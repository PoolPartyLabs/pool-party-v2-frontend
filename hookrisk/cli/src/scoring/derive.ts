/**
 * Turning findings into dimension scores.
 *
 * This is the join between the two halves of hookrisk, and the place where it
 * would be easiest to be quietly dishonest.
 *
 * The rule that governs everything here: **a dimension can be scored 0 only if a
 * detector capable of finding a non-zero value actually looked.** Absence of
 * evidence is evidence of absence only when someone looked.
 *
 * Consider `upgradeability`. If nothing reported a proxy, it is tempting to
 * record 0 — the hook is immutable, three points off the total, possibly a tier
 * lower. But if no engine capable of detecting a proxy ran, that 0 is fabricated,
 * and it is fabricated in the direction that makes the hook look safer. Over a
 * whole report those biases compound in one direction, which is exactly how a
 * scoring tool ends up understating risk precisely when it knows least.
 *
 * So each dimension declares which rule classes can raise it, and which engines
 * can produce those classes. A dimension is scored `measured` when every
 * responsible engine looked, and `unmeasured` otherwise. Unmeasured dimensions
 * are excluded from the total and reported as a range — see `score.ts`.
 *
 * "Ran" is not "looked". An engine reports `status: 'ok'` when its process
 * completed; that says nothing about whether it recognised the target. Five
 * legacy hooks (2023 `getHooksCalls()` ABI) were scored complexity "measured 0 /
 * Pass-through only" because Slither ran cleanly over contracts the detectors
 * never identified as hooks. An engine now counts as having looked only when it
 * ran *and* did not disclaim the target — through `EngineResult.targetCoverage`
 * or an `unsupported-hook-abi` classification.
 *
 * A consequence worth stating plainly: with only HS-01, HS-02 and HS-07
 * implemented, most dimensions come back unmeasured and the tier is a range
 * rather than a point. That is the correct output for the current state of the
 * tool, and it is preferable to a confident-looking number built on detectors
 * that do not exist yet.
 */

import type { DeclaredInputs } from '../config.js';
import type { EngineResult, Finding, RuleClass } from '../types.js';
import { severityRank } from '../types.js';
import {
  type Derivation,
  type DerivationRule,
  type FindingDerivation,
  type FindingDerivationRule,
  type Rubric,
  loadRubric,
} from './rubric.js';
import { type DimensionInput, type ScoringInput, type ValueSource, evaluateCondition } from './score.js';

/**
 * The differential harness's id in `CLASS_COVERAGE` and in `looked`.
 *
 * It is not an entry in `engineResults` — it produces invariants and probe
 * observations rather than engine findings, and the CLI keeps it in its own
 * summary — but for coverage purposes it is an analysis that either examined
 * the hook or did not, exactly like an engine. Matches
 * `manifest.HARNESS_ENGINE_ID`, which is what the manifest's engines table and
 * every harness-sourced finding's attribution already say.
 */
const HARNESS_ENGINE = 'harness';

/**
 * Which engine can produce each rule class.
 *
 * `hookrisk` is our Slither plugin, `blocksec` is BlockSec's HookScan. Classes
 * only one engine covers become unmeasurable when that engine is unavailable,
 * which is why the BlockSec integration widens what hookrisk can score rather
 * than merely duplicating it.
 */
const CLASS_COVERAGE: Record<RuleClass, string[]> = {
  'unprotected-hook-callback': ['hookrisk', 'blocksec'],
  'unprotected-unlock-callback': ['blocksec'],
  'flag-implementation-divergence': ['hookrisk'],
  'admin-surface': ['hookrisk'],
  'upgradeable-hook': ['hookrisk', 'blocksec'],
  selfdestruct: ['blocksec'],
  'external-call-in-swap-path': ['hookrisk'],
  'unbounded-dynamic-fee': ['hookrisk'],
  'custom-accounting': ['hookrisk'],
  'rounding-direction': ['hookrisk'],
  'callback-intentionally-disabled': ['hookrisk'],
  'unsupported-hook-abi': ['hookrisk'],
  // The harness produces these two by executing the deployed hook, not by
  // reading it: no detector can decide either from source. `harness` is not an
  // engine in `engineResults` — see `enginesThatLooked`, which admits it from
  // the harness summary the CLI passes.
  'unvalidated-pool-key': [HARNESS_ENGINE],
  'callback-selector-mismatch': [HARNESS_ENGINE],
  'hook-profile': ['hookrisk'],
};

