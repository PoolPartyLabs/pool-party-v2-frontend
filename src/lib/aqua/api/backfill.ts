import "server-only";

import { ShippedEvent } from "@1inch/aqua-sdk";
import { AquaProgramBuilder, HexString, Order } from "@1inch/swap-vm-sdk";
import { arbitrumPublicClient } from "../chain/clients";
import { AQUA_REGISTRY, AQUA_SWAP_VM_ROUTER } from "../config/addresses";
import { MANDATES } from "./compiler/mandates";
import type { MandateName } from "./compiler/types";

/**
 * Rebuilds `aqua_ships` from chain.
 *
 * The launch ran through Foundry scripts, which cannot write to Postgres, so the table was
 * empty and the page had no band edges or mandate names to show. Everything needed is already
 * public: the `Shipped` event carries the whole ABI-encoded Order, and the program inside it
 * carries the deadline, the concentrate bounds and the salt. The vault's own `StrategyShipped`
 * carries the amounts.
 *
 * So this is a decode, not a reconstruction from memory. Anyone with an RPC can reproduce
 * every row, which is the same property that makes the taker honest.
 */

const SHIPPED_TOPIC = "0xdc3622e06fb145651f567d421c9ef261d71d43e3778b761907bc0d70d42e52b0";
/** PartyVault: StrategyShipped(bytes32 indexed strategyHash, address[] tokens, uint256[] amounts) */
const STRATEGY_SHIPPED_TOPIC = "0x5430a2db5b5fee50925286db9f35c07ceee306dc877935e29afe189f1dd143f2";

const SCAN_FLOOR_BLOCK = BigInt(487_600_000);
const CHUNK = BigInt(90_000);

export type BackfilledShip = {
  /** The vault's Nth ship. See the note where it is assigned: NOT the salt. */
  epochIndex: number;
  strategyHash: `0x${string}`;
  maker: string;
  app: string;
  mandate: MandateName | "unknown";
  programHex: string;
  orderBytes: string;
  salt: string;
  deadline: bigint;
  spotE8: string;
  bandLowE8: string;
  bandHighE8: string;
  shippedUsdc: string;
  shippedWeth: string;
  status: "active" | "docked";
  shipTxHash: string;
  shippedAt: Date;
};

/**
 * Decode every ship a vault has made. Reads only; the caller decides what to persist.
 */
export async function decodeShipsFromChain(vault: `0x${string}`): Promise<BackfilledShip[]> {
  const client = arbitrumPublicClient();
  const head = await client.getBlockNumber();

  const active = new Set(
    (
      (await client.readContract({
        address: vault,
        abi: [
          {
            type: "function",
            name: "activeStrategies",
            inputs: [],
            outputs: [{ type: "bytes32[]" }],
            stateMutability: "view",
          },
        ] as const,
        functionName: "activeStrategies",
      })) as readonly `0x${string}`[]
    ).map((h) => h.toLowerCase()),
  );

  const ships: BackfilledShip[] = [];
  let from = SCAN_FLOOR_BLOCK;

  while (from <= head) {
    const to = from + CHUNK > head ? head : from + CHUNK;
    const logs = await client.getLogs({ address: AQUA_REGISTRY, fromBlock: from, toBlock: to });

    for (const log of logs) {
      if (log.topics[0] !== SHIPPED_TOPIC) continue;

      const parsed = ShippedEvent.fromLog({ topics: [...log.topics], data: log.data });
      if (parsed.maker.toString().toLowerCase() !== vault.toLowerCase()) continue;
      if (parsed.app.toString().toLowerCase() !== AQUA_SWAP_VM_ROUTER.toLowerCase()) continue;

      const orderBytes = parsed.strategy.toString();
      const order = Order.decode(parsed.strategy);
      const program = order.program.toString();
      const decoded = decodeProgramFacts(program);
      if (!decoded) continue;

      const block = await client.getBlock({ blockNumber: log.blockNumber });
      const amounts = await readShippedAmounts(vault, log.transactionHash);
      const strategyHash = parsed.strategyHash.toString() as `0x${string}`;

      ships.push({
        // The launch builder used a timestamp-like salt (4,876,650,791), which overflows the
        // int4 `epoch` column. Epoch is a compiler concept and these ships did not come from
        // the compiler, so it is the vault's Nth ship instead. `salt` keeps the real value in
        // its numeric(78,0) column, and that is what identity actually depends on (PRG-R10).
        epochIndex: ships.filter((s) => s.maker === vault.toLowerCase()).length,
        strategyHash,
        maker: vault.toLowerCase(),
        app: AQUA_SWAP_VM_ROUTER.toLowerCase(),
        mandate: decoded.mandate,
        programHex: program,
        orderBytes,
        salt: decoded.salt.toString(),
        deadline: decoded.deadline,
        spotE8: decoded.spotE8.toString(),
        bandLowE8: decoded.lowE8.toString(),
        bandHighE8: decoded.highE8.toString(),
        shippedUsdc: amounts.usdc.toString(),
        shippedWeth: amounts.weth.toString(),
        status: active.has(strategyHash.toLowerCase()) ? "active" : "docked",
        shipTxHash: log.transactionHash,
        shippedAt: new Date(Number(block.timestamp) * 1000),
      });
    }

    if (to === head) break;
    from = to + BigInt(1);
  }

  return ships;
}

