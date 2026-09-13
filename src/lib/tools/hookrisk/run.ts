/**
 * @id PP-TOOLS-LIB-004
 * @name hookrisk toolchain preflight and invocation
 * @implements-rules-version v1
 * @analytics-events none
 *
 * The shell-out layer: what has to exist on the host, how the CLI is invoked, and what its exit
 * code means.
 *
 * Two rules drive everything here, both taken from hookrisk's own posture (`hookrisk/CLAUDE.md`):
 *
 *   1. **Exit 2 is a result.** The gate failing means the tool worked and the hook did not pass. It
 *      comes back with a full report, and presenting it as an error would throw away the exact
 *      output the user asked for. Codes 10 and above mean hookrisk could not run; those have no
 *      report and must be shown as the failures they are.
 *   2. **Never fake a report.** If `forge`, `slither` or the built CLI is missing, the job fails
 *      immediately naming what is absent and the command that installs it. A tool that reports
 *      nothing looks exactly like a clean bill of health.
 */
import "server-only";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import type { ScanEnv } from "./paths";

/** What an exit code means. */
export type ExitInterpretation =
  | { kind: "result"; gatePassed: boolean }
  | { kind: "usage" }
  | { kind: "cannot-run" };

/** Map a hookrisk exit code onto the three outcomes that matter to the page. */
export function interpretExitCode(code: number): ExitInterpretation {
  if (code === 0) return { kind: "result", gatePassed: true };
  if (code === 2) return { kind: "result", gatePassed: false };
  if (code === 64) return { kind: "usage" };
  // Everything else, catalogue codes (10-70) and an uncaught crash (1) alike, means no report.
  return { kind: "cannot-run" };
}

/** Which of the three required tools were found. */
export interface ToolchainProbe {
  forge: boolean;
  slither: boolean;
  cli: boolean;
}

/**
 * A single sentence naming every missing tool and how to install it, or null when nothing is
 * missing. One message for all three, so a host with nothing installed does not need three
 * round trips to learn that.
 */
export function describeMissingTools(probe: ToolchainProbe): string | null {
  const missing: string[] = [];
  if (!probe.forge) {
    missing.push(
      "`forge` (Foundry) is not on PATH: install it with `curl -L https://foundry.paradigm.xyz | bash && foundryup`",
    );
  }
  if (!probe.slither) {
    missing.push(
      "`slither` was not found: install it with `pip install slither-analyzer` and point HOOKRISK_SLITHER_BIN at the binary",
    );
  }
  if (!probe.cli) {
    missing.push(
      "the hookrisk CLI is not built (`cli/dist/cli.js` is missing): run `make setup` inside `hookrisk/`",
    );
  }
  if (missing.length === 0) return null;
  return `This host cannot run a hook scan. ${missing.join(". ")}.`;
}

/** The slither binary to use: the explicit env var, else the checkout's own `make setup` venv. */
export function resolveSlitherBin(env: ScanEnv, hookriskHome: string): string {
  const configured = env.HOOKRISK_SLITHER_BIN?.trim();
  return configured && configured.length > 0
    ? configured
    : join(hookriskHome, ".venv", "bin", "slither");
}

/**
 * The argv for `node <cli.js> scan ...`.
 *
 * `--log-json` so the progress log is machine-readable on stderr; the job keeps the tail of it and
 * shows it when something goes wrong, which is the difference between "it failed" and "it failed
 * because the harness could not stand the hook up".
 */
export function buildScanArgs(cliPath: string, target: string, jobDir: string): string[] {
  return [cliPath, "scan", target, "--root", jobDir, "--out", jobDir, "--log-json"];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The outcome of running one command to completion. */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Keep only the tail of a stream: a failing `forge build` can produce megabytes of it. */
const MAX_CAPTURED_CHARS = 16_384;
function appendCapped(buffer: string, chunk: string): string {
  const next = buffer + chunk;
  return next.length > MAX_CAPTURED_CHARS ? next.slice(next.length - MAX_CAPTURED_CHARS) : next;
}

/**
 * Run one command and capture its output.
 *
 * PP-INTEGRATION-POINT: this is the seam into the hookrisk toolchain (`forge`, then the hookrisk
 * CLI). It is a child process on the Node runtime, never anything the browser can reach, and the
 * argv is assembled from validated inputs only. No shell: `spawn` without `shell: true` means an
 * explorer-supplied contract name can never become a shell metacharacter.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

/** Whether `forge`, `slither` and the built hookrisk CLI are all reachable from this process. */
export async function probeToolchain(
  hookriskHome: string,
  env: NodeJS.ProcessEnv,
): Promise<ToolchainProbe> {
  const cliPath = join(hookriskHome, "cli", "dist", "cli.js");
  const slitherBin = resolveSlitherBin(env, hookriskHome);
  const [cli, forgeRun, slitherOnPath, slitherAtVenv] = await Promise.all([
    exists(cliPath),
    runCommand("forge", ["--version"], { cwd: hookriskHome, env, timeoutMs: 15_000 }),
    runCommand("slither", ["--version"], { cwd: hookriskHome, env, timeoutMs: 30_000 }),
    exists(slitherBin),
  ]);
  return {
    forge: forgeRun.code === 0,
    slither: slitherAtVenv || slitherOnPath.code === 0,
    cli,
  };
}
