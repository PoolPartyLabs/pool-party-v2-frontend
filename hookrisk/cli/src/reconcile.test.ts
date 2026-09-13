/**
 * Tests for cross-layer reconciliation.
 *
 * Fixtures are the real Orbital scan: hookrisk's two `callback-intentionally-
 * disabled` findings and the harness run record with the seed revert
 * `Error("Use custom addLiquidity")`, verbatim from
 * docs/hackathon/evidence/scans/after/orbital-hook-ctor/hook-risk.json.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { HarnessRunInfo } from './harness.js';
import type { InvariantResult } from './manifest.js';
import { reconcileLayers } from './reconcile.js';
import type { Finding } from './types.js';

/** `Error("Use custom addLiquidity")`, already unwrapped by the harness. */
const SEED_REVERT =
  '0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000175573652063757374' +
  '6f6d206164644c6971756964697479000000000000000000';

const HOOKED_FAILED: HarnessRunInfo = {
  flags: 2696,
  customCurve: true,
  dynamicFee: false,
  permissionsDerived: false,
  seeded: 'hooked-failed',
  hookedSeedRevert: SEED_REVERT,
};

function disabledFinding(callback: 'beforeAddLiquidity' | 'beforeRemoveLiquidity', line: number): Finding {
  return {
    id: `id-${callback}`,
    ruleClass: 'callback-intentionally-disabled',
    title: `OrbitalHook._${callback}(...) overrides \`${callback}\` with \`revert "Use custom ..."\``,
    description: 'disabled by design',
    severity: 'info',
    confidence: 'high',
    location: { file: 'src/OrbitalHook.sol', line },
    function: { name: `_${callback}` },
    discriminator: callback,
    evidence: ['static evidence'],
    engines: [{ engine: 'hookrisk', nativeRule: 'hookrisk-disabled-callback', severity: 'info', confidence: 'high' }],
  };
}

const UNRELATED: Finding = {
  id: 'id-hs01',
  ruleClass: 'unprotected-hook-callback',
  title: 'beforeSwap is callable by anyone',
  description: '',
  severity: 'high',
  confidence: 'medium',
  location: { file: 'src/OrbitalHook.sol', line: 200 },
  function: { name: 'beforeSwap' },
  evidence: ['no onlyPoolManager'],
  engines: [{ engine: 'hookrisk', nativeRule: 'hookrisk-unprotected-callback', severity: 'high', confidence: 'medium' }],
};

function invariants(i3: Partial<InvariantResult> = {}): InvariantResult[] {
  return [
    { id: 'I1', name: 'Conservation and solvency', status: 'passed', runs: 256, calls: 8192 },
    { id: 'I2', name: 'Price monotonicity (custom curve)', status: 'inconclusive', detail: 'passed vacuously' },
    { id: 'I3', name: 'Exit liveness', status: 'inconclusive', detail: 'passed vacuously: 0 positions opened', runs: 256, ...i3 },
  ];
}

