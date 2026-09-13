/**
 * Building, validating and rendering the hook-risk manifest.
 *
 * The manifest is the product. Everything else — detectors, harness, scoring —
 * exists to fill it in. It is validated against `schema/hook-risk.schema.json`
 * before it is written, because downstream consumers rely on the schema and
 * emitting something that violates it would push the failure onto them.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The 2020 build, not the default export: our schema declares
// $schema draft/2020-12, and Ajv's default entry point only understands
// draft-07. Compiling a 2020 schema with the draft-07 compiler fails with
// `no schema with key or ref "…/2020-12/schema"`, which reads like a
// missing file rather than a version mismatch.
import { Ajv2020 as Ajv, type ValidateFunction } from 'ajv/dist/2020.js';

import { HookriskError } from './errors.js';
import type { ScoreResult } from './scoring/score.js';
import type { EngineResult, Finding, RuleClass, Severity } from './types.js';
import { SEVERITIES, isClassification, severityRank } from './types.js';
import type { UncoveredFunction } from './engines/slither.js';
import { summariseProbes, type HarnessProbes } from './harness.js';
import type { GatePolicy } from './config.js';

export const SCHEMA_VERSION = '1.0.0';

export interface InvariantResult {
  id: 'I1' | 'I2' | 'I3';
  name: string;
  status: 'passed' | 'failed' | 'inconclusive' | 'not-applicable' | 'skipped';
  runs?: number;
  calls?: number;
  reverts?: number;
  detail?: string;
  counterexample?: {
    sequence?: Array<{ target?: string; calldata?: string; signature?: string }>;
    revertSelector?: string;
    revertRaw?: string;
  };
}

/**
 * The differential harness as an engine row.
 *
 * It produces invariants rather than findings, so it does not go through the
 * engine reconciliation path, but it is an analysis the scan attempted and a
 * reader must be able to tell "ran and held" from "never ran" without diffing
 * the invariants array against their memory of what should be there.
 */
export interface HarnessSummary {
  version: string;
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  /** Catalogue code (`HR-E304`) when failed. Parsed from `reason` when absent. */
  errorCode?: string;
  durationMs: number;
}

/**
 * What the harness actually did, summed over every completed fuzz sequence
 * from `harness/out/hookrisk-obs-<RUN_ID>.jsonl`. This is the difference
 * between "I2 passed" and "I2 passed over zero compared swaps": a reader of
 * the manifest gets the counts, and the CLI marks an invariant with no
 * relevant observations inconclusive rather than passed.
 */
export interface HarnessObservations {
  swapsExecuted?: number;
  swapsCompared?: number;
  swapsSkipped?: number;
  /** Sequences in which the hooked pool's swap reverted while the reference pool's did not. */
  hookedSwapReverted?: number;
  positionsOpened?: number;
  positionsClosed?: number;
  donations?: number;
  priceChecks?: number;
  monotonicityViolations?: number;
  exitFailures?: number;
  /** Fuzz sequences the counts were summed over. */
  sequences?: number;
}

export interface ManifestInputs {
  toolVersion: string;
  commandLine?: string;
  generatedAt?: string;
  target: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  findings: Finding[];
  invariants?: InvariantResult[];
  score: ScoreResult;
  engineResults: EngineResult[];
  engineMeta: Map<string, { displayName: string; upstream?: { url: string; license: string } }>;
  harness: HarnessSummary;
  /** Summed harness observation log; absent when the harness produced none. */
  observations?: HarnessObservations;
  corroboratedFindings: number;
  uncoveredFunctions: UncoveredFunction[];
  staticAnalysisSkipped: boolean;
  gate?: GatePolicy;
}

/**
 * The catalogue code in a failure reason, wherever the engine put it: the
 * Slither adapter leads with it (`HR-E202 …`), the harness bridge closes with
 * it (`… (HR-E304)`). A structured field will replace this once every engine
 * carries one; until then the code is parsed rather than re-derived, so the
 * manifest never names a code the reason does not.
 */
export function errorCodeOf(reason: string | undefined): string | undefined {
  return reason?.match(/\bHR-E\d{3}\b/)?.[0];
}

export const HARNESS_ENGINE_ID = 'harness';
export const HARNESS_DISPLAY_NAME = 'Differential harness (Foundry)';

export type Manifest = Record<string, unknown>;

// --------------------------------------------------------------------------- //
// Build
// --------------------------------------------------------------------------- //

