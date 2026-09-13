/**
 * Tests for the Slither adapter.
 *
 * The adapter's job is to make sure nothing Slither does quietly turns into a
 * clean-looking result. Each test here pins one way that used to happen: a
 * failure with no reason, an IR-lifting gap that never reached the manifest, a
 * target the detectors never recognised, a neighbour's findings vanishing
 * without a trace, or a detector drifting from the engine contract and its
 * results either being admitted unplaceable or dropped without a word. Slither
 * itself is replaced by an `exec` that returns fixture output captured from
 * real runs.
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';

import { describeFailure, mostInformativeLine } from '../errors.js';
import type { EngineContext } from '../types.js';
import {
  type EngineMetadata,
  type ExecFn,
  SlitherEngine,
  type SlitherDetectorResult,
  collectUncovered,
  coverageOf,
  describeSlitherFailure,
  metadataErrors,
  normalise,
  partitionByTarget,
  scopeOf,
  targetPermissions,
} from './slither.js';

// --------------------------------------------------------------------------- //
// Fixtures
// --------------------------------------------------------------------------- //

/** What `slither . --json <file>` printed for a hook that does not compile (ref-fee-hook). */
const COMPILE_FAILURE_STDOUT = [
  "'forge clean' running (wd: /work/ref-fee-hook)",
  "'forge config --json' running",
  "'forge build --build-info --deny never --skip ./test/** ./script/** --force' running (wd: /work/ref-fee-hook)",
  "'forge' returned non-zero exit code 1",
  'Compiling 28 files with Solc 0.8.30',
  'stdout: Solc 0.8.30 finished in 39.93ms',
  'Error: Compiler run failed:',
  'stderr: Error (7920): Identifier not found or not unique.',
  'stderr:    --> src/RefHook.sol:144:59:',
  'stderr:     |',
  'stderr: 144 |     function claimRefLinkFees(bytes32 refCode, PoolId id, Currency[] calldata currencies) exte',
  '',
].join('\n');

const COMPILE_FAILURE_STDERR = [
  'Traceback (most recent call last):',
  '  File "/venv/bin/slither", line 6, in <module>',
  '    sys.exit(main())',
  '             ~~~~^^',
  '  File "/venv/lib/python3.13/site-packages/crytic_compile/platform/hardhat.py", line 53, in hardhat_like_parsing',
  '    raise InvalidCompilation(txt)',
  'crytic_compile.platform.exceptions.InvalidCompilation: Compilation failed. Can you run build command?',
  '/work/ref-fee-hook/out/build-info is not a directory.',
  '',
].join('\n');

/** IR-lifting failures as Slither logs them (OpenZeppelin uniswap-hooks, AntiSandwich mock). */
const IR_FAILURES = [
  'ERROR:ContractSolcParsing:Impossible to generate IR for ReHypothecationHook._resolveHookDelta (src/general/ReHypothecationHook.sol#264-274):',
  'ERROR:ContractSolcParsing:Impossible to generate IR for ReHypothecationERC4626Mock._resolveHookDelta (src/general/ReHypothecationHook.sol#264-274):',
  'ERROR:ContractSolcParsing:Impossible to generate IR for ReHypothecationNativeMock._resolveHookDelta (src/general/ReHypothecationHook.sol#264-274):',
  // Slither logs the same function once per pass; it is one gap, not two.
  'ERROR:ContractSolcParsing:Impossible to generate IR for ReHypothecationHook._resolveHookDelta (src/general/ReHypothecationHook.sol#264-274):',
].join('\n');

function detectorResult(overrides: Partial<SlitherDetectorResult> & { check: string }): SlitherDetectorResult {
  return {
    impact: 'High',
    confidence: 'Medium',
    description: `${overrides.check} fired. Second sentence.\n`,
    elements: [
      {
        type: 'contract',
        name: 'MyHook',
        source_mapping: { filename_relative: 'src/MyHook.sol', lines: [18, 19, 20], is_dependency: false },
      },
    ],
    hookrisk: {
      version: '1',
      ruleClass: 'flag-implementation-divergence',
      informsDimensions: ['complexity'],
      informsTriggers: [],
      isClassification: false,
    } satisfies EngineMetadata,
    ...overrides,
  };
}

