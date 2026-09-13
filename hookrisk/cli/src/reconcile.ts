/**
 * Cross-layer reconciliation: one fact, seen by two engines, reported once.
 *
 * The static layer classifies a callback that is overridden with a deliberate
 * revert as `callback-intentionally-disabled`. The dynamic layer, when it seeds
 * the hooked pool, watches that same revert happen and records
 * `seeded: "hooked-failed"` with the hook's own error. Reported separately they
 * read as two observations; they are one — "this hook refuses PoolManager
 * liquidity" — and a reader deciding whether the harness's I3 means anything
 * needs them joined.
 *
 * Three outcomes, applied in order:
 *
 * 1. Static classification on a liquidity callback + harness `hooked-failed`:
 *    the finding gains a second engine attribution (`harness` / `seed-reverted`),
 *    confidence `high` and an evidence line naming the revert. Two independent
 *    methods — reading the AST, executing the code — reached the same fact,
 *    which is the strongest false-positive filter available without a human.
 * 2. Harness `hooked-failed` with no static classification for the callback:
 *    a harness-sourced classification is added, at `medium` confidence. The
 *    revert is a fact; that it is *by design* is not established by execution
 *    alone (a whitelist hook and a buggy one revert the same way).
 * 3. When both layers agree that PoolManager liquidity is disabled by design,
 *    I3 (exit liveness) becomes `not-applicable`: no position can exist on the
 *    hooked pool, so there is nothing whose exit could be tested. A vacuous
 *    pass or an `inconclusive` is replaced; a *failed* I3 is never touched —
 *    a failure is evidence whatever the static layer says.
 *
 * The harness's execution probes (`harness/test/HookProbes.sol`) follow the
 * same pattern, with HS-01 as the static half:
 *
 * 4. EOA-guard `unguarded` on a callback HS-01 already reports: the finding
 *    gains a `harness` / `eoa-guard-probe` attribution at confidence `high` —
 *    the missing guard was read *and* exercised. With no HS-01 finding for
 *    that callback, a harness-sourced `unprotected-hook-callback` is added at
 *    `medium`: the call went through, but whether it changed anything worth
 *    guarding is not something the probe can see.
 * 5. Exclusivity `accepted`: an INFO `unvalidated-pool-key` classification on
 *    the contract. Multi-pool hooks are the norm; the point is to tell the
 *    reader that a second pool with a different fee or spacing can be
 *    attached to this hook by anyone, and the hook will serve it.
 * 6. A selector verdict of `wrong-selector` or `reverted`: a HIGH
 *    `callback-selector-mismatch` per callback. The PoolManager reverts
 *    `InvalidHookResponse` on the former and bubbles up the latter, so
 *    either way the operation the callback guards is unavailable through the
 *    pool. `wrong-selector` is `high` confidence — the return value is the
 *    defect. `reverted` is `medium`: the probe's arguments are well-formed
 *    but generic, and a hook that needs reserves, a whitelisted sender or
 *    hookData reverts for its own reasons; the unwrapped revert is in the
 *    evidence so a reader can tell which. A `reverted` callback that a
 *    `callback-intentionally-disabled` finding already names is not
 *    reported: that revert is the design the classification describes.
 *
 * Harness-sourced findings are anchored on the target file, at the line of
 * the static engine's `hook-profile` for it when there is one and line 1
 * otherwise: the harness executes bytecode and has no line of its own.
 *
 * Pure: no I/O, inputs are not mutated, everything else passes through
 * unchanged. The CLI wires the single call between `runHarness` and
 * `buildManifest`.
 */

import { callbackSelector, makeFindingId } from './engines/dedupe.js';
import {
  CALLBACK_SELECTORS,
  describeRevert,
  unwrapRevert,
  type HarnessProbes,
  type HarnessRunInfo,
  type Observations,
} from './harness.js';
import type { InvariantResult } from './manifest.js';
import type { EngineAttribution, Finding, RuleClass, SourceLocation } from './types.js';

export interface ReconcileInput {
  findings: Finding[];
  invariants: InvariantResult[];
  /** The harness's run record, when it wrote one. */
  runRecord?: HarnessRunInfo;
  /** Summed handler counters, when the harness ran to completion. */
  observations?: Observations;
  /**
   * Source-relative path of the target file, e.g. `src/MyHook.sol`. Anchors
   * harness-sourced findings; without it they carry no location.
   */
  sourceFile?: string;
}