describe('reconcileLayers', () => {
  test('static disabled-callback + harness hooked-failed merge into one corroborated finding', () => {
    const input = {
      findings: [UNRELATED, disabledFinding('beforeAddLiquidity', 325), disabledFinding('beforeRemoveLiquidity', 338)],
      invariants: invariants(),
      runRecord: HOOKED_FAILED,
      observations: undefined,
    };
    const { findings, notes } = reconcileLayers(input);

    assert.equal(findings.length, 3, 'no finding added: the static one already names the fact');
    const merged = findings.find((f) => f.id === 'id-beforeAddLiquidity')!;
    assert.deepEqual(
      merged.engines.map((e) => [e.engine, e.nativeRule]),
      [['hookrisk', 'hookrisk-disabled-callback'], ['harness', 'seed-reverted']],
    );
    assert.equal(merged.confidence, 'high');
    assert.match(merged.evidence.at(-1)!, /seed position was rejected in beforeAddLiquidity \(0x259982e5\)/);
    assert.match(merged.evidence.at(-1)!, /Error\("Use custom addLiquidity"\)/);
    assert.match(merged.evidence.at(-1)!, /selector 0x08c379a0/);

    const remove = findings.find((f) => f.id === 'id-beforeRemoveLiquidity')!;
    assert.equal(remove.engines.length, 1, 'the harness never reached beforeRemoveLiquidity; it must not vouch for it');
    assert.deepEqual(findings.find((f) => f.id === 'id-hs01'), UNRELATED, 'unrelated findings pass through untouched');
    assert.equal(notes.length, 2);
  });

  test('both layers agreeing makes I3 not-applicable with the revert named, and leaves I1/I2 alone', () => {
    const { invariants: out } = reconcileLayers({
      findings: [disabledFinding('beforeAddLiquidity', 325)],
      invariants: invariants(),
      runRecord: HOOKED_FAILED,
      observations: {
        swapsExecuted: 0, swapsCompared: 0, swapsSkipped: 0, hookedSwapReverted: 1280, positionsOpened: 0,
        positionsClosed: 0, donations: 0, priceChecks: 0, monotonicityViolations: 0, exitFailures: 0,
      },
    });
    const i3 = out.find((i) => i.id === 'I3')!;
    assert.equal(i3.status, 'not-applicable');
    assert.match(i3.detail ?? '', /disabled by design/);
    assert.match(i3.detail ?? '', /hookrisk classifies beforeAddLiquidity as intentionally disabled/);
    assert.match(i3.detail ?? '', /rejected with Error\("Use custom addLiquidity"\)/);
    assert.match(i3.detail ?? '', /opened 0 position\(s\)/);
    assert.equal(i3.runs, undefined, 'a not-applicable invariant carries no run statistics');
    assert.equal(out.find((i) => i.id === 'I1')!.status, 'passed');
    assert.equal(out.find((i) => i.id === 'I2')!.status, 'inconclusive');
  });

  test('a failed I3 is never downgraded to not-applicable', () => {
    const { invariants: out } = reconcileLayers({
      findings: [disabledFinding('beforeAddLiquidity', 325)],
      invariants: invariants({ status: 'failed', detail: 'exit reverted' }),
      runRecord: HOOKED_FAILED,
    });
    assert.equal(out.find((i) => i.id === 'I3')!.status, 'failed');
  });

  test('hooked-failed with no static classification adds a harness-sourced finding at medium confidence', () => {
    const { findings, invariants: out, notes } = reconcileLayers({
      findings: [UNRELATED],
      invariants: invariants(),
      runRecord: HOOKED_FAILED,
    });
    assert.equal(findings.length, 2);
    const added = findings[1]!;
    assert.equal(added.ruleClass, 'callback-intentionally-disabled');
    assert.equal(added.confidence, 'medium');
    assert.equal(added.location, null);
    assert.deepEqual(added.function, { name: 'beforeAddLiquidity', selector: '0x259982e5' });
    assert.equal(added.discriminator, 'beforeAddLiquidity');
    assert.deepEqual(added.engines, [
      { engine: 'harness', nativeRule: 'seed-reverted', severity: 'info', confidence: 'medium' },
    ]);
    assert.match(added.title, /Error\("Use custom addLiquidity"\)/);
    assert.match(added.description, /not the intent/);
    assert.equal(added.id.length, 16, 'id comes from makeFindingId');
    assert.equal(out.find((i) => i.id === 'I3')!.status, 'inconclusive', 'one witness is not agreement; I3 stays as measured');
    assert.equal(notes.length, 1);
  });

  test('the harness-only finding names the selector when the revert is a custom error', () => {
    const { findings } = reconcileLayers({
      findings: [],
      invariants: invariants(),
      runRecord: { ...HOOKED_FAILED, hookedSeedRevert: '0xebdb4fd9' },
    });
    assert.match(findings[0]!.title, /custom error 0xebdb4fd9/);
    assert.match(findings[0]!.evidence[0]!, /\[selector 0xebdb4fd9\]/);
  });

  test('a static classification on beforeRemoveLiquidity only still counts as agreement, and the add path gets its own finding', () => {
    const { findings, invariants: out } = reconcileLayers({
      findings: [disabledFinding('beforeRemoveLiquidity', 338)],
      invariants: invariants(),
      runRecord: HOOKED_FAILED,
    });
    assert.equal(findings.length, 2, 'the seed revert is about beforeAddLiquidity, which nothing static names');
    assert.equal(findings[0]!.engines.length, 1);
    assert.equal(out.find((i) => i.id === 'I3')!.status, 'not-applicable');
  });

  test('the callback is recognised from a BlockSec-style selector too', () => {
    const bySelector: Finding = { ...disabledFinding('beforeAddLiquidity', 1), discriminator: undefined, function: { selector: '0x259982E5' } };
    const { findings } = reconcileLayers({ findings: [bySelector], invariants: invariants(), runRecord: HOOKED_FAILED });
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.engines.length, 2);
  });

  test('nothing changes when the seed succeeded, the record is absent, or the harness never ran', () => {
    const findings = [disabledFinding('beforeAddLiquidity', 325)];
    for (const runRecord of [undefined, { ...HOOKED_FAILED, seeded: 'both' as const, hookedSeedRevert: '' }]) {
      const out = reconcileLayers({ findings, invariants: invariants(), runRecord });
      assert.deepEqual(out.findings, findings);
      assert.deepEqual(out.invariants, invariants());
      assert.deepEqual(out.notes, []);
    }
  });

  test('inputs are not mutated', () => {
    const findings = [disabledFinding('beforeAddLiquidity', 325)];
    const before = JSON.stringify({ findings, invariants: invariants() });
    reconcileLayers({ findings, invariants: invariants(), runRecord: HOOKED_FAILED });
    assert.equal(JSON.stringify({ findings, invariants: invariants() }), before);
  });

  test('a harness-only finding is anchored on the target file, at the hook-profile line when there is one', () => {
    const { findings } = reconcileLayers({
      findings: [PROFILE],
      invariants: invariants(),
      runRecord: HOOKED_FAILED,
      sourceFile: 'src/OrbitalHook.sol',
    });
    assert.deepEqual(findings.at(-1)!.location, { file: 'src/OrbitalHook.sol', line: 42 });

    const noProfile = reconcileLayers({ findings: [], invariants: invariants(), runRecord: HOOKED_FAILED, sourceFile: 'src/OrbitalHook.sol' });
    assert.deepEqual(noProfile.findings[0]!.location, { file: 'src/OrbitalHook.sol', line: 1 });
  });
});