/** All fourteen fields, as the plugin resolves them. */
const PERMISSIONS: Record<string, boolean> = {
  beforeInitialize: false,
  afterInitialize: false,
  beforeAddLiquidity: false,
  afterAddLiquidity: false,
  beforeRemoveLiquidity: false,
  afterRemoveLiquidity: false,
  beforeSwap: true,
  afterSwap: true,
  beforeDonate: false,
  afterDonate: false,
  beforeSwapReturnDelta: false,
  afterSwapReturnDelta: false,
  afterAddLiquidityReturnDelta: false,
  afterRemoveLiquidityReturnDelta: false,
};

/** What `hookrisk-hook-profile` emitted for corpus/src/good/CleanHook.sol. */
/** `permissions: null` is a hook that declares no getHookPermissions(). */
const hookProfile = (contract = 'MyHook', file = 'src/MyHook.sol', permissions: Record<string, boolean> | null = PERMISSIONS): SlitherDetectorResult =>
  detectorResult({
    check: 'hookrisk-hook-profile',
    impact: 'Informational',
    confidence: 'High',
    description: `${contract} (${file}#18-20) is a recognised v4 hook: implements afterSwap, beforeSwap; declares 2 callback permission(s); 1 state write(s) reachable from callbacks; 0 external call(s) in the swap path.\n`,
    elements: [
      {
        type: 'contract',
        name: contract,
        source_mapping: { filename_relative: file, lines: [18, 19, 20], is_dependency: false },
      },
    ],
    hookrisk: {
      version: '1',
      ruleClass: 'hook-profile',
      informsDimensions: ['complexity'],
      informsTriggers: [],
      isClassification: true,
      metrics: {
        callbacksImplemented: 2,
        callbacksDeclared: 2,
        stateWritesInCallbacks: 1,
        externalCallsInSwapPath: 0, externalCallsInSwapPathThirdParty: 0,
        internalFunctionsReachableFromCallbacks: 2,
        usesReturnsDelta: false,
        hasOwnerOnlyFunctions: false,
      },
      ...(permissions ? { permissions } : {}),
      callbacks: ['afterSwap', 'beforeSwap'],
    } satisfies EngineMetadata,
  });

const hs02 = (discriminator: string): SlitherDetectorResult =>
  detectorResult({
    check: 'hookrisk-flag-divergence',
    description: `MyHook (src/MyHook.sol#18-20) declares permission \`${discriminator}\` but provides no working implementation.\n`,
    hookrisk: {
      version: '1',
      ruleClass: 'flag-implementation-divergence',
      informsDimensions: ['complexity'],
      informsTriggers: [],
      isClassification: false,
      discriminator,
    } satisfies EngineMetadata,
  });

const hs01 = (callback: string, file = 'src/MyHook.sol'): SlitherDetectorResult =>
  detectorResult({
    check: 'hookrisk-unprotected-callback',
    description: `MyHook.${callback}(address,PoolKey,bytes) (${file}#88-95) is an IHooks callback that never compares msg.sender against poolManager. Anyone can call it.\n`,
    elements: [
      {
        type: 'function',
        name: callback,
        source_mapping: { filename_relative: file, lines: [88, 95], is_dependency: false },
      },
    ],
    hookrisk: {
      version: '1',
      ruleClass: 'unprotected-hook-callback',
      informsDimensions: ['complexity'],
      informsTriggers: [],
      isClassification: false,
      discriminator: callback,
    } satisfies EngineMetadata,
  });

const unsupportedAbi = (): SlitherDetectorResult =>
  detectorResult({
    check: 'hookrisk-unsupported-abi',
    impact: 'Informational',
    description: 'MyHook (src/MyHook.sol#18-20) declares getHooksCalls() returning Hooks.Calls, the 2023 hook ABI, which hookrisk cannot analyse. No detector examined it.\n',
    hookrisk: {
      version: '1',
      ruleClass: 'unsupported-hook-abi',
      informsDimensions: [],
      informsTriggers: [],
      isClassification: true,
    } satisfies EngineMetadata,
  });

