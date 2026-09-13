/**
 * Adapter for hookrisk's own Slither detectors.
 *
 * The static engine hookrisk ships. It runs `slither` with the
 * `slither-hookrisk` plugin registered, reads the JSON report, and normalises
 * each finding into the shared shape so it can be reconciled against other
 * engines.
 *
 * Three things this adapter does that a naive wrapper would not:
 *
 * **It writes the report to a file, not stdout.** `--json -` makes Slither
 * capture *both* of its streams into a buffer it only flushes on a clean exit.
 * A compile failure raises crytic-compile's `InvalidCompilation`, which is not
 * a `SlitherException`, so the buffer is never flushed and the process exits
 * with nothing on either stream — the observed "could not parse Slither output:"
 * with nothing after the colon. The same capture swallowed every
 * `Impossible to generate IR` line on a successful run, so the coverage
 * reporting below never saw one from the CLI. With `--json <file>` Slither
 * mirrors the streams instead of blocking them, and both problems go away.
 *
 * **It reads the streams for coverage gaps.** Slither logs
 * `Impossible to generate IR for <function>` and carries on, then reports a
 * normal result count. Any detector that relies on SlithIR never sees those
 * functions. We observed this on OpenZeppelin's own `AntiSandwichHook`, where
 * `_afterSwap` — the function that matters — fails to lift. Reporting a clean
 * scan without saying so would convert Slither's blind spot into false
 * assurance, so uncovered functions are collected and surfaced in the manifest.
 *
 * **It treats a non-zero exit as normal.** Slither exits non-zero when it merely
 * *found* something. Only a missing or unparseable report is a failure, and a
 * failure always carries a reason: classified against the error catalogue when
 * the output matches an entry, the last lines of output when it does not.
 *
 * **It enforces the engine contract.** The `hookrisk` block on every result is
 * validated against `schema/engine-metadata.schema.json` before the result is
 * admitted. A block that does not conform is dropped with a log line naming
 * the detector, and the count lands in `EngineResult.invalidMetadata`, so a
 * detector that drifts from the contract cannot put an unattributable row in
 * the report — nor vanish from it without trace.
 *
 * **It takes coverage from a positive signal.** The plugin emits one
 * `hook-profile` per contract it recognised as a hook. The target counts as
 * analysed only when such a profile exists for its file and contract name; the
 * profile is also where the CLI gets the resolved permission set. Coverage used
 * to be inferred from the *absence* of an unsupported-ABI disclaimer, which is
 * inference from silence — the failure the scoring layer refuses everywhere
 * else.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The 2020 build, as in manifest.ts: the schema declares draft 2020-12 and
// Ajv's default entry point only understands draft-07.
import { Ajv2020 as Ajv, type ValidateFunction } from 'ajv/dist/2020.js';

import { describeFailure } from '../errors.js';
import type {
  Confidence,
  Engine,
  EngineContext,
  EngineResult,
  Finding,
  RuleClass,
  Severity,
} from '../types.js';
import { callbackSelector, makeFindingId } from './dedupe.js';

/** Slither impact levels mapped onto our severity scale. */
const SEVERITY_MAP: Record<string, Severity> = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
  Informational: 'info',
  Optimization: 'info',
};

const CONFIDENCE_MAP: Record<string, Confidence> = {
  High: 'high',
  Medium: 'medium',
  Low: 'low',
};

/** `ERROR:ContractSolcParsing:Impossible to generate IR for X.y (path#1-2):` */
const UNCOVERED_RE = /Impossible to generate IR for ([\w.]+)\s*\(([^)]*)\)/g;

export interface SlitherElement {
  type: string;
  name: string;
  source_mapping?: {
    filename_relative?: string;
    filename_short?: string;
    lines?: number[];
    is_dependency?: boolean;
  };
  type_specific_fields?: Record<string, unknown>;
}

/**
 * The `hookrisk` block, version 1. The authoritative shape is
 * schema/engine-metadata.schema.json; this type mirrors it for the code that
 * runs after validation.
 */
export interface EngineMetadata {
  version: '1';
  ruleClass: RuleClass;
  informsDimensions: string[];
  informsTriggers: string[];
  isClassification: boolean;
  /** See `Finding.discriminator`. */
  discriminator?: string;
  /** Only on `hook-profile`. */
  metrics?: Record<string, number | boolean>;
  /** Only on `hook-profile`, and only when the hook declares permissions. */
  permissions?: Record<string, boolean>;
  /** Only on `hook-profile`: the implemented callback names. */
  callbacks?: string[];
}