// --------------------------------------------------------------------------- //
// Execution probes
// --------------------------------------------------------------------------- //

const PROFILE: Finding = {
  id: 'id-profile',
  ruleClass: 'hook-profile',
  title: 'Counter: hook profile',
  description: '',
  severity: 'info',
  confidence: 'high',
  location: { file: 'src/OrbitalHook.sol', line: 42 },
  evidence: [],
  engines: [{ engine: 'hookrisk', nativeRule: 'hookrisk-hook-profile', severity: 'info', confidence: 'high' }],
};

const CLEAN: HarnessRunInfo = {
  flags: 0xc0,
  customCurve: false,
  dynamicFee: false,
  permissionsDerived: true,
  seeded: 'both',
  hookedSeedRevert: '',
  probes: {
    eoaGuard: { beforeSwap: 'guarded', afterSwap: 'guarded' },
    exclusivity: 'rejected',
    selectors: { beforeSwap: 'ok', afterSwap: 'ok' },
  },
};

function withProbes(probes: Partial<NonNullable<HarnessRunInfo['probes']>>): HarnessRunInfo {
  return { ...CLEAN, probes: { ...CLEAN.probes!, ...probes } };
}

describe('reconcileLayers: EOA-guard probe', () => {
  test('unguarded on a callback HS-01 reports merges as a second attribution at confidence high', () => {
    const hs01: Finding = { ...UNRELATED, function: { name: 'beforeSwap' }, discriminator: 'beforeSwap' };
    const { findings, notes } = reconcileLayers({
      findings: [hs01, PROFILE],
      invariants: [],
      runRecord: withProbes({ eoaGuard: { beforeSwap: 'unguarded', afterSwap: 'guarded' } }),
      sourceFile: 'src/OrbitalHook.sol',
    });
    assert.equal(findings.length, 2, 'no new finding: HS-01 already names the callback');
    const merged = findings.find((f) => f.id === 'id-hs01')!;
    assert.deepEqual(
      merged.engines.map((e) => [e.engine, e.nativeRule, e.confidence]),
      [['hookrisk', 'hookrisk-unprotected-callback', 'medium'], ['harness', 'eoa-guard-probe', 'high']],
    );
    assert.equal(merged.confidence, 'high');
    assert.match(merged.evidence.at(-1)!, /beforeSwap \(0x575e24b4\) was called from an address that is not the PoolManager/);
    assert.match(merged.evidence.at(-1)!, /\[eoa-guard-probe\]/);
    assert.equal(merged.location!.line, 200, 'the static location is kept');
    assert.equal(notes.length, 1);
    assert.match(notes[0]!, /merged into finding id-hs01/);
  });

  test('unguarded with no HS-01 adds a harness-sourced unprotected-hook-callback at medium confidence', () => {
    const { findings, notes } = reconcileLayers({
      findings: [PROFILE],
      invariants: [],
      runRecord: withProbes({ eoaGuard: { beforeSwap: 'guarded', afterSwap: 'unguarded' } }),
      sourceFile: 'src/OrbitalHook.sol',
    });
    assert.equal(findings.length, 2);
    const added = findings[1]!;
    assert.equal(added.ruleClass, 'unprotected-hook-callback');
    assert.equal(added.severity, 'high');
    assert.equal(added.confidence, 'medium');
    assert.deepEqual(added.location, { file: 'src/OrbitalHook.sol', line: 42 });
    assert.deepEqual(added.function, { name: 'afterSwap', selector: '0xb47b2fb1' });
    assert.equal(added.discriminator, 'afterSwap');
    assert.deepEqual(added.engines, [{ engine: 'harness', nativeRule: 'eoa-guard-probe', severity: 'high', confidence: 'medium' }]);
    assert.match(added.description, /established by execution alone/);
    assert.equal(added.id.length, 16);
    assert.equal(notes.length, 1);
  });

  test('guarded and reverted-other produce nothing, and HS-01 on a guarded callback is left as it was', () => {
    const hs01: Finding = { ...UNRELATED, function: { name: 'beforeSwap' }, discriminator: 'beforeSwap' };
    const { findings, notes } = reconcileLayers({
      findings: [hs01],
      invariants: [],
      runRecord: withProbes({ eoaGuard: { beforeSwap: 'reverted-other', afterSwap: 'guarded' } }),
      sourceFile: 'src/OrbitalHook.sol',
    });
    assert.deepEqual(findings, [hs01]);
    assert.deepEqual(notes, []);
  });

  test('the merge does not add the attribution twice on a second pass', () => {
    const hs01: Finding = { ...UNRELATED, function: { name: 'beforeSwap' }, discriminator: 'beforeSwap' };
    const run = withProbes({ eoaGuard: { beforeSwap: 'unguarded' } });
    const once = reconcileLayers({ findings: [hs01], invariants: [], runRecord: run });
    const twice = reconcileLayers({ findings: once.findings, invariants: [], runRecord: run });
    assert.equal(twice.findings[0]!.engines.length, 2);
  });
});