export interface ReconcileOutput {
  findings: Finding[];
  invariants: InvariantResult[];
  /** One line per change made, for the verbose log. Empty when nothing was reconciled. */
  notes: string[];
}

export const HARNESS_ENGINE = 'harness';
export const SEED_REVERTED_RULE = 'seed-reverted';
export const EOA_GUARD_RULE = 'eoa-guard-probe';
export const SELECTOR_RULE = 'selector-probe';
export const EXCLUSIVITY_RULE = 'exclusivity-probe';

// The two classes the probes introduce. Declared in `types.ts` by the scoring
// workstream; typed through `RuleClass` here so the manifest's taxonomy stays
// the single list. The casts go once the union carries both names.
const UNVALIDATED_POOL_KEY: RuleClass = 'unvalidated-pool-key';
const SELECTOR_MISMATCH: RuleClass = 'callback-selector-mismatch';

/** The callback the PoolManager invokes for the harness's seed position. */
const SEED_CALLBACK = 'beforeAddLiquidity';
const LIQUIDITY_CALLBACKS: ReadonlySet<string> = new Set([
  'beforeAddLiquidity',
  'afterAddLiquidity',
  'beforeRemoveLiquidity',
  'afterRemoveLiquidity',
]);

export function reconcileLayers(input: ReconcileInput): ReconcileOutput {
  // Shallow copies down to the arrays that get appended to, so the caller's
  // findings are left as they were: a function that reports what it changed
  // must not also change what it was given.
  const findings = input.findings.map((f) => ({ ...f, evidence: [...f.evidence], engines: [...f.engines] }));
  const invariants = input.invariants.map((i) => ({ ...i }));
  const notes: string[] = [];

  const run = input.runRecord;
  if (!run) return { findings, invariants, notes };

  const location = harnessLocation(input.findings, input.sourceFile);

  if (run.seeded === 'hooked-failed') {
    reconcileSeed(run, input.observations, findings, invariants, notes, location);
  }
  if (run.probes) {
    reconcileEoaGuard(run.probes, findings, notes, location);
    reconcileExclusivity(run.probes, findings, notes, location);
    reconcileSelectors(run, run.probes, findings, notes, location);
  }

  return { findings, invariants, notes };
}

// --------------------------------------------------------------------------- //
// Seed revert ↔ callback-intentionally-disabled
// --------------------------------------------------------------------------- //

function reconcileSeed(
  run: HarnessRunInfo,
  observations: Observations | undefined,
  findings: Finding[],
  invariants: InvariantResult[],
  notes: string[],
  location: SourceLocation | null,
): void {
  const revert = unwrapRevert(run.hookedSeedRevert || '0x');
  const revertText = describeRevert(revert);
  const seedEvidence =
    `harness: the seed position was rejected in ${SEED_CALLBACK} ` +
    `(${CALLBACK_SELECTORS_BY_NAME[SEED_CALLBACK]}) with ${revertText}` +
    (revert.selector ? ` [selector ${revert.selector}]` : '');

  const disabled = findings.filter(
    (f) => f.ruleClass === 'callback-intentionally-disabled' && LIQUIDITY_CALLBACKS.has(callbackOf(f) ?? ''),
  );
  const onSeedCallback = disabled.find((f) => callbackOf(f) === SEED_CALLBACK);

  if (onSeedCallback) {
    // Same fact, second witness.
    if (!onSeedCallback.engines.some((e) => e.engine === HARNESS_ENGINE)) {
      onSeedCallback.engines.push(attribution(SEED_REVERTED_RULE, 'info', 'high'));
    }
    onSeedCallback.confidence = 'high';
    onSeedCallback.evidence.push(seedEvidence);
    notes.push(
      `reconcile: ${SEED_CALLBACK} classified intentionally disabled by hookrisk and observed rejecting the ` +
        `harness's seed (${revertText}); merged into finding ${onSeedCallback.id} at confidence high`,
    );
  } else {
    findings.push(seedRevertFinding(revertText, seedEvidence, location));
    notes.push(
      `reconcile: the harness's seed was rejected in ${SEED_CALLBACK} (${revertText}) and no static ` +
        'classification names that callback; added a harness-sourced callback-intentionally-disabled finding',
    );
  }

  if (disabled.length > 0) {
    const i3 = invariants.find((i) => i.id === 'I3');
    if (i3 && i3.status !== 'failed') {
      const by = disabled.map((f) => callbackOf(f)).join(', ');
      const opened = observations ? ` The harness opened ${observations.positionsOpened} position(s).` : '';
      i3.status = 'not-applicable';
      i3.detail =
        `PoolManager liquidity is disabled by design: hookrisk classifies ${by} as intentionally disabled and ` +
        `the harness's seed position was rejected with ${revertText}. No position can exist on the hooked pool, ` +
        `so exit liveness has nothing to assert; liquidity held through the hook's own path is not exercised.${opened}`;
      delete i3.runs;
      delete i3.calls;
      delete i3.reverts;
      notes.push('reconcile: I3 not-applicable — both layers agree PoolManager liquidity is disabled by design');
    }
  }
}

