/**
 * Tests for cross-engine reconciliation.
 *
 * These pin the behaviour the multi-engine design exists for: agreement between
 * tools built on different foundations is treated as confirmation, disagreement
 * about severity resolves upward, and nothing gets counted twice.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import type { EngineResult, Finding, RuleClass, SourceLocation } from '../types.js';
import {
  HOOK_CALLBACK_SELECTORS,
  callbackSelector,
  groupKey,
  makeFindingId,
  mergeEngineResults,
} from './dedupe.js';

function finding(
  engine: string,
  nativeRule: string,
  overrides: Partial<Finding> & { ruleClass: RuleClass; location: SourceLocation | null },
): Finding {
  const severity = overrides.severity ?? 'high';
  const confidence = overrides.confidence ?? 'medium';
  return {
    id: makeFindingId(
      overrides.ruleClass,
      overrides.location,
      overrides.function?.selector,
      overrides.discriminator,
    ),
    title: 'title',
    description: overrides.description ?? 'description',
    evidence: overrides.evidence ?? [`${engine} says so`],
    engines: [{ engine, nativeRule, severity, confidence }],
    ...overrides,
    severity,
    confidence,
  };
}

function result(engine: string, findings: Finding[]): EngineResult {
  return { engine, version: 'test', status: 'ok', findings, durationMs: 1 };
}

const AT = (file: string, line: number): SourceLocation => ({ file, line });

describe('mergeEngineResults', () => {
  test('collapses the same defect reported by two engines into one finding', () => {
    const ours = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 42),
      function: { name: 'beforeSwap', selector: '0x575e24b4' },
    });
    const theirs = finding('blocksec', 'UniswapPublicHook', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 42),
      function: { name: 'beforeSwap', selector: '0x575e24b4' },
    });

    const { findings, stats } = mergeEngineResults([
      result('hookrisk', [ours]),
      result('blocksec', [theirs]),
    ]);

    assert.equal(findings.length, 1, 'one defect, one finding');
    assert.equal(stats.total, 2);
    assert.equal(stats.unique, 1);
    assert.equal(stats.corroborated, 1);
    assert.equal(findings[0]!.engines.length, 2, 'both engines attributed');
  });

  test('cross-foundation agreement raises confidence to high', () => {
    // Neither engine was individually confident. Agreement across an AST-based
    // and a bytecode-based analyzer is what makes the finding trustworthy.
    const ours = finding('hookrisk', 'HS-04', {
      ruleClass: 'upgradeable-hook',
      location: AT('src/MyHook.sol', 10),
      confidence: 'low',
    });
    const theirs = finding('blocksec', 'UniswapUpgradableHook', {
      ruleClass: 'upgradeable-hook',
      location: AT('src/MyHook.sol', 10),
      confidence: 'low',
    });

    const { findings } = mergeEngineResults([
      result('hookrisk', [ours]),
      result('blocksec', [theirs]),
    ]);

    assert.equal(findings[0]!.confidence, 'high');
  });

  test('a lone engine keeps its own confidence', () => {
    const solo = finding('hookrisk', 'HS-06', {
      ruleClass: 'unbounded-dynamic-fee',
      location: AT('src/MyHook.sol', 77),
      confidence: 'low',
    });

    const { findings, stats } = mergeEngineResults([result('hookrisk', [solo])]);

    assert.equal(findings[0]!.confidence, 'low', 'no corroboration, no promotion');
    assert.equal(stats.corroborated, 0);
  });

  test('severity resolves to the most severe assessment', () => {
    const mild = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 5),
      function: { selector: '0x575e24b4' },
      severity: 'medium',
    });
    const severe = finding('blocksec', 'UniswapPublicHook', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 5),
      function: { selector: '0x575e24b4' },
      severity: 'critical',
    });

    const { findings } = mergeEngineResults([
      result('hookrisk', [mild]),
      result('blocksec', [severe]),
    ]);

    assert.equal(findings[0]!.severity, 'critical');
  });

  test('a one-line disagreement about the same function still merges', () => {
    // One engine points at the `function` keyword, the other at the offending
    // statement. Same defect; the selector is what settles it.
    const atSignature = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 40),
      function: { selector: '0x575e24b4' },
    });
    const atBody = finding('blocksec', 'UniswapPublicHook', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 43),
      function: { selector: '0x575e24b4' },
    });

    const { findings } = mergeEngineResults([
      result('hookrisk', [atSignature]),
      result('blocksec', [atBody]),
    ]);

    assert.equal(findings.length, 1);
  });

  test('different functions stay separate findings', () => {
    const beforeSwap = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 40),
      function: { selector: '0x575e24b4' },
    });
    const afterSwap = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 60),
      function: { selector: '0xb47b2fb1' },
    });

    const { findings } = mergeEngineResults([result('hookrisk', [beforeSwap, afterSwap])]);

    assert.equal(findings.length, 2, 'two unguarded callbacks are two problems');
  });

  test('different rule classes at one location stay separate', () => {
    const unguarded = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 40),
    });
    const upgradeable = finding('blocksec', 'UniswapUpgradableHook', {
      ruleClass: 'upgradeable-hook',
      location: AT('src/MyHook.sol', 40),
    });

    const { findings } = mergeEngineResults([
      result('hookrisk', [unguarded]),
      result('blocksec', [upgradeable]),
    ]);

    assert.equal(findings.length, 2);
  });

  test('findings are ordered worst-first', () => {
    const low = finding('hookrisk', 'HS-08', {
      ruleClass: 'rounding-direction',
      location: AT('src/MyHook.sol', 90),
      severity: 'low',
    });
    const critical = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 10),
      severity: 'critical',
    });

    const { findings } = mergeEngineResults([result('hookrisk', [low, critical])]);

    assert.equal(findings[0]!.severity, 'critical');
    assert.equal(findings[1]!.severity, 'low');
  });

  test('a skipped engine contributes nothing and breaks nothing', () => {
    const ours = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 42),
    });

    const { findings, stats } = mergeEngineResults([
      result('hookrisk', [ours]),
      { engine: 'blocksec', version: 'n/a', status: 'skipped', reason: 'docker absent', findings: [], durationMs: 0 },
    ]);

    assert.equal(findings.length, 1);
    assert.equal(stats.corroborated, 0, 'a skipped engine cannot corroborate');
    assert.equal(stats.byEngine.blocksec, 0);
  });
});

describe('makeFindingId', () => {
  test('is stable for the same defect', () => {
    const a = makeFindingId('unprotected-hook-callback', AT('src/A.sol', 1), '0xdeadbeef');
    const b = makeFindingId('unprotected-hook-callback', AT('src/A.sol', 1), '0xdeadbeef');
    assert.equal(a, b);
  });

  test('differs across rule classes at the same place', () => {
    const a = makeFindingId('unprotected-hook-callback', AT('src/A.sol', 1));
    const b = makeFindingId('upgradeable-hook', AT('src/A.sol', 1));
    assert.notEqual(a, b);
  });

  test('tolerates a missing location', () => {
    assert.equal(typeof makeFindingId('selfdestruct', null), 'string');
  });

  test('distinguishes two findings at one anchor by discriminator', () => {
    const a = makeFindingId('flag-implementation-divergence', AT('src/A.sol', 18), undefined, 'beforeSwap');
    const b = makeFindingId('flag-implementation-divergence', AT('src/A.sol', 18), undefined, 'afterSwap');
    assert.notEqual(a, b);
  });

  test('leaves ids of findings without a discriminator unchanged', () => {
    // Ids are SARIF fingerprints; changing every existing one would re-raise
    // every alert on upgrade.
    const legacy = makeFindingId('custom-accounting', AT('src/A.sol', 18));
    const explicit = makeFindingId('custom-accounting', AT('src/A.sol', 18), undefined, undefined);
    assert.equal(legacy, explicit);
  });
});

describe('anchoring across engines and discriminators', () => {
  test('a hookrisk HS-01 keyed by callback name corroborates a BlockSec finding keyed by selector', () => {
    // hookrisk knows the callback by the name SlithIR gives it; HookScan knows
    // it by the selector it dispatched on. Same missing guard. Before names were
    // resolved to selectors these never met, and the one class both engines
    // cover could never be corroborated.
    const ours = finding('hookrisk', 'hookrisk-unprotected-callback', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 88),
      function: { name: 'beforeAddLiquidity' },
      discriminator: 'beforeAddLiquidity',
    });
    const theirs = finding('blocksec', 'UniswapPublicHook', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 91),
      function: { selector: '0x259982e5' },
    });

    const { findings, stats } = mergeEngineResults([
      result('hookrisk', [ours]),
      result('blocksec', [theirs]),
    ]);

    assert.equal(findings.length, 1, 'one missing guard, one finding');
    assert.equal(stats.corroborated, 1);
    assert.equal(findings[0]!.confidence, 'high', 'cross-foundation agreement');
    assert.deepEqual(findings[0]!.engines.map((e) => e.engine).sort(), ['blocksec', 'hookrisk']);
  });

  test("BaseHook's internal override name resolves to the same callback", () => {
    const ours = finding('hookrisk', 'hookrisk-unprotected-callback', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 40),
      function: { name: '_beforeSwap' },
    });
    const theirs = finding('blocksec', 'UniswapPublicHook', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 40),
      function: { selector: '0x575E24B4' },
    });

    const { findings } = mergeEngineResults([result('hookrisk', [ours]), result('blocksec', [theirs])]);
    assert.equal(findings.length, 1);
  });

  test('two HS-02 findings on one contract with different discriminators stay separate', () => {
    // Both anchor on the contract declaration (the same line), because that is
    // where getHookPermissions() lives. They are two divergent permissions, not
    // one. Reproduced on Orbital: Slither emitted two, the manifest had one.
    const missingCallback = finding('hookrisk', 'hookrisk-flag-divergence', {
      ruleClass: 'flag-implementation-divergence',
      location: AT('src/OrbitalHook.sol', 18),
      discriminator: 'beforeRemoveLiquidity',
      description: 'declares permission `beforeRemoveLiquidity` but provides no working implementation',
    });
    const orphanDelta = finding('hookrisk', 'hookrisk-flag-divergence', {
      ruleClass: 'flag-implementation-divergence',
      location: AT('src/OrbitalHook.sol', 18),
      discriminator: 'beforeSwapReturnDelta',
      description: 'declares `beforeSwapReturnDelta` without `beforeSwap`',
    });

    const { findings, stats } = mergeEngineResults([result('hookrisk', [missingCallback, orphanDelta])]);

    assert.equal(findings.length, 2, 'two divergent permissions are two findings');
    assert.equal(stats.unique, 2);
    assert.deepEqual(stats.merges, [], 'nothing was merged');
    assert.notEqual(findings[0]!.id, findings[1]!.id);
  });

  test('without a discriminator the same anchor still collapses, and the log says so', () => {
    // The legacy shape, kept so an engine that sends no discriminator degrades
    // to the old behaviour rather than to something new. The difference now is
    // that the collapse is visible.
    const a = finding('hookrisk', 'hookrisk-flag-divergence', {
      ruleClass: 'flag-implementation-divergence',
      location: AT('src/OrbitalHook.sol', 18),
    });
    const b = finding('hookrisk', 'hookrisk-flag-divergence', {
      ruleClass: 'flag-implementation-divergence',
      location: AT('src/OrbitalHook.sol', 18),
      description: 'a longer description that should win the merge',
    });

    const log: string[] = [];
    const { findings, stats } = mergeEngineResults([result('hookrisk', [a, b])], (m) => log.push(m));

    assert.equal(findings.length, 1);
    assert.equal(stats.merges.length, 1);
    assert.equal(stats.merges[0]!.count, 2);
    assert.equal(stats.merges[0]!.corroborated, false);
    assert.ok(
      log.some((l) => l.includes('merged 2 flag-implementation-divergence') && l.includes('same anchor 2 times')),
      `expected an explanation in the log, got: ${log.join(' / ')}`,
    );
    assert.ok(log.some((l) => l.includes('2 finding(s) in, 1 out')));
  });

  test('a corroborated merge is logged as corroboration', () => {
    const ours = finding('hookrisk', 'HS-04', {
      ruleClass: 'upgradeable-hook',
      location: AT('src/MyHook.sol', 10),
    });
    const theirs = finding('blocksec', 'UniswapUpgradableHook', {
      ruleClass: 'upgradeable-hook',
      location: AT('src/MyHook.sol', 10),
    });

    const log: string[] = [];
    const { stats } = mergeEngineResults(
      [result('hookrisk', [ours]), result('blocksec', [theirs])],
      (m) => log.push(m),
    );

    assert.equal(stats.merges[0]!.corroborated, true);
    assert.ok(log.some((l) => l.includes('corroborated across hookrisk and blocksec')));
  });

  test('the discriminator changes the group key only when it says something the function does not', () => {
    const withBoth = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 40),
      function: { name: 'afterSwap' },
      discriminator: 'afterSwap',
    });
    const withFunctionOnly = finding('hookrisk', 'HS-01', {
      ruleClass: 'unprotected-hook-callback',
      location: AT('src/MyHook.sol', 40),
      function: { name: 'afterSwap' },
    });
    assert.equal(groupKey(withBoth), groupKey(withFunctionOnly));
    assert.equal(groupKey(withBoth), 'unprotected-hook-callback|src/MyHook.sol|sel:0xb47b2fb1');
  });
});

describe('callbackSelector', () => {
  test('resolves every IHooks callback, its internal override and its full signature', () => {
    assert.equal(callbackSelector('beforeSwap'), '0x575e24b4');
    assert.equal(callbackSelector('_beforeSwap'), '0x575e24b4');
    assert.equal(callbackSelector('beforeSwap(address,PoolKey,SwapParams,bytes)'), '0x575e24b4');
    assert.equal(Object.keys(HOOK_CALLBACK_SELECTORS).length, 10, 'IHooks has ten callbacks');
  });

  test('leaves non-callbacks alone', () => {
    assert.equal(callbackSelector('getHookPermissions'), undefined);
    assert.equal(callbackSelector(undefined), undefined);
  });
});
