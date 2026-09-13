/**
 * Tests for the scoring engine.
 *
 * The most valuable cases here are the four worked examples the framework itself
 * gives in §5, *Combined Trigger Logic (How it Works in Practice)*. They are the
 * only place the Foundation states an end-to-end expected outcome, so they are
 * the closest thing to a conformance suite our port can be held to. If one of
 * them fails, our reading of the framework is wrong, not the test.
 */

import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type { EngineResult, Finding, RuleClass } from '../types.js';
import { deriveScoringInput, enginesThatLooked } from './derive.js';
import { loadRubric } from './rubric.js';
import { type ScoringInput, evaluateCondition, score } from './score.js';

const rubric = loadRubric();

/** Build an input with every dimension measured at 0, then override. */
function dims(overrides: Record<string, number>): ScoringInput['dimensions'] {
  const out: ScoringInput['dimensions'] = {};
  for (const dimension of rubric.dimensions) {
    out[dimension.id] = { value: overrides[dimension.id] ?? 0, source: 'measured' };
  }
  return out;
}

const strengthOf = (result: ReturnType<typeof score>, action: string): string | undefined =>
  result.recommendations.find((r) => r.action === action)?.strength;

describe('rubric', () => {
  test('loads and validates', () => {
    assert.equal(rubric.dimensions.length, 9, 'the framework defines nine dimensions');
    assert.equal(rubric.triggers.length, 7, 'and seven feature triggers');
    assert.equal(rubric.totalRange.max, 33, '5+5+3+3+5+3+3+3+3');
  });

  test('tier boundaries match the framework exactly', () => {
    const byId = Object.fromEntries(rubric.tiers.map((t) => [t.id, t]));
    assert.deepEqual([byId.low!.min, byId.low!.max], [0, 6]);
    assert.deepEqual([byId.medium!.min, byId.medium!.max], [7, 17]);
    assert.deepEqual([byId.high!.min, byId.high!.max], [18, 33]);
  });
});

describe('tier assignment', () => {
  test('6 is Low and 7 is Medium', () => {
    assert.equal(score({ dimensions: dims({ complexity: 5, teamMaturity: 1 }) }).tier.id, 'low');
    assert.equal(score({ dimensions: dims({ complexity: 5, teamMaturity: 2 }) }).tier.id, 'medium');
  });

  test('17 is Medium and 18 is High', () => {
    const at17 = dims({ complexity: 5, customMath: 5, tvlPotential: 4, teamMaturity: 3 });
    const at18 = dims({ complexity: 5, customMath: 5, tvlPotential: 5, teamMaturity: 3 });
    assert.equal(score({ dimensions: at17 }).total, 17);
    assert.equal(score({ dimensions: at17 }).tier.id, 'medium');
    assert.equal(score({ dimensions: at18 }).total, 18);
    assert.equal(score({ dimensions: at18 }).tier.id, 'high');
  });
});

describe("the framework's own worked examples (§5)", () => {
  // "A hook with a score of 4 but with custom math, must include an audit from
  //  a math specialist"
  test('score 4 with custom math requires a math specialist audit', () => {
    const result = score({ dimensions: dims({ customMath: 3, teamMaturity: 1 }) });

    assert.equal(result.total, 4);
    assert.equal(result.tier.id, 'low', 'the tier alone would ask for no math review');
    assert.ok(
      result.triggers.some((t) => t.id === 'custom-math'),
      'the custom-math trigger must fire',
    );
    assert.equal(strengthOf(result, 'math-specialist-audit'), 'required');
  });

  // "A hook with a score of 5 but with TVL 5, must implement monitoring and bug
  //  bounty"
  test('score 5 with TVL 5 requires monitoring and a bug bounty', () => {
    const result = score({ dimensions: dims({ tvlPotential: 5 }) });

    assert.equal(result.total, 5);
    assert.equal(result.tier.id, 'low', 'Low tier says both are optional');
    assert.ok(result.triggers.some((t) => t.id === 'tvl-5'));
    assert.equal(strengthOf(result, 'monitoring'), 'required');
    assert.equal(strengthOf(result, 'bug-bounty'), 'required');
  });

  // "A hook with a score of 3 but with autonomy, requires state invariant
  //  testing"
  test('score 3 with autonomy requires invariant testing', () => {
    const result = score({ dimensions: dims({ autonomousParameterUpdates: 3 }) });

    assert.equal(result.total, 3);
    assert.equal(result.tier.id, 'low');
    assert.ok(result.triggers.some((t) => t.id === 'autonomous'));
    assert.equal(strengthOf(result, 'invariant-testing'), 'required');
  });

  // "A medium-risk hook with a score of 7 but has custom math and price impact,
  //  looks like a high-risk hook regardless"
  //
  // This example does not hold under the framework's own rules, and this test
  // pins the gap rather than papering over it. Applying §3 and §4 mechanically,
  // the hook picks up three of the four measures the High tier makes mandatory
  // and misses `monitoring`, because the only two rules that could demand it are
  // §4.1 ("monitoring is recommended when combined with autonomy or
  // price-modifying behavior" — recommended, not required) and §4.5 ("monitoring
  // required if TVL score is 5" — TVL is 0 here). `second-audit` likewise stays
  // optional while the High tier calls for two audits.
  //
  // Reported upstream as FEEDBACK.md #11. If the Foundation tightens §4.1 or
  // §4.5, this test fails and tells us to update the port.
  test('score 7 with custom math and price impact reaches most, not all, High-tier measures', () => {
    const result = score({
      dimensions: dims({ customMath: 3, priceImpactingBehavior: 3, teamMaturity: 1 }),
    });

    assert.equal(result.total, 7);
    assert.equal(result.tier.id, 'medium', 'the raw tier is still Medium');
    assert.deepEqual(
      result.triggers.map((t) => t.id).sort(),
      ['custom-math', 'price-impact'],
      'both features must trigger independently of the tier',
    );

    // What the triggers do achieve, which is the framework's real point: a
    // Medium-tier hook is held to High-tier practice on the axes that matter.
    assert.equal(strengthOf(result, 'math-specialist-audit'), 'required');
    assert.equal(strengthOf(result, 'bug-bounty'), 'required');
    assert.equal(strengthOf(result, 'adversarial-simulation'), 'required');

    // And what they do not. Asserted explicitly so the shortfall is visible in
    // the test output rather than being an absence nobody notices.
    assert.equal(
      strengthOf(result, 'monitoring'),
      'recommended',
      'no rule in §3 or §4 raises monitoring to required for this hook',
    );
    assert.equal(strengthOf(result, 'second-audit'), 'optional');

    const high = rubric.tiers.find((t) => t.id === 'high')!;
    const highRequired = high.baseline
      .filter((r) => r.strength === 'required')
      .map((r) => r.action);
    const shortfall = highRequired.filter((action) => strengthOf(result, action) !== 'required');
    assert.deepEqual(
      shortfall,
      ['monitoring'],
      'the shortfall against the High tier is exactly monitoring',
    );
  });
});