// --------------------------------------------------------------------------- //
// EOA-guard probe ↔ HS-01
// --------------------------------------------------------------------------- //

function reconcileEoaGuard(
  probes: HarnessProbes,
  findings: Finding[],
  notes: string[],
  location: SourceLocation | null,
): void {
  for (const [callback, verdict] of Object.entries(probes.eoaGuard)) {
    if (verdict !== 'unguarded') continue;
    const selector = CALLBACK_SELECTORS_BY_NAME[callback]!;
    const evidence =
      `harness: ${callback} (${selector}) was called from an address that is not the PoolManager, with ` +
      'well-formed arguments for the hooked pool, and returned instead of reverting [eoa-guard-probe]';

    const existing = findings.find((f) => f.ruleClass === 'unprotected-hook-callback' && callbackOf(f) === callback);
    if (existing) {
      if (!existing.engines.some((e) => e.engine === HARNESS_ENGINE && e.nativeRule === EOA_GUARD_RULE)) {
        existing.engines.push(attribution(EOA_GUARD_RULE, 'high', 'high'));
      }
      existing.confidence = 'high';
      existing.evidence.push(evidence);
      notes.push(
        `reconcile: ${callback} reported unprotected by hookrisk and observed accepting a call from a stranger; ` +
          `merged into finding ${existing.id} at confidence high`,
      );
      continue;
    }

    findings.push({
      id: makeFindingId('unprotected-hook-callback', location, selector, callback),
      ruleClass: 'unprotected-hook-callback',
      title: `${callback} accepts a call from an address that is not the PoolManager`,
      description:
        `The differential harness called ${callback} directly from an address that is not the PoolManager and ` +
        'the call returned. The PoolManager is the only legitimate caller of a hook callback; one that anyone ' +
        'can drive lets an attacker run its logic — move fees, update state, take from the pool inside their ' +
        'own unlock — without a swap or position behind it. No static finding names this callback, so the ' +
        'missing guard is established by execution alone; whether the callback changes state worth guarding ' +
        'is not, hence medium confidence.',
      severity: 'high',
      confidence: 'medium',
      location,
      function: { name: callback, selector },
      discriminator: callback,
      evidence: [evidence],
      engines: [attribution(EOA_GUARD_RULE, 'high', 'medium')],
      references: ['https://github.com/uniswapfoundation/security-framework'],
    });
    notes.push(
      `reconcile: ${callback} accepted a call from a stranger and no static finding names it; ` +
        'added a harness-sourced unprotected-hook-callback finding',
    );
  }
}

// --------------------------------------------------------------------------- //
// Exclusivity probe → unvalidated-pool-key
// --------------------------------------------------------------------------- //

