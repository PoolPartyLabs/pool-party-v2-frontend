/**
 * Adapter for BlockSec's HookScan (https://github.com/blocksecteam/hookscan).
 *
 * Why an adapter and not a reimplementation
 * -----------------------------------------
 * HookScan is a Yul/CFG-level static analyzer for v4 hooks, derived from
 * BlockSec's Phalcon Inspector and backed by their published research. Two of
 * its four detectors cover the same ground as our HS-01 and HS-04, and it does
 * so from bytecode, which catches cases source-level analysis misses. The other
 * two — unprotected `unlockCallback` and `SELFDESTRUCT` — are coverage hookrisk
 * does not have at all.
 *
 * Rewriting that would be worse in every direction: more code, less accurate,
 * and it would misrepresent whose work it is. So hookrisk runs their tool and
 * attributes it. Findings the two engines agree on are merged into a single
 * corroborated finding with raised confidence (see `dedupe.ts`), never counted
 * twice.
 *
 * What it takes to actually run the published image
 * -------------------------------------------------
 * The image is real and it works, but three things stand between `docker pull`
 * and a result, and all three are handled here rather than left to the user:
 *
 * 1. **It is `linux/amd64` only.** On Apple Silicon a bare `docker pull` fails
 *    with `no matching manifest for linux/arm64/v8`. Every invocation therefore
 *    carries `--platform linux/amd64` (see {@link DEFAULT_PLATFORM}) so the
 *    image runs under emulation, and `probe()` hands back a pull command that
 *    carries the same flag.
 *
 * 2. **Its entrypoint cannot start.** `/entrypoint.sh` derives a uid/gid from
 *    the mounted `/project` and calls `groupadd`/`useradd` with them. Under
 *    Docker Desktop the mount is owned by uid 0, so `groupadd -g 0` fails with
 *    "GID '0' already exists", `chown` fails, and the final `su scanner` never
 *    reaches the analyser. The container then exits having printed only its
 *    `arg list: ...` banner, which is exactly the "could not parse HookScan
 *    output" this adapter used to report. We bypass it with
 *    `--entrypoint python` and build the argument vector the entrypoint would
 *    have built — see {@link buildRunArgs}. Nothing is lost: the user-creation
 *    dance only existed to keep output files owned by the host user, and
 *    HookScan writes none.
 *
 * 3. **It ships solc 0.8.14–0.8.24.** v4-core pins 0.8.26, so every current
 *    hook fails to compile inside the image as published. When the version the
 *    project needs is absent we fetch that exact linux-amd64 static binary from
 *    binaries.soliditylang.org into a host cache and mount it read-only at the
 *    path HookScan expects. The download happens on the *host*; the analysis
 *    container itself still runs `--network none`.
 *
 * Licensing
 * ---------
 * HookScan is AGPL-3.0. hookrisk invokes it as an isolated process — a container
 * or a separate interpreter — and never links against it or redistributes it.
 * That is mere aggregation, so hookrisk's own MIT licensing is unaffected, and
 * no HookScan code ships in this repository. The user obtains it themselves via
 * `docker pull`. See NOTICE and docs/PRIOR_ART.md.
 *
 * This engine is opt-in and never required: if Docker is absent the scan
 * proceeds without it and the manifest records the engine as skipped, so a
 * reader can tell "no unprotected callback was found" apart from "nothing
 * looked".
 */

import { spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, resolve } from 'node:path';

import type {
  Confidence,
  Engine,
  EngineContext,
  EngineResult,
  Finding,
  RuleClass,
  Severity,
} from '../types.js';
import { makeFindingId } from './dedupe.js';

/** Default published image. Overridable for air-gapped or pinned deployments. */
const DEFAULT_IMAGE = 'futuretech6/hookscan';

/**
 * The image publishes an amd64 manifest and nothing else. Passing the platform
 * unconditionally is correct on an amd64 host too (it is a no-op there) and is
 * the difference between "runs under emulation" and "no matching manifest" on
 * arm64. Set `HOOKRISK_BLOCKSEC_PLATFORM=` (empty) to omit the flag entirely,
 * for a runtime that does not understand it.
 */
const DEFAULT_PLATFORM = 'linux/amd64';

/** Where the project and the solc tree live inside the container. */
const PROJECT_MOUNT = '/project';
const SOLC_ROOT = '/solc';