/**
 * Pull the deadline, band and salt back out of the program bytes.
 *
 * Returns null for a program shape we did not write (a pegged strategy, say): better to skip
 * a row than to record a band that was never there.
 */
function decodeProgramFacts(programHex: string): {
  deadline: bigint;
  salt: bigint;
  lowE8: bigint;
  highE8: bigint;
  spotE8: bigint;
  mandate: MandateName | "unknown";
} | null {
  const builder = AquaProgramBuilder.decode(new HexString(programHex) as never);
  let deadline: bigint | null = null;
  let salt: bigint | null = null;
  let sqrtMin: bigint | null = null;
  let sqrtMax: bigint | null = null;

  for (const ix of builder.getInstructions()) {
    const name = ix.opcode.id.description ?? "";
    const args = ix.args as unknown as Record<string, bigint>;
    if (name === "Controls.deadline") deadline = args.deadline ?? null;
    if (name === "Controls.salt") salt = args.salt ?? null;
    if (name === "XYCConcentrate.concentrateGrowLiquidity2D") {
      sqrtMin = args.sqrtPriceMin ?? null;
      sqrtMax = args.sqrtPriceMax ?? null;
    }
  }

  if (deadline === null || salt === null || sqrtMin === null || sqrtMax === null) return null;

  const lowE8 = sqrtPriceToE8(sqrtMin);
  const highE8 = sqrtPriceToE8(sqrtMax);
  const { mandate, spotE8 } = classifyBand(lowE8, highE8);
  return { deadline, salt, lowE8, highE8, spotE8, mandate };
}

/**
 * Invert the concentrate encoding: (sqrtPrice/1e18)^2 = P/1e18, where P is USDC raw per WETH
 * raw in 1e18 fixed point, which for 6dp/18dp tokens is priceUsd * 1e6. Back to Chainlink's
 * 8dp: multiply by 100.
 */
function sqrtPriceToE8(sqrtPrice: bigint): bigint {
  const ONE = BigInt(10) ** BigInt(18);
  // (sqrtPrice/1e18)^2 = P/1e18, and for WETH(18dp)/USDC(6dp) that P IS priceUsd * 1e6.
  const rawPriceX18 = (sqrtPrice * sqrtPrice) / ONE;
  // priceUsd * 1e6 -> priceUsd * 1e8 is a single factor of 100. Dividing by 1e6 as well, as
  // an earlier version did, floors every band to zero.
  return rawPriceX18 * BigInt(100);
}

/**
 * Which mandate produced this band, and what spot was it built against?
 *
 * The band edges are exact, and each mandate has a distinct shape: production spans 15% to 5%
 * below spot, demo spans 0.3% to 0.1%. Matching the RATIO high/low identifies the mandate
 * without needing the price at ship time, and spot then follows exactly from the high edge and
 * that mandate's offset. An unrecognised shape stays "unknown" with spot left at the high
 * edge, rather than inventing a mandate.
 */
function classifyBand(
  lowE8: bigint,
  highE8: bigint,
): { mandate: MandateName | "unknown"; spotE8: bigint } {
  if (lowE8 <= BigInt(0)) return { mandate: "unknown", spotE8: highE8 };

  const BPS = BigInt(10_000);
  const ratio = Number(highE8) / Number(lowE8);

  for (const name of ["production", "demo"] as const) {
    const m = MANDATES[name];
    const expected =
      BPS + BigInt(m.bandHighPct) === BigInt(0)
        ? 0
        : Number(BPS + BigInt(m.bandHighPct)) / Number(BPS + BigInt(m.bandLowPct));
    // Tolerant compare: the edges went through an integer sqrt, so they are near but not exact.
    if (Math.abs(ratio - expected) / expected < 0.005) {
      const spotE8 = (highE8 * BPS) / (BPS + BigInt(m.bandHighPct));
      return { mandate: name, spotE8 };
    }
  }
  return { mandate: "unknown", spotE8: highE8 };
}

/**
 * The shipped amounts, taken from the vault's own `StrategyShipped` in the same transaction.
 *
 * Falls back to zeroes rather than failing the row: the band edges and program are the part
 * the page actually renders, and a missing amount is visibly zero rather than wrong.
 */
async function readShippedAmounts(
  vault: `0x${string}`,
  txHash: `0x${string}`,
): Promise<{ usdc: bigint; weth: bigint }> {
  const client = arbitrumPublicClient();
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    const log = receipt.logs.find(
      (l) =>
        l.address.toLowerCase() === vault.toLowerCase() &&
        l.topics[0]?.toLowerCase() === STRATEGY_SHIPPED_TOPIC,
    );
    if (!log) return { usdc: BigInt(0), weth: BigInt(0) };

    // tokens[] then amounts[], both dynamic: [offset0][offset1][len][..][len][..]
    const body = log.data.slice(2);
    const word = (i: number) => BigInt(`0x${body.slice(i * 64, (i + 1) * 64)}`);
    const amountsOffset = Number(word(1)) / 32;
    const count = Number(word(amountsOffset));
    const amounts: bigint[] = [];
    for (let i = 0; i < count; i += 1) amounts.push(word(amountsOffset + 1 + i));
    // The compiler always ships [quote, base] in that order (PRG-R2).
    return { usdc: amounts[0] ?? BigInt(0), weth: amounts[1] ?? BigInt(0) };
  } catch {
    return { usdc: BigInt(0), weth: BigInt(0) };
  }
}