function reconcileExclusivity(
  probes: HarnessProbes,
  findings: Finding[],
  notes: string[],
  location: SourceLocation | null,
): void {
  if (probes.exclusivity !== 'accepted') return;
  if (findings.some((f) => f.ruleClass === UNVALIDATED_POOL_KEY)) return;
  findings.push({
    id: makeFindingId(UNVALIDATED_POOL_KEY, location),
    ruleClass: UNVALIDATED_POOL_KEY,
    title: 'The hook serves any pool it is attached to: a second pool with a different fee or spacing was accepted',
    description:
      'The differential harness initialised a second pool with the same currencies and hook but a different fee ' +
      'tier or tick spacing, then called the hook as the PoolManager with that pool\'s key; the hook did not ' +
      'reject it. `onlyPoolManager` does not prevent this — anyone can create a pool that names an existing hook — ' +
      'so a hook whose logic assumes one pool (a stored reserve, a per-pool fee, a one-time initialisation) ' +
      'must compare the key or the PoolId itself. A hook designed to serve many pools has nothing to fix; this ' +
      'is a classification, reported so the assumption is checked rather than inherited.',
    severity: 'info',
    confidence: 'high',
    location,
    evidence: [
      'harness: a second pool (same currencies and hook, different fee or tick spacing) initialised, and the ' +
        'first implemented swap-or-liquidity callback returned when called as the PoolManager with its key ' +
        '[exclusivity-probe]',
    ],
    engines: [attribution(EXCLUSIVITY_RULE, 'info', 'high')],
  });
  notes.push('reconcile: the hook accepted a callback for a second pool; added an unvalidated-pool-key classification');
}

// --------------------------------------------------------------------------- //
// Selector probe → callback-selector-mismatch
// --------------------------------------------------------------------------- //

function reconcileSelectors(
  run: HarnessRunInfo | undefined,
  probes: HarnessProbes,
  findings: Finding[],
  notes: string[],
  location: SourceLocation | null,
): void {
  for (const [callback, verdict] of Object.entries(probes.selectors)) {
    if (verdict === 'ok') continue;
    // A callback the static layer classifies as intentionally disabled, or
    // the harness already saw refusing its seed, reverts by design; reporting
    // that revert a second time as a selector defect would accuse a hook of
    // the thing the classification just excused.
    const disabled = findings.find(
      (f) => f.ruleClass === 'callback-intentionally-disabled' && callbackOf(f) === callback,
    );
    if (verdict === 'reverted' && disabled) {
      notes.push(
        `reconcile: ${callback} reverted under the selector probe, but finding ${disabled.id} classifies it as ` +
          'intentionally disabled; not reported as a selector mismatch',
      );
      continue;
    }
    // A custom curve whose reserves never arrived (the hook refused the seed)
    // reverts every swap on arithmetic, not on a wrong answer. That is the
    // same idle-pool condition that makes its invariants inconclusive, and a
    // HIGH here would be a second report of it.
    if (verdict === 'reverted' && run?.customCurve && run.seeded === 'hooked-failed') {
      notes.push(
        `reconcile: ${callback} reverted under the selector probe on a custom curve that refused its seed ` +
          '(no reserves); not reported as a selector mismatch — see the inconclusive invariants',
      );
      continue;
    }
    const selector = CALLBACK_SELECTORS_BY_NAME[callback]!;
    const raw = probes.selectorReverts?.[callback];
    const revertText = raw ? describeRevert(unwrapRevert(raw)) : undefined;

    const evidence =
      verdict === 'wrong-selector'
        ? `harness: ${callback} (${selector}) returned a first word that is not its own selector when called as the ` +
          'PoolManager; the PoolManager reverts InvalidHookResponse on that answer [selector-probe]'
        : `harness: ${callback} (${selector}) reverted when called as the PoolManager with well-formed arguments ` +
          `for the hooked pool${revertText ? `: ${revertText}` : ''}${raw ? ` [raw ${raw.slice(0, 10)}…]` : ''} [selector-probe]`;

    findings.push({
      id: makeFindingId(SELECTOR_MISMATCH, location, selector, callback),
      ruleClass: SELECTOR_MISMATCH,
      title:
        verdict === 'wrong-selector'
          ? `${callback} returns the wrong selector; every ${operationOf(callback)} through the pool reverts`
          : `${callback} reverts when the PoolManager calls it${revertText ? ` (${revertText})` : ''}`,
      description:
        verdict === 'wrong-selector'
          ? `Called as the PoolManager, ${callback} returned a value whose first word is not ` +
            `\`IHooks.${callback}.selector\`. The PoolManager checks that word and reverts \`InvalidHookResponse\`, ` +
            `so no ${operationOf(callback)} can complete on a pool with this hook. Usually a copy-paste of a ` +
            'neighbouring callback\'s selector, or a return tuple in the wrong order.'
          : `Called as the PoolManager with well-formed arguments for the hooked pool, ${callback} reverted` +
            `${revertText ? ` with ${revertText}` : ''}. The PoolManager bubbles a hook revert up, so the ` +
            `${operationOf(callback)} it guards fails on that path. The probe's arguments are generic — no ` +
            'hookData, a plain sender, a small exact-input swap — so a hook that needs reserves of its own, a ' +
            'whitelisted router or encoded hookData reverts for its own reasons; the revert above says which. ' +
            'Medium confidence for that reason.',
      severity: 'high',
      confidence: verdict === 'wrong-selector' ? 'high' : 'medium',
      location,
      function: { name: callback, selector },
      discriminator: callback,
      evidence: [evidence],
      engines: [attribution(SELECTOR_RULE, 'high', verdict === 'wrong-selector' ? 'high' : 'medium')],
    });
    notes.push(`reconcile: ${callback} ${verdict} under the selector probe; added a callback-selector-mismatch finding`);
  }
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

const CALLBACK_SELECTORS_BY_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CALLBACK_SELECTORS).map(([selector, name]) => [name, selector]),
);

