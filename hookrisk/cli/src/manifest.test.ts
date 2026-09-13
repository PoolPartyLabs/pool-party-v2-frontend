/**
 * Tests for the manifest: the gate, the engine rows, coverage and the report.
 *
 * The gate is where a policy decision becomes an exit code, so the cases that
 * matter are the boundaries: what an undetermined tier does under each
 * setting, and that a violated invariant fails whatever else is configured.
 * The rest pins the manifest against its schema so a new field cannot be
 * rendered in the report without being valid in the JSON.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  type HarnessObservations,
  type HarnessSummary,
  type InvariantResult,
  type ManifestInputs,
  buildManifest,
  errorCodeOf,
  evaluateGate,
  renderMarkdown,
  validateManifest,
} from './manifest.js';
import { loadRubric } from './scoring/rubric.js';
import { type ScoreResult, type ScoringInput, score } from './scoring/score.js';
import type { EngineResult, Finding } from './types.js';

const rubric = loadRubric();

/** Every dimension measured at the given values; the rest unmeasured. */
function scored(values: Record<string, number>, unmeasured: string[] = []): ScoreResult {
  const dimensions: ScoringInput['dimensions'] = {};
  for (const dimension of rubric.dimensions) {
    dimensions[dimension.id] = unmeasured.includes(dimension.id)
      ? { source: 'unmeasured' }
      : { value: values[dimension.id] ?? 0, source: 'measured' };
  }
  return score({ dimensions }, rubric);
}

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'f1',
  ruleClass: 'unprotected-hook-callback',
  title: 'beforeSwap is callable by anyone',
  description: 'No onlyPoolManager guard.',
  severity: 'high',
  confidence: 'high',
  location: { file: 'src/MyHook.sol', line: 42 },
  function: { name: 'beforeSwap', selector: '0x575e24b4' },
  discriminator: 'beforeSwap',
  evidence: ['no guard'],
  engines: [{ engine: 'hookrisk', nativeRule: 'hookrisk-unprotected-callback', severity: 'high', confidence: 'high' }],
  ...overrides,
});

const profile = (): Finding =>
  finding({
    id: 'p1',
    ruleClass: 'hook-profile',
    title: 'Hook profile of MyHook',
    description: 'Structural profile.',
    severity: 'info',
    confidence: 'high',
    location: { file: 'src/MyHook.sol', line: 10 },
    function: undefined,
    discriminator: 'MyHook',
    evidence: [],
    engines: [{ engine: 'hookrisk', nativeRule: 'hookrisk-hook-profile', severity: 'info', confidence: 'high' }],
    metrics: {
      callbacksImplemented: 2,
      callbacksDeclared: 2,
      stateWritesInCallbacks: 1,
      externalCallsInSwapPath: 0,
      internalFunctionsReachableFromCallbacks: 3,
      usesReturnsDelta: false,
      hasOwnerOnlyFunctions: false,
    },
    callbacks: ['beforeSwap', 'afterSwap'],
    permissions: { beforeSwap: true, afterSwap: true },
  });

const engine = (overrides: Partial<EngineResult> = {}): EngineResult => ({
  engine: 'hookrisk',
  version: '0.11.5',
  status: 'ok',
  findings: [],
  durationMs: 12,
  ...overrides,
});

const harness: HarnessSummary = { version: '1.7.1', status: 'ok', durationMs: 300 };

function inputs(overrides: Partial<ManifestInputs> = {}): ManifestInputs {
  return {
    toolVersion: '0.1.0',
    target: { mode: 'source', contractName: 'MyHook', sourceFile: 'src/MyHook.sol' },
    findings: [],
    score: scored({}),
    engineResults: [engine()],
    engineMeta: new Map([['hookrisk', { displayName: 'hookrisk Slither detectors' }]]),
    harness,
    corroboratedFindings: 0,
    uncoveredFunctions: [],
    staticAnalysisSkipped: false,
    ...overrides,
  };
}

const failures = (gate: Record<string, unknown>): string[] => gate.failures as string[];
const notes = (gate: Record<string, unknown>): string[] => (gate.notes as string[] | undefined) ?? [];

// --------------------------------------------------------------------------- //
// Gate
// --------------------------------------------------------------------------- //