export function buildManifest(input: ManifestInputs): Manifest {
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: {
      tool: 'hookrisk',
      version: input.toolVersion,
      // Omitted by default so two runs over identical input produce identical
      // bytes — a manifest that changes every run cannot be diffed in review.
      ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
      ...(input.commandLine ? { commandLine: input.commandLine } : {}),
    },
    target: input.target,
    findings: input.findings.map(serialiseFinding),
    score: serialiseScore(input.score),
    engines: [
      ...input.engineResults.map((result) => {
        const meta = input.engineMeta.get(result.engine);
        const errorCode = result.status === 'failed' ? errorCodeOf(result.reason) : undefined;
        return {
          engine: result.engine,
          ...(meta?.displayName ? { displayName: meta.displayName } : {}),
          version: result.version,
          status: result.status,
          ...(result.reason ? { reason: result.reason } : {}),
          ...(errorCode ? { errorCode } : {}),
          findingCount: result.findings.length,
          durationMs: result.durationMs,
          ...(meta?.upstream ? { upstream: meta.upstream } : {}),
        };
      }),
      {
        engine: HARNESS_ENGINE_ID,
        displayName: HARNESS_DISPLAY_NAME,
        version: input.harness.version,
        status: input.harness.status,
        ...(input.harness.reason ? { reason: input.harness.reason } : {}),
        ...(harnessErrorCode(input.harness) ? { errorCode: harnessErrorCode(input.harness) } : {}),
        // A failed invariant is the harness's finding; the count is what a
        // reader scanning the engines table expects to see there.
        findingCount: (input.invariants ?? []).filter((i) => i.status === 'failed').length,
        durationMs: input.harness.durationMs,
      },
    ],
    coverage: {
      corroboratedFindings: input.corroboratedFindings,
      uncoveredFunctions: input.uncoveredFunctions,
      staticAnalysisSkipped: input.staticAnalysisSkipped,
      // Derived from the harness status rather than from the --skip-dynamic
      // flag, so a harness that failed or declined to run reads as "not
      // analysed" and never as "analysed, nothing found".
      dynamicAnalysisSkipped: input.harness.status !== 'ok',
      harnessStatus: input.harness.status,
      ...(input.observations ? { observations: input.observations } : {}),
    },
  };

  if (input.permissions) manifest.permissions = input.permissions;
  if (input.invariants?.length) manifest.invariants = input.invariants;

  if (input.gate) {
    manifest.gate = evaluateGate(
      input.gate,
      input.score,
      input.findings,
      input.uncoveredFunctions,
      input.invariants ?? [],
      input.engineResults,
      input.harness,
    );
  }

  return manifest;
}

// Skips carry a code too (HR-E305 for missing constructor arguments): a CI
// job branching on why the dynamic layer did not run should not have to parse
// prose.
const harnessErrorCode = (harness: HarnessSummary): string | undefined =>
  harness.status === 'ok' ? undefined : (harness.errorCode ?? errorCodeOf(harness.reason));

function serialiseFinding(finding: Finding): Record<string, unknown> {
  return {
    id: finding.id,
    ruleClass: finding.ruleClass,
    title: finding.title,
    description: finding.description,
    severity: finding.severity,
    confidence: finding.confidence,
    location: finding.location,
    ...(finding.function ? { function: finding.function } : {}),
    ...(finding.discriminator ? { discriminator: finding.discriminator } : {}),
    evidence: finding.evidence,
    engines: finding.engines.map((e) => ({
      engine: e.engine,
      nativeRule: e.nativeRule,
      severity: e.severity,
      confidence: e.confidence,
    })),
    ...(finding.informsDimensions?.length ? { informsDimensions: finding.informsDimensions } : {}),
    ...(finding.informsTriggers?.length ? { informsTriggers: finding.informsTriggers } : {}),
    ...(finding.references?.length ? { references: finding.references } : {}),
    // The hook-profile payload. Carried on the finding rather than lifted to a
    // top-level section so the manifest keeps one shape per rule class and a
    // consumer reads the profile where it was reported.
    ...(finding.metrics ? { metrics: finding.metrics } : {}),
    ...(finding.callbacks ? { callbacks: finding.callbacks } : {}),
    ...(finding.permissions ? { permissions: finding.permissions } : {}),
  };
}

function serialiseScore(score: ScoreResult): Record<string, unknown> {
  return {
    total: score.total,
    totalUpperBound: score.totalUpperBound,
    tier: score.tier.id,
    tierUpperBound: score.tierUpperBound.id,
    inconclusive: score.inconclusive,
    rubric: {
      framework: 'Uniswap Hooks Security Framework',
      revision: score.rubricRevision,
      url: 'https://github.com/uniswapfoundation/security-framework',
    },
    dimensions: score.dimensions.map((d) => ({
      id: d.id,
      name: d.name,
      value: d.value,
      max: d.max,
      source: d.source,
      bracketLabel: d.bracketLabel,
      bracketsAreInterpretation: d.bracketsAreInterpretation,
      evidence: d.evidence,
    })),
    triggers: score.triggers.map((t) => ({
      id: t.id,
      name: t.name,
      firedBy: t.firedBy,
      derivationIsInterpretation: t.derivationIsInterpretation,
    })),
    recommendations: score.recommendations,
    warnings: score.warnings,
  };
}

/**
 * Decide whether the CI gate passes.
 *
 * A gate failure exits 2, which is deliberately not an error code: the scan
 * succeeded and the hook did not clear the bar. Conflating the two would make
 * "hookrisk is broken" and "your hook has a problem" indistinguishable to a CI
 * job, and only one of those should page someone.
 *
 * An undetermined tier is a deliberate choice, not an automatic failure. With
 * six of nine dimensions unmeasured the upper bound is High on nearly every
 * hook, so a gate that failed on it would fail every scan on hookrisk's own
 * coverage and tell the user nothing about their hook. The tier gate therefore
 * fails on what was *measured*: the lower bound above `maxTier` fails, the
 * upper bound above it fails only under `failOnInconclusive`, and otherwise the
 * gate passes with a note that says exactly what it could not rule out.
 */
