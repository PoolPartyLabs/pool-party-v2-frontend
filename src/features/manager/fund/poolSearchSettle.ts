/**
 * @id PP-MGR-CMP-107
 * @name poolSearchSettle
 * @implements-rules-version v1 (POO-2343)
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
 */
import type { MandatePoolRef, NetworkId } from "./mandateDraft";

/** One read of one network. */
export interface PoolSearchJob {
  network: NetworkId;
  run: () => Promise<MandatePoolRef[]>;
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
    const network = jobs[index]?.network;
    if (network && !failedNetworks.includes(network)) failedNetworks.push(network);
  });
  if (jobs.length > 0 && failures === jobs.length) throw firstError;
  return { pools: [...byId.values()], failedNetworks };
}