/**
 * Rule classes hookrisk currently implements a detector for.
 *
 * Deliberately explicit and deliberately short. A class listed here but not
 * actually implemented would let a dimension be scored 0 by a detector that
 * never runs, which is the failure this whole module exists to prevent. Update
 * it when a detector lands, not when one is planned.
 *
 * The two classifications are listed because hookrisk does emit them, and the
 * question this set answers is "can hookrisk produce this class?". They appear
 * in no dimension's `raisedBy`, so their presence here can never justify a
 * measured 0: a classification describes the target, it does not clear it. Their
 * scoring role runs the other way — `unsupported-hook-abi` *revokes* hookrisk's
 * coverage of the target (see `enginesThatLooked`), turning every dimension it
 * would have measured into unmeasured.
 *
 * `hook-profile` is the third classification and the only one that feeds a
 * score: it is the engine's "I looked at this contract" signal and carries the
 * metrics complexity is derived from (see `deriveFromMetrics`). It is listed
 * for the same reason as the other two — hookrisk emits it — and like them it
 * appears in no `raisedBy`. Its absence is how complexity stays unmeasured
 * when the engine never profiled the target; its presence is never a 0 by
 * silence, because the value comes from the metrics, not from the finding
 * having fired.
 */
const IMPLEMENTED_CLASSES: ReadonlySet<RuleClass> = new Set<RuleClass>([
  'unprotected-hook-callback',
  'flag-implementation-divergence',
  // HS-03, HS-05 and HS-06 landed with this pass: hookrisk can now produce
  // these classes, so their absence is a fact about the hook rather than a
  // fact about the tool — provided the engine analysed the target. Whether
  // that absence measures a *zero* is a separate question, answered per
  // dimension by `unmeasuredWhenSilent`: each of the three detectors has a
  // blind spot that coincides with its dimension's lowest brackets.
  'admin-surface',
  'external-call-in-swap-path',
  'unbounded-dynamic-fee',
  'custom-accounting',
  'callback-intentionally-disabled',
  'unsupported-hook-abi',
  'hook-profile',
]);

interface DimensionRule {
  /** Rule classes that can raise this dimension above 0. */
  raisedBy: RuleClass[];
  /** Score to assign when a class is present. Highest match wins. */
  scoreFor: Partial<Record<RuleClass, number>>;
  /** Why this mapping, shown in the manifest as evidence. */
  rationale: string;
  /**
   * When set, silence from every responsible engine leaves the dimension
   * unmeasured rather than measured 0, and this text says why. For a dimension
   * whose detectors only ever establish a floor, "nothing fired" does not mean
   * "the value is 0"; it means the tool has no way to measure it.
   */
  unmeasuredWhenSilent?: string;
}

