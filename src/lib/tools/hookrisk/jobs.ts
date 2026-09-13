/**
 * @id PP-TOOLS-LIB-005
 * @name hookrisk scan jobs
 * @implements-rules-version v1
 * @analytics-events none (PP-TOOLS-CMP-001 emits the funnel from what this returns)
 *
 * The job layer: one running scan per `(chainId, address)`, progressed in the background and polled
 * over HTTP.
 *
 * A scan compiles a real Solidity project and then runs a fuzzed differential harness against it, so
 * minutes is the normal case and no request can wait for it. The POST therefore starts work and
 * returns an id; a GET reports where that work is. The id is the cache directory name, which is the
 * sha256 of the cache key, so it is deterministic, carries no address, and two tabs asking about the
 * same hook converge on the same job without any coordination.
 *
 * **The registry is in process memory.** That is honest for a demo and wrong for a fleet: a second
 * replica knows nothing about the first replica's running job, and a restart forgets everything in
 * flight. What survives a restart is the part that matters, the cached `HOOK_RISK.md` on disk, so
 * the worst case is one wasted rerun rather than a wrong answer. A durable queue is the upgrade, and
 * it is deliberately not built here.
 */
import "server-only";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { JobSnapshot } from "./contract";
import { fetchVerifiedSource } from "./explorer";
import {
  buildCacheKey,
  cacheDirName,
  isFresh,
  jobDirPath,
  REPORT_FILENAME,
  resolveHookriskHome,
  resolveWorkRoot,
  type SweepEntry,
  selectStaleDirs,
} from "./paths";
import { hookriskTarget, planProject, writeProject } from "./project";
import {
  buildScanArgs,
  describeMissingTools,
  interpretExitCode,
  probeToolchain,
  resolveSlitherBin,
  runCommand,
} from "./run";

export type { JobSnapshot, JobStatus } from "./contract";

interface JobRecord extends JobSnapshot {
  cacheKey: string;
}

/** Budgets. A cold `forge build` of a large hook is minutes; the harness run is minutes more. */
const BUILD_TIMEOUT_MS = 12 * 60 * 1000;
const SCAN_TIMEOUT_MS = 20 * 60 * 1000;
/** How long a finished record is kept so a slow poller still sees its outcome. */
const RECORD_RETENTION_MS = 60 * 60 * 1000;

/**
 * The live registry, keyed by job id.
 *
 * Hung off `globalThis` because Next's dev server re-evaluates modules on every edit, and a plain
 * module-level Map would hand each recompile a fresh one, orphaning jobs that are still running.
 */
const globalScope = globalThis as { __ppHookriskJobs?: Map<string, JobRecord> };
const registry: Map<string, JobRecord> = globalScope.__ppHookriskJobs ?? new Map();
globalScope.__ppHookriskJobs = registry;

function snapshot(record: JobRecord): JobSnapshot {
  const { cacheKey: _cacheKey, ...rest } = record;
  return rest;
}

/** Drop terminal records nobody has polled in an hour, so the map cannot grow without bound. */
function pruneRecords(nowMs: number): void {
  for (const [id, record] of registry) {
    const finished = record.finishedAt;
    if (finished !== undefined && nowMs - finished > RECORD_RETENTION_MS) registry.delete(id);
  }
}

/** The current state of one job, or null when the id is unknown (restart, or never existed). */
export function getJob(jobId: string): JobSnapshot | null {
  const record = registry.get(jobId);
  return record ? snapshot(record) : null;
}

/**
 * Delete every sibling job directory past the TTL.
 *
 * This runs on each start rather than on a schedule: the only thing that creates directories is a
 * request, so a request is the only moment the set can have grown. A failure to sweep is logged and
 * swallowed, because "could not tidy up" must never become "could not scan".
 */
async function sweepWorkRoot(workRoot: string, keep: string, nowMs: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(workRoot);
  } catch {
    return; // The root does not exist yet. Nothing to sweep.
  }
  const stats: SweepEntry[] = [];
  for (const name of entries) {
    try {
      const info = await stat(join(workRoot, name));
      if (info.isDirectory()) stats.push({ name, mtimeMs: info.mtimeMs });
    } catch {
      // Raced by another request's own sweep. Not our problem to resolve.
    }
  }
  for (const name of selectStaleDirs(stats, nowMs, keep)) {
    await rm(join(workRoot, name), { recursive: true, force: true }).catch(() => {});
  }
}

/** Read a cached report, or null when there is none or it has aged out. */
async function readFreshReport(jobDir: string, nowMs: number): Promise<string | null> {
  const reportPath = join(jobDir, REPORT_FILENAME);
  try {
    const info = await stat(reportPath);
    if (!isFresh(info.mtimeMs, nowMs)) return null;
    return await readFile(reportPath, "utf8");
  } catch {
    return null;
  }
}

/** A validated scan request. The route owns validation; this layer trusts its input. */
export interface StartScanInput {
  chainId: number;
  /** EIP-55 checksummed. */
  address: string;
}

function markFailed(record: JobRecord, code: string, message: string): void {
  record.status = "failed";
  record.error = { code, message };
  record.finishedAt = Date.now();
}

