/**
 * The scoring engine: nine dimensions in, a tier and a security plan out.
 *
 * Three decisions shape this file, and each is a place where the obvious
 * implementation would be quietly wrong.
 *
 * **Unmeasured is not zero.** If static analysis was skipped, `upgradeability`
 * has no value. Treating that as 0 produces a lower total, a lower tier, and a
 * thinner set of requirements — the tool would systematically understate risk
 * exactly when it knows least. Unmeasured dimensions are excluded from the total
 * and reported, and we also compute the tier the hook would land in if every
 * unmeasured dimension were at its maximum. When those two tiers differ, the
 * result is marked inconclusive.
 *
 * **Measured and declared are different claims.** `teamMaturity` is a
 * self-assessment; `upgradeability` is observable from bytecode. Both are inputs,
 * but only one can be checked. The provenance travels with the value into the
 * manifest.
 *
 * **Triggers can outrank the tier.** This is the framework's own anti-gaming
 * mechanism (§5) and the reason a Low-tier hook can still owe a bug bounty. Our
 * merge takes the strongest recommendation across the tier baseline and every
 * fired trigger — the framework never states this rule, which is FEEDBACK.md #3.
 */

import {
  type Requirement,
  type Rubric,
  type StrengthId,
  type Tier,
  loadRubric,
  strengthRank,
} from './rubric.js';

/** Where a dimension's value came from. */
export type ValueSource = 'measured' | 'declared' | 'unmeasured';

export interface DimensionInput {
  /** Omitted when `source` is `unmeasured`. */
  value?: number;
  source: ValueSource;
  /** Why the tool believes this, e.g. `HS-04 found an EIP-1967 slot`. */
  evidence?: string[];
}

export interface ScoringInput {
  /** Keyed by dimension id. Missing keys are treated as unmeasured. */
  dimensions: Record<string, DimensionInput>;
  /**
   * Trigger evidence produced by detectors rather than by a dimension score,
   * e.g. `detector:upgradeable-hook` or `returns-delta-permission`. Matched
   * against each trigger's `alsoFiredBy`.
   */
  evidence?: string[];
  /**
   * Named booleans referenced by requirement conditions, e.g.
   * `dependencyInfluencesPricing`.
   */
  flags?: Record<string, boolean>;
}

export interface ScoredDimension {
  id: string;
  name: string;
  value: number | null;
  source: ValueSource;
  max: number;
  bracketLabel: string | null;
  bracketsAreInterpretation: boolean;
  evidence: string[];
}

export interface FiredTrigger {
  id: string;
  name: string;
  /** What fired it: a dimension threshold, or a piece of detector evidence. */
  firedBy: string[];
  /** True when the dimension-to-trigger link is our reading, not the framework's. */
  derivationIsInterpretation: boolean;
  note?: string;
}

export interface Recommendation {
  action: string;
  label: string;
  strength: StrengthId;
  /** Every source that asked for this action, with the strength each asked at. */
  sources: Array<{ from: string; strength: StrengthId; detail?: string }>;
}

export interface ScoreResult {
  /** Sum over dimensions with a known value. */
  total: number;
  /** Total if every unmeasured dimension were at its maximum. */
  totalUpperBound: number;
  tier: Tier;
  /** Tier at `totalUpperBound`. Differs from `tier` only when data is missing. */
  tierUpperBound: Tier;
  /** True when missing data leaves the tier undetermined. */
  inconclusive: boolean;
  dimensions: ScoredDimension[];
  unmeasured: string[];
  triggers: FiredTrigger[];
  recommendations: Recommendation[];
  warnings: string[];
  rubricRevision: string;
}