/** Official static builds. Only the linux-amd64 tree is relevant: see (1) above. */
const SOLC_BINARIES_BASE = 'https://binaries.soliditylang.org/linux-amd64';

/** A solc release binary is ~15MB; anything far below that is a truncated or error page. */
const MIN_SOLC_BYTES = 1_000_000;

/** Host-side network budget. Independent of the per-engine container budget. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * BlockSec detector name -> our canonical class.
 *
 * The two entries that map onto classes we also detect are what make dedupe
 * work; the two that do not are pure coverage gain.
 */
const RULE_CLASS_MAP: Record<string, RuleClass> = {
  UniswapPublicHook: 'unprotected-hook-callback',
  UniswapUpgradableHook: 'upgradeable-hook',
  UniswapPublicCallback: 'unprotected-unlock-callback',
  UniswapSuicidalHook: 'selfdestruct',
};

/**
 * HookScan reports `high | medium | low | info`. Our scale adds `critical`.
 *
 * We deliberately do not promote anything to `critical` here. Severity escalation
 * is hookrisk's judgement, applied later with context the engine does not have
 * (TVL declaration, whether the pool is live), and silently upgrading another
 * tool's rating would misattribute an opinion to BlockSec that they did not make.
 */
const SEVERITY_MAP: Record<string, Severity> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'info',
};

const CONFIDENCE_MAP: Record<string, Confidence> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

/** Which framework dimensions and triggers each class informs. */
const FRAMEWORK_LINKS: Partial<
  Record<RuleClass, { dimensions?: string[]; triggers?: string[] }>
> = {
  'unprotected-hook-callback': { dimensions: ['complexity'] },
  'unprotected-unlock-callback': { dimensions: ['complexity'] },
  'upgradeable-hook': { dimensions: ['upgradeability'], triggers: ['upgradeable'] },
  selfdestruct: { dimensions: ['upgradeability'], triggers: ['upgradeable'] },
};

/** Shape of one entry in HookScan's `detection_results` array. */
interface BlockSecResult {
  detector_name: string;
  vulnerability: string;
  external_function?: string | null;
  function_selector?: string;
  yul_call_stack?: string[];
  source_location?: string;
  severity: string;
  confidence: string;
  additional_info?: unknown;
}

interface BlockSecOutput {
  detection_results?: BlockSecResult[];
  error?: string;
  error_type?: string;
}

/** One `-v host:container[:ro]` binding. */
export interface Mount {
  host: string;
  container: string;
  readOnly?: boolean;
}

export interface BlockSecOptions {
  /** Container image. Defaults to the published one. */
  image?: string;
  /** Container runtime. `podman` works unchanged. */
  runtime?: string;
  /** Skip entirely, e.g. when the user has not accepted pulling a third-party image. */
  enabled?: boolean;
  /** `--platform` value. Empty string omits the flag. Defaults to `linux/amd64`. */
  platform?: string;
}

export class BlockSecEngine implements Engine {
  readonly id = 'blocksec';
  readonly displayName = 'BlockSec HookScan';
  readonly upstream = {
    url: 'https://github.com/blocksecteam/hookscan',
    license: 'AGPL-3.0',
  };

  private readonly image: string;
  private readonly runtime: string;
  private readonly enabled: boolean;
  private readonly platform: string;

  constructor(opts: BlockSecOptions = {}) {
    this.image = opts.image ?? process.env.HOOKRISK_BLOCKSEC_IMAGE ?? DEFAULT_IMAGE;
    this.runtime = opts.runtime ?? process.env.HOOKRISK_CONTAINER_RUNTIME ?? 'docker';
    this.enabled = opts.enabled ?? true;
    // `?? DEFAULT` rather than `|| DEFAULT`: an explicitly empty env var is a
    // deliberate "omit the flag", not an absent setting.
    this.platform = opts.platform ?? process.env.HOOKRISK_BLOCKSEC_PLATFORM ?? DEFAULT_PLATFORM;
  }