/**
 * Run one scan to completion, moving `record` through its statuses.
 *
 * Order is preflight, then source, then build, then scan, and preflight is first on purpose: a host
 * without foundry should learn that in a second, not after a minute of network and disk.
 */
async function runJob(record: JobRecord, input: StartScanInput, jobDir: string): Promise<void> {
  const hookriskHome = resolveHookriskHome(process.env, process.cwd());
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOOKRISK_HOME: hookriskHome,
    HOOKRISK_SLITHER_BIN: resolveSlitherBin(process.env, hookriskHome),
  };

  try {
    const missing = describeMissingTools(await probeToolchain(hookriskHome, childEnv));
    if (missing) {
      markFailed(record, "TOOLCHAIN_MISSING", missing);
      return;
    }

    record.status = "fetching-source";
    const source = await fetchVerifiedSource({
      chainId: input.chainId,
      address: input.address,
      // PP-INTEGRATION-POINT: the block-explorer key is server-only and read at call time, so an
      // unset key fails this one job with a named error instead of breaking the module import.
      apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    });
    if (!source.ok) {
      markFailed(record, source.code, source.message);
      return;
    }

    // A rerun of an expired key must not compile against the previous run's artifacts.
    await rm(jobDir, { recursive: true, force: true });
    const plan = planProject(source.source);
    await writeProject(jobDir, plan);

    record.status = "building";
    const build = await runCommand("forge", ["build"], {
      cwd: jobDir,
      env: childEnv,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    if (build.code !== 0) {
      markFailed(
        record,
        build.timedOut ? "BUILD_TIMEOUT" : "BUILD_FAILED",
        build.timedOut
          ? "Compiling the verified source took longer than the build budget."
          : `The verified source did not compile:\n${build.stderr.trim() || build.stdout.trim()}`,
      );
      return;
    }

    const cliPath = join(hookriskHome, "cli", "dist", "cli.js");
    // `init` writes the hookrisk.toml that declares what a tool cannot observe. It leaves an
    // existing file alone, so a rerun keeps any edits and this stays idempotent.
    await runCommand("node", [cliPath, "init", "--config", join(jobDir, "hookrisk.toml")], {
      cwd: jobDir,
      env: childEnv,
      timeoutMs: 60_000,
    });

    record.status = "scanning";
    const scan = await runCommand(
      "node",
      buildScanArgs(
        cliPath,
        hookriskTarget({ ...source.source, entryFile: plan.entryFile }),
        jobDir,
      ),
      { cwd: jobDir, env: childEnv, timeoutMs: SCAN_TIMEOUT_MS },
    );
    const outcome = scan.timedOut
      ? ({ kind: "cannot-run" } as const)
      : interpretExitCode(scan.code);

    if (outcome.kind === "result") {
      const report = await readFile(join(jobDir, REPORT_FILENAME), "utf8").catch(() => null);
      if (report === null) {
        markFailed(
          record,
          "REPORT_MISSING",
          "hookrisk finished but wrote no report, which should not happen. " +
            `Its log ended with:\n${scan.stderr.trim().slice(-2000)}`,
        );
        return;
      }
      record.report = report;
      record.gatePassed = outcome.gatePassed;
      record.status = "done";
      record.finishedAt = Date.now();
      return;
    }

    markFailed(
      record,
      scan.timedOut ? "SCAN_TIMEOUT" : "SCAN_FAILED",
      scan.timedOut
        ? "The scan exceeded its time budget and was stopped."
        : "hookrisk could not complete a scan of this hook. Its log ended with:\n" +
            scan.stderr.trim().slice(-2000),
    );
  } catch (error) {
    markFailed(
      record,
      "UNEXPECTED",
      `The scan stopped unexpectedly: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
  }
}

/** What a start request resolves to. `reused` means an identical scan was already in flight. */
export interface StartScanResult extends JobSnapshot {
  reused: boolean;
}

/**
 * Start (or join, or short-circuit) a scan of one hook.
 *
 * Three outcomes, in the order they are checked: a fresh report on disk comes back immediately; a
 * job already running for the same hook is joined rather than duplicated, which is the whole of the
 * rate limit; otherwise a new background job starts and the caller polls.
 */
export async function startScan(input: StartScanInput): Promise<StartScanResult> {
  const now = Date.now();
  pruneRecords(now);

  const cacheKey = buildCacheKey(input.chainId, input.address);
  const jobId = cacheDirName(cacheKey);
  const workRoot = resolveWorkRoot(process.env);
  const jobDir = jobDirPath(workRoot, cacheKey);

  await sweepWorkRoot(workRoot, jobId, now);

  const cached = await readFreshReport(jobDir, now);
  if (cached !== null) {
    const record: JobRecord = {
      jobId,
      cacheKey,
      status: "done",
      report: cached,
      cached: true,
      startedAt: now,
      finishedAt: now,
    };
    registry.set(jobId, record);
    return { ...snapshot(record), reused: false };
  }

  const running = registry.get(jobId);
  if (running && running.status !== "done" && running.status !== "failed") {
    return { ...snapshot(running), reused: true };
  }

  const record: JobRecord = { jobId, cacheKey, status: "queued", startedAt: now };
  registry.set(jobId, record);
  // Deliberately not awaited: the request returns 202 and the work continues in the background.
  void runJob(record, input, jobDir);
  return { ...snapshot(record), reused: false };
}
