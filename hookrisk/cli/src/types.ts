/**
 * Normalised types shared by every analysis engine and by the manifest writer.
 *
 * The central idea: hookrisk does not own a single opinion about what a hook's
 * problems are. It runs several engines, each with its own strengths, and
 * reconciles them. That only works if findings from different tools can be
 * compared, which means they have to be reduced to a shared shape and, more
 * importantly, to a shared *taxonomy* — see {@link RuleClass}.
 */

/** Severity, ordered. Higher ordinal means worse. */
export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Confidence that a finding is real rather than a false positive. */
export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s);
export const confidenceRank = (c: Confidence): number => CONFIDENCES.indexOf(c);

/**
 * Canonical vulnerability classes.
 *
 * Every engine's native rule name maps onto one of these. Two engines reporting
 * the same class at the same location is corroboration, not two problems — the
 * distinction matters because a report that counts the same missing access
 * check twice makes a hook look worse than it is, and a scoring model built on
 * finding *counts* would then be wrong.
 *
 * Classes exist here even when hookrisk has no detector of its own for them
 * (`unprotected-unlock-callback`, `selfdestruct`): those come from BlockSec's
 * HookScan and are genuine coverage we would otherwise lack.
 */
export type RuleClass =
  /** A hook callback callable by someone other than the PoolManager. */
  | 'unprotected-hook-callback'
  /** `unlockCallback` callable by someone other than the contract itself. */
  | 'unprotected-unlock-callback'
  /** Declared permissions disagree with implemented callbacks. */
  | 'flag-implementation-divergence'
  /** Privileged surface: who can change what, and are they a contract or an EOA. */
  | 'admin-surface'
  /** Proxy, DELEGATECALL to a mutable target, or an EIP-1967 slot. */
  | 'upgradeable-hook'
  /** The contract can self-destruct. */
  | 'selfdestruct'
  /** External call inside the swap path to something that is not the pool or its tokens. */
  | 'external-call-in-swap-path'
  /** A dynamic fee with no ceiling, no rate limit, or the wrong controller. */
  | 'unbounded-dynamic-fee'
  /** Custom accounting is in use. A classification, not a defect. */
  | 'custom-accounting'
  /** Rounding that resolves in the caller's favour on an exit path. */
  | 'rounding-direction'
  /**
   * A callback is overridden with a deliberate revert: the PoolManager-routed
   * operation is disabled by design. A classification, not a defect — it tells
   * the reader why the harness could not, say, add liquidity through the pool.
   */
  | 'callback-intentionally-disabled'
  /**
   * The contract looks like a v4 hook but uses an ABI hookrisk cannot analyse
   * (the 2023 `getHooksCalls()` / `Hooks.Calls` shape, for instance). A
   * classification with a scoring consequence: every hookrisk-derived dimension
   * for this target is unmeasured, because the detectors never looked.
   */
  | 'unsupported-hook-abi'
  /**
   * The hook accepted a PoolManager-routed callback for a pool it is not
   * attached to. Produced by the harness's exclusivity probe, not by a
   * detector: it initialises a second pool with the same hook and calls the
   * hook as the PoolManager with that pool's key. A classification, not a
   * defect — multi-pool hooks are legitimate, and the framework has no
   * dimension for pool exclusivity — but a hook that keys per-pool state and
   * accepts a foreign key is worth a reader's attention.
   */
  | 'unvalidated-pool-key'
  /**
   * A callback called as the PoolManager would call it returned the wrong
   * selector, or reverted. Either way the PoolManager's own check fails and
   * the pool operation is bricked; the harness observed it rather than
   * inferring it from the source.
   */
  | 'callback-selector-mismatch'
  /**
   * The engine's "I looked at this contract" signal: one per recognised hook,
   * anchored on the contract, carrying the resolved permission set, the
   * implemented callbacks and the metrics complexity is derived from. A
   * classification; its *absence* for the target is what matters, because a
   * target without one was never analysed and no dimension may be scored
   * from its silence.
   */
  | 'hook-profile';

/**
 * Rule classes that classify rather than accuse.
 *
 * A classification is emitted at INFO and must never fail a severity gate or be
 * counted as a defect; its job is to change how the rest of the report is read.
 * Kept here, next to the taxonomy, so the gate, the scorer and the renderers
 * agree on one list instead of each hardcoding `custom-accounting`.
 */
export const CLASSIFICATION_CLASSES: ReadonlySet<RuleClass> = new Set<RuleClass>([
  'custom-accounting',
  'callback-intentionally-disabled',
  'unsupported-hook-abi',
  'unvalidated-pool-key',
  'hook-profile',
]);

export const isClassification = (ruleClass: RuleClass): boolean =>
  CLASSIFICATION_CLASSES.has(ruleClass);

/** Which engine produced a finding, and what it called the rule natively. */
export interface EngineAttribution {
  /** Engine identifier, e.g. `hookrisk` or `blocksec`. */
  engine: string;
  /** The engine's own rule name, preserved so users can trace it back. */
  nativeRule: string;
  severity: Severity;
  confidence: Confidence;
  /** Engine-specific extras worth keeping (call stacks, IR nodes). */
  detail?: Record<string, unknown>;
}