function report(detectors: SlitherDetectorResult[]): unknown {
  return { success: true, error: null, results: { detectors } };
}

interface FakeSlither {
  code: number;
  stdout?: string;
  stderr?: string;
  /** Written to the `--json` path when present, exactly as Slither would. */
  report?: unknown;
}

function fakeSlither(behaviour: FakeSlither): ExecFn {
  return async (_cmd, args) => {
    if (args[0] === '--version') return { code: 0, stdout: '0.11.6\n', stderr: '' };
    if (args[0] === '--list-detectors') {
      return { code: 0, stdout: 'hookrisk-unprotected-callback hookrisk-flag-divergence\n', stderr: '' };
    }
    const at = args.indexOf('--json');
    assert.ok(at >= 0 && args[at + 1] !== '-', 'the report must go to a file, never to stdout');
    if (behaviour.report !== undefined) writeFileSync(args[at + 1]!, JSON.stringify(behaviour.report));
    return { code: behaviour.code, stdout: behaviour.stdout ?? '', stderr: behaviour.stderr ?? '' };
  };
}

function context(log: string[]): EngineContext {
  return {
    projectRoot: tmpdir(),
    sourceFile: 'src/MyHook.sol',
    contractName: 'MyHook',
    solcVersion: '0.8.26',
    timeoutMs: 5_000,
    log: (m) => log.push(m),
  };
}

async function runWith(behaviour: FakeSlither): Promise<{ result: Awaited<ReturnType<SlitherEngine['run']>>; log: string[]; engine: SlitherEngine }> {
  const log: string[] = [];
  const engine = new SlitherEngine({ binary: 'slither', exec: fakeSlither(behaviour) });
  const result = await engine.run(context(log));
  return { result, log, engine };
}

// --------------------------------------------------------------------------- //
// Failure reasons
// --------------------------------------------------------------------------- //

describe('engine failure reasons', () => {
  test('a compile failure gets a catalogue code and the solc diagnostic, never an empty reason', async () => {
    const { result, log } = await runWith({ code: 1, stdout: COMPILE_FAILURE_STDOUT, stderr: COMPILE_FAILURE_STDERR });

    assert.equal(result.status, 'failed');
    assert.match(result.reason!, /^HR-E\d{3} /, 'the reason opens with a catalogue code');
    assert.ok(result.reason!.includes('Error (7920): Identifier not found or not unique.'), result.reason);
    assert.ok(result.reason!.includes('src/RefHook.sol:144:59'), 'the solc pointer is kept');
    assert.ok(!result.reason!.includes('File "'), 'traceback frames are not the reason');
    assert.ok(log.some((l) => l.startsWith('hookrisk: failed — HR-E')), 'the failure is logged, not just returned');
    assert.deepEqual(result.findings, []);
  });

  test('a run that writes nothing anywhere still says so, with the exit code', async () => {
    // What `--json -` produced on every compile failure: exit 1, both streams
    // empty, no report. The old reason was "could not parse Slither output: ".
    const { result } = await runWith({ code: 1 });

    assert.equal(result.status, 'failed');
    assert.ok(result.reason!.length > 0, 'never empty');
    assert.ok(result.reason!.includes('exited with code 1'), result.reason);
    assert.ok(result.reason!.includes('HR-E'), 'even the fallback carries a code');
  });

  test('a report that says success:false uses its own error text', async () => {
    const { result } = await runWith({
      code: 255,
      report: { success: false, error: 'Unknown detector: HS-99', results: {} },
    });

    assert.equal(result.status, 'failed');
    assert.ok(result.reason!.includes('Unknown detector: HS-99'), result.reason);
    assert.match(result.reason!, /^HR-E004 /, 'classified against the catalogue');
  });

  test('describeFailure prefers the solc diagnostic and falls back to the last three lines', () => {
    const classified = describeFailure(`${COMPILE_FAILURE_STDOUT}\n${COMPILE_FAILURE_STDERR}`);
    assert.match(classified, /^HR-E20\d .*: Error \(7920\)/);

    const unclassified = describeFailure('first\n\nsecond\nthird\nfourth\n');
    assert.equal(unclassified, 'second | third | fourth');

    assert.equal(describeFailure('   \n  '), 'the tool produced no output');
    assert.equal(describeSlitherFailure('', 137).length > 0, true);
  });

  test('mostInformativeLine skips traceback scaffolding and relay prefixes', () => {
    assert.equal(
      mostInformativeLine(COMPILE_FAILURE_STDERR),
      '/work/ref-fee-hook/out/build-info is not a directory.',
    );
    assert.equal(
      mostInformativeLine(COMPILE_FAILURE_STDOUT),
      'Error (7920): Identifier not found or not unique. --> src/RefHook.sol:144:59:',
    );
    assert.equal(mostInformativeLine(''), undefined);
  });
});