export function evaluateGate(
  policy: GatePolicy,
  score: ScoreResult,
  findings: Finding[],
  uncovered: UncoveredFunction[],
  invariants: InvariantResult[],
  engineResults: EngineResult[] = [],
  harness?: HarnessSummary,
): Record<string, unknown> {
  const failures: string[] = [];
  const notes: string[] = [];
  const tierRank = { low: 0, medium: 1, high: 2 } as const;

  // "Could not assess" is not "assessed clean". An engine that ran and FAILED
  // (Slither could not compile the project, the harness could not stand the
  // hook up), or a static engine that ran and never recognised the target as
  // a hook, leaves the report describing nothing; letting that pass a CI gate
  // is the exact failure this tool exists to prevent. A *skipped* engine is
  // different: the reason is recorded and the operator chose it.
  if (policy.failOnNotAnalysed !== false) {
    for (const result of engineResults) {
      if (result.status === 'failed') {
        failures.push(`engine ${result.engine} failed${result.reason ? `: ${firstLine(result.reason)}` : ''}`);
      } else if (result.status === 'ok' && result.scope && result.scope.targetAnalysed === false) {
        failures.push(
          `engine ${result.engine} did not analyse the target: it was not recognised as a v4 hook ` +
            '(unsupported ABI), so nothing code-derived was assessed',
        );
      }
    }
    if (harness && harness.status === 'failed') {
      failures.push(`the differential harness failed${harness.reason ? `: ${firstLine(harness.reason)}` : ''}`);
    }
  }

  // A violated invariant fails the gate unconditionally, whatever the tier says
  // and whatever thresholds are configured. It is the strongest evidence
  // hookrisk can produce: not a pattern that resembles a bug, but an executed
  // sequence in which the hook demonstrably misbehaved. A gate that weighed a
  // reproducible counterexample against a numeric threshold would be able to
  // pass a hook that provably traps liquidity, which is not a trade-off worth
  // offering.
  for (const invariant of invariants) {
    if (invariant.status !== 'failed') continue;
    failures.push(
      `invariant ${invariant.id} (${invariant.name}) failed` +
        (invariant.detail ? `: ${invariant.detail}` : ''),
    );
  }

  if (policy.maxTier) {
    const lowerExceeds = tierRank[score.tier.id] > tierRank[policy.maxTier];
    const upperExceeds = tierRank[score.tierUpperBound.id] > tierRank[policy.maxTier];
    const range = `undetermined between ${score.tier.name} and ${score.tierUpperBound.name}`;

    if (lowerExceeds) {
      // Measured evidence alone puts the hook above the gate; the range, when
      // there is one, only says how much further it might go.
      failures.push(
        `risk tier is ${score.tier.name} (${score.total}/33)` +
          (score.inconclusive ? `, ${range},` : '') +
          ` above the configured maximum of ${policy.maxTier}`,
      );
    } else if (score.inconclusive && upperExceeds) {
      const unmeasured = `${score.unmeasured.length} dimension(s) unmeasured: ${score.unmeasured.join(', ')}`;
      if (policy.failOnInconclusive) {
        failures.push(
          `tier is ${range}; the upper bound exceeds the configured maximum of ${policy.maxTier} ` +
            `and failOnInconclusive is set (${unmeasured})`,
        );
      } else {
        notes.push(
          `tier is ${range}; the measured lower bound is within the configured maximum of ${policy.maxTier} ` +
            `and failOnInconclusive is off, so the range does not fail the gate (${unmeasured}). ` +
            'Declare the unmeasured dimensions in hookrisk.toml to close it, or set failOnInconclusive = true.',
        );
      }
    }
  }

  if (policy.maxSeverity) {
    const threshold = severityRank(policy.maxSeverity as Severity);
    const breaching = findings.filter(
      (f) => severityRank(f.severity) >= threshold && !isClassification(f.ruleClass),
    );
    if (breaching.length > 0) {
      failures.push(
        `${breaching.length} finding(s) at or above ${policy.maxSeverity}: ` +
          breaching
            .slice(0, 3)
            .map((f) => f.title)
            .join('; '),
      );
    }
  }

  if (policy.failOnPartialCoverage && uncovered.length > 0) {
    failures.push(`${uncovered.length} function(s) were not analysed (HR-E205)`);
  }

  return {
    passed: failures.length === 0,
    ...(policy.maxTier ? { maxTier: policy.maxTier } : {}),
    ...(policy.maxSeverity ? { maxSeverity: policy.maxSeverity } : {}),
    ...(policy.failOnInconclusive !== undefined ? { failOnInconclusive: policy.failOnInconclusive } : {}),
    failOnNotAnalysed: policy.failOnNotAnalysed !== false,
    failures,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

// --------------------------------------------------------------------------- //
// Validate
// --------------------------------------------------------------------------- //

let validator: ValidateFunction | null = null;

function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(join(here, '..', '..', 'schema', 'hook-risk.schema.json'));
}

export function validateManifest(manifest: Manifest, schemaFile = schemaPath()): void {
  if (!validator) {
    // `validateFormats: false` because the schema's `format` annotations
    // (date-time, uri) are documentation for readers, not constraints we rely
    // on. Enforcing them would mean a second dependency parsing our own output
    // to check something no consumer branches on — not a trade worth making in
    // a security tool, where every dependency is attack surface.
    const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
    validator = ajv.compile(JSON.parse(readFileSync(schemaFile, 'utf8')));
  }

  if (validator(manifest)) return;

  const detail = (validator.errors ?? [])
    .slice(0, 8)
    .map((e) => `${e.instancePath || '/'} ${e.message}`)
    .join('; ');

  throw new HookriskError('HR-E501', {
    detail: `Generated manifest does not satisfy the schema: ${detail}`,
    context: { schema: schemaFile },
  });
}

// --------------------------------------------------------------------------- //
// Render
// --------------------------------------------------------------------------- //

const STRENGTH_LABEL: Record<string, string> = {
  required: '**Required**',
  'strongly-recommended': 'Strongly recommended',
  recommended: 'Recommended',
  optional: 'Optional',
};

const SEVERITY_ICON: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: 'ℹ️',
};