describe('recommendation merging', () => {
  test('the strongest request wins and every request is kept as a source', () => {
    // Low tier calls a bug bounty optional; the TVL-5 trigger calls it required.
    const result = score({ dimensions: dims({ tvlPotential: 5 }) });
    const bounty = result.recommendations.find((r) => r.action === 'bug-bounty')!;

    assert.equal(bounty.strength, 'required');
    assert.ok(bounty.sources.length >= 2, 'both the tier and the trigger are recorded');
    assert.ok(bounty.sources.some((s) => s.from === 'tier:low' && s.strength === 'optional'));
    assert.ok(bounty.sources.some((s) => s.from === 'trigger:tvl-5' && s.strength === 'required'));
  });

  test('recommendations are ordered strongest first', () => {
    const result = score({ dimensions: dims({ tvlPotential: 5, customMath: 4 }) });
    const ranks = result.recommendations.map(
      (r) => rubric.strengths.find((s) => s.id === r.strength)!.rank,
    );
    for (let i = 1; i < ranks.length; i += 1) {
      assert.ok(ranks[i]! <= ranks[i - 1]!, 'strength must be non-increasing');
    }
  });

  test('a conditional requirement stays out when its condition is false', () => {
    // The upgradeable trigger requires a bug bounty only at TVL 5.
    const lowTvl = score({ dimensions: dims({ upgradeability: 2, tvlPotential: 1 }) });
    const bounty = lowTvl.recommendations.find((r) => r.action === 'bug-bounty');
    assert.ok(
      !bounty?.sources.some((s) => s.from === 'trigger:upgradeable'),
      'the upgradeable trigger must not demand a bounty below TVL 5',
    );

    const highTvl = score({ dimensions: dims({ upgradeability: 2, tvlPotential: 5 }) });
    assert.equal(strengthOf(highTvl, 'bug-bounty'), 'required');
  });
});

describe('unmeasured dimensions', () => {
  test('are excluded from the total rather than counted as zero', () => {
    const partial: ScoringInput['dimensions'] = {
      ...dims({ complexity: 2 }),
      upgradeability: { source: 'unmeasured' },
      teamMaturity: { source: 'unmeasured' },
    };
    const result = score({ dimensions: partial });

    assert.equal(result.total, 2, 'only known values are summed');
    assert.equal(result.totalUpperBound, 2 + 3 + 3, 'plus the maxima of what is unknown');
    assert.deepEqual(result.unmeasured.sort(), ['teamMaturity', 'upgradeability']);
  });

  test('mark the result inconclusive when they straddle a tier boundary', () => {
    const partial: ScoringInput['dimensions'] = {
      ...dims({ complexity: 5, customMath: 1 }),
      tvlPotential: { source: 'unmeasured' },
    };
    const result = score({ dimensions: partial });

    assert.equal(result.total, 6);
    assert.equal(result.tier.id, 'low');
    assert.equal(result.totalUpperBound, 11);
    assert.equal(result.tierUpperBound.id, 'medium');
    assert.equal(result.inconclusive, true);
    assert.ok(result.warnings.some((w) => w.includes('unmeasured')));
  });

  test('do not silently suppress a trigger they would have decided', () => {
    const partial: ScoringInput['dimensions'] = {
      ...dims({}),
      upgradeability: { source: 'unmeasured' },
    };
    const result = score({ dimensions: partial });

    assert.ok(
      result.warnings.some((w) => w.includes("trigger 'upgradeable'")),
      'an unevaluable trigger must be reported, not treated as not firing',
    );
  });

  test('detector evidence fires a trigger even when the dimension is unknown', () => {
    const partial: ScoringInput['dimensions'] = {
      ...dims({}),
      upgradeability: { source: 'unmeasured' },
    };
    const result = score({
      dimensions: partial,
      evidence: ['detector:upgradeable-hook'],
    });

    const fired = result.triggers.find((t) => t.id === 'upgradeable');
    assert.ok(fired, 'evidence alone must be able to fire a trigger');
    assert.deepEqual(fired.firedBy, ['detector:upgradeable-hook']);
    assert.equal(strengthOf(result, 'storage-collision-review'), 'required');
  });
});