describe('reconcileLayers: exclusivity probe', () => {
  test('accepted becomes an INFO unvalidated-pool-key classification on the contract, informing no dimension', () => {
    const { findings, notes } = reconcileLayers({
      findings: [PROFILE],
      invariants: [],
      runRecord: withProbes({ exclusivity: 'accepted' }),
      sourceFile: 'src/OrbitalHook.sol',
    });
    assert.equal(findings.length, 2);
    const added = findings[1]!;
    assert.equal(added.ruleClass, 'unvalidated-pool-key');
    assert.equal(added.severity, 'info');
    assert.equal(added.confidence, 'high');
    assert.deepEqual(added.location, { file: 'src/OrbitalHook.sol', line: 42 });
    assert.equal(added.function, undefined, 'anchored on the contract, not a callback');
    assert.equal(added.informsDimensions, undefined);
    assert.deepEqual(added.engines, [{ engine: 'harness', nativeRule: 'exclusivity-probe', severity: 'info', confidence: 'high' }]);
    assert.match(added.evidence[0]!, /\[exclusivity-probe\]/);
    assert.match(added.description, /classification/);
    assert.equal(notes.length, 1);
  });

  test('rejected and not-applicable produce nothing', () => {
    for (const exclusivity of ['rejected', 'not-applicable'] as const) {
      const out = reconcileLayers({ findings: [], invariants: [], runRecord: withProbes({ exclusivity, exclusivityReason: 'x' }) });
      assert.deepEqual(out.findings, []);
      assert.deepEqual(out.notes, []);
    }
  });

  test('the classification is not duplicated when one is already present', () => {
    const run = withProbes({ exclusivity: 'accepted' });
    const once = reconcileLayers({ findings: [], invariants: [], runRecord: run });
    const twice = reconcileLayers({ findings: once.findings, invariants: [], runRecord: run });
    assert.equal(twice.findings.length, 1);
  });
});