  async probe(): Promise<{ available: boolean; version: string; reason?: string }> {
    if (!this.enabled) {
      return { available: false, version: 'n/a', reason: 'disabled in configuration' };
    }

    const runtime = await exec(this.runtime, ['--version'], 15_000).catch(() => null);
    if (!runtime || runtime.code !== 0) {
      return {
        available: false,
        version: 'n/a',
        reason: `\`${this.runtime}\` not available; BlockSec HookScan runs as a container`,
      };
    }

    // `image inspect` succeeds only when the image is present locally. We do not
    // pull implicitly: downloading a third-party image is the user's decision,
    // and a scan that silently fetches hundreds of megabytes is a bad surprise
    // in CI.
    const img = await exec(this.runtime, ['image', 'inspect', this.image], 30_000).catch(
      () => null,
    );
    if (!img || img.code !== 0) {
      return { available: false, version: 'n/a', reason: this.pullHint() };
    }

    const digest = firstLine(img.stdout.match(/"Id":\s*"([^"]+)"/)?.[1] ?? 'unknown');
    return { available: true, version: `${this.image}@${digest.slice(0, 19)}` };
  }

  /**
   * The remediation line for a missing image.
   *
   * It carries `--platform` because the bare command genuinely does not work on
   * the arm64 machines a lot of people develop on, and a suggestion that fails
   * when followed is worse than no suggestion.
   */
  private pullHint(): string {
    const platform = this.platform ? `--platform ${this.platform} ` : '';
    return `image \`${this.image}\` not present locally — run \`${this.runtime} pull ${platform}${this.image}\` to enable this engine`;
  }

