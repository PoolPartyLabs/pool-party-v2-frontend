/**
 * Tests for the harness bridge.
 *
 * The property under test throughout: the dynamic layer must never report
 * success when it did not run. Every fixture that models forge failing,
 * `setUp` reverting, or the harness declining has an assertion that the result
 * says so — because a tool that reports nothing looks exactly like success.
 *
 * Fixtures are trimmed from real `forge test --json` output: the setUp failure
 * is from scanning a custom-curve hook that rejects PoolManager liquidity, the
 * passing rows from the corpus's CleanHook.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  PLACEHOLDERS,
  describeRevert,
  encodeConstructorArgs,
  flagsFrom,
  locateArtifact,
  parseObservations,
  parseRunRecord,
  permissionsFrom,
  readArtifact,
  resolveProject,
  summariseProbes,
  translate,
  unwrapRevert,
  type AbiInput,
  type ExecResult,
  type ForgeReport,
  type ForgeTestResult,
  type Observations,
} from './harness.js';

// --------------------------------------------------------------------------- //
// Fixtures
// --------------------------------------------------------------------------- //

/** Verbatim from forge: hook 0x…0888 rejected the seed in beforeAddLiquidity with Error("No v4 Liquidity allowed"). */
const SETUP_FAILURE_REASON =
  'WrappedError(0x4444000000000000000000000000000000000888, 0x259982e5, ' +
  '0x08c379a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000017' +
  '4e6f207634204c697175696469747920616c6c6f776564000000000000000000, 0xa9e35b2f)';

const SUITE = 'test/Generic.t.sol:GenericHookInvariants';

function invariantRow(status = 'Success', extra: Partial<ForgeTestResult> = {}): ForgeTestResult {
  return {
    status,
    reason: null,
    counterexample: null,
    kind: { Invariant: { runs: 256, calls: 8192, reverts: 0 } },
    ...extra,
  };
}

function report(rows: Record<string, ForgeTestResult>): ForgeReport {
  return { [SUITE]: { test_results: rows } };
}

const ALL_PASS: Record<string, ForgeTestResult> = {
  'invariant_I1_tokensAreConserved()': invariantRow(),
  'invariant_I2_hookDoesNotBlockSwaps()': invariantRow(),
  'invariant_I2_noUndeclaredExtraction()': invariantRow(),
  'invariant_I2b_priceIsMonotonic()': invariantRow(),
  'invariant_I3_noExitReverted()': invariantRow(),
};

// Hand-rolled ABI encoding, so the raw-calldata path is tested against bytes
// whose layout is spelled out here rather than produced by the code under test.
const wordOf = (hex: string): string => hex.replace(/^0x/, '').padStart(64, '0');
const bytesOf = (hex: string): string => {
  const data = hex.replace(/^0x/, '');
  const padded = data.padEnd(Math.ceil(data.length / 64) * 64, '0');
  return wordOf((data.length / 2).toString(16)) + padded;
};
const errorString = (text: string): string =>
  `0x08c379a0${wordOf('20')}${bytesOf(Buffer.from(text, 'utf8').toString('hex'))}`;
const panic = (code: number): string => `0x4e487b71${wordOf(code.toString(16))}`;
function wrappedError(target: string, selector: string, reason: string, details = '0x'): string {
  const reasonBytes = bytesOf(reason);
  const reasonOffset = 4 * 32;
  const detailsOffset = reasonOffset + reasonBytes.length / 2;
  return (
    '0x90bfb865' +
    wordOf(target) +
    selector.replace(/^0x/, '').padEnd(64, '0') +
    wordOf(reasonOffset.toString(16)) +
    wordOf(detailsOffset.toString(16)) +
    reasonBytes +
    bytesOf(details)
  );
}

// --------------------------------------------------------------------------- //
// Revert unwrapping
// --------------------------------------------------------------------------- //