export interface SlitherDetectorResult {
  check: string;
  impact: string;
  confidence: string;
  description: string;
  elements: SlitherElement[];
  /**
   * Injected by HookriskDetector._report. Typed loosely on purpose: it is
   * untrusted until `metadataErrors` has passed it.
   */
  hookrisk?: unknown;
}

interface SlitherReport {
  success: boolean;
  error: string | null;
  results?: { detectors?: SlitherDetectorResult[] };
}

export interface UncoveredFunction {
  contract: string;
  function: string;
  reason: string;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** How the engine runs a process. Injectable so the failure paths are testable without Slither. */
export type ExecFn = (cmd: string, args: string[], timeoutMs: number, cwd?: string) => Promise<ExecResult>;

export interface SlitherOptions {
  /** Path to the slither executable. Defaults to `slither` on PATH. */
  binary?: string;
  enabled?: boolean;
  exec?: ExecFn;
  /** Engine-contract schema to validate metadata blocks against. */
  metadataSchema?: string;
}

export class SlitherEngine implements Engine {
  readonly id = 'hookrisk';
  readonly displayName = 'hookrisk Slither detectors';

  /** Populated by `run`, consumed by the manifest builder. */
  uncoveredFunctions: UncoveredFunction[] = [];
  /** Path of the engine-contract schema; overridable for tests. */
  readonly metadataSchema: string;

  private readonly binary: string;
  private readonly enabled: boolean;
  private readonly exec: ExecFn;

  constructor(opts: SlitherOptions = {}) {
    this.binary = opts.binary ?? process.env.HOOKRISK_SLITHER_BIN ?? 'slither';
    this.enabled = opts.enabled ?? true;
    this.exec = opts.exec ?? exec;
    this.metadataSchema = opts.metadataSchema ?? metadataSchemaPath();
  }

  async probe(): Promise<{ available: boolean; version: string; reason?: string }> {
    if (!this.enabled) {
      return { available: false, version: 'n/a', reason: 'disabled in configuration' };
    }

    const version = await this.exec(this.binary, ['--version'], 30_000).catch(() => null);
    if (!version || version.code !== 0) {
      return {
        available: false,
        version: 'n/a',
        reason: '`slither` not available — install with `pipx install slither-analyzer` (HR-E002)',
      };
    }

    // Registration is separate from installation: the plugin can be on disk in a
    // different environment than the one running Slither, in which case the
    // detectors exist and are invisible.
    const detectors = await this.exec(this.binary, ['--list-detectors'], 60_000).catch(() => null);
    if (!detectors || !/hookrisk-/.test(detectors.stdout)) {
      return {
        available: false,
        version: version.stdout.trim(),
        reason:
          'hookrisk detectors are not registered with this Slither — run `make install-detectors` (HR-E004)',
      };
    }

    return { available: true, version: version.stdout.trim() };
  }

