/**
 * Types for the machine-readable rubric, and its loader.
 *
 * The rubric itself lives in `schema/framework-rubric.json` — a port of the
 * Uniswap Hooks Security Framework into data. Keeping it as data rather than as
 * code means the interpretation is auditable: a reviewer can diff our reading of
 * the framework against the framework, without reading TypeScript.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type StrengthId = 'optional' | 'recommended' | 'strongly-recommended' | 'required';

export interface Strength {
  id: StrengthId;
  rank: number;
  label: string;
  aliases?: string[];
}

/** Whether a dimension's value can be observed, or has to be declared. */
export type Measurability = 'measured' | 'declared';

export interface Bracket {
  score: number;
  label: string;
}

export interface Dimension {
  id: string;
  name: string;
  min: number;
  max: number;
  measurable: Measurability;
  measurableNote?: string;
  description: string;
  /**
   * True when hookrisk invented the brackets because the framework does not
   * publish them. Surfaced in the report so a reader knows which numbers carry
   * the Foundation's authority and which carry ours. See FEEDBACK.md #2.
   */
  bracketsAreInterpretation: boolean;
  interpretationNote?: string;
  brackets: Bracket[];
  /**
   * How a measured value is derived from an engine classification's metrics,
   * when the dimension has one. Kept in the rubric rather than in code for the
   * same reason the brackets are: the mapping is an interpretation, and a
   * reviewer should be able to audit it without reading TypeScript.
   */
  derivation?: Derivation;
  /**
   * How a *finding* of a given rule class scores this dimension, when the score
   * depends on the finding's shape rather than only on its class. Kept in the
   * rubric for the same reason the brackets are: "an unguarded mutator is a 2
   * and an owner-only one a 1" is hookrisk's reading of the framework's prose,
   * and a reviewer must be able to audit it without reading TypeScript.
   *
   * Classes whose score does not vary stay in `derive.ts`'s flat table.
   */
  findingDerivation?: FindingDerivation;
}

/** One rule of a {@link FindingDerivation}. */
export interface FindingDerivationRule {
  /** The rule class this applies to; other classes skip it. */
  ruleClass: string;
  score: number;
  /**
   * Guard over the finding's attributes, same grammar as
   * {@link DerivationRule.when}. Absent means "always", which is how a class
   * with a single fixed score is written.
   */
  when?: string;
  rationale: string;
}

export interface FindingDerivation {
  /** True when the class-to-score mapping is hookrisk's reading, not the framework's. */
  interpretation: boolean;
  /**
   * Attribute names the rules may reference: `severityRank` plus whatever the
   * finding's `metrics` carry. Booleans are readable both as a bare name and
   * as `name == 1` / `name == 0`, so a rule can test the negative without the
   * grammar growing a `!` operator.
   */
  attributes: string[];
  /**
   * Evaluated in the order written — unlike {@link Derivation}, which is
   * highest-score-first — because a class's last rule is usually its
   * unconditional fallback and a highest-first sweep would reach it too early.
   */
  rules: FindingDerivationRule[];
}

/** One rule of a {@link Derivation}: the first rule whose `when` holds wins. */
export interface DerivationRule {
  score: number;
  /** Same grammar as {@link Requirement.condition}, evaluated over the metrics. */
  when: string;
  rationale: string;
}

export interface Derivation {
  /** True when the metric-to-score mapping is hookrisk's reading, not the framework's. */
  interpretation: boolean;
  /** Rule class of the classification that carries the metrics, e.g. `hook-profile`. */
  source: string;
  /** Metric names the rules may reference. */
  metrics: string[];
  rules: DerivationRule[];
}

export interface Requirement {
  action: string;
  strength: StrengthId;
  detail?: string;
  /** Guard expression; the requirement applies only when it evaluates true. */
  condition?: string;
}

export interface Tier {
  id: 'low' | 'medium' | 'high';
  name: string;
  min: number;
  max: number;
  summary: string;
  baseline: Requirement[];
  monitoringTargets?: string[];
}

export interface TriggerDerivation {
  dimension: string;
  atLeast: number;
  /** True when the dimension-to-trigger link is our reading. FEEDBACK.md #5. */
  interpretation: boolean;
}

export interface Trigger {
  id: string;
  name: string;
  derivedFrom: TriggerDerivation;
  /** Additional evidence sources that fire this trigger regardless of score. */
  alsoFiredBy?: string[];
  requirements: Requirement[];
  note?: string;
}

export interface Rubric {
  framework: { name: string; url: string; worksheet: string; revision: string; retrieved: string };
  strengths: Strength[];
  dimensions: Dimension[];
  totalRange: { min: number; max: number };
  tiers: Tier[];
  triggers: Trigger[];
  actions: Record<string, string>;
}

let cached: Rubric | null = null;

/**
 * Load and validate the rubric.
 *
 * Validation is not ceremony. A typo in the tier boundaries or a dimension whose
 * brackets do not span its declared range would produce scores that look
 * plausible and are wrong, and a scoring tool that is quietly wrong is worse
 * than no scoring tool.
 */
export function loadRubric(path?: string): Rubric {
  if (!path && cached) return cached;

  const resolved = path ?? defaultRubricPath();
  const rubric = JSON.parse(readFileSync(resolved, 'utf8')) as Rubric;
  validate(rubric, resolved);

  if (!path) cached = rubric;
  return rubric;
}

function defaultRubricPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/scoring/ -> package root -> repo root
  return resolve(join(here, '..', '..', '..', 'schema', 'framework-rubric.json'));
}