describe('unwrapRevert', () => {
  test('unwraps the textual WrappedError forge prints down to the hook’s own Error(string)', () => {
    const revert = unwrapRevert(SETUP_FAILURE_REASON);
    assert.equal(revert.callback, 'beforeAddLiquidity');
    assert.equal(revert.callbackSelector, '0x259982e5');
    assert.equal(revert.selector, '0x08c379a0');
    assert.equal(revert.message, 'Error("No v4 Liquidity allowed")');
    assert.equal(
      describeRevert(revert),
      'beforeAddLiquidity (0x259982e5) reverted with Error("No v4 Liquidity allowed")',
    );
  });

  test('decodes raw WrappedError calldata the same way', () => {
    const raw = wrappedError('0x4444000000000000000000000000000000000888', '0x575e24b4', errorString('nope'));
    const revert = unwrapRevert(raw);
    assert.equal(revert.callback, 'beforeSwap');
    assert.equal(revert.message, 'Error("nope")');
    assert.equal(revert.raw, raw);
  });

  test('names the outermost callback when wrappers nest', () => {
    // The hook’s beforeRemoveLiquidity called something that itself reverted
    // with a custom error; the PoolManager wrapped the hook, the hook wrapped
    // its callee. The callback a reader needs is the outer one.
    const inner = wrappedError('0x1111111111111111111111111111111111111111', '0xabcdef01', '0xdeadbeef');
    const outer = wrappedError('0x4444000000000000000000000000000000000888', '0x21d0ee70', inner);
    const revert = unwrapRevert(outer);
    assert.equal(revert.callback, 'beforeRemoveLiquidity');
    assert.equal(revert.callbackSelector, '0x21d0ee70');
    assert.equal(revert.selector, '0xdeadbeef');
    assert.equal(revert.message, 'custom error 0xdeadbeef');
  });

  test('decodes Panic(uint256) with its meaning', () => {
    const revert = unwrapRevert(wrappedError('0x4444000000000000000000000000000000000888', '0xb47b2fb1', panic(0x11)));
    assert.equal(revert.callback, 'afterSwap');
    assert.equal(revert.message, 'Panic(0x11: arithmetic overflow or underflow)');
  });

  test('shows the four-byte selector for an unknown custom error', () => {
    const revert = unwrapRevert('0xdeadbeef');
    assert.equal(revert.selector, '0xdeadbeef');
    assert.equal(revert.message, 'custom error 0xdeadbeef');
    assert.equal(revert.callback, undefined);
  });

  test('reports a revert with no data as such rather than as an empty string', () => {
    assert.equal(unwrapRevert('0x').message, 'reverted without data');
  });

  test('passes through text forge already decoded', () => {
    const revert = unwrapRevert('revert: TwinPools: hook constructor reverted');
    assert.equal(revert.message, 'revert: TwinPools: hook constructor reverted');
    assert.equal(revert.selector, undefined);
  });
});

// --------------------------------------------------------------------------- //
// Translation
// --------------------------------------------------------------------------- //