  async run(ctx: EngineContext): Promise<EngineResult> {
    const started = Date.now();
    const probe = await this.probe();

    if (!probe.available) {
      ctx.log(`hookrisk: skipped (${probe.reason})`);
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
    ctx.log(`hookrisk: slither ${ctx.sourceFile}:${ctx.contractName}`);

    const failed = (reason: string): EngineResult => ({
      engine: this.id,
      version: probe.version,
      status: 'failed',
      reason,
      findings: [],
      durationMs: Date.now() - started,
    });

    // The report goes to a scratch file rather than stdout: see the module
    // comment for why `--json -` loses every diagnostic on the paths that matter.
    const scratch = mkdtempSync(join(tmpdir(), 'hookrisk-slither-'));
    const reportPath = join(scratch, 'report.json');
    try {
      const proc = await this.exec(
        this.binary,
        ['.', '--exclude-dependencies', '--json', reportPath],
        ctx.timeoutMs,
        projectRoot,
      ).catch((err: Error) => ({ code: -1, stdout: '', stderr: err.message }));

      // Which stream a message lands on depends on how Slither was asked to
      // report (its logger goes to stdout unless JSON is on stdout), so both are
      // read together and neither is trusted to be the "diagnostic" one.
      const output = `${proc.stdout}\n${proc.stderr}`;
      this.uncoveredFunctions = collectUncovered(output);
      if (this.uncoveredFunctions.length > 0) {
        ctx.log(
          `hookrisk: ${this.uncoveredFunctions.length} function(s) could not be lifted to IR ` +
            'and were not analysed (HR-E205)',
        );
      }

      let report: SlitherReport;
      try {
        report = JSON.parse(readFileSync(reportPath, 'utf8')) as SlitherReport;
      } catch {
        const reason = describeSlitherFailure(output, proc.code);
        ctx.log(`hookrisk: failed — ${reason}`);
        return failed(reason);
      }

      if (report.success === false) {
        const reason = describeSlitherFailure(`${report.error ?? ''}\n${output}`, proc.code);
        ctx.log(`hookrisk: failed — ${reason}`);
        return failed(reason);
      }

      // Every hookrisk result goes through the engine contract first. A result
      // that fails it is named, counted and dropped — never admitted with a
      // guessed rule class, never lost without a line in the log.
      const validate = metadataValidator(this.metadataSchema);
      const raw = (report.results?.detectors ?? []).filter((r) => r.check.startsWith('hookrisk-'));
      const admitted: SlitherDetectorResult[] = [];
      let invalidMetadata = 0;
      for (const r of raw) {
        const errors = metadataErrors(r.hookrisk, validate);
        if (errors.length === 0) {
          admitted.push(r);
          continue;
        }
        invalidMetadata += 1;
        ctx.log(
          `hookrisk: dropped a result from ${r.check} on ${describeAnchor(r)} — its hookrisk metadata ` +
            `does not satisfy the engine contract (${errors.join('; ')}); the plugin and the CLI disagree ` +
            'on the metadata version, reinstall with `make install-detectors`',
        );
      }
      if (invalidMetadata > 0) {
        ctx.log(`hookrisk: ${invalidMetadata} result(s) dropped for invalid metadata`);
      }

      const all = admitted.map((r) => normalise(r)).filter((f): f is Finding => f !== null);

      // The profiles are the engine's own statement of what it analysed,
      // taken before attribution so a neighbour's profile still counts as
      // "looked at" even though its findings are set aside.
      const scope = scopeOf(admitted, ctx.sourceFile, ctx.contractName);
      const permissions = targetPermissions(admitted, ctx.sourceFile, ctx.contractName);

      // Slither has to compile the whole project — imports and inheritance make
      // anything narrower unreliable — but a scan of `src/MyHook.sol:MyHook` must
      // report on that hook, not on every other contract in the repository.
      // Reporting a neighbour's problems against this target would inflate its
      // score with findings its author cannot act on, and the score is the point.
      const { findings, unattributed } = partitionByTarget(all, ctx.sourceFile);
      if (unattributed.length > 0) {
        const elsewhere = unattributed.reduce((n, u) => n + u.count, 0);
        ctx.log(
          `hookrisk: ${elsewhere} finding(s) in other files, not attributed to this target: ` +
            unattributed.map((u) => `${u.file} (${u.count})`).join(', '),
        );
      }

      const targetCoverage = coverageOf(findings, ctx.contractName, scope);
      if (!targetCoverage.covered) {
        ctx.log(`hookrisk: did not analyse the target — ${targetCoverage.reason}`);
      }

      ctx.log(
        `hookrisk: ${findings.length} finding(s); analysed ${scope.analysedContracts.length} hook contract(s)` +
          (permissions ? '; permissions resolved from the profile' : ''),
      );
      return {
        engine: this.id,
        version: probe.version,
        status: 'ok',
        findings,
        durationMs: Date.now() - started,
        targetCoverage,
        scope,
        ...(permissions ? { permissions } : {}),
        ...(invalidMetadata > 0 ? { invalidMetadata } : {}),
        ...(unattributed.length > 0 ? { unattributed } : {}),
      };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}

// --------------------------------------------------------------------------- //
// The engine contract
// --------------------------------------------------------------------------- //

function metadataSchemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(join(here, '..', '..', '..', 'schema', 'engine-metadata.schema.json'));
}

const validators = new Map<string, ValidateFunction>();

/** Compile the engine-contract schema once per path. */
export function metadataValidator(schemaFile = metadataSchemaPath()): ValidateFunction {
  let validate = validators.get(schemaFile);
  if (!validate) {
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    validate = ajv.compile(JSON.parse(readFileSync(schemaFile, 'utf8')));
    validators.set(schemaFile, validate);
  }
  return validate;
}

/**
 * Why a `hookrisk` block fails the engine contract; empty when it conforms.
 *
 * A missing block is the oldest failure — a detector that forgot to use
 * `HookriskDetector._report` — and is reported in the same words as any other,
 * because to the consumer they are the same thing: a result it cannot place.
 */
export function metadataErrors(block: unknown, validate = metadataValidator()): string[] {
  if (block === undefined || block === null) return ['no hookrisk metadata block'];
  if (validate(block)) return [];
  return (validate.errors ?? []).slice(0, 6).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

/** `MyHook.beforeSwap` or `MyHook`, for a log line about a dropped result. */
function describeAnchor(result: SlitherDetectorResult): string {
  const element = result.elements?.[0];
  if (!element) return '<no element>';
  const parent = (element.type_specific_fields?.parent as { name?: string } | undefined)?.name;
  return parent && element.type === 'function' ? `${parent}.${element.name}` : element.name;
}

/** The contract element a `hook-profile` is anchored on, with its file. */
function profileAnchor(result: SlitherDetectorResult): { contract: string; file: string } | null {
  const meta = result.hookrisk as EngineMetadata;
  if (meta.ruleClass !== 'hook-profile') return null;
  const element = result.elements.find((e) => e.type === 'contract') ?? result.elements[0];
  if (!element) return null;
  return { contract: element.name, file: element.source_mapping?.filename_relative ?? '' };
}

/**
 * What the engine analysed, from its `hook-profile` results.
 *
 * `analysedContracts` is `file:Contract` for every profile in the report.
 * `targetAnalysed` requires a profile for exactly the target file and name:
 * a same-named contract in another file is somebody else's hook.
 */
export function scopeOf(
  results: SlitherDetectorResult[],
  sourceFile: string,
  contractName: string,
): { analysedContracts: string[]; targetAnalysed: boolean } {
  const anchors = results.map(profileAnchor).filter((a): a is { contract: string; file: string } => a !== null);
  return {
    analysedContracts: anchors.map((a) => `${a.file}:${a.contract}`).sort(),
    targetAnalysed: anchors.some((a) => a.file === sourceFile && a.contract === contractName),
  };
}

/** The target's permission set from its profile, or undefined. */
export function targetPermissions(
  results: SlitherDetectorResult[],
  sourceFile: string,
  contractName: string,
): Record<string, boolean> | undefined {
  for (const r of results) {
    const anchor = profileAnchor(r);
    if (anchor && anchor.file === sourceFile && anchor.contract === contractName) {
      return (r.hookrisk as EngineMetadata).permissions;
    }
  }
  return undefined;
}

/**
 * Translate one Slither detector result into hookrisk's shape.
 *
 * Returns null for a result whose metadata fails the engine contract; `run`
 * checks the same thing first so it can log and count, and this check is the
 * guarantee for callers that skip `run`.
 */
export function normalise(result: SlitherDetectorResult): Finding | null {
  if (metadataErrors(result.hookrisk).length > 0) return null;
  const meta = result.hookrisk as EngineMetadata;

  // Prefer the first element that is not a dependency; findings anchored in
  // lib/ point at code the user did not write.
  const element =
    result.elements.find((e) => e.source_mapping && !e.source_mapping.is_dependency) ??
    result.elements[0];

  const mapping = element?.source_mapping;
  const location =
    mapping?.filename_relative && mapping.lines?.length
      ? {
          file: mapping.filename_relative,
          line: mapping.lines[0]!,
          endLine: mapping.lines[mapping.lines.length - 1]!,
        }
      : null;

  const severity = SEVERITY_MAP[result.impact] ?? 'medium';
  const confidence = CONFIDENCE_MAP[result.confidence] ?? 'medium';

  const description = result.description.trim();
  const title = firstSentence(description);

  // A callback's selector is attached when the name resolves to one, so the id
  // and group key of an HS-01 here match the same defect seen by an engine
  // that only knows selectors.
  const fn =
    element?.type === 'function'
      ? { name: element.name, ...(callbackSelector(element.name) ? { selector: callbackSelector(element.name) } : {}) }
      : undefined;
  const discriminator =
    typeof meta.discriminator === 'string' && meta.discriminator.length > 0
      ? meta.discriminator
      : undefined;

  return {
    id: makeFindingId(meta.ruleClass, location, fn?.selector, discriminator),
    ruleClass: meta.ruleClass,
    title,
    description,
    severity,
    confidence,
    location,
    ...(fn ? { function: fn } : {}),
    ...(discriminator ? { discriminator } : {}),
    ...(meta.permissions ? { permissions: meta.permissions } : {}),
    ...(meta.metrics ? { metrics: meta.metrics } : {}),
    evidence: [description],
    engines: [
      {
        engine: 'hookrisk',
        nativeRule: result.check,
        severity,
        confidence,
      },
    ],
    informsDimensions: meta.informsDimensions,
    informsTriggers: meta.informsTriggers,
  };
}

/**
 * Split findings into those on the target file and those elsewhere, the latter
 * counted per file so the report can say what was set aside. A finding with no
 * location cannot be placed and is kept: dropping it would hide a detector's
 * output on the strength of a missing source mapping.
 */
export function partitionByTarget(
  all: Finding[],
  sourceFile: string,
): { findings: Finding[]; unattributed: Array<{ file: string; count: number }> } {
  const findings: Finding[] = [];
  const counts = new Map<string, number>();
  for (const f of all) {
    if (!f.location || f.location.file === sourceFile) findings.push(f);
    else counts.set(f.location.file, (counts.get(f.location.file) ?? 0) + 1);
  }
  const unattributed = [...counts]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
  return { findings, unattributed };
}

/**
 * Whether hookrisk's detectors actually examined the target.
 *
 * Two signals, and the negative one wins. An `unsupported-hook-abi`
 * classification is the detectors saying "this is hook-shaped and I could not
 * read it" — including the `partial` shape, where a profile exists for the
 * callbacks that did match but the rest was never judged. Otherwise the answer
 * is the presence of a `hook-profile` for the target: without one the plugin
 * never recognised the contract as a hook, and every other finding — or none —
 * is silence from code that never looked. The scorer must not turn that
 * silence into zeros.
 *
 * `scope` is optional only for callers that pre-date the profile; `run` always
 * supplies it, and a missing profile there is a missing profile.
 */
export function coverageOf(
  findings: Finding[],
  contractName: string,
  scope?: { analysedContracts: string[]; targetAnalysed: boolean },
): { covered: boolean; reason?: string } {
  const unsupported = findings.find((f) => f.ruleClass === 'unsupported-hook-abi');
  if (unsupported) {
    return { covered: false, reason: `${contractName} uses a hook ABI hookrisk cannot analyse: ${unsupported.title}` };
  }
  if (scope && !scope.targetAnalysed) {
    const looked = scope.analysedContracts.length;
    return {
      covered: false,
      reason:
        `hookrisk emitted no hook-profile for ${contractName}: the detectors did not recognise it as a v4 hook` +
        (looked > 0 ? ` (they analysed ${looked} other contract(s): ${scope.analysedContracts.join(', ')})` : ''),
    };
  }
  return { covered: true };
}

/**
 * Reason for a run that produced no readable report. Never empty: an engine
 * row that says "failed" with no reason is indistinguishable from a bug in the
 * adapter, and the user's next step depends on which it was.
 */
export function describeSlitherFailure(output: string, exitCode: number): string {
  return describeFailure(
    output,
    `Slither exited with code ${exitCode} and wrote nothing to stdout, stderr or its report ` +
      '(HR-E901); run `slither . --exclude-dependencies` in the project to see why',
  );
}

/**
 * Collect functions Slither could not lift to IR.
 *
 * These are the silent gaps. Slither logs them and continues; without this the
 * manifest would say "0 findings" for a contract whose most interesting function
 * was never examined.
 */
export function collectUncovered(output: string): UncoveredFunction[] {
  const out: UncoveredFunction[] = [];
  const seen = new Set<string>();

  for (const match of output.matchAll(UNCOVERED_RE)) {
    const qualified = match[1]!;
    const location = match[2] ?? '';
    if (seen.has(qualified)) continue;
    seen.add(qualified);

    const dot = qualified.lastIndexOf('.');
    out.push({
      contract: dot > 0 ? qualified.slice(0, dot) : qualified,
      function: dot > 0 ? qualified.slice(dot + 1) : qualified,
      reason: `Slither could not generate IR${location ? ` (${location})` : ''}; this function was not analysed`,
    });
  }
  return out;
}

function firstSentence(text: string): string {
  const line = text.split('\n')[0] ?? text;
  const stop = line.indexOf('. ');
  const sentence = stop > 0 ? line.slice(0, stop) : line;
  if (sentence.length <= 160) return sentence;
  // Cut at a word boundary: a title chopped mid-identifier reads as corrupt
  // data in a report heading and in SARIF.
  const cut = sentence.lastIndexOf(' ', 157);
  return `${sentence.slice(0, cut > 80 ? cut : 157)} …`;
}

/** Run a command with a hard timeout. Never uses a shell. */
function exec(cmd: string, args: string[], timeoutMs: number, cwd?: string): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`\`${cmd}\` timed out after ${Math.round(timeoutMs / 1000)}s`));
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
      // Slither exits non-zero when it found something. That is a result.
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}