const DIMENSION_RULES: Record<string, DimensionRule> = {
  upgradeability: {
    raisedBy: ['upgradeable-hook', 'selfdestruct'],
    // 2 rather than 3: a proxy is present, but source analysis cannot tell
    // whether an EOA or a multisig controls it. Deployed mode reads `owner()`
    // and its codesize, and can refine this to 1, 2 or 3.
    scoreFor: { 'upgradeable-hook': 2, selfdestruct: 2 },
    rationale:
      'A proxy, DELEGATECALL to mutable code, or SELFDESTRUCT was found. Scored 2 (multisig-equivalent) because source analysis cannot identify the controller; scan the deployed address to refine.',
  },
  priceImpactingBehavior: {
    raisedBy: ['custom-accounting', 'unbounded-dynamic-fee'],
    // 3 only when the delta touches a *swap* (before/afterSwapReturnDelta). A
    // liquidity-only returns-delta (after{Add,Remove}LiquidityReturnDelta)
    // adjusts what an LP settles, never a swap price, and the swap comparison
    // (I2) still applies to it; see adjustForLiquidityOnlyDelta.
    scoreFor: { 'custom-accounting': 3, 'unbounded-dynamic-fee': 2 },
    rationale:
      'A returns-delta permission lets the hook alter settled amounts, which is the framework’s definition of price-impacting behaviour.',
    // HS-07 sees a returns-delta permission and HS-06 sees a dynamic fee with
    // no ceiling. Neither sees a *bounded* dynamic fee, which is the rubric's
    // own 2 bracket, and neither sees a fixed fee taken through an lpFeeOverride
    // (bracket 1). Silence therefore cannot separate 0 from 1 or 2, and the 0
    // bracket — "observes swaps; does not alter price, fee or delta" — is the
    // strongest claim in the dimension.
    unmeasuredWhenSilent:
      'no returns-delta permission and no unbounded dynamic fee were found, but HS-06 only reports a fee it can show is unbounded: a hook that adjusts its LP fee within a ceiling (bracket 2) or charges a fixed declared fee (bracket 1) fires nothing. Declare priceImpactingBehavior in hookrisk.toml to score it.',
  },
  customMath: {
    raisedBy: ['custom-accounting', 'rounding-direction'],
    scoreFor: { 'custom-accounting': 3, 'rounding-direction': 2 },
    rationale:
      'Custom accounting implies a custom curve or non-standard settlement arithmetic.',
  },
  externalDependencies: {
    raisedBy: ['external-call-in-swap-path'],
    // The per-finding split (2 for a call that can write, 1 for a static read)
    // lives in the rubric's `findingDerivation`, with the rationale for each
    // bracket; this stays as the fallback for a finding the rubric's rules do
    // not match.
    scoreFor: { 'external-call-in-swap-path': 2 },
    rationale:
      'An external call inside the swap path reopens the execution environment mid-swap.',
    // HS-05 is scoped to the swap path by construction, and the rubric's 1
    // bracket is "one immutable, trusted dependency read *outside* the swap
    // path". A hook that reads an oracle in afterInitialize and nothing in
    // beforeSwap is a 1 that HS-05 is not looking for, so its silence cannot
    // establish the 0 bracket ("touches only the PoolManager and the pair's
    // tokens"). Closing this needs a metric counting external calls outside
    // the swap path; the hook profile does not carry one yet.
    unmeasuredWhenSilent:
      'HS-05 found no external call inside the swap path, but it only looks there: a dependency read outside the swap path is the rubric’s 1 bracket and no detector reports it. Declare externalDependencies in hookrisk.toml to score it.',
  },
  autonomousParameterUpdates: {
    raisedBy: ['admin-surface'],
    // Both values come from the rubric's `findingDerivation`, which reads the
    // finding's severity: HIGH is an unguarded mutator, MEDIUM an owner-only
    // one. The flat entry is the floor for an admin-surface finding whose
    // severity matches no rule.
    scoreFor: { 'admin-surface': 1 },
    rationale:
      'HS-03 found a state-changing external function on the hook. The framework grades this dimension by the guardrails on a parameter change (bounds, rate limit, gating); an admin surface is where those guardrails would have to live.',
    // HS-03 answers "who may change a parameter", not "does the hook change one
    // by itself". A hook that recomputes its fee from its own state inside
    // beforeSwap — the 3 bracket, self-adjusting with neither bounds nor rate
    // limiting — has no admin surface at all and fires nothing. Reading that
    // silence as 0 ("all parameters set by an explicit privileged call") would
    // score the most autonomous hook in the corpus at the bottom of the scale.
    unmeasuredWhenSilent:
      'HS-03 found no privileged or unguarded mutator, but it measures the admin surface, not autonomy: a hook that recomputes a parameter from its own state inside a callback has no admin surface and fires nothing. Declare autonomousParameterUpdates in hookrisk.toml to score it.',
  },
  complexity: {
    raisedBy: ['flag-implementation-divergence', 'unprotected-hook-callback'],
    // These findings prove the hook has callbacks and non-trivial structure, but
    // they are a poor proxy for the framework's notion of complexity, so they
    // only ever establish a floor of 1.
    scoreFor: { 'flag-implementation-divergence': 1, 'unprotected-hook-callback': 1 },
    rationale:
      'The hook implements callbacks with non-trivial structure. This establishes a floor only; the measured value comes from the hook-profile metrics when the engine profiled the target.',
    // A floor-only detector cannot measure 0. The rubric's 0 bracket reads
    // "No callbacks implemented", and nothing HS-01/HS-02 run can tell a
    // pass-through hook from a complex one whose callbacks happen to be guarded
    // and correctly declared — which is what every well-written hook looks like.
    // Only the hook-profile classification, which counts rather than accuses,
    // can measure it; without one the dimension stays unmeasured.
    unmeasuredWhenSilent:
      'the engine emitted no hook-profile for the target, so its metrics could not be read. HS-01 and HS-02 only establish a floor of 1 when they fire, and neither fired; that silence says nothing about how much state the callbacks branch on. Declare complexity in hookrisk.toml to score it.',
  },
};