// --------------------------------------------------------------------------- //
// Coverage
// --------------------------------------------------------------------------- //

describe('coverage reporting', () => {
  test('IR-lifting failures are collected from whichever stream carries them', async () => {
    // With the report going to a file, Slither's logger writes to stdout; the
    // root logger (where ContractSolcParsing lives) writes to stderr. Both are
    // read, so the split cannot hide a gap.
    const { result, engine, log } = await runWith({ code: 255, stdout: IR_FAILURES, report: report([]) });

    assert.equal(result.status, 'ok');
    assert.equal(engine.uncoveredFunctions.length, 3, 'three contracts, one function each, duplicate collapsed');
    assert.deepEqual(
      engine.uncoveredFunctions.map((u) => `${u.contract}.${u.function}`),
      [
        'ReHypothecationHook._resolveHookDelta',
        'ReHypothecationERC4626Mock._resolveHookDelta',
        'ReHypothecationNativeMock._resolveHookDelta',
      ],
    );
    assert.ok(log.some((l) => l.includes('3 function(s) could not be lifted to IR')));
  });

  test('collectUncovered parses the location into the reason', () => {
    const [first] = collectUncovered(IR_FAILURES);
    assert.ok(first!.reason.includes('src/general/ReHypothecationHook.sol#264-274'));
    assert.deepEqual(collectUncovered(''), []);
  });

  test('an unsupported-hook-abi finding on the target marks it not covered, even next to a profile', async () => {
    // The `partial` shape: the plugin profiled the callbacks it could read and
    // disclaimed the rest. The disclaimer wins.
    const { result, log } = await runWith({ code: 255, report: report([unsupportedAbi(), hookProfile()]) });

    assert.equal(result.status, 'ok', 'the engine ran');
    assert.equal(result.targetCoverage?.covered, false, 'but it did not look');
    assert.ok(result.targetCoverage?.reason?.includes('MyHook'), result.targetCoverage?.reason);
    assert.ok(result.targetCoverage?.reason?.includes('2023 hook ABI'));
    assert.ok(log.some((l) => l.includes('did not analyse the target')));
    assert.equal(result.findings.length, 2, 'the classifications themselves are still reported');
    assert.ok(result.findings.every((f) => f.severity === 'info'));
    assert.equal(result.scope?.targetAnalysed, true, 'the scope records what the plugin said');
  });

  test('a target with a hook-profile is reported as covered', async () => {
    const { result } = await runWith({ code: 255, report: report([hookProfile(), hs02('beforeSwap')]) });
    assert.deepEqual(result.targetCoverage, { covered: true });
    assert.deepEqual(result.scope, { analysedContracts: ['src/MyHook.sol:MyHook'], targetAnalysed: true });
  });

  test('findings without a hook-profile for the target do not count as coverage', async () => {
    // Before the profile existed this shape read as "covered": an HS-02 on the
    // target proved the detectors looked. It still does — but the contract now
    // is that the plugin *says* what it analysed, and a plugin that did not is
    // a plugin the CLI cannot vouch for.
    const { result, log } = await runWith({ code: 255, report: report([hs02('beforeSwap')]) });
    assert.equal(result.targetCoverage?.covered, false);
    assert.ok(result.targetCoverage?.reason?.includes('no hook-profile for MyHook'), result.targetCoverage?.reason);
    assert.deepEqual(result.scope, { analysedContracts: [], targetAnalysed: false });
    assert.ok(log.some((l) => l.includes('did not analyse the target')));
  });

  test('a profile for a same-named contract in another file is not the target', async () => {
    const { result } = await runWith({
      code: 255,
      report: report([hookProfile('MyHook', 'src/other/MyHook.sol'), hookProfile('Neighbour', 'src/Neighbour.sol')]),
    });
    assert.equal(result.targetCoverage?.covered, false);
    assert.ok(result.targetCoverage?.reason?.includes('analysed 2 other contract(s)'), result.targetCoverage?.reason);
    assert.deepEqual(result.scope?.analysedContracts, ['src/Neighbour.sol:Neighbour', 'src/other/MyHook.sol:MyHook']);
    assert.equal(result.permissions, undefined, 'another contract’s permissions are not the target’s');
  });

  test('coverageOf is the single source of that judgement', () => {
    assert.equal(coverageOf([], 'X').covered, true, 'no scope: legacy callers keep the old answer');
    assert.equal(coverageOf([], 'X', { analysedContracts: [], targetAnalysed: true }).covered, true);
    assert.equal(coverageOf([], 'X', { analysedContracts: [], targetAnalysed: false }).covered, false);
    const unsupported = normalise(unsupportedAbi())!;
    assert.equal(coverageOf([unsupported], 'X', { analysedContracts: ['a:X'], targetAnalysed: true }).covered, false);
  });
});