describe('reconcileLayers: selector probe', () => {
  test('wrong-selector is a HIGH callback-selector-mismatch at high confidence, per callback', () => {
    const { findings, notes } = reconcileLayers({
      findings: [PROFILE],
      invariants: [],
      runRecord: withProbes({ selectors: { beforeSwap: 'wrong-selector', afterSwap: 'ok' } }),
      sourceFile: 'src/OrbitalHook.sol',
    });
    assert.equal(findings.length, 2);
    const added = findings[1]!;
    assert.equal(added.ruleClass, 'callback-selector-mismatch');
    assert.equal(added.severity, 'high');
    assert.equal(added.confidence, 'high');
    assert.deepEqual(added.location, { file: 'src/OrbitalHook.sol', line: 42 });
    assert.deepEqual(added.function, { name: 'beforeSwap', selector: '0x575e24b4' });
    assert.equal(added.discriminator, 'beforeSwap');
    assert.match(added.title, /returns the wrong selector; every swap through the pool reverts/);
    assert.match(added.evidence[0]!, /InvalidHookResponse.*\[selector-probe\]/);
    assert.deepEqual(added.engines, [{ engine: 'harness', nativeRule: 'selector-probe', severity: 'high', confidence: 'high' }]);
    assert.equal(notes.length, 1);
  });

  test('reverted is HIGH at medium confidence and names the unwrapped revert from the record', () => {
    const { findings } = reconcileLayers({
      findings: [],
      invariants: [],
      runRecord: withProbes({
        selectors: { beforeSwap: 'reverted', afterSwap: 'reverted' },
        selectorReverts: { beforeSwap: SEED_REVERT, afterSwap: '0xebdb4fd9' },
      }),
      sourceFile: 'src/OrbitalHook.sol',
    });
    assert.equal(findings.length, 2);
    const [before, after] = findings as [Finding, Finding];
    assert.equal(before.confidence, 'medium');
    assert.match(before.title, /beforeSwap reverts when the PoolManager calls it \(Error\("Use custom addLiquidity"\)\)/);
    assert.match(before.evidence[0]!, /reverted when called as the PoolManager .*: Error\("Use custom addLiquidity"\) \[raw 0x08c379a0…\]/);
    assert.match(before.description, /needs reserves of its own/);
    assert.match(after.title, /custom error 0xebdb4fd9/);
    assert.notEqual(before.id, after.id, 'one finding per callback');
    assert.deepEqual(findings.map((f) => f.location), [{ file: 'src/OrbitalHook.sol', line: 1 }, { file: 'src/OrbitalHook.sol', line: 1 }]);
  });

  test('reverted without a recorded reason still reports, without inventing one', () => {
    const { findings } = reconcileLayers({ findings: [], invariants: [], runRecord: withProbes({ selectors: { afterSwap: 'reverted' } }) });
    assert.equal(findings[0]!.title, 'afterSwap reverts when the PoolManager calls it');
    assert.equal(findings[0]!.location, null, 'no sourceFile, no location');
  });

  test('all ok produces nothing', () => {
    const out = reconcileLayers({ findings: [PROFILE], invariants: invariants(), runRecord: CLEAN, sourceFile: 'src/OrbitalHook.sol' });
    assert.deepEqual(out.findings, [PROFILE]);
    assert.deepEqual(out.invariants, invariants());
    assert.deepEqual(out.notes, []);
  });
});