// --------------------------------------------------------------------------- //
// Deriving a value from a classification's metrics
// --------------------------------------------------------------------------- //

/**
 * The hook-profile finding for the target, when the engine emitted one.
 *
 * Findings reaching the scorer are already restricted to the target file, but
 * one file can hold several hook contracts (a mock and its base, say), each
 * with its own profile. The contract name disambiguates through the finding's
 * discriminator; without one, the first profile wins and the evidence says so.
 */
export function hookProfileOf(
  findings: Finding[],
  contractName?: string,
): { profile: Finding; note?: string } | null {
  const profiles = findings.filter((f) => f.ruleClass === 'hook-profile');
  if (profiles.length === 0) return null;
  if (contractName) {
    const named = profiles.find((f) => f.discriminator === contractName);
    if (named) return { profile: named };
  }
  const note =
    profiles.length > 1
      ? `${profiles.length} hook-profile classifications in the target file; used the one anchored at line ${profiles[0]!.location?.line ?? '?'}.`
      : undefined;
  return { profile: profiles[0]!, ...(note ? { note } : {}) };
}

/**
 * Read the metrics off a profile finding.
 *
 * The engine-metadata contract fixes the metric names but not where the
 * adapter hangs them on `Finding`; `metrics` is the field this branch defines,
 * and an engine attribution's `detail.metrics` is the pre-existing slot for
 * engine-specific extras. Either is accepted so the two halves of the contract
 * can land independently.
 */
export function profileMetrics(profile: Finding): Record<string, number | boolean> | null {
  const isMetrics = (value: unknown): value is Record<string, number | boolean> =>
    typeof value === 'object' &&
    value !== null &&
    Object.values(value as Record<string, unknown>).every(
      (v) => typeof v === 'number' || typeof v === 'boolean',
    );
  if (isMetrics(profile.metrics)) return profile.metrics;
  for (const attribution of profile.engines) {
    const candidate = attribution.detail?.metrics;
    if (isMetrics(candidate)) return candidate;
  }
  return null;
}

/**
 * Apply a rubric derivation to a metrics object: highest score first, the
 * first rule whose condition holds wins. Numeric metrics are the condition
 * grammar's values, boolean metrics its flags — the same evaluator the
 * requirement guards use, so the rubric has one condition language, not two.
 *
 * Null when no rule matched. A rule table whose lowest rule cannot be met
 * (a metric the engine did not send, say) leaves the dimension unmeasured with
 * the metrics in its evidence, rather than defaulting to any score.
 */
export function deriveFromMetrics(
  derivation: Derivation,
  metrics: Record<string, number | boolean>,
): { score: number; rule: DerivationRule } | null {
  const values: Record<string, number> = {};
  const flags: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(metrics)) {
    if (typeof value === 'number') values[name] = value;
    else flags[name] = value;
  }
  const ordered = [...derivation.rules].sort((a, b) => b.score - a.score);
  for (const rule of ordered) {
    if (evaluateCondition(rule.when, values, new Set(), flags)) return { score: rule.score, rule };
  }
  return null;
}

/**
 * Score one rule class from the findings that carry it, using the rubric's
 * per-finding rules.
 *
 * Two of the new detectors report the same class in two shapes that deserve
 * different scores — an unguarded mutator against an owner-only one, a call
 * that can write against a static read — and the shape is on the finding
 * (severity, `metrics`), not on the class. The rules are read in the order the
 * rubric writes them, first match wins, and a rule with no `when` is that
 * class's fallback; the loader refuses a rule written after one.
 *
 * The worst finding wins, and the rule that produced it is returned so the
 * dimension's evidence can quote the rationale rather than assert a number.
 * Null when the class has no rules here, or when no rule matched any finding —
 * the caller then falls back to `DimensionRule.scoreFor`.
 */
