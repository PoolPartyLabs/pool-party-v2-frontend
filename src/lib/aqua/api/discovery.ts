import "server-only";

import { PARTY_VAULT_VIEW_ABI } from "../abis/partyVault";
import { arbitrumPublicClient } from "../chain/clients";
import { AQUA_REGISTRY, AQUA_SWAP_VM_ROUTER } from "../config/addresses";

/**
 * Finds every Active Reserve vault from chain, so a newly launched strategy appears without
 * anyone editing config.
 *
 * There is no factory: `Deploy.s.sol` does `new PartyVault(...)` directly, so no contract
 * holds a list of ours. What DOES exist is the trail every live strategy must leave: to quote
 * anything at all, a vault has to ship to the official Aqua registry naming our router as the
 * app. So the registry's `Shipped` log IS the index, and we recover it by scanning and then
 * proving each maker is one of ours.
 *
 * The proof is `OWNER() == the manager address`. 1inch's own makers are EOAs and fail the
 * call outright; a third-party contract that happened to expose `OWNER()` would still have to
 * return OUR manager, which it cannot. A vault that has never shipped does not appear, which
 * is correct: it has no strategy to show.
 */

/** Gen-2 registry's first activity. A fixed floor, so the scan window cannot silently drift. */
const SCAN_FLOOR_BLOCK = BigInt(487_600_000);

/** Public RPCs cap eth_getLogs; 90k blocks per call is comfortably inside Arbitrum's limits. */
const CHUNK = BigInt(90_000);

const SHIPPED_TOPIC = "0xdc3622e06fb145651f567d421c9ef261d71d43e3778b761907bc0d70d42e52b0";

export type DiscoveredVault = {
  vault: `0x${string}`;
  adapter: `0x${string}` | null;
  owner: `0x${string}`;
  /** Ships seen in the scan window, newest last. Used only to order the list. */
  shipCount: number;
  firstSeenBlock: bigint;
};

function managerAddress(): `0x${string}` | null {
  const raw = process.env.AQUA_MANAGER_ADDRESS;
  return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as `0x${string}`) : null;
}

/**
 * Every vault this manager has shipped a strategy from, newest first.
 *
 * Returns [] rather than throwing when the manager is unset: the page then falls back to the
 * pinned `AQUA_VAULT_ADDRESS`, so a missing env var degrades to today's behaviour instead of
 * an empty screen.
 */
export async function discoverVaults(): Promise<DiscoveredVault[]> {
  const manager = managerAddress();
  if (!manager) return [];

  const client = arbitrumPublicClient();
  const head = await client.getBlockNumber();

  // maker -> ships seen, and the block we first saw it at.
  const seen = new Map<string, { ships: number; firstBlock: bigint }>();

  let from = SCAN_FLOOR_BLOCK;
  while (from <= head) {
    const to = from + CHUNK > head ? head : from + CHUNK;
    const logs = await getLogsWithRetry(from, to);

    for (const log of logs) {
      if (log.topics[0] !== SHIPPED_TOPIC) continue;
      const { maker, app } = decodeShippedHeader(log.data);
      // Only strategies pointed at OUR router; the registry serves other apps too.
      if (app.toLowerCase() !== AQUA_SWAP_VM_ROUTER.toLowerCase()) continue;

      const key = maker.toLowerCase();
      const prior = seen.get(key);
      if (prior) prior.ships += 1;
      else seen.set(key, { ships: 1, firstBlock: log.blockNumber });
    }

    if (to === head) break;
    from = to + BigInt(1);
  }

  const vaults: DiscoveredVault[] = [];
  for (const [maker, { ships, firstBlock }] of seen) {
    const identity = await identifyVault(maker as `0x${string}`, manager);
    if (!identity) continue;
    vaults.push({
      vault: maker as `0x${string}`,
      adapter: identity.adapter,
      owner: identity.owner,
      shipCount: ships,
      firstSeenBlock: firstBlock,
    });
  }

  // Newest deployment first: the strategy someone just launched is the one they want to see.
  return vaults.sort((a, b) => (a.firstSeenBlock < b.firstSeenBlock ? 1 : -1));
}

/**
 * Public RPCs drop requests under load, and a dropped chunk here silently loses every vault
 * in that block range: discovery would return fewer strategies with no error anywhere. Retry,
 * then fail loudly, because a short list is indistinguishable from a correct one.
 */
async function getLogsWithRetry(from: bigint, to: bigint, attempts = 3) {
  const client = arbitrumPublicClient();
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await client.getLogs({ address: AQUA_REGISTRY, fromBlock: from, toBlock: to });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
  throw new Error(
    `Aqua registry log scan failed for blocks ${from}-${to} after ${attempts} attempts: ` +
      `${(lastError as Error)?.message ?? "unknown"}. Refusing to return a partial vault list.`,
  );
}

/**
 * Is this maker one of our vaults? Returns null for anything that is not, including EOAs,
 * which simply revert the call.
 */
async function identifyVault(
  maker: `0x${string}`,
  manager: `0x${string}`,
): Promise<{ owner: `0x${string}`; adapter: `0x${string}` | null } | null> {
  const client = arbitrumPublicClient();
  try {
    const owner = (await client.readContract({
      address: maker,
      abi: PARTY_VAULT_VIEW_ABI,
      functionName: "OWNER",
    })) as `0x${string}`;
    if (owner.toLowerCase() !== manager.toLowerCase()) return null;

    const adapter = (await client
      .readContract({ address: maker, abi: PARTY_VAULT_VIEW_ABI, functionName: "ADAPTER" })
      .catch(() => null)) as `0x${string}` | null;

    return { owner, adapter };
  } catch {
    return null;
  }
}

/**
 * `Shipped(address maker, address app, bytes32 strategyHash, bytes strategy)`, all non-indexed.
 * Only the two leading addresses are needed to decide whether to keep scanning this log, and
 * slicing them is cheaper than decoding the trailing `bytes` for every log in the window.
 */
export function decodeShippedHeader(data: `0x${string}`): {
  maker: `0x${string}`;
  app: `0x${string}`;
} {
  const body = data.slice(2);
  const word = (index: number) => body.slice(index * 64, (index + 1) * 64);
  return {
    maker: `0x${word(0).slice(24)}` as `0x${string}`,
    app: `0x${word(1).slice(24)}` as `0x${string}`,
  };
}