/**
 * Which IHooks callback a finding is about, from whichever field the engine
 * filled in: the discriminator (hookrisk's disabled-callback and HS-01), the
 * function name (`_beforeAddLiquidity` on a BaseHook override resolves to the
 * callback) or a bare selector (BlockSec).
 */
function callbackOf(f: Finding): string | undefined {
  for (const candidate of [f.discriminator, f.function?.name]) {
    const selector = callbackSelector(candidate);
    if (selector) return CALLBACK_SELECTORS[selector];
  }
  if (f.function?.selector) return CALLBACK_SELECTORS[f.function.selector.toLowerCase()];
  return undefined;
}

/** The pool operation a callback gates, for titles. */
function operationOf(callback: string): string {
  if (callback.endsWith('Swap')) return 'swap';
  if (callback.endsWith('AddLiquidity')) return 'liquidity addition';
  if (callback.endsWith('RemoveLiquidity')) return 'liquidity removal';
  if (callback.endsWith('Donate')) return 'donation';
  return 'pool initialisation';
}

/**
 * Where a harness-sourced finding points: the target file, at the line of the
 * static engine's hook-profile for it (the contract's own line) when there is
 * one, else line 1. `null` when the caller did not say which file the target
 * is — the harness knows bytecode, not source.
 */
function harnessLocation(findings: Finding[], sourceFile: string | undefined): SourceLocation | null {
  if (!sourceFile) return null;
  const profile =
    findings.find((f) => f.ruleClass === 'hook-profile' && f.location?.file === sourceFile) ??
    findings.find((f) => f.ruleClass === 'hook-profile' && f.location);
  return { file: sourceFile, line: profile?.location?.line ?? 1 };
}

function attribution(
  nativeRule: string,
  severity: EngineAttribution['severity'],
  confidence: EngineAttribution['confidence'],
): EngineAttribution {
  return { engine: HARNESS_ENGINE, nativeRule, severity, confidence };
}

function seedRevertFinding(revertText: string, evidence: string, location: SourceLocation | null): Finding {
  const selector = CALLBACK_SELECTORS_BY_NAME[SEED_CALLBACK]!;
  return {
    id: makeFindingId('callback-intentionally-disabled', location, selector, SEED_CALLBACK),
    ruleClass: 'callback-intentionally-disabled',
    title: `${SEED_CALLBACK} rejects PoolManager liquidity: the harness's seed position reverted with ${revertText}`,
    description:
      `The differential harness could not add liquidity to the hooked pool through the PoolManager: ${SEED_CALLBACK} ` +
      `reverted with ${revertText}. A hook that keeps its own reserves does this by design; a hook that meant to ` +
      'accept liquidity does not. No static classification names this callback as intentionally disabled, so ' +
      'execution alone establishes the refusal, not the intent — hence medium confidence. Invariants that need ' +
      'a position on the hooked pool were not exercised.',
    severity: 'info',
    confidence: 'medium',
    location,
    function: { name: SEED_CALLBACK, selector },
    discriminator: SEED_CALLBACK,
    evidence: [evidence],
    engines: [attribution(SEED_REVERTED_RULE, 'info', 'medium')],
  };
}