export interface SourceLocation {
  /** Repository-relative where possible; absolute paths are normalised on ingest. */
  file: string;
  /** 1-indexed. */
  line: number;
  endLine?: number;
}

export interface FunctionRef {
  name?: string;
  /** `0x` + 8 hex chars. */
  selector?: string;
}

/**
 * One reconciled finding.
 *
 * `engines` has at least one entry. More than one means independent tools agreed,
 * which is the strongest false-positive filter available without a human.
 */
export interface Finding {
  /** Stable across runs: derived from rule class, location and function. */
  id: string;
  ruleClass: RuleClass;
  title: string;
  description: string;
  severity: Severity;
  confidence: Confidence;
  location: SourceLocation | null;
  function?: FunctionRef;
  /**
   * What distinguishes this finding from others of the same class anchored on
   * the same element: the permission field for HS-02, the callback name for
   * HS-01. Without it, nine divergent permissions on one contract are one
   * finding, because they all point at the contract's opening line.
   */
  discriminator?: string;
  /** Human-readable support: the guard that is missing, the flag that diverges. */
  evidence: string[];
  engines: EngineAttribution[];
  /**
   * Framework dimensions this finding informs, e.g. `upgradeability`.
   * Findings feed scoring; they do not *set* it. See docs/SCORING.md.
   */
  informsDimensions?: string[];
  /** Framework feature triggers this finding activates. */
  informsTriggers?: string[];
  /** Where to read more — post-mortems, upstream docs. */
  references?: string[];
  /**
   * The resolved `getHookPermissions()` set, on a `hook-profile` finding.
   * Carried on the finding as well as on the engine result so the manifest
   * can show where the permissions came from next to the profile itself.
   */
  permissions?: Record<string, boolean>;
  /** Per-contract measurements, on a `hook-profile` finding. */
  metrics?: Record<string, number | boolean>;
  /** Implemented callback names, present on `hook-profile` findings only. */
  callbacks?: string[];
}

/** Outcome of one engine run. */
export interface EngineResult {
  engine: string;
  /** Version string, recorded in the manifest for reproducibility. */
  version: string;
  status: 'ok' | 'skipped' | 'failed';
  /** Why, when status is not `ok`. Always an HR-E code when failed. */
  reason?: string;
  findings: Finding[];
  /** Wall-clock milliseconds. */
  durationMs: number;
  /**
   * Whether the engine actually examined the target, as opposed to merely
   * running. `status: 'ok'` with zero findings reads as a clean bill of health;
   * if the engine never recognised the target as a hook it is nothing of the
   * kind, and every dimension that would have been scored from its silence must
   * stay unmeasured. Absent means the engine makes no such claim.
   */
  targetCoverage?: { covered: boolean; reason?: string };
  /**
   * Findings the engine produced in files other than the target, dropped from
   * `findings` so a neighbour's problems do not inflate this target's score.
   * Listed so the manifest can say what was set aside rather than losing it.
   */
  unattributed?: Array<{ file: string; count: number }>;
  /**
   * What the engine claims to have analysed: every contract it emitted a
   * `hook-profile` for, and whether the target is among them. This is the
   * positive statement `targetCoverage` is derived from — coverage is no
   * longer inferred from the absence of a disclaimer.
   */
  scope?: { analysedContracts: string[]; targetAnalysed: boolean };
  /**
   * The target's resolved permission set, from its `hook-profile`. Inheritance
   * followed, every field present. Absent when the engine did not analyse the
   * target or the hook declares no `getHookPermissions()`; the CLI then falls
   * back to the harness's runtime derivation.
   */
  permissions?: Record<string, boolean>;
  /**
   * Results the engine emitted whose metadata block failed the engine
   * contract (schema/engine-metadata.schema.json) and were dropped. Never
   * silently zero: a drifted detector shows up here, not as a clean scan.
   */
  invalidMetadata?: number;
}

/** What every engine receives. */
export interface EngineContext {
  /** Absolute path to the Foundry project root containing the target. */
  projectRoot: string;
  /** Source-relative path of the file holding the hook, e.g. `src/MyHook.sol`. */
  sourceFile: string;
  /** Contract name within that file. */
  contractName: string;
  /** solc version the project builds with, e.g. `0.8.26`. */
  solcVersion: string;
  /** Per-engine wall-clock budget. */
  timeoutMs: number;
  /** Emit progress; the CLI routes this to stderr so stdout stays machine-readable. */
  log: (message: string) => void;
}

/** Contract every analysis engine implements. */
export interface Engine {
  /** Stable identifier used in attributions and config. */
  readonly id: string;
  /** Shown in the report and in `hookrisk engines`. */
  readonly displayName: string;
  /**
   * Upstream project, for attribution. Required for third-party engines: we run
   * other people's tools and say so, in the report as well as the README.
   */
  readonly upstream?: { url: string; license: string };
  /**
   * Whether this engine can run right now. Returning a reason rather than
   * throwing lets the CLI degrade cleanly and tell the user what they are
   * missing instead of failing the whole scan.
   */
  probe(): Promise<{ available: boolean; version: string; reason?: string }>;
  run(ctx: EngineContext): Promise<EngineResult>;
}