describe('evaluateGate: undetermined tier', () => {
  // Measured 3, six dimensions unmeasured: Low now, up to High. This is what
  // every real hook looks like today, including the official template.
  const range = scored(
    { teamMaturity: 3 },
    ['complexity', 'customMath', 'externalDependencies', 'externalLiquidityExposure', 'upgradeability', 'autonomousParameterUpdates'],
  );
  assert.equal(range.tier.id, 'low');
  assert.equal(range.tierUpperBound.id, 'high');
  assert.equal(range.inconclusive, true);

  test('passes under maxTier when failOnInconclusive is off, and says what it could not rule out', () => {
    for (const policy of [{ maxTier: 'medium' as const }, { maxTier: 'medium' as const, failOnInconclusive: false }]) {
      const gate = evaluateGate(policy, range, [], [], []);
      assert.equal(gate.passed, true, JSON.stringify(gate));
      assert.deepEqual(failures(gate), []);
      assert.equal(notes(gate).length, 1);
      assert.match(notes(gate)[0]!, /undetermined between Low Risk and High Risk/);
      assert.match(notes(gate)[0]!, /failOnInconclusive is off/);
      assert.match(notes(gate)[0]!, /6 dimension\(s\) unmeasured: complexity, customMath/);
    }
  });

  test('fails when failOnInconclusive is on', () => {
    const gate = evaluateGate({ maxTier: 'medium', failOnInconclusive: true }, range, [], [], []);
    assert.equal(gate.passed, false);
    assert.equal(failures(gate).length, 1);
    assert.match(failures(gate)[0]!, /upper bound exceeds the configured maximum of medium and failOnInconclusive is set/);
    assert.equal(gate.failOnInconclusive, true, 'the policy is echoed so the verdict can be read with it');
  });

  test('passes silently when even the upper bound is within maxTier', () => {
    const gate = evaluateGate({ maxTier: 'high', failOnInconclusive: true }, range, [], [], []);
    assert.equal(gate.passed, true);
    assert.deepEqual(notes(gate), []);
  });

  test('fails on the measured lower bound whatever failOnInconclusive says', () => {
    // Measured 8 (Medium) with two dimensions still open: the evidence in hand
    // already breaks a Low gate; the range only says how much further it goes.
    const medium = scored({ teamMaturity: 3, tvlPotential: 5 }, ['upgradeability', 'complexity', 'customMath']);
    assert.equal(medium.tier.id, 'medium');
    assert.equal(medium.tierUpperBound.id, 'high');
    assert.equal(medium.inconclusive, true);

    const gate = evaluateGate({ maxTier: 'low', failOnInconclusive: false }, medium, [], [], []);
    assert.equal(gate.passed, false);
    assert.equal(failures(gate).length, 1, 'one fact, one failure');
    assert.match(failures(gate)[0]!, /risk tier is Medium Risk \(8\/33\), undetermined between Medium Risk and High Risk, above the configured maximum of low/);
    assert.deepEqual(notes(gate), []);
  });

  test('a determined tier above maxTier fails without mentioning a range', () => {
    const high = scored({ teamMaturity: 3, tvlPotential: 5, complexity: 5, customMath: 5 });
    assert.equal(high.inconclusive, false);
    const gate = evaluateGate({ maxTier: 'medium' }, high, [], [], []);
    assert.equal(gate.passed, false);
    assert.match(failures(gate)[0]!, /^risk tier is High Risk \(18\/33\) above the configured maximum of medium$/);
  });

  test('without maxTier the tier is not gated at all, undetermined or not', () => {
    const gate = evaluateGate({ maxSeverity: 'high', failOnInconclusive: true }, range, [], [], []);
    assert.equal(gate.passed, true);
    assert.deepEqual(notes(gate), []);
  });
});