export function scoreFromFindings(
  derivation: FindingDerivation | undefined,
  ruleClass: RuleClass,
  findings: Finding[],
): { score: number; rule: FindingDerivationRule; finding: Finding } | null {
  const rules = (derivation?.rules ?? []).filter((r) => r.ruleClass === ruleClass);
  if (rules.length === 0) return null;

  let best: { score: number; rule: FindingDerivationRule; finding: Finding } | null = null;
  for (const finding of findings) {
    const { values, flags } = findingAttributes(finding);
    const hit = rules.find((rule) => rule.when === undefined || evaluateCondition(rule.when, values, new Set(), flags));
    if (!hit) continue;
    if (!best || hit.score > best.score) best = { score: hit.score, rule: hit, finding };
  }
  return best;
}

/**
 * The attributes a `findingDerivation` condition may read.
 *
 * Booleans go into both maps: as flags so `isStatic` reads naturally, and as
 * 0/1 values so `isStatic == 0` expresses the negative. The condition grammar
 * has no `!`, and adding one to a language that decides scores is a worse
 * trade than writing the comparison.
 */
function findingAttributes(finding: Finding): {
  values: Record<string, number>;
  flags: Record<string, boolean>;
} {
  const values: Record<string, number> = { severityRank: severityRank(finding.severity) };
  const flags: Record<string, boolean> = {};
  // `profileMetrics` reads `metrics` wherever the adapter hung it; nothing
  // about it is specific to a hook-profile finding.
  for (const [name, value] of Object.entries(profileMetrics(finding) ?? {})) {
    if (typeof value === 'number') values[name] = value;
    else {
      flags[name] = value;
      values[name] = value ? 1 : 0;
    }
  }
  return { values, flags };
}

const formatMetrics = (metrics: Record<string, number | boolean>): string =>
  Object.entries(metrics)
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');

/** Dimensions hookrisk never measures. Declared or unmeasured, never invented. */
// autonomousParameterUpdates left this set when HS-03 landed: it is now raised
// by `admin-surface`, and unmeasured only when nothing fired (see
// DIMENSION_RULES).
const NEVER_MEASURED = new Set(['teamMaturity', 'tvlPotential', 'externalLiquidityExposure']);

export interface DeriveOptions {
  findings: Finding[];
  engineResults: EngineResult[];
  declared: DeclaredInputs;
  /** Dimension ids present in the rubric, so we never emit an unknown one. */
  dimensionIds: string[];
  /** The rubric whose derivation tables apply. Defaults to the bundled one. */
  rubric?: Rubric;
  /** Target contract, to pick its hook-profile when the file holds several. */
  contractName?: string;
  /**
   * How the differential harness ended, when it was part of the scan.
   *
   * The harness is not in `engineResults`, but it is the only producer of
   * `unvalidated-pool-key` and `callback-selector-mismatch`, so without this
   * every dimension those classes could raise would report "the harness did
   * not run" even on a scan where it did. Structural rather than an import of
   * `HarnessSummary`: the scorer needs the status, not the manifest's row.
   */
  harness?: { status: 'ok' | 'skipped' | 'failed'; reason?: string };
}

/**
 * Engines whose silence about the target may be believed.
 *
 * `looked` holds engines that ran and did not disclaim the target. `declined`
 * explains, per engine that ran but does not count, why — the string ends up in
 * the manifest as the dimension's evidence, so a reader can see *which* gap
 * left a dimension unmeasured rather than just that one did.
 */