describe('translate', () => {
  test('a setUp failure is a harness failure with every invariant inconclusive', () => {
    // Before this, the setUp row was ignored and the CLI logged "0
    // invariant(s), 0 failed" with status ok — the exact output of a clean hook.
    const result = translate(
      report({ 'setUp()': { status: 'Failure', reason: SETUP_FAILURE_REASON, kind: {} } }),
      { customCurve: true },
    );
    assert.equal(result.status, 'failed');
    assert.match(result.reason ?? '', /harness setUp failed/);
    assert.match(result.reason ?? '', /beforeAddLiquidity \(0x259982e5\) reverted with Error\("No v4 Liquidity allowed"\)/);
    assert.match(result.reason ?? '', /HR-E304/);
    assert.deepEqual(
      result.invariants.map((i) => [i.id, i.status]),
      [['I1', 'inconclusive'], ['I2', 'inconclusive'], ['I3', 'inconclusive']],
    );
    for (const invariant of result.invariants) {
      assert.equal(invariant.detail, result.reason);
      assert.equal(invariant.counterexample?.revertSelector, '0x08c379a0');
    }
  });

  test('no invariant rows at all is a failure, never ok', () => {
    for (const fixture of [{}, report({}), report({ 'setUp()': { status: 'Success' } })]) {
      const result = translate(fixture, { customCurve: false });
      assert.equal(result.status, 'failed', JSON.stringify(fixture));
      assert.match(result.reason ?? '', /no invariant results/);
      assert.equal(result.invariants.length, 3);
      assert.ok(result.invariants.every((i) => i.status === 'inconclusive'));
    }
  });

  test('all passing rows become three passed invariants with their statistics', () => {
    const result = translate(report(ALL_PASS), { customCurve: false });
    assert.equal(result.status, 'ok');
    assert.deepEqual(
      result.invariants.map((i) => [i.id, i.status, i.runs, i.calls]),
      [['I1', 'passed', 256, 8192], ['I2', 'passed', 256, 8192], ['I3', 'passed', 256, 8192]],
    );
  });

  test('without a custom curve, I2 is the output comparison and I2b is discarded', () => {
    const result = translate(report(ALL_PASS), { customCurve: false });
    const i2 = result.invariants.find((i) => i.id === 'I2')!;
    assert.equal(i2.name, 'No undeclared extraction');
    assert.equal(i2.detail, undefined);
  });

  test('with a custom curve, I2b takes I2’s place and says why', () => {
    const result = translate(report(ALL_PASS), { customCurve: true });
    const i2 = result.invariants.find((i) => i.id === 'I2')!;
    assert.equal(i2.name, 'Price monotonicity (custom curve)');
    assert.match(i2.detail ?? '', /does not apply to a custom-curve hook/);
  });

  test('a vacuous I2b pass cannot leak into a non-custom-curve result', () => {
    // I2 proper failed; I2b (which the harness skips but forge still lists)
    // passed. Failure must dominate the merge.
    const rows = {
      ...ALL_PASS,
      'invariant_I2_noUndeclaredExtraction()': invariantRow('Failure', {
        reason: 'shortfall 350 bips exceeds declared 100 bips',
      }),
    };
    const result = translate(report(rows), { customCurve: false });
    const i2 = result.invariants.find((i) => i.id === 'I2')!;
    assert.equal(i2.status, 'failed');
    assert.match(i2.detail ?? '', /350 bips/);
  });

  test('a failed invariant carries the unwrapped hook revert and its selector', () => {
    const reason = wrappedError('0x4444000000000000000000000000000000000888', '0x21d0ee70', errorString('locked'));
    const rows = {
      ...ALL_PASS,
      'invariant_I3_noExitReverted()': invariantRow('Failure', { reason, counterexample: 'seq' }),
    };
    const result = translate(report(rows), { customCurve: false });
    const i3 = result.invariants.find((i) => i.id === 'I3')!;
    assert.equal(i3.status, 'failed');
    assert.match(i3.detail ?? '', /beforeRemoveLiquidity \(0x21d0ee70\) reverted with Error\("locked"\)/);
    assert.equal(i3.counterexample?.revertSelector, '0x08c379a0');
    assert.equal(i3.counterexample?.revertRaw, 'seq');
  });

  test('when the hook refused PoolManager liquidity and has no custom curve, I2 and I3 are not-applicable', () => {
    const result = translate(report(ALL_PASS), {
      customCurve: false,
      seeded: 'hooked-failed',
      hookedSeedRevert: SETUP_FAILURE_REASON,
    });
    assert.equal(result.status, 'ok');
    const [i1, i2, i3] = result.invariants;
    assert.equal(i1!.status, 'passed', 'I1 is still reported: tokens may have moved during the attempt');
    assert.equal(i2!.status, 'not-applicable');
    assert.equal(i3!.status, 'not-applicable');
    assert.match(i2!.detail ?? '', /rejected the harness's initial PoolManager liquidity/);
    assert.match(i2!.detail ?? '', /beforeAddLiquidity \(0x259982e5\)/);
    assert.equal(i2!.runs, undefined, 'a not-applicable invariant must not carry run statistics as if it ran');
  });

  test('a custom-curve hook that refused PoolManager liquidity is still fully assessed', () => {
    const result = translate(report(ALL_PASS), { customCurve: true, seeded: 'hooked-failed' });
    assert.deepEqual(
      result.invariants.map((i) => i.status),
      ['passed', 'passed', 'passed'],
    );
  });

  test('forge’s Skipped status is reported as skipped, not passed', () => {
    const rows = { ...ALL_PASS, 'invariant_I3_noExitReverted()': invariantRow('Skipped') };
    const result = translate(report(rows), { customCurve: false });
    assert.equal(result.invariants.find((i) => i.id === 'I3')!.status, 'skipped');
  });
});

// --------------------------------------------------------------------------- //
// Observation log: a pass over nothing is not a pass
// --------------------------------------------------------------------------- //

/** Verbatim lines from HarnessValidation.t.sol: a busy sequence and an idle one. */
const BUSY_LINE =
  '{"swapsExecuted":3,"swapsCompared":3,"swapsSkipped":0,"hookedSwapReverted":false,"positionsOpened":1,' +
  '"positionsClosed":1,"donations":1,"priceChecks":3,"monotonicityViolations":0,"exitFailures":0}';
const IDLE_LINE =
  '{"swapsExecuted":0,"swapsCompared":0,"swapsSkipped":0,"hookedSwapReverted":true,"positionsOpened":0,' +
  '"positionsClosed":0,"donations":0,"priceChecks":0,"monotonicityViolations":0,"exitFailures":0}';

const zero: Observations = {
  swapsExecuted: 0, swapsCompared: 0, swapsSkipped: 0, hookedSwapReverted: 0, positionsOpened: 0,
  positionsClosed: 0, donations: 0, priceChecks: 0, monotonicityViolations: 0, exitFailures: 0,
};
const observed = (totals: Partial<Observations>, sequences = 1280) => ({ sequences, totals: { ...zero, ...totals } });

describe('parseObservations', () => {
  test('sums the lines, counts booleans, and ignores the padding blank lines the harness leaves', () => {
    const log = parseObservations(`${BUSY_LINE}\n\n${IDLE_LINE}\n\n${BUSY_LINE}\n\n`);
    assert.equal(log.sequences, 3);
    assert.deepEqual(log.totals, {
      ...zero,
      swapsExecuted: 6, swapsCompared: 6, hookedSwapReverted: 1, positionsOpened: 2, positionsClosed: 2,
      donations: 2, priceChecks: 6,
    });
  });

  test('an empty log is zero sequences, not an error', () => {
    assert.deepEqual(parseObservations(''), { sequences: 0, totals: zero });
  });

  test('a line the CLI cannot read is refused with its number, never skipped', () => {
    assert.throws(() => parseObservations(`${BUSY_LINE}\n{"swapsExecuted":1}\n`), /line 2: swapsCompared is undefined/);
    assert.throws(() => parseObservations('{"swapsExecuted":-1'), /line 1 is not JSON/);
    assert.throws(() => parseObservations(BUSY_LINE.replace('"swapsCompared":3', '"swapsCompared":"3"')), /swapsCompared is "3"/);
  });
});

describe('translate with observations', () => {
  const noObs = { customCurve: false, observations: observed({}) };

  test('an all-passing report over sequences that exercised nothing is inconclusive on every invariant', () => {
    // The Orbital shape before this existed: I1/I2/I3 passed on a pool that
    // never traded, indistinguishable from a hook the harness had exercised.
    const result = translate(report(ALL_PASS), noObs);
    assert.equal(result.status, 'ok', 'the harness ran; it is the invariants that measured nothing');
    assert.deepEqual(result.invariants.map((i) => i.status), ['inconclusive', 'inconclusive', 'inconclusive']);
    const [i1, i2, i3] = result.invariants;
    assert.match(i1!.detail ?? '', /^inconclusive, nothing relevant was observed: 0 swaps landed and 0 positions opened across 1280 sequences/);
    assert.match(i2!.detail ?? '', /^inconclusive, nothing relevant was observed: 0 swaps compared across 1280 sequences/);
    assert.match(i3!.detail ?? '', /^inconclusive, nothing relevant was observed: 0 positions opened across 1280 sequences/);
    assert.match(i3!.detail ?? '', /Observed: 1280 sequence\(s\), 0 swap\(s\) landed/);
  });

  test('sequences that did exercise the hook leave the passes alone', () => {
    const result = translate(report(ALL_PASS), {
      customCurve: false,
      observations: observed({ swapsExecuted: 5000, swapsCompared: 4900, positionsOpened: 300, positionsClosed: 300 }),
    });
    assert.deepEqual(result.invariants.map((i) => i.status), ['passed', 'passed', 'passed']);
    assert.equal(result.invariants[1]!.detail, undefined);
  });

  test('each invariant is judged by its own relevant count', () => {
    const swapsOnly = translate(report(ALL_PASS), {
      customCurve: false,
      observations: observed({ swapsExecuted: 10, swapsCompared: 10 }),
    });
    assert.deepEqual(swapsOnly.invariants.map((i) => i.status), ['passed', 'passed', 'inconclusive']);

    const positionsOnly = translate(report(ALL_PASS), {
      customCurve: false,
      observations: observed({ positionsOpened: 4, positionsClosed: 4 }),
    });
    assert.deepEqual(positionsOnly.invariants.map((i) => i.status), ['passed', 'inconclusive', 'passed']);
  });

  test('a custom curve is judged by price checks, not compared swaps', () => {
    const checked = translate(report(ALL_PASS), {
      customCurve: true,
      observations: observed({ swapsExecuted: 10, priceChecks: 10 }),
    });
    assert.equal(checked.invariants[1]!.status, 'passed');

    const unchecked = translate(report(ALL_PASS), { customCurve: true, observations: observed({ swapsExecuted: 10 }) });
    assert.equal(unchecked.invariants[1]!.status, 'inconclusive');
    assert.match(unchecked.invariants[1]!.detail ?? '', /^inconclusive, nothing relevant was observed: 0 price checks/);
    assert.match(unchecked.invariants[1]!.detail ?? '', /price monotonicity was asserted instead/, 'the custom-curve note is kept');
  });

  test('the Orbital case: custom curve, seed rejected, every hooked swap reverted', () => {
    const result = translate(report(ALL_PASS), {
      customCurve: true,
      seeded: 'hooked-failed',
      hookedSeedRevert: SETUP_FAILURE_REASON,
      observations: observed({ hookedSwapReverted: 1280 }),
    });
    assert.deepEqual(result.invariants.map((i) => i.status), ['inconclusive', 'inconclusive', 'inconclusive']);
    const i1 = result.invariants[0]!;
    assert.match(i1.detail ?? '', /the hook rejected PoolManager liquidity \(beforeAddLiquidity \(0x259982e5\) reverted with Error\("No v4 Liquidity allowed"\)\) so the pool never traded/);
    assert.match(i1.detail ?? '', /reverted with it in 1280 sequence\(s\)/);
  });

  test('a failure is evidence whatever the counters say', () => {
    const rows = { ...ALL_PASS, 'invariant_I3_noExitReverted()': invariantRow('Failure', { reason: 'trapped' }) };
    const result = translate(report(rows), noObs);
    assert.equal(result.invariants[2]!.status, 'failed');
  });

  test('not-applicable rows from a rejected seed are not re-labelled', () => {
    const result = translate(report(ALL_PASS), { ...noObs, seeded: 'hooked-failed' });
    assert.deepEqual(result.invariants.map((i) => i.status), ['inconclusive', 'not-applicable', 'not-applicable']);
  });

  test('without an observation log the old behaviour is kept, so the pre-log harness still reads', () => {
    const result = translate(report(ALL_PASS), { customCurve: false });
    assert.deepEqual(result.invariants.map((i) => i.status), ['passed', 'passed', 'passed']);
  });
});

// --------------------------------------------------------------------------- //
// Constructor arguments
// --------------------------------------------------------------------------- //

describe('encodeConstructorArgs', () => {
  const manager: AbiInput = { name: '_poolManager', type: 'address', internalType: 'contract IPoolManager' };
  const fee: AbiInput = { name: '_fee', type: 'uint24', internalType: 'uint24' };
  const owner: AbiInput = { name: '_owner', type: 'address', internalType: 'address' };

  function fakeCast(result: Partial<ExecResult> = {}) {
    const calls: Array<{ signature: string; values: string[] }> = [];
    const run = async (signature: string, values: string[]): Promise<ExecResult> => {
      calls.push({ signature, values });
      return { code: 0, stdout: '0xencoded\n', stderr: '', ...result };
    };
    return { run, calls };
  }

  test('a constructor with no arguments needs nothing', async () => {
    const cast = fakeCast();
    assert.deepEqual(await encodeConstructorArgs('V2PairHook', [], undefined, cast.run), { encoded: '' });
    assert.equal(cast.calls.length, 0);
  });

  test('a single IPoolManager is the placeholder word, without spawning cast', async () => {
    const cast = fakeCast();
    const result = await encodeConstructorArgs('CleanHook', [manager], undefined, cast.run);
    assert.deepEqual(result, {
      encoded: '0x000000000000000000000000000000000000000000000000000000c0ffee0001',
    });
    assert.equal(cast.calls.length, 0);
  });

  test('a single plain address is treated as the PoolManager too', async () => {
    const result = await encodeConstructorArgs('Hook', [{ type: 'address' }], undefined, fakeCast().run);
    assert.ok('encoded' in result);
  });

  test('a single address of some other contract type is not guessed', async () => {
    const wsteth: AbiInput = { name: '_wsteth', type: 'address', internalType: 'contract IWstETH' };
    const result = await encodeConstructorArgs('WstETHHook', [wsteth], undefined, fakeCast().run);
    assert.ok('reason' in result);
    assert.match(result.reason, /address _wsteth/);
    assert.match(result.reason, /\[harness\] constructorArgs/);
  });

  test('more than one argument without configuration is a precise, actionable skip', async () => {
    // The message that motivated this: a 0-arg hook was told "additional
    // constructor arguments are not supported".
    const result = await encodeConstructorArgs('FeeHook', [manager, fee, owner], undefined, fakeCast().run);
    assert.ok('reason' in result);
    assert.match(result.reason, /takes 3 argument\(s\) \(address _poolManager, uint24 _fee, address _owner\)/);
    assert.match(result.reason, /\[harness\] constructorArgs/);
    assert.match(result.reason, /\$poolManager, \$currency0, \$currency1, \$owner, \$hook/);
    assert.match(result.reason, /HR-E305/);
  });

  test('a configured count that disagrees with the ABI is rejected before cast runs', async () => {
    const cast = fakeCast();
    const result = await encodeConstructorArgs('FeeHook', [manager, fee], ['$poolManager'], cast.run);
    assert.ok('reason' in result);
    assert.match(result.reason, /has 1 value\(s\) but FeeHook's constructor takes 2 \(address _poolManager, uint24 _fee\)/);
    assert.equal(cast.calls.length, 0);
  });

  test('placeholders are substituted and everything else reaches cast verbatim', async () => {
    const cast = fakeCast({ stdout: '0x00aa\n' });
    const result = await encodeConstructorArgs('FeeHook', [manager, fee, owner], ['$poolManager', '3000', '$owner'], cast.run);
    assert.deepEqual(result, { encoded: '0x00aa' });
    assert.deepEqual(cast.calls, [
      {
        signature: 'constructor(address,uint24,address)',
        values: [PLACEHOLDERS.$poolManager, '3000', PLACEHOLDERS.$owner],
      },
    ]);
  });

  test('configuration takes precedence over the single-argument shortcut', async () => {
    const cast = fakeCast({ stdout: '0x00bb' });
    const result = await encodeConstructorArgs('Hook', [owner], ['0x1111111111111111111111111111111111111111'], cast.run);
    assert.deepEqual(result, { encoded: '0x00bb' });
    assert.equal(cast.calls.length, 1);
  });

  test('a cast failure is reported with cast’s own message, not swallowed', async () => {
    const cast = fakeCast({
      code: 1,
      stdout: '',
      stderr: 'Error: Could not ABI encode the function and arguments: parser error:\n0xnotanaddress\ninvalid string length',
    });
    const result = await encodeConstructorArgs('FeeHook', [manager, fee], ['0xnotanaddress', '1'], cast.run);
    assert.ok('reason' in result);
    assert.match(result.reason, /cast abi-encode "constructor\(address,uint24\)"/);
    assert.match(result.reason, /invalid string length/);
  });

  test('cast printing something that is not hex is a failure too', async () => {
    const cast = fakeCast({ stdout: 'warning: something\n' });
    const result = await encodeConstructorArgs('FeeHook', [manager, fee], ['$poolManager', '1'], cast.run);
    assert.ok('reason' in result);
  });

  test('struct arguments are declared unsupported rather than mis-encoded', async () => {
    const params: AbiInput = { name: 'params', type: 'tuple', internalType: 'struct Hook.Params' };
    const result = await encodeConstructorArgs('Hook', [manager, params], ['$poolManager', '(1,2)'], fakeCast().run);
    assert.ok('reason' in result);
    assert.match(result.reason, /struct argument \(tuple params\)/);
  });
});

// --------------------------------------------------------------------------- //
// Project resolution
// --------------------------------------------------------------------------- //

function scratchProject(): string {
  return mkdtempSync(join(tmpdir(), 'hookrisk-harness-test-'));
}

function writeArtifact(dir: string, file: string, name: string, extra: Record<string, unknown> = {}): string {
  mkdirSync(join(dir, file), { recursive: true });
  const path = join(dir, file, name);
  writeFileSync(
    path,
    JSON.stringify({
      abi: [{ type: 'constructor', inputs: [{ name: '_pm', type: 'address', internalType: 'contract IPoolManager' }] }],
      bytecode: { object: '6001' },
      deployedBytecode: { object: '0x6002' },
      metadata: { compiler: { version: '0.8.29+commit.ab55807c' } },
      ...extra,
    }),
  );
  return path;
}

describe('locateArtifact', () => {
  test('finds the plain artifact name', () => {
    const root = scratchProject();
    const path = writeArtifact(join(root, 'out'), 'MyHook.sol', 'MyHook.json');
    assert.deepEqual(locateArtifact(join(root, 'out'), 'src/MyHook.sol', 'MyHook', '0.8.26', root, 'out'), { path });
  });

  test('accepts forge’s per-version name when there is exactly one', () => {
    const root = scratchProject();
    const path = writeArtifact(join(root, 'foundry-out'), 'MyHook.sol', 'MyHook.0.8.26.json');
    const result = locateArtifact(join(root, 'foundry-out'), 'src/MyHook.sol', 'MyHook', null, root, 'foundry-out');
    assert.deepEqual(result, { path });
  });

  test('picks the pinned solc among several per-version artifacts, and refuses to guess otherwise', () => {
    const root = scratchProject();
    const dir = join(root, 'out');
    writeArtifact(dir, 'MyHook.sol', 'MyHook.0.8.26.json');
    const wanted = writeArtifact(dir, 'MyHook.sol', 'MyHook.0.8.29.json');
    assert.deepEqual(locateArtifact(dir, 'src/MyHook.sol', 'MyHook', '0.8.29', root, 'out'), { path: wanted });

    const ambiguous = locateArtifact(dir, 'src/MyHook.sol', 'MyHook', null, root, 'out');
    assert.ok('reason' in ambiguous);
    assert.match(ambiguous.reason, /several solc versions \(MyHook\.0\.8\.26\.json, MyHook\.0\.8\.29\.json\)/);
  });

  test('a missing artifact names the directory forge actually uses', () => {
    const root = scratchProject();
    const result = locateArtifact(join(root, 'foundry-out'), 'src/MyHook.sol', 'MyHook', null, root, 'foundry-out');
    assert.ok('reason' in result);
    assert.match(result.reason, /out = "foundry-out"/);
    assert.match(result.reason, /forge build/);
  });
});

describe('resolveProject', () => {
  test('takes out and solc from forge config, and solc from the artifact when forge has none', async () => {
    const root = scratchProject();
    writeArtifact(join(root, 'foundry-out'), 'MyHook.sol', 'MyHook.json');
    const project = await resolveProject(root, 'src/MyHook.sol', 'MyHook', async () => ({
      out: 'foundry-out',
      solc: null,
    }));
    assert.equal(project.configSource, 'forge-config');
    assert.equal(project.artifactDir, join(root, 'foundry-out'));
    assert.equal(project.solcVersion, '0.8.29');
    assert.equal(project.solcSource, 'artifact-metadata');
    assert.ok(project.artifactPath?.endsWith('MyHook.json'));
    assert.deepEqual(project.notes, []);
  });

  test('prefers forge’s pinned solc over the artifact’s', async () => {
    const root = scratchProject();
    writeArtifact(join(root, 'out'), 'MyHook.sol', 'MyHook.json');
    const project = await resolveProject(root, 'src/MyHook.sol', 'MyHook', async () => ({ out: 'out', solc: '0.8.26' }));
    assert.equal(project.solcVersion, '0.8.26');
    assert.equal(project.solcSource, 'forge-config');
  });

  test('falls back to out/ and 0.8.26 when forge config fails, and says so', async () => {
    const root = scratchProject();
    const project = await resolveProject(root, 'src/MyHook.sol', 'MyHook', async () => {
      throw new Error('forge: command not found');
    });
    assert.equal(project.configSource, 'fallback');
    assert.equal(project.artifactDir, join(root, 'out'));
    assert.equal(project.solcVersion, '0.8.26');
    assert.equal(project.solcSource, 'fallback');
    assert.match(project.notes.join('\n'), /forge config.*failed.*forge: command not found/);
    assert.match(project.artifactReason ?? '', /does not exist/);
  });
});

describe('readArtifact', () => {
  test('returns creation and runtime code with the 0x prefix normalised', () => {
    const root = scratchProject();
    const path = writeArtifact(join(root, 'out'), 'MyHook.sol', 'MyHook.json');
    const artifact = readArtifact(path, 'MyHook');
    assert.ok(!('reason' in artifact));
    assert.equal(artifact.creationCode, '0x6001');
    assert.equal(artifact.runtimeCode, '0x6002');
    assert.equal(artifact.constructorInputs.length, 1);
  });

  test('an abstract contract is refused with its reason', () => {
    const root = scratchProject();
    const path = writeArtifact(join(root, 'out'), 'Base.sol', 'Base.json', { bytecode: { object: '0x' } });
    const artifact = readArtifact(path, 'Base');
    assert.ok('reason' in artifact);
    assert.match(artifact.reason, /no creation bytecode/);
  });
});

// --------------------------------------------------------------------------- //
// Run record and permissions
// --------------------------------------------------------------------------- //

describe('parseRunRecord', () => {
  test('accepts the shape the harness writes', () => {
    const record = parseRunRecord(
      '{"flags": 2184, "customCurve": true, "dynamicFee": false, "permissionsDerived": true, "seeded": "hooked-failed", "hookedSeedRevert": "0x90bfb865"}',
    );
    assert.deepEqual(record, {
      flags: 2184,
      customCurve: true,
      dynamicFee: false,
      permissionsDerived: true,
      seeded: 'hooked-failed',
      hookedSeedRevert: '0x90bfb865',
    });
  });

  test('rejects a record it cannot trust, since a wrong seeded value changes which invariants apply', () => {
    assert.throws(() => parseRunRecord('{"flags": 1, "customCurve": true, "dynamicFee": false, "permissionsDerived": true, "seeded": "maybe"}'), /seeded/);
    assert.throws(() => parseRunRecord('{"flags": 1, "dynamicFee": false, "permissionsDerived": true, "seeded": "both"}'), /customCurve/);
    assert.throws(() => parseRunRecord('{"flags": -1, "customCurve": true, "dynamicFee": false, "permissionsDerived": true, "seeded": "both"}'), /flags/);
    assert.throws(() => parseRunRecord('not json'));
  });

  /** Verbatim from `EoaGuardProbeIsRight.test_runFileCarriesTheProbes` in HarnessValidation.t.sol. */
  const WITH_PROBES =
    '{"flags":192,"customCurve":false,"dynamicFee":false,"permissionsDerived":false,"seeded":"both","hookedSeedRevert":"",' +
    '"probes":{"eoaGuard":{"beforeSwap":"guarded","afterSwap":"unguarded"},"exclusivity":"accepted","selectors":{"beforeSwap":"ok","afterSwap":"ok"}}}';

  test('reads the probes object the harness writes, per callback', () => {
    const record = parseRunRecord(WITH_PROBES);
    assert.deepEqual(record.probes, {
      eoaGuard: { beforeSwap: 'guarded', afterSwap: 'unguarded' },
      exclusivity: 'accepted',
      selectors: { beforeSwap: 'ok', afterSwap: 'ok' },
    });
  });

  test('a record without probes is the pre-probe shape, not an error', () => {
    const record = parseRunRecord('{"flags": 1, "customCurve": true, "dynamicFee": false, "permissionsDerived": true, "seeded": "both"}');
    assert.equal(record.probes, undefined);
  });

  test('carries the exclusivity reason and the selector reverts when present', () => {
    const record = parseRunRecord(
      '{"flags":2184,"customCurve":true,"dynamicFee":false,"permissionsDerived":false,"seeded":"hooked-failed","hookedSeedRevert":"0x",' +
        '"probes":{"eoaGuard":{"beforeAddLiquidity":"guarded","beforeSwap":"guarded"},"exclusivity":"not-applicable",' +
        '"exclusivityReason":"a second pool with the same hook would not initialise: 0xebdb4fd9",' +
        '"selectors":{"beforeAddLiquidity":"reverted","beforeSwap":"reverted"},"selectorReverts":{"beforeAddLiquidity":"0x2f5a2b6e","beforeSwap":"0x08c379a0"}}}',
    );
    assert.equal(record.probes?.exclusivityReason, 'a second pool with the same hook would not initialise: 0xebdb4fd9');
    assert.deepEqual(record.probes?.selectorReverts, { beforeAddLiquidity: '0x2f5a2b6e', beforeSwap: '0x08c379a0' });
  });

  test('refuses a verdict, a callback name or a shape it does not know, so a new harness word cannot read as clean', () => {
    const base = '{"flags":1,"customCurve":false,"dynamicFee":false,"permissionsDerived":false,"seeded":"both","hookedSeedRevert":"","probes":';
    assert.throws(() => parseRunRecord(`${base}{"eoaGuard":{"beforeSwap":"maybe"},"exclusivity":"accepted","selectors":{}}}`), /probes\.eoaGuard\.beforeSwap is "maybe"/);
    assert.throws(() => parseRunRecord(`${base}{"eoaGuard":{},"exclusivity":"unknown","selectors":{}}}`), /probes\.exclusivity is "unknown"/);
    assert.throws(() => parseRunRecord(`${base}{"eoaGuard":{},"exclusivity":"accepted","selectors":{"beforeSwap":"fine"}}}`), /probes\.selectors\.beforeSwap is "fine"/);
    assert.throws(() => parseRunRecord(`${base}{"eoaGuard":{"unlockCallback":"guarded"},"exclusivity":"accepted","selectors":{}}}`), /unknown callback "unlockCallback"/);
    assert.throws(() => parseRunRecord(`${base}{"eoaGuard":[],"exclusivity":"accepted","selectors":{}}}`), /probes\.eoaGuard is \[\]/);
    assert.throws(() => parseRunRecord(`${base}{"exclusivity":"accepted","selectors":{}}}`), /probes\.eoaGuard/);
    assert.throws(() => parseRunRecord(`${base}{"eoaGuard":{},"exclusivity":"accepted","selectors":{},"selectorReverts":{"beforeSwap":"nothex"}}}`), /selectorReverts\.beforeSwap/);
    assert.throws(() => parseRunRecord(`${base}"yes"}`), /probes is "yes"/);
  });

  test('summariseProbes leads with the bad news', () => {
    const record = parseRunRecord(WITH_PROBES);
    assert.equal(summariseProbes(record.probes!), 'unguarded: afterSwap; selectors ok; exclusivity accepted');
    assert.equal(
      summariseProbes({ eoaGuard: { beforeSwap: 'guarded' }, exclusivity: 'rejected', selectors: { beforeSwap: 'wrong-selector' } }),
      'eoa guard held on 1 callback(s); selectors: beforeSwap=wrong-selector; exclusivity rejected',
    );
  });
});

describe('permissionsFrom', () => {
  test('round-trips with flagsFrom', () => {
    const permissions = permissionsFrom(0xac0);
    assert.equal(permissions.beforeAddLiquidity, true);
    assert.equal(permissions.beforeRemoveLiquidity, true);
    assert.equal(permissions.beforeSwap, true);
    assert.equal(permissions.afterSwap, true);
    assert.equal(permissions.beforeInitialize, false);
    assert.equal(Object.keys(permissions).length, 14);
    assert.equal(flagsFrom(permissions), 0xac0);
  });
});