describe('evaluateGate: unconditional rules', () => {
  const invariantFailed: InvariantResult = { id: 'I3', name: 'Exit liveness', status: 'failed', detail: 'removeLiquidity reverted' };

  test('a failed invariant fails the gate under the most permissive policy', () => {
    const clean = scored({});
    const gate = evaluateGate({ maxTier: 'high', maxSeverity: 'critical', failOnInconclusive: false }, clean, [], [], [invariantFailed]);
    assert.equal(gate.passed, false);
    assert.match(failures(gate)[0]!, /invariant I3 \(Exit liveness\) failed: removeLiquidity reverted/);
  });

  test('a classification never breaches the severity gate, even at info', () => {
    const gate = evaluateGate({ maxSeverity: 'info' }, scored({}), [profile()], [], []);
    assert.equal(gate.passed, true, JSON.stringify(gate));
  });

  test('a real finding at the threshold does', () => {
    const gate = evaluateGate({ maxSeverity: 'high' }, scored({}), [finding()], [], []);
    assert.equal(gate.passed, false);
    assert.match(failures(gate)[0]!, /1 finding\(s\) at or above high: beforeSwap is callable by anyone/);
  });
});

// --------------------------------------------------------------------------- //
// Engine rows, coverage, validation
// --------------------------------------------------------------------------- //

describe('errorCodeOf', () => {
  test('finds the catalogue code wherever the engine put it', () => {
    assert.equal(errorCodeOf('HR-E202 compilation failed: Error (7920)'), 'HR-E202');
    assert.equal(errorCodeOf('harness setUp failed: beforeAddLiquidity reverted … (HR-E304)'), 'HR-E304');
    assert.equal(errorCodeOf('slither exited 1 with no output'), undefined);
    assert.equal(errorCodeOf(undefined), undefined);
  });
});