function validate(rubric: Rubric, source: string): void {
  const fail = (message: string): never => {
    throw new Error(`invalid rubric at ${source}: ${message}`);
  };

  if (!rubric.dimensions?.length) fail('no dimensions');
  if (!rubric.tiers?.length) fail('no tiers');

  const summedMax = rubric.dimensions.reduce((acc, d) => acc + d.max, 0);
  if (summedMax !== rubric.totalRange.max) {
    fail(`dimensions sum to ${summedMax} but totalRange.max is ${rubric.totalRange.max}`);
  }

  for (const dimension of rubric.dimensions) {
    const scores = dimension.brackets.map((b) => b.score);
    for (let expected = dimension.min; expected <= dimension.max; expected += 1) {
      if (!scores.includes(expected)) {
        fail(`dimension '${dimension.id}' has no bracket for score ${expected}`);
      }
    }
    if (dimension.derivation) validateDerivation(dimension, fail);
    if (dimension.findingDerivation) validateFindingDerivation(dimension, fail);
  }

  // Tiers must tile the whole range with no gap and no overlap, or some totals
  // would map to no tier and others to two.
  const ordered = [...rubric.tiers].sort((a, b) => a.min - b.min);
  if (ordered[0]!.min !== rubric.totalRange.min) {
    fail(`lowest tier starts at ${ordered[0]!.min}, expected ${rubric.totalRange.min}`);
  }
  if (ordered[ordered.length - 1]!.max !== rubric.totalRange.max) {
    fail(`highest tier ends at ${ordered[ordered.length - 1]!.max}, expected ${rubric.totalRange.max}`);
  }
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i]!.min !== ordered[i - 1]!.max + 1) {
      fail(`gap or overlap between tiers '${ordered[i - 1]!.id}' and '${ordered[i]!.id}'`);
    }
  }

  const dimensionIds = new Set(rubric.dimensions.map((d) => d.id));
  for (const trigger of rubric.triggers) {
    if (!dimensionIds.has(trigger.derivedFrom.dimension)) {
      fail(`trigger '${trigger.id}' derives from unknown dimension '${trigger.derivedFrom.dimension}'`);
    }
    for (const requirement of trigger.requirements) {
      if (!rubric.actions[requirement.action]) {
        fail(`trigger '${trigger.id}' references unknown action '${requirement.action}'`);
      }
    }
  }
  for (const tier of rubric.tiers) {
    for (const requirement of tier.baseline) {
      if (!rubric.actions[requirement.action]) {
        fail(`tier '${tier.id}' references unknown action '${requirement.action}'`);
      }
    }
  }
}

/**
 * A derivation rule that scores outside the dimension's range, or names a
 * metric the source classification does not carry, would produce a measured
 * value nothing can explain. Both are rubric bugs, so both refuse to load.
 */
function validateDerivation(dimension: Dimension, fail: (message: string) => never): void {
  const derivation = dimension.derivation!;
  if (!derivation.rules?.length) fail(`dimension '${dimension.id}' has a derivation with no rules`);
  const known = new Set(derivation.metrics ?? []);
  for (const rule of derivation.rules) {
    if (!Number.isInteger(rule.score) || rule.score < dimension.min || rule.score > dimension.max) {
      fail(`dimension '${dimension.id}' derivation rule scores ${rule.score}, outside ${dimension.min}-${dimension.max}`);
    }
    if (!rule.when?.trim()) fail(`dimension '${dimension.id}' derivation rule for ${rule.score} has no condition`);
    for (const name of rule.when.match(/[A-Za-z_]\w*/g) ?? []) {
      if (!known.has(name)) {
        fail(`dimension '${dimension.id}' derivation rule for ${rule.score} references unknown metric '${name}'`);
      }
    }
  }
}

/**
 * The same guarantees as {@link validateDerivation}, plus one specific to
 * ordered rules: a rule that can never be reached is a rubric bug that reads
 * as a policy. An unconditional rule ends its class, so anything written after
 * it for that class is dead and refuses to load.
 */
function validateFindingDerivation(dimension: Dimension, fail: (message: string) => never): void {
  const derivation = dimension.findingDerivation!;
  if (!derivation.rules?.length) fail(`dimension '${dimension.id}' has a findingDerivation with no rules`);
  const known = new Set(derivation.attributes ?? []);
  const closed = new Set<string>();
  for (const rule of derivation.rules) {
    if (!rule.ruleClass?.trim()) fail(`dimension '${dimension.id}' findingDerivation rule has no ruleClass`);
    if (!Number.isInteger(rule.score) || rule.score < dimension.min || rule.score > dimension.max) {
      fail(
        `dimension '${dimension.id}' findingDerivation rule for ${rule.ruleClass} scores ${rule.score}, outside ${dimension.min}-${dimension.max}`,
      );
    }
    if (!rule.rationale?.trim()) {
      fail(`dimension '${dimension.id}' findingDerivation rule for ${rule.ruleClass} has no rationale`);
    }
    if (closed.has(rule.ruleClass)) {
      fail(
        `dimension '${dimension.id}' findingDerivation has an unreachable rule for '${rule.ruleClass}': an earlier rule for that class is unconditional`,
      );
    }
    if (rule.when === undefined) {
      closed.add(rule.ruleClass);
      continue;
    }
    if (!rule.when.trim()) fail(`dimension '${dimension.id}' findingDerivation rule for ${rule.ruleClass} has an empty condition`);
    for (const name of rule.when.match(/[A-Za-z_]\w*/g) ?? []) {
      if (!known.has(name)) {
        fail(
          `dimension '${dimension.id}' findingDerivation rule for ${rule.ruleClass} references unknown attribute '${name}'`,
        );
      }
    }
  }
}

/** Rank lookup for merging recommendation strengths. */
export function strengthRank(rubric: Rubric, id: StrengthId): number {
  const found = rubric.strengths.find((s) => s.id === id);
  if (!found) throw new Error(`unknown strength '${id}'`);
  return found.rank;
}