// --------------------------------------------------------------------------- //
// The engine contract
// --------------------------------------------------------------------------- //

describe('engine metadata contract', () => {
  test('a result whose block fails the schema is dropped, named in the log and counted', async () => {
    const drifted = detectorResult({
      check: 'hookrisk-flag-divergence',
      hookrisk: { version: '2', ruleClass: 'flag-implementation-divergence', informsDimensions: [], informsTriggers: [], isClassification: false },
    });
    const invented = detectorResult({
      check: 'hookrisk-new-thing',
      hookrisk: { version: '1', ruleClass: 'brand-new-class', informsDimensions: [], informsTriggers: [], isClassification: false },
    });
    const forgot = detectorResult({ check: 'hookrisk-mystery', hookrisk: undefined });

    const { result, log } = await runWith({ code: 255, report: report([hookProfile(), drifted, invented, forgot, hs02('beforeSwap')]) });

    assert.equal(result.status, 'ok');
    assert.equal(result.invalidMetadata, 3);
    assert.deepEqual(
      result.findings.map((f) => f.ruleClass),
      ['hook-profile', 'flag-implementation-divergence'],
      'only conforming results are admitted',
    );
    const dropped = log.filter((l) => l.includes('dropped a result from'));
    assert.equal(dropped.length, 3);
    assert.ok(dropped.some((l) => l.includes('hookrisk-flag-divergence on MyHook') && l.includes('/version')), dropped.join('\n'));
    assert.ok(dropped.some((l) => l.includes('hookrisk-new-thing on MyHook') && l.includes('/ruleClass')), dropped.join('\n'));
    assert.ok(dropped.some((l) => l.includes('hookrisk-mystery on MyHook') && l.includes('no hookrisk metadata block')), dropped.join('\n'));
    assert.ok(log.some((l) => l.includes('3 result(s) dropped for invalid metadata')));
  });

  test('nothing dropped means no invalidMetadata field at all', async () => {
    const { result } = await runWith({ code: 255, report: report([hookProfile()]) });
    assert.equal(result.invalidMetadata, undefined);
  });

  test('metadataErrors names the violated path', () => {
    assert.deepEqual(metadataErrors(undefined), ['no hookrisk metadata block']);
    assert.deepEqual(metadataErrors(hookProfile().hookrisk), []);
    const badMetric = { ...(hookProfile().hookrisk as EngineMetadata) };
    badMetric.metrics = { ...badMetric.metrics!, callbacksDeclared: -1 };
    assert.ok(metadataErrors(badMetric).some((e) => e.startsWith('/metrics/callbacksDeclared')));
    const extra = { ...(hs02('beforeSwap').hookrisk as EngineMetadata), surprise: 1 };
    assert.ok(metadataErrors(extra).some((e) => e.includes('additional properties')));
  });

  test('the profile supplies the permission set and the analysed scope', async () => {
    const { result, log } = await runWith({ code: 255, report: report([hookProfile(), hs01('beforeSwap', 'src/Other.sol')]) });
    assert.deepEqual(result.permissions, PERMISSIONS);
    assert.deepEqual(result.scope, { analysedContracts: ['src/MyHook.sol:MyHook'], targetAnalysed: true });
    assert.ok(log.some((l) => l.includes('analysed 1 hook contract(s)') && l.includes('permissions resolved from the profile')));
  });

  test('a hook that declares no permissions yields a profile without them', async () => {
    const { result } = await runWith({ code: 255, report: report([hookProfile('MyHook', 'src/MyHook.sol', null)]) });
    assert.equal(result.permissions, undefined);
    assert.equal(result.targetCoverage?.covered, true, 'no permissions is still analysed');
    assert.equal(result.findings[0]!.permissions, undefined);
  });

  test('the profile stays in the findings as an INFO classification carrying its permissions and metrics', async () => {
    const { result } = await runWith({ code: 255, report: report([hookProfile()]) });
    const [profile] = result.findings;
    assert.equal(profile!.ruleClass, 'hook-profile');
    assert.equal(profile!.severity, 'info');
    assert.deepEqual(profile!.permissions, PERMISSIONS);
    assert.equal(profile!.metrics?.callbacksImplemented, 2);
    assert.equal(profile!.location?.file, 'src/MyHook.sol');
  });

  test('scopeOf and targetPermissions read the profile anchors', () => {
    const results = [hookProfile('A', 'src/A.sol'), hookProfile('B', 'src/B.sol'), hs02('beforeSwap')];
    assert.deepEqual(scopeOf(results, 'src/B.sol', 'B'), { analysedContracts: ['src/A.sol:A', 'src/B.sol:B'], targetAnalysed: true });
    assert.deepEqual(scopeOf(results, 'src/B.sol', 'A'), { analysedContracts: ['src/A.sol:A', 'src/B.sol:B'], targetAnalysed: false });
    assert.deepEqual(targetPermissions(results, 'src/A.sol', 'A'), PERMISSIONS);
    assert.equal(targetPermissions(results, 'src/C.sol', 'C'), undefined);
  });
});