describe('buildManifest', () => {
  test('carries errorCode on failed engines only, and validates', () => {
    const manifest = buildManifest(
      inputs({
        engineResults: [
          engine({ status: 'failed', reason: 'HR-E202 compilation failed: Error (7920): Identifier not found' }),
          engine({ engine: 'blocksec', status: 'skipped', reason: 'docker not available (HR-E301)' }),
        ],
        engineMeta: new Map([
          ['hookrisk', { displayName: 'hookrisk Slither detectors' }],
          ['blocksec', { displayName: 'BlockSec HookScan' }],
        ]),
        harness: { version: '1.7.1', status: 'failed', reason: 'harness setUp failed: … (HR-E304)', durationMs: 5 },
      }),
    );
    const engines = manifest.engines as Array<Record<string, unknown>>;
    assert.equal(engines[0]!.errorCode, 'HR-E202');
    assert.equal(engines[1]!.errorCode, undefined, 'skipped is not failed; the code stays in the reason');
    assert.equal(engines[2]!.errorCode, 'HR-E304');
    assert.doesNotThrow(() => validateManifest(manifest));
  });

  test('prefers a structured harness errorCode over the parsed one', () => {
    const manifest = buildManifest(
      inputs({ harness: { version: '1.7.1', status: 'failed', reason: 'forge crashed (HR-E304)', errorCode: 'HR-E303', durationMs: 5 } }),
    );
    const rows = manifest.engines as Array<Record<string, unknown>>;
    assert.equal(rows[rows.length - 1]!.errorCode, 'HR-E303');
    assert.doesNotThrow(() => validateManifest(manifest));
  });

  test('renders coverage.observations when passed and omits it otherwise', () => {
    const observations: HarnessObservations = {
      swapsExecuted: 120,
      swapsCompared: 118,
      swapsSkipped: 2,
      hookedSwapReverted: 0,
      positionsOpened: 40,
      positionsClosed: 38,
      donations: 7,
      priceChecks: 0,
      monotonicityViolations: 0,
      exitFailures: 0,
      sequences: 64,
    };
    const withObs = buildManifest(inputs({ observations }));
    assert.deepEqual((withObs.coverage as Record<string, unknown>).observations, observations);
    assert.doesNotThrow(() => validateManifest(withObs));

    const without = buildManifest(inputs());
    assert.equal('observations' in (without.coverage as Record<string, unknown>), false);
  });

  test('serialises the hook-profile payload and the gate notes, and stays schema-valid', () => {
    const range = scored({ teamMaturity: 3 }, ['complexity', 'customMath', 'upgradeability', 'externalDependencies']);
    const manifest = buildManifest(
      inputs({
        findings: [profile(), finding()],
        score: range,
        permissions: { fromSource: { beforeSwap: true }, fromEngine: { beforeSwap: true, afterSwap: true } },
        gate: { maxTier: 'medium', maxSeverity: 'critical', failOnInconclusive: false },
      }),
    );
    const findings = manifest.findings as Array<Record<string, unknown>>;
    assert.deepEqual(findings[0]!.callbacks, ['beforeSwap', 'afterSwap']);
    assert.equal((findings[0]!.metrics as Record<string, unknown>).callbacksImplemented, 2);
    assert.equal(findings[0]!.discriminator, 'MyHook');
    assert.equal(findings[1]!.metrics, undefined, 'only the profile carries metrics');

    const gate = manifest.gate as Record<string, unknown>;
    assert.equal(gate.passed, true);
    assert.equal(gate.failOnInconclusive, false);
    assert.equal(notes(gate).length, 1);

    assert.doesNotThrow(() => validateManifest(manifest));
  });

  test('a harness-sourced finding and the probe record validate', () => {
    // The two classes the probes produce carry no hookrisk attribution at all:
    // nothing read the source to reach them. The schema has to accept an
    // engine it has never seen a detector for, and the probe record the
    // harness writes at the end of setUp.
    const manifest = buildManifest(
      inputs({
        findings: [
          finding({
            id: 'probe-1',
            ruleClass: 'callback-selector-mismatch',
            title: 'afterSwap did not return its own selector',
            description: 'Called as the PoolManager, afterSwap returned 0x00000000.',
            discriminator: 'afterSwap',
            severity: 'high',
            evidence: ['selector probe: afterSwap returned 0x00000000, expected 0xb47b2fb1'],
            engines: [{ engine: 'harness', nativeRule: 'selector-probe', severity: 'high', confidence: 'high' }],
          }),
          finding({
            id: 'probe-2',
            ruleClass: 'unvalidated-pool-key',
            title: 'The hook accepted a callback for a pool it is not attached to',
            description: 'A second pool with the same hook was initialised; beforeSwap accepted its key.',
            severity: 'info',
            location: { file: 'src/MyHook.sol', line: 1 },
            function: undefined,
            discriminator: undefined,
            evidence: ['exclusivity probe: accepted (drove beforeSwap as the PoolManager)'],
            engines: [{ engine: 'harness', nativeRule: 'pool-exclusivity-probe', severity: 'info', confidence: 'high' }],
          }),
          // The same missing guard seen twice: HS-01 read it, the probe called
          // it. One finding, two attributions.
          finding({
            id: 'merged-1',
            engines: [
              { engine: 'hookrisk', nativeRule: 'hookrisk-unprotected-callback', severity: 'high', confidence: 'medium' },
              { engine: 'harness', nativeRule: 'eoa-guard-probe', severity: 'high', confidence: 'high' },
            ],
          }),
        ],
        permissions: {
          harnessRun: {
            flags: 0x0cc0,
            permissionsDerived: true,
            customCurve: false,
            dynamicFee: false,
            seeded: 'both',
            probes: {
              eoaGuard: { beforeSwap: 'unguarded', afterSwap: 'guarded', beforeInitialize: 'reverted-other' },
              exclusivity: 'accepted',
              exclusivityReason: 'drove beforeSwap with the second pool’s key',
              selectors: { beforeSwap: 'ok', afterSwap: 'wrong-selector' },
            },
          },
        },
      }),
    );

    assert.doesNotThrow(() => validateManifest(manifest));

    const report = renderMarkdown(manifest);
    assert.match(report, /P-02 `callback-selector-mismatch`/);
    assert.match(report, /Observed by the differential harness running the hook \(`harness\/selector-probe`\)\./);
    assert.match(
      report,
      /Observed by the differential harness running the hook \(`harness\/eoa-guard-probe`\), and reported from source by `hookrisk\/hookrisk-unprotected-callback`\./,
    );
    // A classification never joins the defect table.
    assert.match(report, /\| P-01 `unvalidated-pool-key` \| The hook accepted a callback for a pool it is not attached to \|/);
  });

  test('the schema stays strict: an unknown probe verdict is rejected', () => {
    const manifest = buildManifest(
      inputs({
        permissions: {
          harnessRun: { flags: 0, seeded: 'both', probes: { eoaGuard: { beforeSwap: 'unguarded' } } },
        },
      }),
    );
    ((((manifest.permissions as Record<string, unknown>).harnessRun as Record<string, unknown>).probes as Record<string, unknown>)
      .eoaGuard as Record<string, unknown>).beforeSwap = 'probably-fine';
    assert.throws(() => validateManifest(manifest), /HR-E501|does not satisfy/);
  });

  test('the schema stays strict: an unknown observation key is rejected', () => {
    const manifest = buildManifest(inputs({ observations: { swapsExecuted: 1 } }));
    (manifest.coverage as Record<string, unknown>).observations = { swapsExecuted: 1, extra: 2 };
    assert.throws(() => validateManifest(manifest), /HR-E501|does not satisfy/);
  });
});

