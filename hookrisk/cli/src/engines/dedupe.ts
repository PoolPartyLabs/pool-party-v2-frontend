/**
 * Reconciliation of findings across engines.
 *
 * Running several analyzers over the same contract produces overlapping output.
 * Two engines flagging the same missing access check is *one* problem reported
 * twice, and treating it as two is wrong in both directions: the report
 * overstates how much is broken, and the strongest available signal — that
 * independent tools, built on different foundations, reached the same conclusion
 * — gets thrown away.
 *
 * So findings are keyed by what they are *about* (canonical class, location,
 * function, discriminator) rather than by who reported them. Matching findings
 * collapse into one, carrying every engine's attribution.
 *
 * The confidence rule
 * -------------------
 * Corroboration by two engines that do not share an analysis foundation raises
 * confidence to `high`. Our Slither detectors work on solc's AST and SlithIR;
 * BlockSec's HookScan works on the Yul CFG. Agreement between them is close to
 * independent confirmation, which is the best false-positive filter available
 * without a human reading the code.
 *
 * Agreement between two engines that *do* share a foundation is not treated as
 * independent. Today every pairing is cross-foundation, but the rule is written
 * out so that adding a second Slither-based engine later does not quietly
 * inflate confidence across the whole report.
 *
 * The anchoring rule
 * ------------------
 * A key that is too loose merges distinct defects; one that is too tight splits
 * one defect into two uncorroborated findings. Both failures were observed:
 *
 * - Too loose: HS-02 anchors every divergent permission on the contract itself,
 *   so Orbital's two divergences (and nine on OpenZeppelin's BaseHookMockReverts)
 *   became one finding. The `discriminator` an engine attaches now keeps them
 *   apart.
 * - Too tight: our detectors know a callback by *name*, HookScan by *selector*.
 *   Keyed on the raw value the two engines could never agree on an HS-01, which
 *   is the one class they both cover. Callback names are resolved to selectors
 *   before keying so the spellings line up.
 */

import { createHash } from 'node:crypto';

import {
  type Confidence,
  type EngineAttribution,
  type EngineResult,
  type Finding,
  type FunctionRef,
  type RuleClass,
  type SourceLocation,
  confidenceRank,
  severityRank,
} from '../types.js';

/**
 * Analysis foundation each engine is built on.
 *
 * Two engines sharing a foundation share its blind spots, so their agreement is
 * much weaker evidence than agreement across foundations.
 */
const ENGINE_FOUNDATION: Record<string, string> = {
  hookrisk: 'solc-ast',
  blocksec: 'yul-cfg',
};

/**
 * Selectors of the ten IHooks callbacks, taken from the pinned v4-core build
 * (`harness/out/IHooks.sol/IHooks.json`, `methodIdentifiers`).
 *
 * The table exists because engines spell the same function differently: a
 * SlithIR detector has the declaration's name, a Yul-CFG analyzer has the
 * selector it dispatched on. Resolving names to selectors here is what lets an
 * HS-01 from hookrisk and a UniswapPublicHook from BlockSec land in one bucket.
 */
export const HOOK_CALLBACK_SELECTORS: Readonly<Record<string, string>> = {
  beforeInitialize: '0xdc98354e',
  afterInitialize: '0x6fe7e6eb',
  beforeAddLiquidity: '0x259982e5',
  afterAddLiquidity: '0x9f063efc',
  beforeRemoveLiquidity: '0x21d0ee70',
  afterRemoveLiquidity: '0x6c2bbe7e',
  beforeSwap: '0x575e24b4',
  afterSwap: '0xb47b2fb1',
  beforeDonate: '0xb6a8b0fa',
  afterDonate: '0xe1b4af69',
};

/**
 * Selector for a callback name, or undefined when the name is not an IHooks
 * callback. `_beforeSwap`, `beforeSwap(address,...)` and `beforeSwap` all resolve
 * to the same selector: BaseHook's internal override, a full signature and a
 * bare name are three ways engines refer to one entry point.
 */
export function callbackSelector(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const bare = name.replace(/^_+/, '').split('(')[0]!;
  return HOOK_CALLBACK_SELECTORS[bare];
}