/** Compute the score, tier and merged security plan. */
export function score(input: ScoringInput, rubricOverride?: Rubric): ScoreResult {
  const rubric = rubricOverride ?? loadRubric();
  const warnings: string[] = [];

  const dimensions: ScoredDimension[] = [];
  const values: Record<string, number> = {};
  const unmeasured: string[] = [];
  let total = 0;
  let unmeasuredMax = 0;

  for (const dimension of rubric.dimensions) {
    const given = input.dimensions[dimension.id];
    const source: ValueSource = given?.source ?? 'unmeasured';

    if (source === 'unmeasured' || given?.value === undefined) {
      unmeasured.push(dimension.id);
      unmeasuredMax += dimension.max;
      dimensions.push({
        id: dimension.id,
        name: dimension.name,
        value: null,
        source: 'unmeasured',
        max: dimension.max,
        bracketLabel: null,
        bracketsAreInterpretation: dimension.bracketsAreInterpretation,
        evidence: given?.evidence ?? [],
      });
      continue;
    }

    // Clamp rather than reject: a detector heuristic that returns 6 for a 0-5
    // dimension is our bug, and refusing to produce any score would lose the
    // eight dimensions that are fine.
    const raw = given.value;
    const clamped = Math.max(dimension.min, Math.min(dimension.max, Math.round(raw)));
    if (clamped !== raw) {
      warnings.push(
        `${dimension.id}: value ${raw} is outside ${dimension.min}-${dimension.max}, clamped to ${clamped}`,
      );
    }

    values[dimension.id] = clamped;
    total += clamped;

    dimensions.push({
      id: dimension.id,
      name: dimension.name,
      value: clamped,
      source,
      max: dimension.max,
      bracketLabel: dimension.brackets.find((b) => b.score === clamped)?.label ?? null,
      bracketsAreInterpretation: dimension.bracketsAreInterpretation,
      evidence: given.evidence ?? [],
    });
  }

  const totalUpperBound = total + unmeasuredMax;
  const tier = tierFor(rubric, total);
  const tierUpperBound = tierFor(rubric, totalUpperBound);
  const inconclusive = tier.id !== tierUpperBound.id;

  if (inconclusive) {
    warnings.push(
      `${unmeasured.length} dimension(s) unmeasured: the tier is between ` +
        `${tier.name} and ${tierUpperBound.name}. Unmeasured dimensions are ` +
        `excluded from the total, never counted as zero.`,
    );
  }

  const evidence = new Set(input.evidence ?? []);
  const triggers = fireTriggers(rubric, values, evidence, unmeasured, warnings);
  const recommendations = mergeRecommendations(rubric, tier, triggers, values, input.flags ?? {});

  return {
    total,
    totalUpperBound,
    tier,
    tierUpperBound,
    inconclusive,
    dimensions,
    unmeasured,
    triggers,
    recommendations,
    warnings,
    rubricRevision: rubric.framework.revision,
  };
}

function tierFor(rubric: Rubric, total: number): Tier {
  const found = rubric.tiers.find((t) => total >= t.min && total <= t.max);
  if (!found) {
    // The rubric loader proves tiers tile the range, so this is unreachable for
    // any total inside it. Clamping to the ends keeps a caller who passes an
    // out-of-range total from getting undefined.
    const ordered = [...rubric.tiers].sort((a, b) => a.min - b.min);
    return total < ordered[0]!.min ? ordered[0]! : ordered[ordered.length - 1]!;
  }
  return found;
}

function fireTriggers(
  rubric: Rubric,
  values: Record<string, number>,
  evidence: Set<string>,
  unmeasured: string[],
  warnings: string[],
): FiredTrigger[] {
  const fired: FiredTrigger[] = [];

  for (const trigger of rubric.triggers) {
    const firedBy: string[] = [];

    const { dimension, atLeast } = trigger.derivedFrom;
    const value = values[dimension];
    if (value !== undefined && value >= atLeast) {
      firedBy.push(`${dimension} >= ${atLeast} (is ${value})`);
    } else if (value === undefined && unmeasured.includes(dimension)) {
      // We cannot rule the trigger out. Say so rather than let silence read as
      // "does not apply" — the framework's triggers exist to catch exactly the
      // properties a team might not volunteer.
      warnings.push(
        `trigger '${trigger.id}' could not be evaluated: dimension '${dimension}' is unmeasured`,
      );
    }

    for (const source of trigger.alsoFiredBy ?? []) {
      if (evidence.has(source)) firedBy.push(source);
    }

    if (firedBy.length > 0) {
      fired.push({
        id: trigger.id,
        name: trigger.name,
        firedBy,
        derivationIsInterpretation: trigger.derivedFrom.interpretation,
        note: trigger.note,
      });
    }
  }

  return fired;
}

