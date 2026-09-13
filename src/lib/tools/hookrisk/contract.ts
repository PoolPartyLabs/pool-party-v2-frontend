/**
 * @id PP-TOOLS-LIB-006
 * @name hookrisk scan contract (shared client/server)
 * @implements-rules-version v1
 * @analytics-events none
 *
 * The narrow slice of the hookrisk feature that BOTH sides need: which chains the picker offers,
 * and the shape of a job snapshot the screen polls for.
 *
 * It is a separate module for one reason. Everything else under `src/lib/tools/hookrisk/` begins
 * `import "server-only"` because it spawns processes and writes files, and a client component
 * importing any of it would fail the build. Rather than weaken that guard, the shared vocabulary
 * lives here, with no `server-only` and no Node imports, and the server modules re-export from it.
 */

/** One chain the Tools page offers. Adding a row is the whole cost of supporting a chain. */
export interface SupportedChain {
  id: number;
  /** Short label. Not translated: these are proper nouns. */
  name: string;
}

/** The chains we read verified source from, in the order the picker shows them. */
export const SUPPORTED_CHAINS: readonly SupportedChain[] = [
  { id: 1, name: "Ethereum" },
  { id: 130, name: "Unichain" },
  { id: 8453, name: "Base" },
  { id: 42161, name: "Arbitrum" },
  { id: 137, name: "Polygon" },
] as const;

/** Whether `chainId` is one of the chains the page offers. */
export function isSupportedChain(chainId: number): boolean {
  return SUPPORTED_CHAINS.some((chain) => chain.id === chainId);
}

/** Where a scan is. `done` and `failed` are terminal. */
export type JobStatus = "queued" | "fetching-source" | "building" | "scanning" | "done" | "failed";

/** What a poll returns. Deliberately carries no address: the caller already knows it. */
export interface JobSnapshot {
  jobId: string;
  status: JobStatus;
  /** `HOOK_RISK.md`, present only on `done`. */
  report?: string;
  /** Present only on `failed`: a code for analytics and a sentence for the user. */
  error?: { code: string; message: string };
  /** True when the report came from cache rather than a fresh scan. */
  cached?: boolean;
  /**
   * Whether hookrisk's own gate passed. Undefined when the scan could not run.
   *
   * `false` is NOT an error: hookrisk exits 2 when a hook fails the gate and still writes the full
   * report, which is the output the user asked for.
   */
  gatePassed?: boolean;
  startedAt: number;
  finishedAt?: number;
}