export function enginesThatLooked(
  engineResults: EngineResult[],
  findings: Finding[],
  harness?: { status: 'ok' | 'skipped' | 'failed'; reason?: string },
): { looked: Set<string>; declined: Map<string, string> } {
  const looked = new Set<string>();
  const declined = new Map<string, string>();

  // The classification is a coverage statement, not just a finding: hookrisk
  // saw something hook-shaped it could not analyse. Whichever engine emitted it
  // is the one disclaiming, and today that is only hookrisk.
  const unsupported = findings.find((f) => f.ruleClass === 'unsupported-hook-abi');

  for (const result of engineResults) {
    if (result.status !== 'ok') continue;

    if (result.targetCoverage?.covered === false) {
      declined.set(
        result.engine,
        `ran but did not analyse the target${result.targetCoverage.reason ? ` (${result.targetCoverage.reason})` : ''}`,
      );
      continue;
    }

    if (result.engine === 'hookrisk' && unsupported) {
      declined.set(result.engine, `ran but did not recognise the target's hook ABI (unsupported-hook-abi: ${unsupported.title})`);
      continue;
    }

    looked.add(result.engine);
  }

  // The harness looked when it stood the twin pools up: its probes run against
  // the deployed hook at the end of setUp, before the fuzz campaign, so an `ok`
  // run means every probe either fired or reported itself not-applicable. A
  // failed run reached no probe; a skipped one never started.
  if (harness?.status === 'ok') looked.add(HARNESS_ENGINE);
  else if (harness?.status === 'failed') {
    declined.set(
      HARNESS_ENGINE,
      `ran and failed before its probes could observe the hook${harness.reason ? ` (${firstLine(harness.reason)})` : ''}`,
    );
  }

  return { looked, declined };
}

const firstLine = (text: string): string => text.split('\n')[0]?.trim().slice(0, 160) ?? '';

/**
 * Build the scoring input from findings, engine outcomes and declarations.
 *
 * Precedence: an explicit declaration always wins over a measurement, and the
 * manifest records both so a reviewer can see where a team disagreed with the
 * tool. Overriding a measured value upward is unremarkable; overriding one
 * downward is exactly the move the framework warns about, and making it visible
 * is the only defence a document can offer.
 */