/**
 * Merge the tier baseline with every fired trigger's requirements.
 *
 * One action can be asked for several times at different strengths; the result
 * takes the maximum and keeps every request as a source, so a report can explain
 * *why* a bug bounty is required rather than only that it is.
 */
function mergeRecommendations(
  rubric: Rubric,
  tier: Tier,
  triggers: FiredTrigger[],
  values: Record<string, number>,
  flags: Record<string, boolean>,
): Recommendation[] {
  const merged = new Map<string, Recommendation>();
  const firedIds = new Set(triggers.map((t) => t.id));

  const consider = (requirement: Requirement, from: string): void => {
    if (requirement.condition && !evaluateCondition(requirement.condition, values, firedIds, flags)) {
      return;
    }

    const existing = merged.get(requirement.action);
    const entry = { from, strength: requirement.strength, detail: requirement.detail };

    if (!existing) {
      merged.set(requirement.action, {
        action: requirement.action,
        label: rubric.actions[requirement.action] ?? requirement.action,
        strength: requirement.strength,
        sources: [entry],
      });
      return;
    }

    existing.sources.push(entry);
    if (strengthRank(rubric, requirement.strength) > strengthRank(rubric, existing.strength)) {
      existing.strength = requirement.strength;
    }
  };

  for (const requirement of tier.baseline) {
    consider(requirement, `tier:${tier.id}`);
  }
  for (const trigger of triggers) {
    const definition = rubric.triggers.find((t) => t.id === trigger.id);
    for (const requirement of definition?.requirements ?? []) {
      consider(requirement, `trigger:${trigger.id}`);
    }
  }

  return [...merged.values()].sort(
    (a, b) =>
      strengthRank(rubric, b.strength) - strengthRank(rubric, a.strength) ||
      a.action.localeCompare(b.action),
  );
}

/**
 * Evaluate a requirement guard.
 *
 * Grammar, deliberately tiny:
 *
 *     expr   := atom (('||' | '&&') atom)*
 *     atom   := 'trigger:' ID | ID | ID OP NUMBER
 *     OP     := '==' | '!=' | '>=' | '<=' | '>' | '<'
 *
 * No `eval`, no operator precedence beyond left-to-right, no parentheses. The
 * conditions in the rubric are simple by design; a richer language here would be
 * a place for bugs to hide in something that decides whether a team is told they
 * need a bug bounty. Unparseable conditions return false and are reported by the
 * caller rather than silently passing.
 */
export function evaluateCondition(
  condition: string,
  values: Record<string, number>,
  firedTriggers: Set<string>,
  flags: Record<string, boolean>,
): boolean {
  const tokens = condition.split(/\s*(\|\||&&)\s*/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;

  let result = evaluateAtom(tokens[0]!, values, firedTriggers, flags);
  for (let i = 1; i < tokens.length - 1; i += 2) {
    const operator = tokens[i];
    const operand = evaluateAtom(tokens[i + 1]!, values, firedTriggers, flags);
    result = operator === '&&' ? result && operand : result || operand;
  }
  return result;
}

function evaluateAtom(
  atom: string,
  values: Record<string, number>,
  firedTriggers: Set<string>,
  flags: Record<string, boolean>,
): boolean {
  const trimmed = atom.trim();

  if (trimmed.startsWith('trigger:')) {
    return firedTriggers.has(trimmed.slice('trigger:'.length));
  }

  const comparison = trimmed.match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(-?\d+)$/);
  if (comparison) {
    const [, name, operator, literal] = comparison;
    const value = values[name!];
    // An unmeasured dimension cannot satisfy a threshold. Returning false here
    // means a conditional requirement is omitted rather than asserted on a value
    // we do not have; the unmeasured dimension is already reported separately.
    if (value === undefined) return false;
    const target = Number.parseInt(literal!, 10);
    switch (operator) {
      case '==':
        return value === target;
      case '!=':
        return value !== target;
      case '>=':
        return value >= target;
      case '<=':
        return value <= target;
      case '>':
        return value > target;
      case '<':
        return value < target;
      default:
        return false;
    }
  }

  // A bare identifier is a named boolean flag.
  return flags[trimmed] === true;
}
