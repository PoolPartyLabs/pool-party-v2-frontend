import "server-only";

import { AQUA_RAW_BALANCES_ABI, PARTY_VAULT_VIEW_ABI } from "../../abis/partyVault";
import { arbitrumPublicClient } from "../../chain/clients";
import {
  AQUA_REGISTRY,
  AQUA_SWAP_VM_ROUTER,
  CHAINLINK_ETH_USD,
  TOKENS,
} from "../../config/addresses";

/**
 * Assembles the live inputs a compile needs: Chainlink spot, the vault's assets, and what is
 * already committed to active strategies.
 *
 * Kept separate from `compile` on purpose. The compiler stays a pure function of its context,
 * which is what makes it deterministic and testable without a chain or a database.
 */

const CHAINLINK_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
  },
] as const;

/** D9: 90 minutes. Measured max gap between updates over 24h was 29.5 min, so this has room. */
export const MAX_ORACLE_STALENESS_SECONDS = BigInt(90 * 60);

export type SpotReading = {
  answerE8: bigint;
  updatedAt: bigint;
  ageSeconds: bigint;
};

/**
 * Read Chainlink ETH/USD and refuse a stale answer.
 *
 * VLT-R4's in-vault staleness gate is deferred for the window, so this off-chain check is the
 * only thing standing between a stale feed and a band built around the wrong price. It fails
 * loudly rather than falling back to a cached value.
 */
export async function readSpot(): Promise<SpotReading> {
  const client = arbitrumPublicClient();
  const [, answer, , updatedAt] = await client.readContract({
    address: CHAINLINK_ETH_USD,
    abi: CHAINLINK_ABI,
    functionName: "latestRoundData",
  });

  if (answer <= BigInt(0)) {
    throw new Error(
      `Chainlink ETH/USD returned a non-positive answer (${answer}); refusing to build a band`,
    );
  }

  const block = await client.getBlock();
  const ageSeconds = block.timestamp - updatedAt;
  if (ageSeconds > MAX_ORACLE_STALENESS_SECONDS) {
    throw new Error(
      `Chainlink ETH/USD is ${ageSeconds}s old, past the ${MAX_ORACLE_STALENESS_SECONDS}s bound (D9). ` +
        "No NAV and no band without a fresh price.",
    );
  }

  return { answerE8: answer, updatedAt, ageSeconds };
}

/**
 * Raw quote units already committed to ACTIVE strategies for this maker (PRG-R6).
 *
 * Read from the Aqua registry rather than from a local ledger. The registry is what actually gates
 * a ship, so asking it removes the class of bug where our bookkeeping and the chain disagree and
 * the compiler sizes a band against money that is already spoken for.
 */
export async function readAlreadyShipped(maker: `0x${string}`): Promise<bigint> {
  const client = arbitrumPublicClient();
  const active = await client.readContract({
    address: maker,
    abi: PARTY_VAULT_VIEW_ABI,
    functionName: "activeStrategies",
  });

  let total = BigInt(0);
  for (const strategyHash of active) {
    const [committed] = await client.readContract({
      address: AQUA_REGISTRY,
      abi: AQUA_RAW_BALANCES_ABI,
      functionName: "rawBalances",
      args: [maker, AQUA_SWAP_VM_ROUTER, strategyHash, TOKENS.USDC],
    });
    total += committed;
  }
  return total;
}

/**
 * Next epoch id for a maker. Epochs are monotonic so a salt is never reused (PRG-R10).
 *
 * Derived from how many strategies the vault currently has active. Without the ships ledger this
 * cannot see epochs that were shipped and later docked, so it is a LOWER BOUND: pass `--epoch`
 * explicitly when rolling a band whose predecessor has already been docked.
 */
export async function nextEpoch(maker: `0x${string}`): Promise<number> {
  const client = arbitrumPublicClient();
  const active = await client.readContract({
    address: maker,
    abi: PARTY_VAULT_VIEW_ABI,
    functionName: "activeStrategies",
  });
  return active.length;
}