export function deriveScoringInput(options: DeriveOptions): ScoringInput {
  const { findings, engineResults, declared, dimensionIds, contractName, harness } = options;
  const rubric = options.rubric ?? loadRubric();

  const { looked, declined } = enginesThatLooked(engineResults, findings, harness);

  const byClass = new Map<RuleClass, Finding[]>();
  for (const finding of findings) {
    const bucket = byClass.get(finding.ruleClass);
    if (bucket) bucket.push(finding);
    else byClass.set(finding.ruleClass, [finding]);
  }

  const dimensions: Record<string, DimensionInput> = {};

  for (const id of dimensionIds) {
    const declaredValue = (declared as Record<string, number | undefined>)[id];

    if (NEVER_MEASURED.has(id)) {
      dimensions[id] =
        declaredValue === undefined
          ? { source: 'unmeasured' as ValueSource }
          : {
              value: declaredValue,
              source: 'declared' as ValueSource,
              evidence: [`Declared in hookrisk.toml. hookrisk does not measure ${id}.`],
            };
      continue;
    }

    const rule = DIMENSION_RULES[id];
    if (!rule) {
      dimensions[id] =
        declaredValue === undefined
          ? { source: 'unmeasured' as ValueSource }
          : { value: declaredValue, source: 'declared' as ValueSource };
      continue;
    }

    let measured: number | null = null;
    const evidence: string[] = [];

    // A derivation table measures the dimension from a classification's
    // metrics. It runs first so the floor-only findings below can only raise
    // the result, never replace a measurement with a floor.
    const derivation = rubric.dimensions.find((d) => d.id === id)?.derivation;
    const profiled = derivation ? hookProfileOf(findings, contractName) : null;
    if (derivation && profiled) {
      const metrics = profileMetrics(profiled.profile);
      const hit = metrics ? deriveFromMetrics(derivation, metrics) : null;
      if (profiled.note) evidence.push(profiled.note);
      if (!metrics) {
        evidence.push(`${derivation.source} carried no metrics, so the dimension could not be derived from it.`);
      } else if (!hit) {
        evidence.push(
          `${derivation.source} metrics (${formatMetrics(metrics)}) matched no derivation rule in the rubric.`,
        );
      } else {
        measured = hit.score;
        evidence.push(`${derivation.source} metrics: ${formatMetrics(metrics)}`);
        evidence.push(
          `Scored ${hit.score} by rule \`${hit.rule.when}\`: ${hit.rule.rationale}` +
            (derivation.interpretation ? ' (hookrisk’s interpretation; the framework publishes no brackets)' : ''),
        );
      }
    }

    // Find the strongest evidence present. A class whose score depends on the
    // shape of the finding (HS-03's unguarded vs owner-only mutator, HS-05's
    // static vs state-changing call) is resolved from the rubric; the flat
    // table is the fallback.
    const findingRules = rubric.dimensions.find((d) => d.id === id)?.findingDerivation;
    for (const ruleClass of rule.raisedBy) {
      const hits = byClass.get(ruleClass);
      if (!hits?.length) continue;
      const shaped = scoreFromFindings(findingRules, ruleClass, hits);
      let value = shaped?.score ?? rule.scoreFor[ruleClass] ?? 1;
      if (ruleClass === 'custom-accounting' && liquidityOnlyDelta(findings, contractName)) {
        // after{Add,Remove}LiquidityReturnDelta only: the hook adjusts what an
        // LP settles, never a swap. Price impact is real but indirect and the
        // arithmetic is settlement math, not a curve. Swaps still compare
        // against the reference pool, so I2 applies unchanged.
        value = id === 'priceImpactingBehavior' ? 1 : id === 'customMath' ? 2 : value;
        evidence.push('returns-delta is liquidity-side only (no swap delta); swaps still compare against the reference pool');
      }
      if (measured === null || value > measured) measured = value;
      evidence.push(`${hits.length} ${ruleClass} finding(s)`);
      if (shaped) {
        evidence.push(
          `Scored ${shaped.score} by rule \`${shaped.rule.when ?? 'always'}\` on ` +
            `${shaped.finding.discriminator ?? shaped.finding.title} (${shaped.finding.severity}): ${shaped.rule.rationale}` +
            (findingRules?.interpretation ? ' (hookrisk’s interpretation; the framework publishes no brackets)' : ''),
        );
      }
    }

    if (measured !== null) {
      evidence.push(rule.rationale);
      dimensions[id] =
        declaredValue !== undefined
          ? {
              value: declaredValue,
              source: 'declared' as ValueSource,
              evidence: [
                ...evidence,
                `hookrisk measured ${measured}; hookrisk.toml declares ${declaredValue}.` +
                  (declaredValue < measured
                    ? ' The declaration is lower than the measurement.'
                    : ''),
              ],
            }
          : { value: measured, source: 'measured' as ValueSource, evidence };
      continue;
    }

    // Nothing found. Whether that means zero depends entirely on whether anyone
    // capable of finding something actually looked — and on whether the
    // dimension is one that silence can measure at all.
    const missing = coverageGaps(rule.raisedBy, looked, declined);
    // Silence alone cannot measure a dimension flagged unmeasuredWhenSilent,
    // but silence corroborated by a positive measurement can: the hook
    // profile counted the thing whose absence the dimension's 0 asserts.
    const corroboration = missing.length === 0 ? silenceCorroboratedBy(id, findings, contractName) : null;
    if (missing.length === 0 && (!rule.unmeasuredWhenSilent || corroboration)) {
      dimensions[id] =
        declaredValue !== undefined
          ? { value: declaredValue, source: 'declared' as ValueSource }
          : {
              value: 0,
              source: 'measured' as ValueSource,
              evidence: [
                `No ${rule.raisedBy.join(' or ')} findings, and every detector that could ` +
                  'produce one ran.',
                ...(corroboration ? [corroboration] : []),
              ],
            };
    } else {
      // A profile that was present but unusable is a more specific reason than
      // "no profile": say what was wrong with it rather than that it was absent.
      const why =
        missing.length > 0
          ? `Not measured: ${missing.join('; ')}.`
          : evidence.length > 0
            ? `Not measured: ${evidence.join(' ')}`
            : `Not measured: ${rule.unmeasuredWhenSilent}`;
      dimensions[id] =
        declaredValue !== undefined
          ? {
              value: declaredValue,
              source: 'declared' as ValueSource,
              evidence: [`${why.replace(/^Not measured/, 'Not measurable')} Value taken from hookrisk.toml.`],
            }
          : {
              source: 'unmeasured' as ValueSource,
              evidence: [why],
            };
    }
  }

  // Evidence that fires a trigger directly, independent of any dimension score.
  const evidence: string[] = [];
  if (byClass.has('custom-accounting')) evidence.push('returns-delta-permission');
  if (byClass.has('upgradeable-hook')) evidence.push('detector:upgradeable-hook');
  if (byClass.has('selfdestruct')) evidence.push('detector:selfdestruct');
  if (byClass.has('external-call-in-swap-path')) evidence.push('detector:external-call-in-swap-path');
  if (byClass.has('unbounded-dynamic-fee')) evidence.push('dynamic-fee-pool');

  return { dimensions, evidence };
}