/** Report labels for the hook-profile metrics; unknown metrics render by name. */
const PROFILE_METRIC_LABEL: Record<string, string> = {
  callbacksImplemented: 'Callbacks implemented (working; deliberate revert-guards are listed as disabled)',
  callbacksDeclared: 'Callbacks declared',
  stateWritesInCallbacks: 'State writes in callbacks',
  externalCallsInSwapPath: 'External calls in the swap path',
  internalFunctionsReachableFromCallbacks: 'Internal functions reachable from callbacks',
  usesReturnsDelta: 'Returns a delta',
  hasOwnerOnlyFunctions: 'Owner-only surface',
};

/** Short rule identifiers for the report; classes without one render by name. */
const RULE_ID: Record<string, string> = {
  'unprotected-hook-callback': 'HS-01',
  'flag-implementation-divergence': 'HS-02',
  'admin-surface': 'HS-03',
  'upgradeable-hook': 'HS-04',
  'external-call-in-swap-path': 'HS-05',
  'unbounded-dynamic-fee': 'HS-06',
  'custom-accounting': 'HS-07',
  'rounding-direction': 'HS-08',
  'unprotected-unlock-callback': 'BS-01',
  selfdestruct: 'BS-02',
  'callback-intentionally-disabled': 'C-01',
  'unsupported-hook-abi': 'C-02',
  'hook-profile': 'C-00',
  // P for probe: produced by the harness executing the hook, not by a detector
  // reading it. Numbered in their own series so a reader can tell at a glance
  // which layer saw the thing.
  'unvalidated-pool-key': 'P-01',
  'callback-selector-mismatch': 'P-02',
};

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: '🔴 Critical',
  high: '🟠 High',
  medium: '🟡 Medium',
  low: '🔵 Low',
  info: 'ℹ️ Info',
};

const INVARIANT_ICON: Record<string, string> = {
  passed: '✅',
  failed: '❌',
  inconclusive: '⚠️',
  'not-applicable': '➖',
  skipped: '⏭️',
};

/**
 * A heading-length title for a finding.
 *
 * Detector descriptions open with the fully qualified function signature, which
 * is the right anchor for a SARIF result and the wrong one for a heading. Where
 * the rule and its discriminator say what the finding is about, build the
 * title from those; otherwise fall back to the engine's own first sentence.
 */
function shortTitle(f: Record<string, unknown>): string {
  const rule = String(f.ruleClass);
  const what = f.discriminator ? `\`${String(f.discriminator)}\`` : undefined;
  switch (rule) {
    case 'unprotected-hook-callback':
      return what ? `${what} is callable by anyone, not only the PoolManager` : 'A hook callback is callable by anyone';
    case 'flag-implementation-divergence':
      return what ? `${what} is declared but has no working implementation` : 'Declared permissions and implemented callbacks disagree';
    case 'callback-intentionally-disabled':
      return what ? `${what} is disabled by design (deliberate revert)` : 'A callback is disabled by design';
    case 'custom-accounting':
      return 'Custom accounting: the hook can alter settled amounts';
    case 'unsupported-hook-abi':
      return 'Hook ABI predates the shipped v4 interface; not analysed';
    case 'upgradeable-hook':
      return 'The hook delegates to mutable code';
    case 'selfdestruct':
      return 'The hook can self-destruct';
    case 'unprotected-unlock-callback':
      return what ? `${what} is callable by anyone` : 'unlockCallback is callable by anyone';
    case 'admin-surface':
      return what
        ? `${what} changes hook state and is callable outside a swap`
        : 'The hook has a privileged administrative surface';
    case 'external-call-in-swap-path':
      return what
        ? `${what} calls out of the swap path mid-swap`
        : 'The swap path calls a contract that is neither the PoolManager nor a pool token';
    case 'unbounded-dynamic-fee':
      return what
        ? `${what} sets the pool fee with no ceiling on the value`
        : 'The hook sets the pool fee dynamically with no ceiling';
    case 'unvalidated-pool-key':
      return 'The hook accepted a callback for a pool it is not attached to';
    case 'callback-selector-mismatch':
      return what
        ? `${what} did not return its own selector when called as the PoolManager`
        : 'A callback did not return its own selector when called as the PoolManager';
    default:
      return String(f.title);
  }
}