describe('provenance', () => {
  test('measured and declared values stay distinguishable', () => {
    const result = score({
      dimensions: {
        ...dims({}),
        upgradeability: { value: 2, source: 'measured', evidence: ['HS-04: EIP-1967 slot'] },
        teamMaturity: { value: 1, source: 'declared' },
      },
    });

    const upgrade = result.dimensions.find((d) => d.id === 'upgradeability')!;
    const team = result.dimensions.find((d) => d.id === 'teamMaturity')!;

    assert.equal(upgrade.source, 'measured');
    assert.deepEqual(upgrade.evidence, ['HS-04: EIP-1967 slot']);
    assert.equal(team.source, 'declared');
  });

  test('flags which brackets are our interpretation rather than the framework’s', () => {
    const result = score({ dimensions: dims({}) });
    const tvl = result.dimensions.find((d) => d.id === 'tvlPotential')!;
    const complexity = result.dimensions.find((d) => d.id === 'complexity')!;

    assert.equal(tvl.bracketsAreInterpretation, false, 'the framework publishes TVL brackets');
    assert.equal(complexity.bracketsAreInterpretation, true, 'it does not publish these');
  });

  test('out-of-range values are clamped and warned about', () => {
    const result = score({
      dimensions: { ...dims({}), complexity: { value: 9, source: 'measured' } },
    });
    assert.equal(result.dimensions.find((d) => d.id === 'complexity')!.value, 5);
    assert.ok(result.warnings.some((w) => w.includes('clamped')));
  });
});

describe('condition evaluation', () => {
  const values = { tvlPotential: 5, priceImpactingBehavior: 1 };
  const triggers = new Set(['autonomous']);
  const flags = { dependencyInfluencesPricing: true };

  test('numeric comparisons', () => {
    assert.equal(evaluateCondition('tvlPotential == 5', values, triggers, flags), true);
    assert.equal(evaluateCondition('tvlPotential >= 5', values, triggers, flags), true);
    assert.equal(evaluateCondition('tvlPotential > 5', values, triggers, flags), false);
    assert.equal(evaluateCondition('priceImpactingBehavior >= 2', values, triggers, flags), false);
  });

  test('trigger references and boolean flags', () => {
    assert.equal(evaluateCondition('trigger:autonomous', values, triggers, flags), true);
    assert.equal(evaluateCondition('trigger:price-impact', values, triggers, flags), false);
    assert.equal(evaluateCondition('dependencyInfluencesPricing', values, triggers, flags), true);
    assert.equal(evaluateCondition('somethingElse', values, triggers, flags), false);
  });

  test('disjunction and conjunction', () => {
    assert.equal(
      evaluateCondition('trigger:autonomous || trigger:price-impact', values, triggers, flags),
      true,
    );
    assert.equal(
      evaluateCondition('trigger:autonomous && trigger:price-impact', values, triggers, flags),
      false,
    );
    assert.equal(
      evaluateCondition('tvlPotential == 5 || priceImpactingBehavior >= 2', values, triggers, flags),
      true,
    );
  });

  test('an unmeasured dimension cannot satisfy a threshold', () => {
    assert.equal(evaluateCondition('upgradeability >= 1', values, triggers, flags), false);
  });

  test('an unparseable condition is false, never true by accident', () => {
    assert.equal(evaluateCondition('!!!garbage!!!', values, triggers, flags), false);
    assert.equal(evaluateCondition('', values, triggers, flags), false);
  });
});

// --------------------------------------------------------------------------- //
// Deriving dimensions from findings and engine outcomes
// --------------------------------------------------------------------------- //