// --------------------------------------------------------------------------- //
// Attribution
// --------------------------------------------------------------------------- //

describe('attribution to the target', () => {
  test('findings in other files are listed per file, not silently dropped', async () => {
    const { result, log } = await runWith({
      code: 255,
      report: report([
        hs02('beforeSwap'),
        hs01('beforeSwap', 'src/Other.sol'),
        hs01('afterSwap', 'src/Other.sol'),
        hs01('beforeDonate', 'lib/vendored/Third.sol'),
      ]),
    });

    assert.equal(result.findings.length, 1, 'only the target file is attributed');
    assert.deepEqual(result.unattributed, [
      { file: 'src/Other.sol', count: 2 },
      { file: 'lib/vendored/Third.sol', count: 1 },
    ]);
    assert.ok(
      log.some((l) => l.includes('3 finding(s) in other files') && l.includes('src/Other.sol (2)')),
      log.join(' / '),
    );
  });

  test('nothing elsewhere means no unattributed field at all', async () => {
    const { result } = await runWith({ code: 255, report: report([hs02('beforeSwap')]) });
    assert.equal(result.unattributed, undefined);
  });

  test('partitionByTarget keeps findings that have no location', () => {
    const located = normalise(hs01('beforeSwap', 'src/Other.sol'))!;
    const unlocated = { ...normalise(hs02('afterSwap'))!, location: null };
    const { findings, unattributed } = partitionByTarget([located, unlocated], 'src/MyHook.sol');
    assert.deepEqual(findings, [unlocated]);
    assert.deepEqual(unattributed, [{ file: 'src/Other.sol', count: 1 }]);
  });
});