/**
 * How a finding's engine attributions read in prose.
 *
 * "Reported by `harness/eoa-guard-probe`" understates what happened: the
 * harness did not read the hook and form an opinion, it called the hook and
 * watched. Findings the probes produced say so, and a finding both layers
 * carry says both, because that combination is the strongest evidence
 * hookrisk emits.
 */
function attributionSentence(engines: Array<Record<string, unknown>>): string {
  const ref = (e: Record<string, unknown>): string => `\`${e.engine}/${e.nativeRule}\``;
  const probes = engines.filter((e) => e.engine === HARNESS_ENGINE_ID);
  const readers = engines.filter((e) => e.engine !== HARNESS_ENGINE_ID);
  if (probes.length === 0) return `Reported by ${engines.map(ref).join(', ')}.`;
  const observed = `Observed by the differential harness running the hook (${probes.map(ref).join(', ')})`;
  return readers.length === 0
    ? `${observed}.`
    : `${observed}, and reported from source by ${readers.map(ref).join(', ')}.`;
}

const cell = (text: unknown): string => String(text ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');

/** Render HOOK_RISK.md, the human-facing report. */
export function renderMarkdown(manifest: Manifest): string {
  const score = manifest.score as ReturnType<typeof serialiseScore>;
  const findings = (manifest.findings ?? []) as Array<Record<string, unknown>>;
  const engines = (manifest.engines ?? []) as Array<Record<string, unknown>>;
  const coverage = (manifest.coverage ?? {}) as Record<string, unknown>;
  const target = (manifest.target ?? {}) as Record<string, unknown>;
  const permissions = (manifest.permissions ?? {}) as Record<string, unknown>;
  const invariants = (manifest.invariants ?? []) as InvariantResult[];
  const gate = manifest.gate as Record<string, unknown> | undefined;
  const generated = (manifest.generatedBy ?? {}) as Record<string, unknown>;

  const defects = findings.filter((f) => !isClassification(f.ruleClass as RuleClass));
  const classifications = findings.filter(
    (f) => isClassification(f.ruleClass as RuleClass) && f.ruleClass !== 'hook-profile',
  );
  const profile = findings.find((f) => f.ruleClass === 'hook-profile');
  const dimensions = score.dimensions as Array<Record<string, unknown>>;
  const bySource = { measured: 0, declared: 0, unmeasured: 0 } as Record<string, number>;
  for (const d of dimensions) bySource[String(d.source)] = (bySource[String(d.source)] ?? 0) + 1;

  const severityCounts = new Map<Severity, number>();
  for (const f of defects) {
    const sev = f.severity as Severity;
    severityCounts.set(sev, (severityCounts.get(sev) ?? 0) + 1);
  }
  const severitySummary =
    defects.length === 0
      ? 'none'
      : [...SEVERITIES]
          .reverse()
          .filter((sev) => severityCounts.has(sev))
          .map((sev) => `${severityCounts.get(sev)} ${sev}`)
          .join(', ');

  const tierLabel = String(score.tier).toUpperCase();
  const tierText = score.inconclusive
    ? `**${tierLabel}** ${score.total}/33, undetermined up to ${String(score.tierUpperBound).toUpperCase()} ${score.totalUpperBound}/33`
    : `**${tierLabel}** ${score.total}/33`;
  const gateText = !gate
    ? 'not evaluated (`--no-gate`)'
    : gate.passed
      ? '✅ Passed'
      : `❌ Failed (${(gate.failures as string[]).length} reason${(gate.failures as string[]).length === 1 ? '' : 's'} below)`;
  const staticRow = engines.find((e) => e.engine === 'hookrisk');
  const blocksecRow = engines.find((e) => e.engine === 'blocksec');
  const harnessRow = engines.find((e) => e.engine === 'harness');
  const engineText = (e: Record<string, unknown> | undefined): string =>
    !e ? 'not run' : `${e.status}${e.errorCode ? ` (${e.errorCode})` : ''}`;
  const invariantText =
    invariants.length === 0
      ? 'not run'
      : invariants.map((i) => `${INVARIANT_ICON[i.status] ?? ''} ${i.id} ${i.status}`).join(' · ');

  const out: string[] = [];
  out.push(`# Hook Risk Report — ${target.contractName ?? 'hook'}`, '');
  out.push(
    'Executable assessment against the [Uniswap Hooks Security Framework]' +
      '(https://github.com/uniswapfoundation/security-framework): static detectors, a differential ' +
      'twin-pool harness, and the framework’s scoring rubric. Unmeasured dimensions are excluded from ' +
      'the total, never counted as zero.',
    '',
  );

  // --- summary ---
  out.push('## Summary', '');
  out.push('| | |', '| --- | --- |');
  out.push(`| Contract | \`${target.contractName ?? '?'}\`${target.sourceFile ? ` in \`${target.sourceFile}\`` : ''} |`);
  if (target.address) out.push(`| Address | \`${target.address}\`${target.chainId ? ` on chain ${target.chainId}` : ''} |`);
  if (target.codehash) out.push(`| Codehash | \`${target.codehash}\` |`);
  if (target.solcVersion) out.push(`| Compiler | solc ${target.solcVersion} |`);
  out.push(`| Risk tier | ${tierText} |`);
  out.push(`| Gate | ${gateText} |`);
  out.push(`| Findings | ${severitySummary}${classifications.length ? ` · ${classifications.length} classification${classifications.length === 1 ? '' : 's'}` : ''} |`);
  out.push(`| Dimensions | ${bySource.measured} measured · ${bySource.declared} declared · ${bySource.unmeasured} unmeasured |`);
  out.push(`| Static analysis | ${engineText(staticRow)}${blocksecRow ? ` · BlockSec ${engineText(blocksecRow)}` : ''} |`);
  out.push(`| Differential harness | ${engineText(harnessRow)} |`);
  out.push(`| Invariants | ${invariantText} |`);
  if (generated.version) out.push(`| Tool | hookrisk ${generated.version}${score.rubric ? `, rubric ${(score.rubric as Record<string, unknown>).revision ?? ''}` : ''} |`);
  out.push('');

  if (score.inconclusive) {
    out.push(
      `> **The tier is a range.** ${score.total}/33 is the sum of what could be measured or was declared; ` +
        `${bySource.unmeasured} dimension${bySource.unmeasured === 1 ? '' : 's'} ha${bySource.unmeasured === 1 ? 's' : 've'} no detector or declaration. ` +
        `At their maximum the hook would score ${score.totalUpperBound}/33 (${score.tierUpperBound}). ` +
        'Declare them in `hookrisk.toml` to close the range.',
      '',
    );
  }
  if (target.codehash) {
    out.push(
      '> This report is bound to the codehash above. If the code at that address changes, ' +
        'this report describes something that no longer exists.',
      '',
    );
  }

  if (gate) {
    const failures = (gate.failures as string[]) ?? [];
    if (failures.length > 0) {
      out.push('### Why the gate failed', '');
      failures.forEach((f, i) => out.push(`${i + 1}. ${f}`));
      out.push('');
    }
    for (const note of (gate.notes as string[] | undefined) ?? []) out.push(`> ℹ️ ${note}`, '');
  }

  // --- findings ---
  out.push('## Findings', '');
  if (defects.length === 0) {
    out.push(
      classifications.length > 0 || profile
        ? 'No defects. The classifications and the hook profile below describe the hook without accusing it.'
        : 'No defects.',
      '',
    );
  } else {
    out.push(
      '| # | Severity | Rule | Finding | Location | Confidence | Engines |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    defects.forEach((f, i) => {
      const location = f.location as Record<string, unknown> | null;
      const eng = (f.engines as Array<Record<string, unknown>>).map((e) => String(e.engine));
      out.push(
        `| F${i + 1} | ${SEVERITY_LABEL[f.severity as Severity]} | ${RULE_ID[String(f.ruleClass)] ?? ''} \`${f.ruleClass}\` | ${cell(shortTitle(f))} | ${location ? `\`${location.file}:${location.line}\`` : '—'} | ${f.confidence}${eng.length > 1 ? ' (corroborated)' : ''} | ${eng.join(', ')} |`,
      );
    });
    out.push('');
    defects.forEach((f, i) => {
      const location = f.location as Record<string, unknown> | null;
      const attributions = f.engines as Array<Record<string, unknown>>;
      out.push(`### F${i + 1} · ${SEVERITY_LABEL[f.severity as Severity]} · ${shortTitle(f)}`, '');
      out.push(
        `${RULE_ID[String(f.ruleClass)] ? `${RULE_ID[String(f.ruleClass)]} ` : ''}\`${f.ruleClass}\`` +
          (location ? ` · \`${location.file}:${location.line}\`` : '') +
          ` · confidence **${f.confidence}**` +
          (attributions.length > 1 ? ' · **corroborated across engines**' : ''),
        '',
      );
      out.push(String(f.description), '');
      out.push(attributionSentence(f.engines as Array<Record<string, unknown>>), '');
    });
  }

  // --- classifications ---
  if (classifications.length > 0) {
    out.push('## Classifications', '');
    out.push(
      'Properties of the hook that change how it is scored or tested. They are informational and never fail the gate.',
      '',
    );
    out.push('| Rule | Classification | Applies to | Detail |', '| --- | --- | --- | --- |');
    for (const c of classifications) {
      const location = c.location as Record<string, unknown> | null;
      const eng = (c.engines as Array<Record<string, unknown>>).map((e) => String(e.engine));
      out.push(
        `| ${RULE_ID[String(c.ruleClass)] ?? ''} \`${c.ruleClass}\` | ${cell(shortTitle(c))} | ${location ? `\`${location.file}:${location.line}\`` : '—'}${c.discriminator ? ` (\`${c.discriminator}\`)` : ''} | ${cell(String(c.description).split('. ')[0])}.${eng.length > 1 ? ` Confirmed by ${eng.join(' and ')}.` : ''} |`,
      );
    }
    out.push('');
  }

  // --- hook profile ---
  if (profile) {
    out.push('## Hook profile', '');
    out.push(
      'The static engine’s structural measurement of the contract. Complexity is derived from these ' +
        'metrics; the rule that fired is quoted in the score table’s evidence.',
      '',
    );
    out.push('| Metric | Value |', '| --- | --- |');
    const callbacks = (profile.callbacks as string[] | undefined) ?? [];
    if (callbacks.length > 0) out.push(`| Callbacks implemented | ${callbacks.map((c) => `\`${c}\``).join(', ')} |`);
    for (const [name, value] of Object.entries((profile.metrics as Record<string, unknown>) ?? {})) {
      out.push(`| ${PROFILE_METRIC_LABEL[name] ?? name} | ${String(value)} |`);
    }
    const declared = profile.permissions as Record<string, boolean> | undefined;
    if (declared) {
      const on = Object.entries(declared).filter(([, v]) => v).map(([name]) => `\`${name}\``);
      out.push(`| Permissions declared | ${on.length > 0 ? on.join(', ') : 'none'} |`);
    }
    out.push('');
  }

  // --- score ---
  out.push('## Score', '');
  out.push('| Dimension | Score | Source | Bracket |', '| --- | --- | --- | --- |');
  for (const d of dimensions) {
    const value = d.value === null ? '—' : `${d.value}/${d.max}`;
    const interp = d.bracketsAreInterpretation ? ' ᵃ' : '';
    out.push(`| ${d.name} | ${value} | ${d.source} | ${d.bracketLabel ?? '_unmeasured_'}${interp} |`);
  }
  out.push('');
  out.push(
    'ᵃ Bracket supplied by hookrisk. The framework publishes brackets for only two of its nine ' +
      'dimensions; the rest are our reading of its prose. See ' +
      '[FEEDBACK.md](https://github.com/0xmvercosa/hookrisk/blob/main/FEEDBACK.md) #2.',
    '',
  );
  const evidenced = dimensions.filter((d) => Array.isArray(d.evidence) && (d.evidence as string[]).length > 0);
  if (evidenced.length > 0) {
    out.push('<details><summary>Evidence per dimension</summary>', '');
    for (const d of evidenced) {
      out.push(`- **${d.name}**`);
      for (const e of d.evidence as string[]) out.push(`  - ${e}`);
    }
    out.push('', '</details>', '');
  }

  const triggers = score.triggers as Array<Record<string, unknown>>;
  if (triggers.length > 0) {
    out.push('### Feature triggers', '');
    out.push(
      'These apply regardless of the total: the framework’s own safeguard against a team scoring itself ' +
        'low while shipping a dangerous primitive.',
      '',
    );
    out.push('| Trigger | Fired by | Derivation |', '| --- | --- | --- |');
    for (const t of triggers) {
      out.push(
        `| ${t.name} | ${(t.firedBy as string[]).map((x) => `\`${x}\``).join(', ')} | ${t.derivationIsInterpretation ? 'hookrisk’s reading' : 'framework'} |`,
      );
    }
    out.push('');
  }

  // --- security plan ---
  const recommendations = score.recommendations as Array<Record<string, unknown>>;
  if (recommendations.length > 0) {
    out.push('## Security plan', '');
    out.push(
      'The strongest requirement across the tier baseline and every fired trigger, with the source of each.',
      '',
    );
    out.push('| Action | Strength | Because |', '| --- | --- | --- |');
    for (const r of recommendations) {
      const sources = (r.sources as Array<Record<string, unknown>>) ?? [];
      out.push(`| ${r.label} | ${STRENGTH_LABEL[String(r.strength)] ?? r.strength} | ${sources.map((s) => `\`${s.from}\``).join(', ')} |`);
    }
    out.push('');
  }

  // --- dynamic analysis ---
  const run = permissions.harnessRun as Record<string, unknown> | undefined;
  const observations = coverage.observations as HarnessObservations | undefined;
  if (invariants.length > 0 || harnessRow) {
    out.push('## Dynamic analysis', '');
    if (harnessRow) {
      out.push(
        `Differential twin-pool harness: **${harnessRow.status}**${harnessRow.errorCode ? ` (${harnessRow.errorCode})` : ''}` +
          (harnessRow.reason ? `. ${harnessRow.reason}` : '.'),
        '',
      );
    }
    if (run) {
      out.push('| Run | |', '| --- | --- |');
      out.push(`| Hook address flags | \`0x${Number(run.flags).toString(16)}\`${run.permissionsDerived ? ' (derived from the runtime code)' : ''} |`);
      out.push(`| Pricing | ${run.customCurve ? 'custom curve: output comparison replaced by price monotonicity' : 'v4 pricing: output compared against the reference pool'} |`);
      out.push(`| Pool fee | ${run.dynamicFee ? 'dynamic (static fee rejected by the hook)' : 'static'} |`);
      out.push(`| Initial liquidity | ${run.seeded === 'both' ? 'seeded on both pools' : `the hook rejected PoolManager liquidity${run.hookedSeedRevert ? ` (\`${String(run.hookedSeedRevert).slice(0, 10)}…\`)` : ''}`} |`);
      if (run.probes) out.push(`| Execution probes | ${cell(summariseProbes(run.probes as HarnessProbes))} |`);
      out.push('');
    }
    if (invariants.length > 0) {
      out.push('| | Invariant | Result | Detail |', '| --- | --- | --- | --- |');
      for (const inv of invariants) {
        // A skipped harness gives every invariant the same reason; printing it
        // three more times buries the table. Point at the line above instead.
        const detail =
          inv.detail && harnessRow?.reason && inv.detail === harnessRow.reason
            ? 'see the harness status above'
            : cell(inv.detail ?? '');
        out.push(`| ${INVARIANT_ICON[inv.status] ?? ''} | ${inv.id} ${inv.name} | ${inv.status} | ${detail} |`);
      }
      out.push('');
      for (const inv of invariants) {
        if (inv.status !== 'failed' || !inv.counterexample) continue;
        out.push(`### Counterexample for ${inv.id}`, '');
        if (inv.counterexample.revertSelector) out.push(`Hook reverted with \`${inv.counterexample.revertSelector}\`.`, '');
        if (inv.counterexample.sequence?.length) {
          out.push('```');
          inv.counterexample.sequence.forEach((step) => out.push(`${step.signature ?? step.target ?? ''} ${step.calldata ?? ''}`.trim()));
          out.push('```', '');
        }
      }
    }
    if (observations) {
      const n = (key: keyof HarnessObservations): number => observations[key] ?? 0;
      out.push('| Observed | |', '| --- | --- |');
      if (observations.sequences !== undefined) out.push(`| Fuzz sequences | ${observations.sequences} |`);
      out.push(`| Swaps landed / compared / skipped | ${n('swapsExecuted')} / ${n('swapsCompared')} / ${n('swapsSkipped')} |`);
      out.push(`| Swaps that reverted only with the hook | ${n('hookedSwapReverted')} |`);
      out.push(`| Positions opened / closed | ${n('positionsOpened')} / ${n('positionsClosed')} |`);
      out.push(`| Donations | ${n('donations')} |`);
      out.push(`| Price checks / monotonicity violations | ${n('priceChecks')} / ${n('monotonicityViolations')} |`);
      out.push(`| Exit failures | ${n('exitFailures')} |`);
      out.push('');
      out.push(
        `The harness executed ${n('swapsExecuted')} swap(s) (${n('swapsCompared')} compared against the ` +
          `reference pool, ${n('swapsSkipped')} skipped), opened ${n('positionsOpened')} and closed ` +
          `${n('positionsClosed')} position(s), made ${n('donations')} donation(s) and ran ` +
          `${n('priceChecks')} price check(s)` +
          (observations.sequences !== undefined ? ` over ${observations.sequences} sequence(s)` : '') +
          '. An invariant with no relevant observations is reported inconclusive, not passed.',
        '',
      );
    }
  }

  // --- coverage ---
  out.push('## Analysis coverage', '');
  out.push('| Engine | Status | Findings | Notes |', '| --- | --- | --- | --- |');
  for (const e of engines) {
    out.push(`| ${e.displayName ?? e.engine} | ${e.status}${e.errorCode ? ` (${e.errorCode})` : ''} | ${e.findingCount ?? 0} | ${cell(e.reason ?? '')} |`);
  }
  out.push('');
  const fromEngine = permissions.fromEngine as Record<string, boolean> | undefined;
  const fromRuntime = permissions.fromRuntime as Record<string, boolean> | undefined;
  const disagreement = permissions.disagreement as string[] | undefined;
  if (fromEngine && fromRuntime) {
    out.push(
      disagreement && disagreement.length > 0
        ? `> ⚠️ **Permissions disagree.** Static analysis and the deployed runtime differ on ${disagreement.map((d) => `\`${d}\``).join(', ')}: one of the two analyses is looking at the wrong contract.`
        : 'Permissions resolved by static analysis and derived from the deployed runtime code agree.',
      '',
    );
  }
  const uncovered = (coverage.uncoveredFunctions ?? []) as UncoveredFunction[];
  if (uncovered.length > 0) {
    out.push(
      `> ⚠️ **${uncovered.length} function(s) in the compilation unit were not analysed.** Slither could not lift them ` +
        'to IR and continued silently. Findings above do not cover them; that is not the same as those functions being clean. See `HR-E205`.',
      '',
    );
    for (const u of uncovered) out.push(`- \`${u.contract}.${u.function}\``);
    out.push('');
  }
  if (Number(coverage.corroboratedFindings ?? 0) > 0) {
    out.push(
      `${coverage.corroboratedFindings} finding(s) were confirmed independently by engines built on different ` +
        'analysis foundations and carry raised confidence as a result.',
      '',
    );
  }

  const warnings = score.warnings as string[];
  if (warnings.length > 0) {
    out.push('## Warnings', '');
    warnings.forEach((w) => out.push(`- ${w}`));
    out.push('');
  }

  out.push('---', '');
  out.push(
    '_Generated by [hookrisk](https://github.com/0xmvercosa/hookrisk). The Uniswap Foundation ' +
      'does not review, endorse or certify this report or any score derived from its framework._',
  );

  return out.join('\n');
}

/** Highest severity present, for badge colour and gate messaging. */
export function worstSeverity(findings: Finding[]): Severity | null {
  let worst: Severity | null = null;
  for (const f of findings) {
    if (!worst || severityRank(f.severity) > severityRank(worst)) worst = f.severity;
  }
  return worst;
}

export { SEVERITIES };

const firstLine = (text: string): string => text.split('\n')[0]?.trim().slice(0, 200) ?? '';