describe('reconcileLayers: probes and the seed revert together', () => {
  test('the Orbital shape with probes: seed merged, exclusivity accepted, swap callback reverted', () => {
    const { findings, invariants: out, notes } = reconcileLayers({
      findings: [disabledFinding('beforeAddLiquidity', 325), PROFILE],
      invariants: invariants(),
      runRecord: {
        ...HOOKED_FAILED,
        probes: {
          eoaGuard: { beforeAddLiquidity: 'guarded', beforeSwap: 'guarded' },
          exclusivity: 'accepted',
          selectors: { beforeAddLiquidity: 'reverted', beforeSwap: 'reverted' },
          selectorReverts: { beforeAddLiquidity: SEED_REVERT, beforeSwap: '0xebdb4fd9' },
        },
      },
      sourceFile: 'src/OrbitalHook.sol',
    });
    // The swap callback's revert is the idle-pool condition (a custom curve
    // that refused its seed has no reserves), already reported through the
    // inconclusive invariants; it is not a selector defect.
    assert.deepEqual(
      findings.map((f) => f.ruleClass),
      ['callback-intentionally-disabled', 'hook-profile', 'unvalidated-pool-key'],
    );
    assert.equal(findings[0]!.engines.length, 2, 'the seed merge still happens');
    assert.equal(out.find((i) => i.id === 'I3')!.status, 'not-applicable');
    assert.ok(notes.some((n) => /beforeAddLiquidity reverted under the selector probe, but finding id-beforeAddLiquidity classifies it as intentionally disabled/.test(n)));
    assert.ok(notes.some((n) => /beforeSwap reverted under the selector probe on a custom curve that refused its seed/.test(n)));
  });

  test('a reverted selector verdict on a callback the harness itself classified as disabled is not a second finding', () => {
    const { findings } = reconcileLayers({
      findings: [],
      invariants: invariants(),
      runRecord: {
        ...HOOKED_FAILED,
        probes: { eoaGuard: {}, exclusivity: 'not-applicable', selectors: { beforeAddLiquidity: 'reverted' } },
      },
    });
    assert.deepEqual(findings.map((f) => f.ruleClass), ['callback-intentionally-disabled']);
  });

  test('a wrong-selector verdict is reported even on a disabled callback: a wrong answer is not a refusal', () => {
    const { findings } = reconcileLayers({
      findings: [disabledFinding('beforeAddLiquidity', 325)],
      invariants: invariants(),
      runRecord: { ...HOOKED_FAILED, probes: { eoaGuard: {}, exclusivity: 'not-applicable', selectors: { beforeAddLiquidity: 'wrong-selector' } } },
    });
    assert.deepEqual(findings.map((f) => f.ruleClass), ['callback-intentionally-disabled', 'callback-selector-mismatch']);
  });

  test('a record without probes changes nothing beyond the seed reconciliation', () => {
    const out = reconcileLayers({ findings: [PROFILE], invariants: invariants(), runRecord: { ...HOOKED_FAILED, seeded: 'both' } });
    assert.deepEqual(out.findings, [PROFILE]);
    assert.deepEqual(out.notes, []);
  });
});