describe('deriveScoringInput', () => {
  const dimensionIds = rubric.dimensions.map((d) => d.id);

  const engine = (
    id: string,
    findings: Finding[] = [],
    extra: Partial<EngineResult> = {},
  ): EngineResult => ({ engine: id, version: 't', status: 'ok', findings, durationMs: 1, ...extra });

  const finding = (ruleClass: RuleClass, overrides: Partial<Finding> = {}): Finding => ({
    id: `${ruleClass}-id`,
    ruleClass,
    title: `${ruleClass} title`,
    description: 'd',
    severity: 'high',
    confidence: 'medium',
    location: { file: 'src/MyHook.sol', line: 18 },
    evidence: [],
    engines: [{ engine: 'hookrisk', nativeRule: 'r', severity: 'high', confidence: 'medium' }],
    ...overrides,
  });

  const derive = (findings: Finding[], engineResults: EngineResult[], declared = {}) =>
    deriveScoringInput({ findings, engineResults, declared, dimensionIds });

  test('complexity is unmeasured, never 0, when nothing raised it', () => {
    // Five legacy hooks were scored "measured 0 / Pass-through only; no hook
    // state" from exactly this input. HS-01 and HS-02 only ever set a floor of
    // 1; their silence measures nothing.
    const input = derive([], [engine('hookrisk')]);
    const complexity = input.dimensions.complexity!;

    assert.equal(complexity.source, 'unmeasured');
    assert.equal(complexity.value, undefined);
    assert.ok(complexity.evidence?.[0]?.includes('no hook-profile for the target'), complexity.evidence?.join(' '));

    // Scoped to complexity: other dimensions are unmeasured for the reason they
    // always were (rule 2, a class with no detector yet), not for this one.
    const customMath = input.dimensions.customMath!;
    assert.equal(customMath.source, 'unmeasured');
    assert.ok(customMath.evidence?.[0]?.includes('no detector for rounding-direction yet'), customMath.evidence?.join(' '));
    assert.ok(!customMath.evidence?.[0]?.includes('complexity metric'));

    const scored = score(input, rubric);
    const scoredComplexity = scored.dimensions.find((d) => d.id === 'complexity')!;
    assert.equal(scoredComplexity.value, null);
    assert.equal(scoredComplexity.bracketLabel, null, 'no bracket is asserted from silence');
  });

  test('complexity keeps its floor of 1 when a structural finding fires', () => {
    const input = derive([finding('flag-implementation-divergence')], [engine('hookrisk')]);
    assert.deepEqual(
      { value: input.dimensions.complexity!.value, source: input.dimensions.complexity!.source },
      { value: 1, source: 'measured' },
    );
  });

  test('a declared complexity still wins when the detectors are silent', () => {
    const input = derive([], [engine('hookrisk')], { complexity: 3 });
    const complexity = input.dimensions.complexity!;
    assert.equal(complexity.source, 'declared');
    assert.equal(complexity.value, 3);
    assert.ok(complexity.evidence?.[0]?.startsWith('Not measurable'), complexity.evidence?.join(' '));
  });

  test('an unsupported-hook-abi finding revokes hookrisk coverage of the target', () => {
    // The engine ran (status ok) but the detectors never recognised the
    // contract. Every dimension hookrisk would have measured must come back
    // unmeasured, not 0.
    const input = derive(
      [finding('unsupported-hook-abi', { severity: 'info', title: '2023 getHooksCalls() ABI' })],
      [engine('hookrisk')],
    );

    for (const id of ['customMath', 'priceImpactingBehavior', 'complexity']) {
      const dimension = input.dimensions[id]!;
      assert.equal(dimension.source, 'unmeasured', `${id} must be unmeasured`);
      assert.ok(
        dimension.evidence?.[0]?.includes("did not recognise the target's hook ABI"),
        `${id}: ${dimension.evidence?.join(' ')}`,
      );
    }
    assert.deepEqual(input.evidence, [], 'a classification fires no trigger evidence');
  });

  test('an engine that disclaims the target through targetCoverage is treated as not having looked', () => {
    const input = derive(
      [],
      [engine('hookrisk', [], { targetCoverage: { covered: false, reason: 'no hook contract in src/MyHook.sol' } })],
    );
    const customMath = input.dimensions.customMath!;
    assert.equal(customMath.source, 'unmeasured');
    assert.ok(
      customMath.evidence?.[0]?.includes('ran but did not analyse the target (no hook contract in src/MyHook.sol)'),
      customMath.evidence?.join(' '),
    );
  });

  test('enginesThatLooked separates ran-and-looked from ran-and-disclaimed', () => {
    const { looked, declined } = enginesThatLooked(
      [
        engine('hookrisk', [], { targetCoverage: { covered: true } }),
        engine('blocksec', [], { status: 'skipped' }),
      ],
      [],
    );
    assert.deepEqual([...looked], ['hookrisk']);
    assert.equal(declined.size, 0, 'a skipped engine neither looked nor disclaimed; it simply did not run');
  });

  test('a genuine 0 still requires that the responsible engine looked', () => {
    // No hookrisk at all: customMath cannot be 0, whatever blocksec says.
    const input = derive([], [engine('blocksec')]);
    assert.equal(input.dimensions.customMath!.source, 'unmeasured');
    assert.ok(input.dimensions.customMath!.evidence?.[0]?.includes('which did not run'));
  });
});

// --------------------------------------------------------------------------- //
// Complexity from the hook-profile metrics
// --------------------------------------------------------------------------- //

