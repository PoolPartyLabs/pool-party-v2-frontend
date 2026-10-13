/**
 * @id PP-MGR-CMP-107
 * @name poolSearchSettle
 * @implements-rules-version v1 (POO-2343)
 * @implements-rules-version DEC-204 (POO-2262: a failed read keeps its pinned fallback pools)
 * @analytics-events none, pure logic
 *
 * R5: the decision a multi-network pool read makes when some networks answer and some fail.
 *
 * The Pools step asks one network at a time. A mandate that holds Ethereum and Solana asks both,
 * and DEX Screener (Solana) can fail while the Ethereum read works. One failed read must not
 * reject the whole step: the pools that did arrive stay, and the step names the networks that
 * failed so it can show an error with Retry for that part only.
 *
 * When EVERY read fails there is nothing to keep. The first error is thrown, so a mandate with
 * one network keeps the error state it always had.
 *
 * DEC-204: a job can name a `fallback`, the pools it lists with no read at all (the pinned Raydium
 * release pools). When its read fails those pools stay, in the job's place, and the network still
 * counts as failed, so the step keeps its error with Retry. With a fallback pool in hand, a read
 * where every job failed answers that list and its failures instead of throwing.
 */
import type { MandatePoolRef, NetworkId } from "./mandateDraft";

/** One read of one network. */
export interface PoolSearchJob {
  network: NetworkId;
  run: () => Promise<MandatePoolRef[]>;
  /** DEC-204: the pools this job still lists when its read fails. They need no read. */
  fallback?: () => MandatePoolRef[];
}

/** The pools that arrived, deduped by pool id, and the networks whose read failed. */
export interface SettledPoolSearches {
  pools: MandatePoolRef[];
  /** Each failed network once, in the order of the jobs. Empty when every read worked. */
  failedNetworks: NetworkId[];
}

export async function settlePoolSearches(jobs: PoolSearchJob[]): Promise<SettledPoolSearches> {
  const outcomes = await Promise.allSettled(jobs.map((job) => job.run()));
  const byId = new Map<string, MandatePoolRef>();
  const failedNetworks: NetworkId[] = [];
  let firstError: unknown;
  let failures = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      // Deduped by pool id: a pool that holds two mandate tokens comes back from both reads.
      for (const pool of outcome.value) if (!byId.has(pool.id)) byId.set(pool.id, pool);
      return;
    }
    if (failures === 0) firstError = outcome.reason;
    failures += 1;
    const job = jobs[index];
    for (const pool of job?.fallback?.() ?? []) if (!byId.has(pool.id)) byId.set(pool.id, pool);
    const network = job?.network;
    if (network && !failedNetworks.includes(network)) failedNetworks.push(network);
  });
  if (jobs.length > 0 && failures === jobs.length && byId.size === 0) throw firstError;
  return { pools: [...byId.values()], failedNetworks };
}

/**
 * R10: the network for the error event of a failed Solana read. It is `solana` only when Solana is
 * the one network that failed. The event of an EVM failure keeps the shape it had before Solana
 * joined, and a failure that spans two networks has no single true value.
 */
export function solanaFailureNetwork(networks: readonly NetworkId[]): "solana" | undefined {
  const distinct = [...new Set(networks)];
  return distinct.length === 1 && distinct[0] === "solana" ? "solana" : undefined;
}