// --------------------------------------------------------------------------- //
// Report
// --------------------------------------------------------------------------- //

describe('renderMarkdown', () => {
  const range = scored({ teamMaturity: 3 }, ['complexity', 'customMath', 'upgradeability', 'externalDependencies', 'externalLiquidityExposure']);
  assert.equal(range.tierUpperBound.id, 'high');

  const report = renderMarkdown(
    buildManifest(
      inputs({
        findings: [profile(), finding()],
        score: range,
        observations: { swapsExecuted: 12, swapsCompared: 12, swapsSkipped: 0, positionsOpened: 4, positionsClosed: 4, donations: 1, priceChecks: 0, sequences: 8 },
        engineResults: [engine({ status: 'failed', reason: 'HR-E202 compilation failed' })],
        gate: { maxTier: 'medium', failOnInconclusive: false },
      }),
    ),
  );

  test('renders the hook profile in its own section, not among the findings', () => {
    const findingsAt = report.indexOf('## Findings');
    const profileAt = report.indexOf('## Hook profile');
    const scoreAt = report.indexOf('## Score');
    assert.ok(findingsAt < profileAt && profileAt < scoreAt, 'profile sits between the findings and the score');
    assert.match(report, /\| Callbacks implemented \| `beforeSwap`, `afterSwap` \|/);
    assert.match(report, /\| State writes in callbacks \| 1 \|/);
    assert.match(report, /\| Returns a delta \| false \|/);
    assert.match(report, /\| Permissions declared \| `beforeSwap`, `afterSwap` \|/);
    assert.equal(report.slice(findingsAt, profileAt).indexOf('Hook profile of MyHook'), -1, 'the profile is not listed as a finding');
  });

  test('lists defects as a numbered table and details them with a short title', () => {
    assert.match(report, /\| # \| Severity \| Rule \| Finding \| Location \| Confidence \| Engines \|/);
    assert.match(report, /\| F1 \| 🟠 High \| HS-01 `unprotected-hook-callback` \| `beforeSwap` is callable by anyone, not only the PoolManager \| `src\/MyHook.sol:42` \| high \| hookrisk \|/);
    assert.match(report, /### F1 · 🟠 High · `beforeSwap` is callable by anyone, not only the PoolManager/);
    assert.match(report, /HS-01 `unprotected-hook-callback` · `src\/MyHook.sol:42` · confidence \*\*high\*\*/);
  });

  test('summarises tier, gate, findings, dimensions and engines up front', () => {
    assert.match(report, /\| Risk tier \| \*\*LOW\*\* 3\/33, undetermined up to HIGH 22\/33 \|/);
    assert.match(report, /\| Gate \| ❌ Failed \(1 reason below\) \|/);
    assert.match(report, /\| Findings \| 1 high \|/);
    assert.match(report, /\| Dimensions \| \d+ measured · \d+ declared · \d+ unmeasured \|/);
    assert.match(report, /\| Static analysis \| failed \(HR-E202\) \|/);
  });

  test('shows the gate reasons and note next to the verdict and the error code in the engines table', () => {
    // An engine that failed is not a pass: failOnNotAnalysed defaults on, so
    // the verdict flips and names the engine, and the tier note still follows.
    assert.match(report, /### Why the gate failed\n\n1\. engine hookrisk failed: HR-E202 compilation failed\n\n> ℹ️ tier is undetermined between Low Risk and High Risk/);
    assert.match(report, /\| hookrisk Slither detectors \| failed \(HR-E202\) \| 0 \| HR-E202 compilation failed \|/);
  });

  test('summarises the harness observations under coverage', () => {
    assert.match(report, /The harness executed 12 swap\(s\) \(12 compared against the reference pool, 0 skipped\), opened 4 and closed 4 position\(s\), made 1 donation\(s\) and ran 0 price check\(s\) over 8 sequence\(s\)\./);
  });
});