// --------------------------------------------------------------------------- //
// Normalisation
// --------------------------------------------------------------------------- //

describe('normalise', () => {
  test('carries the discriminator and gives two HS-02s on one contract distinct ids', () => {
    const a = normalise(hs02('beforeRemoveLiquidity'))!;
    const b = normalise(hs02('beforeSwapReturnDelta'))!;

    assert.equal(a.discriminator, 'beforeRemoveLiquidity');
    assert.equal(b.discriminator, 'beforeSwapReturnDelta');
    assert.deepEqual(a.location, b.location, 'same anchor');
    assert.notEqual(a.id, b.id, 'different findings');
    assert.equal(a.function, undefined, 'a contract element is not a function');
  });

  test('resolves an HS-01 callback to its selector so it can meet a selector-keyed engine', () => {
    const f = normalise(hs01('beforeAddLiquidity'))!;
    assert.deepEqual(f.function, { name: 'beforeAddLiquidity', selector: '0x259982e5' });
    assert.equal(f.discriminator, 'beforeAddLiquidity');
    assert.equal(f.location?.line, 88);
    assert.equal(f.location?.endLine, 95);
  });

  test('a non-callback function element gets a name but no selector', () => {
    const f = normalise(
      detectorResult({
        check: 'hookrisk-flag-divergence',
        elements: [{ type: 'function', name: 'getHookPermissions', source_mapping: { filename_relative: 'src/MyHook.sol', lines: [30], is_dependency: false } }],
      }),
    )!;
    assert.deepEqual(f.function, { name: 'getHookPermissions' });
  });

  test('an empty discriminator fails the contract rather than being treated as absent', () => {
    // The schema says minLength 1: a detector that sends "" has a bug, and a
    // finding whose identity is silently widened is how Orbital lost one.
    const f = normalise(
      detectorResult({
        check: 'hookrisk-flag-divergence',
        hookrisk: { version: '1', ruleClass: 'flag-implementation-divergence', informsDimensions: [], informsTriggers: [], isClassification: false, discriminator: '' },
      }),
    );
    assert.equal(f, null);
  });

  test('drops a result that carries no hookrisk metadata', () => {
    assert.equal(normalise(detectorResult({ check: 'hookrisk-mystery', hookrisk: undefined })), null);
  });

  test('drops a result whose metadata predates the versioned contract', () => {
    const unversioned = detectorResult({
      check: 'hookrisk-flag-divergence',
      hookrisk: { ruleClass: 'flag-implementation-divergence', informsDimensions: [], informsTriggers: [], isClassification: false },
    });
    assert.equal(normalise(unversioned), null);
  });

  test('prefers an element outside dependencies for the anchor', () => {
    const f = normalise(
      detectorResult({
        check: 'hookrisk-flag-divergence',
        elements: [
          { type: 'contract', name: 'BaseHook', source_mapping: { filename_relative: 'lib/BaseHook.sol', lines: [1], is_dependency: true } },
          { type: 'contract', name: 'MyHook', source_mapping: { filename_relative: 'src/MyHook.sol', lines: [18], is_dependency: false } },
        ],
      }),
    )!;
    assert.equal(f.location?.file, 'src/MyHook.sol');
  });

  test('maps Slither impact and confidence, with info for classifications', () => {
    const f = normalise(unsupportedAbi())!;
    assert.equal(f.severity, 'info');
    assert.equal(f.ruleClass, 'unsupported-hook-abi');
    assert.equal(f.title, 'MyHook (src/MyHook.sol#18-20) declares getHooksCalls() returning Hooks.Calls, the 2023 hook ABI, which hookrisk cannot analyse');
  });
});