  async run(ctx: EngineContext): Promise<EngineResult> {
    const started = Date.now();
    const probe = await this.probe();

    if (!probe.available) {
      ctx.log(`blocksec: skipped (${probe.reason})`);
      return {
        engine: this.id,
        version: probe.version,
        status: 'skipped',
        reason: probe.reason,
        findings: [],
        durationMs: Date.now() - started,
      };
    }

    const projectRoot = resolve(ctx.projectRoot);
    if (!existsSync(projectRoot)) {
      return this.failure(probe.version, started, `project root does not exist: ${projectRoot}`);
    }

    // --- symlinked library roots -------------------------------------------
    // `corpus/lib` is a symlink to `../harness/lib`, kept deliberately (see
    // corpus/foundry.toml). Only the project root is mounted, so a target that
    // escapes it cannot be reached from inside the container — and no extra
    // bind mount fixes that, for the reason spelled out on
    // {@link escapingLibraryRoots}. Refuse rather than emit a clean scan.
    const escaping = escapingLibraryRoots(projectRoot);
    if (escaping.length > 0) {
      return this.failure(probe.version, started, escapedLibraryReason(projectRoot, escaping));
    }

    const mounts: Mount[] = [{ host: projectRoot, container: PROJECT_MOUNT }];

    // --- solc ---------------------------------------------------------------
    // One validated spelling of the version feeds both the mount and the
    // `--solc-bin` argument: deriving them separately is how you end up mounting
    // a compiler at a path the analyser never looks at.
    let solcBin: string;
    let solcMount: Mount | null;
    try {
      const version = assertSolcVersion(ctx.solcVersion);
      solcBin = solcContainerPath(version);
      solcMount = await this.provisionSolc(ctx, version);
    } catch (err) {
      return this.failure(probe.version, started, (err as Error).message);
    }
    if (solcMount) mounts.push(solcMount);

    const args = buildRunArgs({
      image: this.image,
      platform: this.platform,
      mounts,
      solcBin,
      sourceFile: ctx.sourceFile,
      contractName: ctx.contractName,
    });

    ctx.log(`blocksec: ${this.runtime} run ${this.image} (${ctx.sourceFile}:${ctx.contractName})`);

    const proc = await exec(this.runtime, args, ctx.timeoutMs).catch((err: Error) => {
      return { code: -1, stdout: '', stderr: err.message };
    });

    if (proc.code !== 0 && !proc.stdout.trim()) {
      return this.failure(
        probe.version,
        started,
        `container exited ${proc.code}: ${lastLines(proc.stderr, 3)}`,
      );
    }

    let parsed: BlockSecOutput;
    try {
      parsed = JSON.parse(extractJson(proc.stdout));
    } catch {
      return this.failure(
        probe.version,
        started,
        `could not parse HookScan output: ${lastLines(proc.stdout || proc.stderr, 3)}`,
      );
    }

    if (parsed.error) {
      // HookScan itself failed on this contract. That is informative — often it
      // means the contract does not compile under the requested solc — but it is
      // not a hookrisk failure and must not abort the scan.
      return this.failure(
        probe.version,
        started,
        `HookScan reported ${parsed.error_type ?? 'an error'}: ${firstLine(parsed.error)}`,
      );
    }

    const findings = (parsed.detection_results ?? []).map((r) =>
      this.normalise(r, ctx.sourceFile),
    );

    ctx.log(`blocksec: ${findings.length} finding(s)`);
    return {
      engine: this.id,
      version: probe.version,
      status: 'ok',
      findings,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Make sure `/solc/v<version>/solc` exists inside the container.
   *
   * Returns the extra mount when one is needed, or `null` when the image
   * already ships the version. Throws — rather than returning a degraded
   * result — when the version cannot be obtained at all: running the analyser
   * with the wrong compiler would produce a confident, wrong "no findings".
   */
  private async provisionSolc(ctx: EngineContext, version: string): Promise<Mount | null> {
    const containerPath = solcContainerPath(version);

    const ls = await exec(this.runtime, this.lsArgs([], [SOLC_ROOT]), 120_000).catch(() => null);
    // A failed probe is not fatal: assume the version is missing and provision
    // it. Mounting a compiler the image already has is harmless.
    const shipped = ls && ls.code === 0 ? parseSolcVersions(ls.stdout) : [];
    if (shipped.includes(version)) return null;

    const cached = solcCachePath(version);
    if (isUsableSolc(cached)) {
      ctx.log(`blocksec: mounting cached solc ${version} at ${containerPath}`);
      return { host: cached, container: containerPath, readOnly: true };
    }

    const shippedNote = shipped.length > 0 ? ` (image ships ${shipped.join(', ')})` : '';
    ctx.log(
      `blocksec: image has no solc ${version}${shippedNote}; downloading the linux-amd64 build from ${SOLC_BINARIES_BASE} to ${cached}`,
    );
    await downloadSolc(version, cached);
    ctx.log(`blocksec: solc ${version} cached (${statSync(cached).size} bytes)`);

    return { host: cached, container: containerPath, readOnly: true };
  }

  /** `run --rm …flags… --platform … --entrypoint ls IMAGE …lsArgs…` */
  private lsArgs(flags: string[], lsArgs: string[]): string[] {
    return [
      'run',
      '--rm',
      ...flags,
      ...platformArgs(this.platform),
      '--entrypoint',
      'ls',
      this.image,
      ...lsArgs,
    ];
  }

  /** Translate one HookScan result into hookrisk's shape. */
  private normalise(r: BlockSecResult, fallbackFile: string): Finding {
    const ruleClass: RuleClass =
      RULE_CLASS_MAP[r.detector_name] ?? 'unprotected-hook-callback';
    const severity = SEVERITY_MAP[r.severity] ?? 'medium';
    const confidence = CONFIDENCE_MAP[r.confidence] ?? 'medium';

    // `source_location` is "path/to/File.sol:123". Split on the last colon so
    // Windows drive letters and paths containing colons survive.
    let location: Finding['location'] = null;
    if (r.source_location) {
      const idx = r.source_location.lastIndexOf(':');
      const file = idx > 0 ? r.source_location.slice(0, idx) : r.source_location;
      const line = idx > 0 ? Number.parseInt(r.source_location.slice(idx + 1), 10) : NaN;
      location = {
        file: normaliseContainerPath(file, fallbackFile),
        line: Number.isFinite(line) ? line : 1,
      };
    }

    const evidence: string[] = [`BlockSec HookScan: ${r.vulnerability}`];
    if (r.yul_call_stack?.length) {
      evidence.push(`Yul call stack: ${r.yul_call_stack.join(' -> ')}`);
    }

    const links = FRAMEWORK_LINKS[ruleClass] ?? {};

    return {
      id: makeFindingId(ruleClass, location, r.function_selector),
      ruleClass,
      title: humanTitle(ruleClass, r),
      description: r.vulnerability,
      severity,
      confidence,
      location,
      function: {
        name: r.external_function ?? undefined,
        selector: r.function_selector,
      },
      evidence,
      engines: [
        {
          engine: this.id,
          nativeRule: r.detector_name,
          severity,
          confidence,
          detail: r.additional_info ? { additionalInfo: r.additional_info } : undefined,
        },
      ],
      informsDimensions: links.dimensions,
      informsTriggers: links.triggers,
      references: ['https://github.com/blocksecteam/hookscan'],
    };
  }

  private failure(version: string, started: number, reason: string): EngineResult {
    return {
      engine: this.id,
      version,
      status: 'failed',
      reason,
      findings: [],
      durationMs: Date.now() - started,
    };
  }
}

// --------------------------------------------------------------------------- //
// argument construction
// --------------------------------------------------------------------------- //

export interface RunArgsInput {
  image: string;
  /** `--platform` value; empty string omits the flag. */
  platform: string;
  mounts: Mount[];
  /** In-container path to the compiler, e.g. `/solc/v0.8.26/solc`. */
  solcBin: string;
  /** Project-relative, e.g. `src/hooks/FeeHooks.sol`. */
  sourceFile: string;
  contractName: string;
}

/**
 * Build the full `docker run …` argument vector.
 *
 * Everything after the image name reproduces what `/entrypoint.sh` assembles —
 * `--base-path`, `--solc-bin`, the caller's extra flags, then
 * `/project/<CONTRACT>` — because we invoke `python -m hookscan` directly. See
 * point (2) in the file header for why the entrypoint cannot be used.
 *
 * `--silent` makes HookScan report its own failures as JSON instead of a stack
 * trace, which keeps a crash in their analyser from taking down the hookrisk run.
 */
export function buildRunArgs(input: RunArgsInput): string[] {
  return [
    'run',
    '--rm',
    ...platformArgs(input.platform),
    // Static analysis needs no network; deny it. Any compiler download already
    // happened on the host, before this container starts.
    '--network',
    'none',
    ...mountArgs(input.mounts),
    '--entrypoint',
    'python',
    input.image,
    '-m',
    'hookscan',
    '--base-path',
    PROJECT_MOUNT,
    '--solc-bin',
    input.solcBin,
    '--silent',
    `${posix.join(PROJECT_MOUNT, input.sourceFile)}:${input.contractName}`,
  ];
}

export function platformArgs(platform: string): string[] {
  return platform ? ['--platform', platform] : [];
}

export function mountArgs(mounts: Mount[]): string[] {
  return mounts.flatMap((m) => ['-v', `${m.host}:${m.container}${m.readOnly ? ':ro' : ''}`]);
}

// --------------------------------------------------------------------------- //
// solc provisioning
// --------------------------------------------------------------------------- //

/**
 * The compiler version is interpolated into a URL, a filesystem path and a
 * container path. Validate it rather than trusting `foundry.toml`.
 */
export function assertSolcVersion(version: string): string {
  const trimmed = version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new Error(
      `refusing to provision solc for version ${JSON.stringify(version)}: expected MAJOR.MINOR.PATCH`,
    );
  }
  return trimmed;
}

/** Root of hookrisk's on-disk cache. `HOOKRISK_CACHE_DIR` replaces `~/.cache/hookrisk`. */
export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HOOKRISK_CACHE_DIR?.trim();
  return override ? resolve(override) : join(homedir(), '.cache', 'hookrisk');
}

