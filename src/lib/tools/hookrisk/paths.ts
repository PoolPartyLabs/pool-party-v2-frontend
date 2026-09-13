/**
 * @id PP-TOOLS-LIB-001
 * @name hookrisk cache paths and TTL
 * @implements-rules-version v1
 * @analytics-events none (pure path/TTL arithmetic; the screen PP-TOOLS-CMP-001 owns the funnel)
 *
 * Where a hookrisk scan's artifacts live, and for how long.
 *
 * A scan of a deployed hook costs minutes of `forge build` plus a fuzzed differential run, and the
 * answer only changes when the contract does, which for a deployed address is never. So the unit of
 * caching is `(chainId, address)` and the TTL exists to bound disk growth, not to chase staleness.
 *
 * The directory is named after the sha256 of that key rather than the address, for one reason worth
 * stating: the work root defaults to the shared OS temp dir, and a directory listing there would
 * otherwise be a log of which contracts this host has been asked about.
 *
 * There is no cron. Every request sweeps its siblings, which is enough because the only thing that
 * creates entries is a request.
 */
import "server-only";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, isAddress } from "viem";

/**
 * An environment map. An index signature rather than the three named keys, so `process.env` itself
 * is assignable: the vars that matter are `HOOKRISK_WORK_DIR`, `HOOKRISK_HOME` and
 * `HOOKRISK_SLITHER_BIN`, and each is documented on the function that reads it.
 */
export type ScanEnv = Readonly<Record<string, string | undefined>>;

/** How long a `HOOK_RISK.md` on disk is served without rerunning the scan. */
export const SCAN_TTL_MS = 24 * 60 * 60 * 1000;

/** The report hookrisk writes, and the only artifact this feature reads back. */
export const REPORT_FILENAME = "HOOK_RISK.md";

/**
 * The EIP-55 checksummed form of `raw`, or `null` when it is not a 20-byte hex address.
 *
 * Returning null rather than throwing is deliberate: an unparseable address is a user mistake the
 * screen reports as a blocked intent, not an exception anybody should catch.
 */
export function normalizeAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!isAddress(trimmed, { strict: false })) return null;
  return getAddress(trimmed);
}

/** `<chainId>:<address lowercased>`. Lowercased so casing never forks the cache. */
export function buildCacheKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

/** The on-disk directory name for a cache key: its sha256, hex. */
export function cacheDirName(cacheKey: string): string {
  return createHash("sha256").update(cacheKey).digest("hex");
}

/** Root holding every job directory. `HOOKRISK_WORK_DIR` wins; the OS temp dir is the fallback. */
export function resolveWorkRoot(env: ScanEnv, fallback: string = tmpdir()): string {
  const configured = env.HOOKRISK_WORK_DIR?.trim();
  return join(configured && configured.length > 0 ? configured : fallback, "hookrisk");
}

/** The hookrisk checkout holding `harness/`, `schema/` and `cli/dist`. Defaults to `<repo>/hookrisk`. */
export function resolveHookriskHome(env: ScanEnv, repoRoot: string): string {
  const configured = env.HOOKRISK_HOME?.trim();
  return configured && configured.length > 0 ? configured : join(repoRoot, "hookrisk");
}

/** Absolute path of one job's directory. */
export function jobDirPath(workRoot: string, cacheKey: string): string {
  return join(workRoot, cacheDirName(cacheKey));
}

/**
 * Whether a report written at `mtimeMs` is still inside the TTL at `nowMs`.
 *
 * A future mtime reads as NOT fresh. A clock that disagrees with the filesystem is a reason to
 * rerun a cheap-to-rerun thing, not a reason to serve a report of unknown age forever.
 */
export function isFresh(mtimeMs: number, nowMs: number, ttlMs: number = SCAN_TTL_MS): boolean {
  const age = nowMs - mtimeMs;
  return age >= 0 && age <= ttlMs;
}

/** One entry of the work root, as `readdir` + `stat` produce it. */
export interface SweepEntry {
  name: string;
  mtimeMs: number;
}

/**
 * The directory names to delete: everything past the TTL except `keep`.
 *
 * `keep` is the job the current request is about to write into. It can legitimately be stale (a
 * previous scan of the same hook, now expired) and deleting it here would race that request's own
 * writer, so the caller names it and the sweep steps over it.
 */
export function selectStaleDirs(
  entries: readonly SweepEntry[],
  nowMs: number,
  keep?: string,
  ttlMs: number = SCAN_TTL_MS,
): string[] {
  return entries
    .filter((entry) => entry.name !== keep && !isFresh(entry.mtimeMs, nowMs, ttlMs))
    .map((entry) => entry.name);
}