/**
 * Stable identifier for a finding.
 *
 * Deliberately excludes severity, confidence and the reporting engine, so the
 * same defect gets the same id no matter who found it or how badly they rated
 * it. Line numbers are included: two missing guards in one file are two
 * findings. That does mean an unrelated edit above a finding changes its id, and
 * that is the accepted trade — the alternative, hashing surrounding source,
 * makes ids unstable under formatting instead.
 *
 * The discriminator is appended only when present, so ids of findings that never
 * carried one are unchanged by its introduction.
 */
export function makeFindingId(
  ruleClass: RuleClass,
  location: SourceLocation | null,
  selector?: string,
  discriminator?: string,
): string {
  const parts = [
    ruleClass,
    location ? `${location.file}:${location.line}` : 'no-location',
    selector ?? 'no-selector',
  ];
  if (discriminator) parts.push(discriminator);
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/** Canonical spelling of the function a finding is anchored on, if any. */
function functionIdentity(fn: FunctionRef | undefined): string | undefined {
  if (fn?.selector) return `sel:${fn.selector.toLowerCase()}`;
  if (fn?.name) {
    const selector = callbackSelector(fn.name);
    return selector ? `sel:${selector}` : `fn:${fn.name}`;
  }
  return undefined;
}

/**
 * Canonical spelling of a discriminator. HS-01 discriminates by callback name,
 * which is the same thing as the function it is anchored on; resolving it the
 * same way lets the two collapse instead of double-keying one finding.
 */
function discriminatorIdentity(discriminator: string): string {
  const selector = callbackSelector(discriminator);
  return selector ? `sel:${selector}` : `disc:${discriminator}`;
}

/**
 * Group key for reconciliation.
 *
 * Slightly looser than the finding id: when a function is known it wins over
 * the line, because engines routinely disagree by a line or two about where a
 * function "is" — one points at the `function` keyword, another at the
 * offending statement. Keying on `class + file + function` in that case stops a
 * one-line disagreement from splitting a corroborated finding into two
 * uncorroborated ones.
 *
 * The discriminator is added when it says something the function does not.
 * Only when neither is known does the line number stand in.
 */
export function groupKey(f: Finding): string {
  const parts = [f.ruleClass, f.location?.file ?? 'no-file'];
  const fn = functionIdentity(f.function);
  const discriminator = f.discriminator ? discriminatorIdentity(f.discriminator) : undefined;
  if (fn) parts.push(fn);
  if (discriminator && discriminator !== fn) parts.push(discriminator);
  if (!fn && !discriminator) parts.push(String(f.location?.line ?? 'no-line'));
  return parts.join('|');
}

/** One bucket that collapsed, and why. Logged at verbose level and kept in stats. */
export interface MergeRecord {
  ruleClass: RuleClass;
  /** The key the findings agreed on. */
  key: string;
  /** How many findings went in. */
  count: number;
  /** Engines represented, in first-seen order. */
  engines: string[];
  /** True when the engines span more than one analysis foundation. */
  corroborated: boolean;
}

export interface MergeStats {
  /** Findings before reconciliation. */
  total: number;
  /** Findings after. */
  unique: number;
  /** How many were confirmed by more than one foundation. */
  corroborated: number;
  /** Per-engine counts, for the report's engine table. */
  byEngine: Record<string, number>;
  /** Every bucket that held more than one finding. */
  merges: MergeRecord[];
}

export interface MergeOutcome {
  findings: Finding[];
  stats: MergeStats;
}

/**
 * Reconcile findings from every engine into one ordered list.
 *
 * Output is sorted by severity, then confidence, then file and line, so the
 * first thing in the report is the thing most worth reading.
 *
 * `log` receives one line per collapsed bucket. A verbose run that says "3
 * finding(s)" from one engine and then writes two into the manifest, with
 * nothing in between, is how the Orbital duplicate went unnoticed.
 */
export function mergeEngineResults(
  results: EngineResult[],
  log: (message: string) => void = () => {},
): MergeOutcome {
  const byEngine: Record<string, number> = {};
  const groups = new Map<string, Finding[]>();

  for (const result of results) {
    byEngine[result.engine] = result.findings.length;
    for (const finding of result.findings) {
      const key = groupKey(finding);
      const bucket = groups.get(key);
      if (bucket) bucket.push(finding);
      else groups.set(key, [finding]);
    }
  }

  let corroborated = 0;
  let total = 0;
  const merged: Finding[] = [];
  const merges: MergeRecord[] = [];

  for (const [key, bucket] of groups) {
    total += bucket.length;
    const combined = mergeGroup(bucket);
    const crossFoundation = foundations(combined.engines).size > 1;
    if (crossFoundation) corroborated += 1;
    merged.push(combined);

    if (bucket.length > 1) {
      const engines = [...new Set(bucket.flatMap((f) => f.engines.map((e) => e.engine)))];
      merges.push({ ruleClass: combined.ruleClass, key, count: bucket.length, engines, corroborated: crossFoundation });
      log(
        `reconcile: merged ${bucket.length} ${combined.ruleClass} finding(s) keyed ${key} into one — ` +
          (crossFoundation
            ? `corroborated across ${engines.join(' and ')}`
            : engines.length > 1
              ? `reported by ${engines.join(' and ')}, which share an analysis foundation`
              : `${engines[0]} reported the same anchor ${bucket.length} times`),
      );
    }
  }

  if (merges.length > 0) {
    log(`reconcile: ${total} finding(s) in, ${merged.length} out, ${merges.length} bucket(s) merged`);
  }

  merged.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      confidenceRank(b.confidence) - confidenceRank(a.confidence) ||
      (a.location?.file ?? '').localeCompare(b.location?.file ?? '') ||
      (a.location?.line ?? 0) - (b.location?.line ?? 0),
  );

  return {
    findings: merged,
    stats: { total, unique: merged.length, corroborated, byEngine, merges },
  };
}