/** Where HookScan looks for a compiler, i.e. what `--solc-bin` must be given. */
export function solcContainerPath(version: string): string {
  return posix.join(SOLC_ROOT, `v${assertSolcVersion(version)}`, 'solc');
}

/** Where the linux-amd64 solc of a given version is cached on the host. */
export function solcCachePath(version: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(cacheRoot(env), 'solc', assertSolcVersion(version), 'solc');
}

/** `v0.8.14\nv0.8.15\n…` from `ls /solc` -> `['0.8.14', '0.8.15', …]`. */
export function parseSolcVersions(lsOutput: string): string[] {
  return lsOutput
    .split(/\s+/)
    .map((s) => /^v(\d+\.\d+\.\d+)$/.exec(s.trim())?.[1])
    .filter((v): v is string => v !== undefined);
}

/**
 * Is the cached file a compiler we can actually mount?
 *
 * Checks the ELF magic as well as size and mode, because the realistic
 * corruption is not a truncated download — it is an HTML error page written to
 * the cache and then mounted as `solc`, which would surface as an inscrutable
 * "exec format error" on every subsequent run.
 */
export function isUsableSolc(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size < MIN_SOLC_BYTES) return false;
    if ((stat.mode & 0o111) === 0) return false;
    return hasElfMagic(readFileSync(path, { flag: 'r' }).subarray(0, 4));
  } catch {
    return false;
  }
}

function hasElfMagic(head: Buffer | Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
}

/**
 * Resolve `0.8.26` to `solc-linux-amd64-v0.8.26+commit.8a97fa7a`.
 *
 * The commit hash is part of the filename and is not derivable, so the official
 * `list.json` is the only way to name the artefact. Doing it this way also means
 * a version the Solidity team never published for linux-amd64 fails with "not
 * published" rather than a 404 on a URL we guessed.
 */