/**
 * Explain why a rule class could not be ruled out.
 *
 * Three distinct reasons, and the distinctions are worth keeping: hookrisk has
 * no detector for the class at all; it has one but the engine did not run; or
 * the engine ran and did not examine the target.
 */
function coverageGaps(
  classes: RuleClass[],
  looked: Set<string>,
  declined: Map<string, string>,
): string[] {
  const gaps: string[] = [];
  for (const ruleClass of classes) {
    const covering = CLASS_COVERAGE[ruleClass] ?? [];
    const available = covering.filter(
      (engine) =>
        looked.has(engine) && (engine !== 'hookrisk' || IMPLEMENTED_CLASSES.has(ruleClass)),
    );
    if (available.length > 0) continue;

    if (covering.includes('hookrisk') && !IMPLEMENTED_CLASSES.has(ruleClass)) {
      const others = covering.filter((e) => e !== 'hookrisk');
      gaps.push(
        others.length > 0
          ? `no detector for ${ruleClass} (needs ${others.join(' or ')}, which did not run)`
          : `no detector for ${ruleClass} yet`,
      );
      continue;
    }

    const disclaimed = covering.filter((e) => declined.has(e));
    if (disclaimed.length > 0) {
      gaps.push(
        `${ruleClass} requires ${covering.join(' or ')}; ` +
          disclaimed.map((e) => `${e} ${declined.get(e)}`).join(', '),
      );
    } else {
      gaps.push(`${ruleClass} requires ${covering.join(' or ')}, which did not run`);
    }
  }
  return gaps;
}

/**
 * True when the target's resolved permissions carry a returns-delta flag on a
 * liquidity callback but none on a swap. Read from the hook profile, the only
 * place the resolved (inheritance-followed) set lives on the static side.
 */
function liquidityOnlyDelta(findings: Finding[], contractName?: string): boolean {
  const profile = hookProfileOf(findings, contractName)?.profile;
  const p = profile?.permissions;
  if (!p) return false;
  const swap = Boolean(p.beforeSwapReturnDelta) || Boolean(p.afterSwapReturnDelta);
  const liquidity = Boolean(p.afterAddLiquidityReturnDelta) || Boolean(p.afterRemoveLiquidityReturnDelta);
  return liquidity && !swap;
}

function externalCallsInSwapPath(findings: Finding[], contractName?: string): number | null {
  const profile = hookProfileOf(findings, contractName)?.profile;
  const metrics = profile ? profileMetrics(profile) : null;
  const value = metrics?.externalCallsInSwapPath;
  return typeof value === 'number' ? value : null;
}

/**
 * What in the hook profile lets a silent detector's 0 stand.
 *
 * Each dimension names the profile metric whose value would contradict the
 * silence: a returns-delta flag for price impact, an owner-only surface for
 * autonomous parameter updates, a third-party call in the swap path for
 * external dependencies. When the metric says "none", the detector's silence
 * and the profile's count agree, and 0 is a measurement rather than a guess.
 */
function silenceCorroboratedBy(id: string, findings: Finding[], contractName?: string): string | null {
  const profile = hookProfileOf(findings, contractName)?.profile;
  const metrics = profile ? profileMetrics(profile) : null;
  if (!metrics) return null;
  switch (id) {
    case 'priceImpactingBehavior':
      return metrics.usesReturnsDelta === false
        ? 'Corroborated by the hook profile: no returns-delta permission, and HS-06 found no unbounded dynamic fee.'
        : null;
    case 'autonomousParameterUpdates':
      return metrics.hasOwnerOnlyFunctions === false
        ? 'Corroborated by the hook profile: no owner-only surface, and HS-03 found no unguarded mutator of callback-read state.'
        : null;
    case 'externalDependencies':
      return metrics.externalCallsInSwapPathThirdParty === 0
        ? 'Corroborated by the hook profile: zero third-party calls in the swap path.'
        : null;
    default:
      return null;
  }
}