/** Collapse one group of equivalent findings. */
function mergeGroup(bucket: Finding[]): Finding {
  if (bucket.length === 1) return bucket[0]!;

  // Take the richest description rather than the first: engines vary a lot in
  // how much they say, and the longest is almost always the most useful.
  const primary = bucket.reduce((best, f) =>
    f.description.length > best.description.length ? f : best,
  );

  const engines: EngineAttribution[] = [];
  const seen = new Set<string>();
  for (const f of bucket) {
    for (const attribution of f.engines) {
      const dedupeKey = `${attribution.engine}|${attribution.nativeRule}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      engines.push(attribution);
    }
  }

  // Severity: the most severe assessment wins. A tool that under-rates does not
  // get to talk a peer down; the user can see every individual rating in
  // `engines[]` and disagree if they want.
  const severity = bucket.reduce(
    (worst, f) => (severityRank(f.severity) > severityRank(worst) ? f.severity : worst),
    bucket[0]!.severity,
  );

  const confidence = mergedConfidence(bucket, engines);

  return {
    ...primary,
    severity,
    confidence,
    engines,
    evidence: dedupeStrings(bucket.flatMap((f) => f.evidence)),
    references: dedupeStrings(bucket.flatMap((f) => f.references ?? [])),
    informsDimensions: dedupeStrings(bucket.flatMap((f) => f.informsDimensions ?? [])),
    informsTriggers: dedupeStrings(bucket.flatMap((f) => f.informsTriggers ?? [])),
  };
}

/**
 * Confidence after merging.
 *
 * Cross-foundation agreement promotes to `high`. Otherwise take the highest any
 * single engine claimed — engines are already conservative about their own
 * confidence, and averaging would punish the one that was sure.
 */
function mergedConfidence(bucket: Finding[], engines: EngineAttribution[]): Confidence {
  if (foundations(engines).size > 1) return 'high';
  return bucket.reduce<Confidence>(
    (best, f) => (confidenceRank(f.confidence) > confidenceRank(best) ? f.confidence : best),
    bucket[0]!.confidence,
  );
}

function foundations(engines: EngineAttribution[]): Set<string> {
  return new Set(engines.map((e) => ENGINE_FOUNDATION[e.engine] ?? `unknown:${e.engine}`));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