export function solcBinaryName(listJson: unknown, version: string): string {
  const releases = (listJson as { releases?: Record<string, string> } | null)?.releases;
  const name = releases?.[version];
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      `solc ${version} is not published as a linux-amd64 static build; ` +
        `pick a version listed at ${SOLC_BINARIES_BASE}/list.json`,
    );
  }
  return name;
}

/** Download the exact linux-amd64 build of `version` to `dest`, atomically. */
async function downloadSolc(version: string, dest: string): Promise<void> {
  const list = await fetchJson(`${SOLC_BINARIES_BASE}/list.json`);
  const name = solcBinaryName(list, version);

  const url = `${SOLC_BINARIES_BASE}/${name}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch(
    (err: Error) => {
      throw new Error(`could not download solc ${version} from ${url}: ${err.message}`);
    },
  );
  if (!response.ok) {
    throw new Error(`could not download solc ${version}: ${url} returned ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < MIN_SOLC_BYTES) {
    throw new Error(
      `refusing to cache solc ${version}: ${url} returned ${bytes.length} bytes, expected a multi-megabyte binary`,
    );
  }
  if (!hasElfMagic(bytes)) {
    throw new Error(
      `refusing to cache solc ${version}: ${url} did not return an ELF binary (an error page, most likely)`,
    );
  }

  // Write-then-rename so a concurrent scan never mounts a half-written file,
  // and so an interrupted download leaves no poisoned cache entry behind.
  mkdirSync(join(dest, '..'), { recursive: true });
  const tmp = `${dest}.${process.pid}.partial`;
  try {
    writeFileSync(tmp, bytes, { mode: 0o755 });
    chmodSync(tmp, 0o755);
    renameSync(tmp, dest);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* the temp file may never have been created */
    }
    throw new Error(`could not write solc ${version} to ${dest}: ${(err as Error).message}`);
  }

  if (!isUsableSolc(dest)) {
    throw new Error(`solc ${version} was written to ${dest} but is not a usable executable`);
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch(
    (err: Error) => {
      throw new Error(`could not reach ${url}: ${err.message}`);
    },
  );
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

// --------------------------------------------------------------------------- //
// symlinked library roots
// --------------------------------------------------------------------------- //

/**
 * Which entries directly under the project root a Foundry build reads from.
 *
 * Both sources matter: `remappings.txt` is what solc is actually given, and
 * `libs` is what forge walks. Absolute and parent-relative entries are ignored
 * — they are not entries under the project root, so nothing we mount at
 * `/project/<name>` could stand in for them.
 */
export function libraryRootEntries(remappingsText: string, foundryToml: string): string[] {
  const names = new Set<string>();

  for (const line of remappingsText.split(/\r?\n/)) {
    const target = line.split('#')[0]!.trim().split('=')[1];
    addRootSegment(names, target);
  }

  const libs = /^\s*libs\s*=\s*\[([^\]]*)\]/m.exec(foundryToml)?.[1] ?? '';
  for (const raw of libs.split(',')) {
    addRootSegment(names, raw.trim().replace(/^["']|["']$/g, ''));
  }

  return [...names].sort();
}

function addRootSegment(into: Set<string>, target: string | undefined): void {
  if (!target) return;
  const first = target.replace(/^\.\//, '').split('/')[0];
  if (!first || first === '..' || first === '.' || first === '') return;
  if (target.startsWith('/')) return;
  into.add(first);
}

/** A library root that is a symlink whose target lands outside the container mount. */
export interface EscapingLibraryRoot {
  /** Entry name directly under the project root, e.g. `lib`. */
  name: string;
  /** The symlink's target, verbatim, e.g. `../harness/lib`. */
  target: string;
  /** Where that target lands inside the container, e.g. `/harness/lib`. */
  resolvedInContainer: string;
}

/**
 * Library roots that a container mounted at `/project` cannot compile through.
 *
 * Only the project root is bind-mounted, so a symlink pointing above it resolves
 * to a path outside the mount. Two things follow, and the second is the one that
 * bites:
 *
 *   - The target may not exist in the container at all.
 *   - Even when it does, solc canonicalises imports *through* the symlink and
 *     then rejects them: `Source "lib/v4-core/src/interfaces/IHooks.sol" not
 *     found: File outside of allowed directories`. HookScan builds its own solc
 *     command line, so hookrisk cannot widen `--allow-paths` to compensate.
 *
 * Binding the realpath over `/project/<name>` does not help either: the runtime
 * resolves a bind-mount destination *through* the symlink, so the files land at
 * the escaped path rather than replacing the link, and solc's allowed-path check
 * fails exactly as before. Verified against Docker 29.7 on the corpus project.
 *
 * Hence: detect, and refuse. The alternative is a scan that compiles nothing and
 * reports no findings, which is indistinguishable from a clean hook.
 */
export function escapingLibraryRoots(projectRoot: string): EscapingLibraryRoot[] {
  const read = (name: string): string => {
    try {
      return readFileSync(join(projectRoot, name), 'utf8');
    } catch {
      return '';
    }
  };

  const out: EscapingLibraryRoot[] = [];
  for (const name of libraryRootEntries(read('remappings.txt'), read('foundry.toml'))) {
    const path = join(projectRoot, name);
    let target: string;
    try {
      if (!lstatSync(path).isSymbolicLink()) continue;
      target = readlinkSync(path);
    } catch {
      // Absent or unreadable: not our problem here — solc will say so, and
      // inventing a diagnosis for a path that does not exist would only make
      // the eventual error harder to read.
      continue;
    }

    // The link lives at /project/<name>, so a relative target resolves against
    // /project — the same arithmetic the container's kernel will do.
    const inContainer = posix.join(PROJECT_MOUNT, name);
    const resolved = posix.resolve(posix.dirname(inContainer), target);
    if (resolved === PROJECT_MOUNT || resolved.startsWith(`${PROJECT_MOUNT}/`)) continue;
    out.push({ name, target, resolvedInContainer: resolved });
  }
  return out;
}

/** The failure text for {@link escapingLibraryRoots}. Separate so it can be tested. */
export function escapedLibraryReason(
  projectRoot: string,
  escaping: EscapingLibraryRoot[],
): string {
  const detail = escaping
    .map((e) => `${e.name} -> ${e.target} (lands at ${e.resolvedInContainer})`)
    .join(', ');
  return (
    `the lib symlink cannot be followed inside the container: ${detail}. ` +
    `Only ${projectRoot} is mounted at ${PROJECT_MOUNT}, so solc resolves those imports to a path ` +
    `outside its allowed directories and compiles nothing. Point the engine at a project whose ` +
    `library directory is real — copy the project, or replace the symlink with the directory it ` +
    `points at.`
  );
}

// --------------------------------------------------------------------------- //
// helpers
// --------------------------------------------------------------------------- //

function humanTitle(ruleClass: RuleClass, r: BlockSecResult): string {
  const fn = r.external_function ? `\`${r.external_function}\`` : 'a callback';
  switch (ruleClass) {
    case 'unprotected-hook-callback':
      return `${fn} does not restrict callers to the PoolManager`;
    case 'unprotected-unlock-callback':
      return `${fn} does not restrict callers to the contract itself`;
    case 'upgradeable-hook':
      return 'Contract delegate-calls a mutable address';
    case 'selfdestruct':
      return 'Contract can self-destruct';
    default:
      return r.vulnerability;
  }
}

/**
 * Map a container path back onto the host project.
 *
 * HookScan sees the project mounted at /project, so its paths are prefixed with
 * it. Stripping the prefix yields the project-relative path the rest of hookrisk
 * uses, keeping SARIF locations clickable in a GitHub diff.
 */
function normaliseContainerPath(file: string, fallback: string): string {
  const stripped = file.replace(/^\/project\/?/, '');
  return stripped.length > 0 ? stripped : fallback;
}

/**
 * Pull the JSON object out of mixed output.
 *
 * Scanning to the first `{` is enough because the tool emits exactly one
 * top-level object. Bypassing the entrypoint removed its `arg list: …` banner,
 * but HookScan's own warnings still reach stdout on some inputs.
 */
function extractJson(stdout: string): string {
  const start = stdout.indexOf('{');
  return start >= 0 ? stdout.slice(start) : stdout;
}

const firstLine = (s: string): string => s.split('\n')[0]?.trim() ?? '';
const lastLines = (s: string, n: number): string =>
  s.trim().split('\n').slice(-n).join(' | ');

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command with a hard timeout, capturing both streams.
 *
 * Never uses a shell: the contract name and file path reach us from user input
 * and from on-chain data, and neither is trustworthy enough to interpolate into
 * a command line.
 */
function exec(cmd: string, args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`\`${cmd}\` exceeded ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}