describe('complexity derived from hook-profile', () => {
  const dimensionIds = rubric.dimensions.map((d) => d.id);
  const hookrisk: EngineResult = { engine: 'hookrisk', version: 't', status: 'ok', findings: [], durationMs: 1 };

  /** The engine-metadata contract's metrics object, every field present. */
  const metrics = (overrides: Partial<Record<string, number | boolean>> = {}): Record<string, number | boolean> => ({
    callbacksImplemented: 0,
    callbacksDeclared: 0,
    stateWritesInCallbacks: 0,
    externalCallsInSwapPath: 0,
    internalFunctionsReachableFromCallbacks: 0,
    usesReturnsDelta: false,
    hasOwnerOnlyFunctions: false,
    ...overrides,
  });

  const profile = (m: Record<string, number | boolean>, overrides: Partial<Finding> = {}): Finding => ({
    id: 'hook-profile-id',
    ruleClass: 'hook-profile',
    title: 'Hook profile',
    description: 'd',
    severity: 'info',
    confidence: 'high',
    location: { file: 'src/MyHook.sol', line: 10 },
    evidence: [],
    engines: [{ engine: 'hookrisk', nativeRule: 'hookrisk-hook-profile', severity: 'info', confidence: 'high' }],
    metrics: m,
    ...overrides,
  });

  const complexityOf = (findings: Finding[], declared = {}, contractName?: string) =>
    deriveScoringInput({ findings, engineResults: [hookrisk], declared, dimensionIds, contractName }).dimensions
      .complexity!;

  // One case per bracket of the rubric's rule table, so a change to the table
  // that moves a boundary fails here and names the bracket.
  const brackets: Array<[number, string, Record<string, number | boolean>]> = [
    [0, 'no callbacks implemented', metrics()],
    [1, 'two callbacks, no state writes', metrics({ callbacksImplemented: 2, callbacksDeclared: 2 })],
    [2, 'state writes in callbacks', metrics({ callbacksImplemented: 1, stateWritesInCallbacks: 3 })],
    [2, 'three callbacks, no state writes', metrics({ callbacksImplemented: 3 })],
    [3, 'returns-delta alone', metrics({ callbacksImplemented: 1, usesReturnsDelta: true })],
    [3, 'external call in the swap path alone', metrics({ callbacksImplemented: 2, externalCallsInSwapPath: 1 })],
    [4, 'returns-delta and an external call', metrics({ callbacksImplemented: 4, usesReturnsDelta: true, externalCallsInSwapPath: 2 })],
    [5, 'both plus an owner-only surface', metrics({ callbacksImplemented: 4, usesReturnsDelta: true, externalCallsInSwapPath: 2, hasOwnerOnlyFunctions: true })],
  ];

  for (const [expected, label, m] of brackets) {
    test(`scores ${expected} for ${label}`, () => {
      const complexity = complexityOf([profile(m)]);
      assert.equal(complexity.source, 'measured');
      assert.equal(complexity.value, expected);
      assert.ok(complexity.evidence?.some((e) => e.startsWith('hook-profile metrics:')), complexity.evidence?.join(' | '));
      assert.ok(complexity.evidence?.some((e) => e.includes('interpretation')), 'the evidence says the mapping is ours');

      const scored = score(deriveScoringInput({ findings: [profile(m)], engineResults: [hookrisk], declared: {}, dimensionIds }), rubric);
      const dimension = scored.dimensions.find((d) => d.id === 'complexity')!;
      assert.equal(dimension.value, expected);
      assert.equal(dimension.bracketsAreInterpretation, true);
      assert.ok(dimension.bracketLabel, 'a measured value carries its bracket label');
    });
  }

  test('an owner-only surface without returns-delta and an external call does not reach 5', () => {
    // The 5 rule is conjunctive; the admin surface alone is HS-03's business.
    const complexity = complexityOf([profile(metrics({ callbacksImplemented: 2, hasOwnerOnlyFunctions: true }))]);
    assert.equal(complexity.value, 1);
  });

  test('a measured 0 is possible from a profile, never from silence', () => {
    // The whole point of the profile: the engine looked, counted, and found
    // no callback. That is the only way complexity can be measured 0.
    assert.equal(complexityOf([profile(metrics())]).value, 0);
    assert.equal(complexityOf([]).source, 'unmeasured');
  });

  test('without a profile the dimension is unmeasured and says why', () => {
    const complexity = complexityOf([]);
    assert.equal(complexity.source, 'unmeasured');
    assert.ok(complexity.evidence?.[0]?.includes('no hook-profile for the target'), complexity.evidence?.join(' '));
  });

  test('HS-01 / HS-02 only raise the profile value to a floor of 1, never replace it', () => {
    const divergence: Finding = {
      id: 'hs02',
      ruleClass: 'flag-implementation-divergence',
      title: 'divergence',
      description: 'd',
      severity: 'high',
      confidence: 'medium',
      location: { file: 'src/MyHook.sol', line: 18 },
      evidence: [],
      engines: [{ engine: 'hookrisk', nativeRule: 'hookrisk-flag-divergence', severity: 'high', confidence: 'medium' }],
    };
    // Profile says 3; the floor must not pull it down to 1.
    const three = complexityOf([profile(metrics({ callbacksImplemented: 1, usesReturnsDelta: true })), divergence]);
    assert.equal(three.value, 3);
    assert.ok(three.evidence?.some((e) => e.includes('flag-implementation-divergence finding')));
    // Profile alone says 0 for a contract HS-02 fired on (declared but not
    // implemented callbacks): the floor still applies.
    const floored = complexityOf([profile(metrics({ callbacksDeclared: 2 })), divergence]);
    assert.equal(floored.value, 1);
  });

  test('a declared value still wins, and a lower declaration is called out', () => {
    const complexity = complexityOf([profile(metrics({ callbacksImplemented: 4, usesReturnsDelta: true, externalCallsInSwapPath: 1 }))], {
      complexity: 2,
    });
    assert.equal(complexity.source, 'declared');
    assert.equal(complexity.value, 2);
    const note = complexity.evidence?.find((e) => e.includes('hookrisk measured 4; hookrisk.toml declares 2.'));
    assert.ok(note, complexity.evidence?.join(' | '));
    assert.ok(note!.includes('The declaration is lower than the measurement.'));
  });

  test('metrics carried on the engine attribution detail are read too', () => {
    // The adapter may hang the payload on `detail` rather than `metrics`; the
    // scorer accepts either so the two halves of the contract land independently.
    const viaDetail = profile(metrics(), { metrics: undefined });
    viaDetail.engines[0]!.detail = { metrics: metrics({ callbacksImplemented: 3 }) };
    assert.equal(complexityOf([viaDetail]).value, 2);
  });

  test('a profile without metrics leaves complexity unmeasured with the reason', () => {
    const complexity = complexityOf([profile(metrics(), { metrics: undefined })]);
    assert.equal(complexity.source, 'unmeasured');
    assert.ok(complexity.evidence?.some((e) => e.includes('carried no metrics')), complexity.evidence?.join(' | '));
  });

  test('metrics that match no rule leave complexity unmeasured rather than defaulting', () => {
    // `callbacksImplemented` missing: neither the 0 nor the 1 rule can hold.
    const complexity = complexityOf([profile({ usesReturnsDelta: false })]);
    assert.equal(complexity.source, 'unmeasured');
    assert.ok(complexity.evidence?.some((e) => e.includes('matched no derivation rule')), complexity.evidence?.join(' | '));
  });

  test('the target contract picks its profile when the file holds several', () => {
    const base = profile(metrics({ callbacksImplemented: 1 }), { id: 'base', discriminator: 'BaseHookMock', location: { file: 'src/MyHook.sol', line: 5 } });
    const target = profile(metrics({ callbacksImplemented: 4, usesReturnsDelta: true }), { id: 'target', discriminator: 'MyHook', location: { file: 'src/MyHook.sol', line: 40 } });

    assert.equal(complexityOf([base, target], {}, 'MyHook').value, 3);
    assert.equal(complexityOf([base, target], {}, 'BaseHookMock').value, 1);

    // No name to go on: the first wins and the evidence admits the choice.
    const ambiguous = complexityOf([base, target]);
    assert.equal(ambiguous.value, 1);
    assert.ok(ambiguous.evidence?.[0]?.includes('2 hook-profile classifications'), ambiguous.evidence?.join(' | '));
  });

  test('the profile fires no trigger evidence and stays a classification', () => {
    const input = deriveScoringInput({ findings: [profile(metrics({ callbacksImplemented: 4, usesReturnsDelta: true }))], engineResults: [hookrisk], declared: {}, dimensionIds });
    assert.deepEqual(input.evidence, [], 'usesReturnsDelta is a metric, not the custom-accounting finding');
  });

  test('the rubric refuses a findingDerivation rule that names an unknown attribute', () => {
    const broken = structuredClone(rubric);
    // A class of its own: an unconditional rule already closes
    // external-call-in-swap-path, and that check fires first.
    broken.dimensions.find((d) => d.id === 'externalDependencies')!.findingDerivation!.rules.push({
      ruleClass: 'upgradeable-hook',
      score: 3,
      when: 'destinationIsUpgradeable',
      rationale: 'x',
    });
    const path = join(tmpdir(), `hookrisk-rubric-attr-${process.pid}.json`);
    writeFileSync(path, JSON.stringify(broken));
    try {
      assert.throws(() => loadRubric(path), /unknown attribute 'destinationIsUpgradeable'/);
    } finally {
      rmSync(path, { force: true });
    }
  });

  test('the rubric refuses a findingDerivation rule that can never be reached', () => {
    // The 2 rule for external-call-in-swap-path is unconditional, so anything
    // written after it for that class is dead. A dead rule in a scoring table
    // reads as policy and never runs.
    const broken = structuredClone(rubric);
    broken.dimensions.find((d) => d.id === 'externalDependencies')!.findingDerivation!.rules.push({
      ruleClass: 'external-call-in-swap-path',
      score: 3,
      when: 'severityRank >= 4',
      rationale: 'x',
    });
    const path = join(tmpdir(), `hookrisk-rubric-dead-${process.pid}.json`);
    writeFileSync(path, JSON.stringify(broken));
    try {
      assert.throws(() => loadRubric(path), /unreachable rule for 'external-call-in-swap-path'/);
    } finally {
      rmSync(path, { force: true });
    }
  });

  test('the rubric refuses a derivation rule that names an unknown metric', () => {
    const broken = structuredClone(rubric);
    broken.dimensions.find((d) => d.id === 'complexity')!.derivation!.rules.push({ score: 2, when: 'branchesOnState >= 1', rationale: 'x' });
    const path = join(tmpdir(), `hookrisk-rubric-${process.pid}.json`);
    writeFileSync(path, JSON.stringify(broken));
    try {
      assert.throws(() => loadRubric(path), /unknown metric 'branchesOnState'/);
    } finally {
      rmSync(path, { force: true });
    }
  });
});

// --------------------------------------------------------------------------- //
// The dimensions HS-03, HS-05 and HS-06 unlocked
//
// Each of the three detectors raises one dimension when it fires, and leaves it
// unmeasured when it does not: each one's blind spot coincides with its
// dimension's lowest brackets, so silence cannot establish a 0. The brackets
// and the reasons live in schema/framework-rubric.json, marked as
// interpretation; these tests pin the numbers the rubric records.
// --------------------------------------------------------------------------- //

describe('dimensions raised by the new detectors', () => {
  const dimensionIds = rubric.dimensions.map((d) => d.id);
  const hookrisk: EngineResult = { engine: 'hookrisk', version: 't', status: 'ok', findings: [], durationMs: 1 };

  const hit = (ruleClass: RuleClass, overrides: Partial<Finding> = {}): Finding => ({
    id: `${ruleClass}-1`,
    ruleClass,
    title: `${ruleClass} title`,
    description: 'd',
    severity: 'high',
    confidence: 'medium',
    location: { file: 'src/MyHook.sol', line: 12 },
    evidence: [],
    engines: [{ engine: 'hookrisk', nativeRule: 'r', severity: 'high', confidence: 'medium' }],
    ...overrides,
  });

  const dimension = (id: string, findings: Finding[], declared = {}) =>
    deriveScoringInput({ findings, engineResults: [hookrisk], declared, dimensionIds }).dimensions[id]!;

  describe('autonomousParameterUpdates from HS-03', () => {
    test('an unguarded mutator (HIGH) scores 2 and quotes the rubric’s reasoning', () => {
      const d = dimension('autonomousParameterUpdates', [hit('admin-surface', { discriminator: 'setFee' })]);
      assert.equal(d.source, 'measured');
      assert.equal(d.value, 2);
      assert.ok(d.evidence?.some((e) => e.includes("anybody can move the hook's parameters")), d.evidence?.join(' | '));
      assert.ok(d.evidence?.some((e) => e.includes('hookrisk’s interpretation')), d.evidence?.join(' | '));
    });

    test('an owner-only mutator (MEDIUM) scores 1, the floor', () => {
      const d = dimension('autonomousParameterUpdates', [hit('admin-surface', { severity: 'medium', discriminator: 'setFee' })]);
      assert.equal(d.value, 1);
      assert.ok(d.evidence?.some((e) => e.includes("cannot see the owner's guardrails")), d.evidence?.join(' | '));
    });

    test('the worst finding decides when both shapes are present', () => {
      const d = dimension('autonomousParameterUpdates', [
        hit('admin-surface', { id: 'a', severity: 'medium', discriminator: 'setFee' }),
        hit('admin-surface', { id: 'b', severity: 'high', discriminator: 'register' }),
      ]);
      assert.equal(d.value, 2);
    });

    test('silence leaves it unmeasured: HS-03 measures the admin surface, not autonomy', () => {
      const d = dimension('autonomousParameterUpdates', []);
      assert.equal(d.source, 'unmeasured');
      assert.equal(d.value, undefined);
      assert.ok(d.evidence?.[0]?.includes('measures the admin surface, not autonomy'), d.evidence?.join(' | '));
    });

    test('a declaration still wins, and says the tool could not measure it', () => {
      const d = dimension('autonomousParameterUpdates', [], { autonomousParameterUpdates: 3 });
      assert.equal(d.source, 'declared');
      assert.equal(d.value, 3);
      assert.ok(d.evidence?.[0]?.startsWith('Not measurable'), d.evidence?.join(' | '));
    });
  });

  describe('externalDependencies from HS-05', () => {
    test('a call that can write scores 2', () => {
      const d = dimension('externalDependencies', [hit('external-call-in-swap-path', { severity: 'medium', metrics: { isStatic: false } })]);
      assert.equal(d.value, 2);
      assert.equal(d.source, 'measured');
    });

    test('a static read scores 1 and says it is a floor', () => {
      const d = dimension('externalDependencies', [hit('external-call-in-swap-path', { severity: 'medium', metrics: { isStatic: true } })]);
      assert.equal(d.value, 1);
      assert.ok(d.evidence?.some((e) => e.includes('as a floor')), d.evidence?.join(' | '));
    });

    test('a finding with no isStatic metric scores 2, the direction that does not understate', () => {
      const d = dimension('externalDependencies', [hit('external-call-in-swap-path', { severity: 'medium' })]);
      assert.equal(d.value, 2);
    });

    test('the worst call decides when a hook makes both kinds', () => {
      const d = dimension('externalDependencies', [
        hit('external-call-in-swap-path', { id: 'a', severity: 'medium', metrics: { isStatic: true } }),
        hit('external-call-in-swap-path', { id: 'b', severity: 'medium', metrics: { isStatic: false } }),
      ]);
      assert.equal(d.value, 2);
    });

    test('silence leaves it unmeasured: HS-05 never looks outside the swap path', () => {
      const d = dimension('externalDependencies', []);
      assert.equal(d.source, 'unmeasured');
      assert.ok(d.evidence?.[0]?.includes('only looks there'), d.evidence?.join(' | '));
    });
  });

  describe('priceImpactingBehavior from HS-06', () => {
    test('an unbounded dynamic fee scores 2, one bracket below its own title', () => {
      const d = dimension('priceImpactingBehavior', [hit('unbounded-dynamic-fee', { severity: 'medium' })]);
      assert.equal(d.value, 2);
      assert.ok(d.evidence?.some((e) => e.includes('evidence is negative')), d.evidence?.join(' | '));
    });

    test('a returns-delta still outranks it', () => {
      const d = dimension('priceImpactingBehavior', [
        hit('unbounded-dynamic-fee', { id: 'a', severity: 'medium' }),
        hit('custom-accounting', { id: 'b', severity: 'info' }),
      ]);
      assert.equal(d.value, 3);
    });

    test('it fires the dynamic-fee trigger evidence', () => {
      const input = deriveScoringInput({
        findings: [hit('unbounded-dynamic-fee', { severity: 'medium' })],
        engineResults: [hookrisk],
        declared: {},
        dimensionIds,
      });
      assert.ok(input.evidence?.includes('dynamic-fee-pool'), JSON.stringify(input.evidence));
    });

    test('silence leaves it unmeasured: a fee within a ceiling fires nothing', () => {
      const d = dimension('priceImpactingBehavior', []);
      assert.equal(d.source, 'unmeasured');
      assert.ok(d.evidence?.[0]?.includes('within a ceiling'), d.evidence?.join(' | '));
    });
  });

  describe('the harness as a coverage source', () => {
    test('an ok harness counts as having looked, so its classes are covered', () => {
      const { looked, declined } = enginesThatLooked([hookrisk], [], { status: 'ok' });
      assert.deepEqual([...looked].sort(), ['harness', 'hookrisk']);
      assert.equal(declined.size, 0);
    });

    test('a failed harness disclaims, with the reason a dimension would quote', () => {
      const { looked, declined } = enginesThatLooked([hookrisk], [], {
        status: 'failed',
        reason: 'setUp reverted: InvalidInitializer() (HR-E304)',
      });
      assert.ok(!looked.has('harness'));
      assert.match(declined.get('harness') ?? '', /failed before its probes could observe the hook \(setUp reverted/);
    });

    test('a skipped harness neither looked nor disclaimed', () => {
      const { looked, declined } = enginesThatLooked([hookrisk], [], { status: 'skipped', reason: '--skip-dynamic' });
      assert.ok(!looked.has('harness'));
      assert.equal(declined.size, 0);
    });

    test('without a harness summary the scorer assumes nothing', () => {
      const { looked } = enginesThatLooked([hookrisk], []);
      assert.ok(!looked.has('harness'));
    });

    test('the harness-sourced classes score no dimension', () => {
      // `unvalidated-pool-key` is a classification and `callback-selector-mismatch`
      // is a defect the framework has no dimension for: both must reach the
      // report without moving a number.
      const withProbes = deriveScoringInput({
        findings: [hit('unvalidated-pool-key', { severity: 'info' }), hit('callback-selector-mismatch')],
        engineResults: [hookrisk],
        declared: {},
        dimensionIds,
        harness: { status: 'ok' },
      });
      const bare = deriveScoringInput({ findings: [], engineResults: [hookrisk], declared: {}, dimensionIds, harness: { status: 'ok' } });
      assert.deepEqual(withProbes.dimensions, bare.dimensions);
      assert.deepEqual(withProbes.evidence, bare.evidence);
    });
  });
});


describe('silence corroborated by the profile', () => {
  test('a clean profile lets the silent detectors measure 0 on three dimensions', async () => {
    const { deriveScoringInput } = await import('./derive.js');
    const profile = {
      id: 'p', ruleClass: 'hook-profile' as const, title: 'Hook profile of Counter', description: 'profile',
      severity: 'info' as const, confidence: 'high' as const,
      location: { file: 'src/Counter.sol', line: 13 }, evidence: [],
      engines: [{ engine: 'hookrisk', nativeRule: 'hookrisk-hook-profile', severity: 'info' as const, confidence: 'high' as const }],
      discriminator: 'Counter',
      metrics: {
        callbacksImplemented: 4, callbacksDeclared: 4, stateWritesInCallbacks: 4,
        externalCallsInSwapPath: 0, externalCallsInSwapPathThirdParty: 0,
        internalFunctionsReachableFromCallbacks: 4, usesReturnsDelta: false, hasOwnerOnlyFunctions: false,
      },
    };
    const input = deriveScoringInput({
      findings: [profile],
      engineResults: [{ engine: 'hookrisk', version: 'x', status: 'ok', findings: [profile], durationMs: 1, scope: { analysedContracts: ['src/Counter.sol:Counter'], targetAnalysed: true } }],
      declared: {},
      dimensionIds: ['priceImpactingBehavior', 'autonomousParameterUpdates', 'externalDependencies', 'customMath'],
      contractName: 'Counter',
    });
    for (const id of ['priceImpactingBehavior', 'autonomousParameterUpdates', 'externalDependencies']) {
      assert.equal(input.dimensions[id]!.source, 'measured', id);
      assert.equal(input.dimensions[id]!.value, 0, id);
      assert.ok(input.dimensions[id]!.evidence!.some((e) => /Corroborated by the hook profile/.test(e)), id);
    }
    // No profile metric speaks to custom math beyond the returns-delta, so it stays honest.
    assert.equal(input.dimensions.customMath!.source, 'unmeasured');
  });
});
