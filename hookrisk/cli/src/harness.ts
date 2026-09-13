/**
 * Running the differential harness against an arbitrary hook.
 *
 * The harness lives in this repository, as a Foundry project with v4-core, the
 * twin-pool fixture and the invariants. A user's hook lives somewhere else. This
 * module bridges the two without asking the user to write any Solidity.
 *
 * ## How
 *
 * The creation bytecode is read out of the user's Foundry artifact and handed to
 * the harness through `HOOKRISK_CREATION_CODE`, alongside the permission flags
 * and the declared fee bound. `TwinPools` etches it at a flag-bearing address,
 * runs the constructor and etches the resulting runtime code — the same
 * procedure `forge-std`'s `deployCodeTo` uses.
 *
 * Passing bytes rather than a name is what makes cross-project scanning work at
 * all. `vm.getCode("File.sol:Contract")` resolves against the *harness's* own
 * compilation index, so an artifact merely copied into its `out/` directory is
 * invisible and fails with `no matching artifact found` — which reads like a
 * missing file when the file is sitting right there.
 *
 * This is also more robust than generating Solidity and compiling it inside the
 * user's project: no remappings to reconcile, no solc version to agree on, and
 * the invariants under test are the same bytes CI runs against our own fixtures.
 *
 * ## The contract with the harness
 *
 * Everything crosses the process boundary as environment variables in and a
 * JSON run record out. The full list is in docs/INVARIANTS.md; the pieces that
 * matter for reading this file:
 *
 * - `HOOKRISK_FLAGS=0` plus `HOOKRISK_RUNTIME_CODE` asks the harness to derive
 *   the permissions itself by calling `getHookPermissions()` on the etched
 *   runtime code. That is how a hook whose permissions live in an inherited
 *   base contract (every OpenZeppelin-based hook) gets scanned at all.
 * - `HOOKRISK_CONSTRUCTOR_ARGS` carries ABI-encoded constructor arguments with
 *   placeholder addresses the harness substitutes for the real PoolManager,
 *   currencies, owner and hook address at deployment.
 * - `HOOKRISK_RUN_ID` names a file the harness writes at the *end* of a
 *   successful `setUp`. Its absence therefore means `setUp` never finished.
 *
 * ## The rule this file exists to enforce
 *
 * A dynamic layer that did not run must never look like one that ran and found
 * nothing. Every early exit here yields either `skipped` with an accurate,
 * actionable reason, or `failed` with the invariants marked `inconclusive`. The
 * one thing it never returns is `ok` with an empty result.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HookriskError } from './errors.js';
import type { InvariantResult } from './manifest.js';

/** Bit positions of the 14 hook permissions, from v4-core's Hooks library. */
export const FLAG_BITS: Record<string, number> = {
  beforeInitialize: 13,
  afterInitialize: 12,
  beforeAddLiquidity: 11,
  afterAddLiquidity: 10,
  beforeRemoveLiquidity: 9,
  afterRemoveLiquidity: 8,
  beforeSwap: 7,
  afterSwap: 6,
  beforeDonate: 5,
  afterDonate: 4,
  beforeSwapReturnDelta: 3,
  afterSwapReturnDelta: 2,
  afterAddLiquidityReturnDelta: 1,
  afterRemoveLiquidityReturnDelta: 0,
};

/**
 * Placeholder addresses in `HOOKRISK_CONSTRUCTOR_ARGS`. The harness replaces
 * each 32-byte word holding one of these with the real address before running
 * the constructor. They are the shared contract between this file, the harness
 * and hookrisk.toml, so the names here are the names a user writes.
 */
export const PLACEHOLDERS: Record<string, string> = {
  $poolManager: '0x000000000000000000000000000000C0FFEE0001',
  $currency0: '0x000000000000000000000000000000C0FFEE0002',
  $currency1: '0x000000000000000000000000000000C0FFEE0003',
  $owner: '0x000000000000000000000000000000C0FFEE0004',
  $hook: '0x000000000000000000000000000000C0FFEE0005',
};

/**
 * v4 `IHooks` callback selectors, so a revert the PoolManager wrapped can name
 * the callback that rejected the call rather than just its four bytes.
 */
export const CALLBACK_SELECTORS: Record<string, string> = {
  '0xdc98354e': 'beforeInitialize',
  '0x6fe7e6eb': 'afterInitialize',
  '0x259982e5': 'beforeAddLiquidity',
  '0x9f063efc': 'afterAddLiquidity',
  '0x21d0ee70': 'beforeRemoveLiquidity',
  '0x6c2bbe7e': 'afterRemoveLiquidity',
  '0x575e24b4': 'beforeSwap',
  '0xb47b2fb1': 'afterSwap',
  '0xb6a8b0fa': 'beforeDonate',
  '0xe1b4af69': 'afterDonate',
};

const INVARIANT_NAMES = {
  I1: 'Conservation and solvency',
  I2: 'No undeclared extraction',
  I3: 'Exit liveness',
} as const;

const FALLBACK_SOLC = '0.8.26';
const FALLBACK_OUT = 'out';

// --------------------------------------------------------------------------- //
// Permissions
// --------------------------------------------------------------------------- //


/** Compute the low-14-bit flag word from a permission set. */
export function flagsFrom(permissions: Record<string, boolean>): number {
  let flags = 0;
  for (const [name, bit] of Object.entries(FLAG_BITS)) {
    if (permissions[name]) flags |= 1 << bit;
  }
  return flags;
}

/** The inverse of {@link flagsFrom}: a full 14-field permission set from a flag word. */
export function permissionsFrom(flags: number): Record<string, boolean> {
  const permissions: Record<string, boolean> = {};
  for (const [name, bit] of Object.entries(FLAG_BITS)) {
    permissions[name] = (flags & (1 << bit)) !== 0;
  }
  return permissions;
}

// --------------------------------------------------------------------------- //
// Project resolution: where the artifact is and which solc built it
// --------------------------------------------------------------------------- //

export interface ProjectResolution {
  projectRoot: string;
  /** Absolute artifact directory, `forge config`'s `out`. */
  artifactDir: string;
  solcVersion: string;
  /** Whether `artifactDir`/`solcVersion` came from forge or from built-in defaults. */
  configSource: 'forge-config' | 'fallback';
  solcSource: 'forge-config' | 'artifact-metadata' | 'fallback';
  /** The hook's artifact, when it could be located. */
  artifactPath?: string;
  /** Why it could not be, phrased so the user knows what to do. */
  artifactReason?: string;
  /** Anything the reader of the manifest should know about how these were found. */
  notes: string[];
}

export type ForgeConfigRunner = (
  projectRoot: string,
) => Promise<{ out?: string | null; solc?: string | null }>;

/**
 * Ask forge where the artifacts are and which compiler built them.
 *
 * Read from `forge config --json` rather than by parsing foundry.toml, because
 * the file is only one of several inputs: profiles, `FOUNDRY_*` environment
 * variables and `solc_version` spelling all change the answer, and forge is the
 * only thing that resolves them the way `forge build` did. Uniswap's own hooks
 * repository sets `out = 'foundry-out'` and was reported as "run forge build
 * first" after a successful build, which is the failure this replaces.
 *
 * When forge itself cannot be run the defaults are used and the manifest says
 * so, so a scan of a project that builds elsewhere is not silently wrong.
 */
export async function resolveProject(
  projectRoot: string,
  sourceFile: string,
  contractName: string,
  runForgeConfig: ForgeConfigRunner = forgeConfig,
): Promise<ProjectResolution> {
  const notes: string[] = [];
  let out = FALLBACK_OUT;
  let solc: string | null = null;
  let configSource: ProjectResolution['configSource'] = 'fallback';

  try {
    const config = await runForgeConfig(projectRoot);
    out = config.out || FALLBACK_OUT;
    solc = config.solc ?? null;
    configSource = 'forge-config';
  } catch (err) {
    notes.push(
      `\`forge config\` failed in ${projectRoot} (${(err as Error).message.trim()}); ` +
        `assuming out = "${FALLBACK_OUT}" and solc ${FALLBACK_SOLC}.`,
    );
  }

  const artifactDir = resolve(projectRoot, out);
  const located = locateArtifact(artifactDir, sourceFile, contractName, solc, projectRoot, out);

  let solcVersion = solc ?? FALLBACK_SOLC;
  let solcSource: ProjectResolution['solcSource'] = solc ? 'forge-config' : 'fallback';
  if (!solc && 'path' in located) {
    // forge leaves `solc` null when the project pins nothing and lets forge
    // auto-detect; the artifact records what was actually used.
    const fromArtifact = compilerVersionOf(located.path);
    if (fromArtifact) {
      solcVersion = fromArtifact;
      solcSource = 'artifact-metadata';
    } else {
      notes.push(`artifact carries no compiler version; assuming solc ${FALLBACK_SOLC}.`);
    }
  } else if (!solc) {
    notes.push(`foundry.toml pins no solc version and no artifact was found; assuming ${FALLBACK_SOLC}.`);
  }

  return {
    projectRoot,
    artifactDir,
    solcVersion,
    configSource,
    solcSource,
    ...('path' in located ? { artifactPath: located.path } : { artifactReason: located.reason }),
    notes,
  };
}

/**
 * Find `<out>/<File.sol>/<Contract>.json`, tolerating forge's per-version
 * naming. When one source file is compiled under several solc versions forge
 * writes `Contract.0.8.26.json`, `Contract.0.8.29.json` and no plain name; a
 * project pinning one version gets the plain name. Uniswap's hooks repo does
 * both in one `out/`.
 */
export function locateArtifact(
  artifactDir: string,
  sourceFile: string,
  contractName: string,
  solc: string | null,
  projectRoot: string,
  outName: string,
): { path: string } | { reason: string } {
  const fileDir = join(artifactDir, basenameOf(sourceFile));
  const buildHint = `run \`forge build\` in ${projectRoot} first`;

  if (!existsSync(artifactDir)) {
    return {
      reason: `artifact directory ${artifactDir} does not exist (forge config: out = "${outName}") — ${buildHint}.`,
    };
  }
  if (!existsSync(fileDir)) {
    return {
      reason:
        `no compiled artifact for ${basenameOf(sourceFile)} under ${artifactDir} ` +
        `(forge config: out = "${outName}") — ${buildHint}.`,
    };
  }

  const plain = join(fileDir, `${contractName}.json`);
  if (existsSync(plain)) return { path: plain };

  const versioned = readdirSync(fileDir).filter((name) =>
    new RegExp(`^${escapeRegExp(contractName)}\\.[0-9]+\\.[0-9]+\\.[0-9]+\\.json$`).test(name),
  );
  if (versioned.length === 1) return { path: join(fileDir, versioned[0]!) };
  if (versioned.length > 1) {
    const preferred = solc ? `${contractName}.${solc}.json` : null;
    if (preferred && versioned.includes(preferred)) return { path: join(fileDir, preferred) };
    return {
      reason:
        `${contractName} was compiled under several solc versions (${versioned.join(', ')}) and ` +
        `foundry.toml pins none of them — set \`solc\` in foundry.toml so the harness knows which build to test.`,
    };
  }

  return {
    reason: `no compiled artifact ${relative(projectRoot, plain)} (forge config: out = "${outName}") — ${buildHint}.`,
  };
}

function compilerVersionOf(artifactPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      metadata?: { compiler?: { version?: string } };
    };
    const raw = parsed.metadata?.compiler?.version;
    // `0.8.26+commit.8a97fa7a` -> `0.8.26`; Slither wants the bare version.
    return raw ? raw.split('+')[0]! : null;
  } catch {
    return null;
  }
}

async function forgeConfig(projectRoot: string): Promise<{ out?: string | null; solc?: string | null }> {
  const proc = await exec('forge', ['config', '--json'], 60_000, projectRoot, {});
  if (proc.code !== 0) throw new Error(lastLines(proc.stderr || proc.stdout, 2) || `exit ${proc.code}`);
  const parsed = JSON.parse(proc.stdout) as { out?: string | null; solc?: string | null };
  return { out: parsed.out, solc: parsed.solc };
}

// --------------------------------------------------------------------------- //
// Artifact and constructor arguments
// --------------------------------------------------------------------------- //

export interface AbiInput {
  name?: string;
  type: string;
  internalType?: string;
}

export interface Artifact {
  creationCode: string;
  runtimeCode: string;
  constructorInputs: AbiInput[];
}

/**
 * Extract what the harness needs from a Foundry artifact, checking it is usable.
 *
 * Creation code must be present, which it is not for an abstract contract or an
 * interface; runtime code is what the harness calls `getHookPermissions()` on
 * when it derives the flags itself. The constructor ABI decides how arguments
 * are produced — read from the artifact rather than inferred from source, since
 * the artifact is what actually gets deployed and a mismatch surfaces otherwise
 * as an opaque revert deep inside `setUp`.
 */
export function readArtifact(artifactPath: string, contractName: string): Artifact | { reason: string } {
  let parsed: {
    abi?: Array<{ type: string; inputs?: AbiInput[] }>;
    bytecode?: { object?: string };
    deployedBytecode?: { object?: string };
  };
  try {
    parsed = JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (err) {
    return { reason: `could not read artifact ${artifactPath}: ${(err as Error).message}` };
  }

  const creation = parsed.bytecode?.object;
  if (!creation || creation === '0x' || creation.length <= 2) {
    return {
      reason: `${contractName} has no creation bytecode — abstract contracts and interfaces cannot be deployed.`,
    };
  }

  const ctor = parsed.abi?.find((entry) => entry.type === 'constructor');
  return {
    creationCode: hexPrefixed(creation),
    runtimeCode: hexPrefixed(parsed.deployedBytecode?.object ?? ''),
    constructorInputs: ctor?.inputs ?? [],
  };
}

/** Runs `cast abi-encode "constructor(<types>)" <values...>`; injectable for tests. */
export type CastRunner = (signature: string, values: string[]) => Promise<ExecResult>;

const CONFIG_KEY = '[harness] constructorArgs';

/**
 * Produce `HOOKRISK_CONSTRUCTOR_ARGS` for the hook's constructor.
 *
 * Three shapes are handled without configuration: no arguments (a factory-style
 * hook), and a single `address`/`IPoolManager` (the `BaseHook` convention),
 * which is encoded as the PoolManager placeholder. Anything else needs the user
 * to say what goes in, one string per ABI input, in hookrisk.toml. Placeholders
 * are substituted here so the harness sees only addresses; everything else is
 * handed to `cast abi-encode` verbatim, so the user writes values in the syntax
 * cast already documents rather than one we would invent.
 *
 * The skip reasons name the ABI types and the config key on purpose: the
 * previous message ("additional constructor arguments are not supported") was
 * shown to a hook with *zero* arguments and told the user nothing to do.
 */
export async function encodeConstructorArgs(
  contractName: string,
  inputs: AbiInput[],
  configured: string[] | undefined,
  runCast: CastRunner,
): Promise<{ encoded: string } | { reason: string }> {
  const signature = `constructor(${inputs.map((i) => i.type).join(',')})`;
  const describe = inputs.map((i) => `${i.type}${i.name ? ` ${i.name}` : ''}`).join(', ');

  if (configured === undefined) {
    if (inputs.length === 0) return { encoded: '' };
    if (inputs.length === 1 && isPoolManagerLike(inputs[0]!)) {
      return { encoded: addressWord(PLACEHOLDERS.$poolManager!) };
    }
    return {
      reason:
        `${contractName}'s constructor takes ${inputs.length} argument(s) (${describe}) and the harness can ` +
        `only derive the IPoolManager on its own. Add ${CONFIG_KEY} to hookrisk.toml with one value per ` +
        `argument — ${Object.keys(PLACEHOLDERS).join(', ')} are substituted with the harness's own addresses, ` +
        'anything else is passed literally to `cast abi-encode`. See HR-E305.',
    };
  }

  if (configured.length !== inputs.length) {
    return {
      reason:
        `${CONFIG_KEY} has ${configured.length} value(s) but ${contractName}'s constructor takes ` +
        `${inputs.length} (${describe || 'none'}). See HR-E305.`,
    };
  }
  if (inputs.length === 0) return { encoded: '' };

  const tuple = inputs.find((i) => i.type.startsWith('tuple'));
  if (tuple) {
    return {
      reason:
        `${contractName}'s constructor takes a struct argument (${tuple.type}${tuple.name ? ` ${tuple.name}` : ''}), ` +
        `which ${CONFIG_KEY} cannot express yet. See HR-E305.`,
    };
  }

  const values = configured.map((value) => PLACEHOLDERS[value] ?? value);
  let proc: ExecResult;
  try {
    proc = await runCast(signature, values);
  } catch (err) {
    return { reason: `could not run \`cast abi-encode\` (${(err as Error).message}); cast ships with forge.` };
  }
  const encoded = proc.stdout.trim();
  if (proc.code !== 0 || !/^0x[0-9a-fA-F]*$/.test(encoded)) {
    return {
      reason:
        `\`cast abi-encode "${signature}" ${values.join(' ')}\` failed: ` +
        `${lastLines(proc.stderr || proc.stdout, 2) || `exit ${proc.code}`}. Check ${CONFIG_KEY}. See HR-E305.`,
    };
  }
  return { encoded };
}

function isPoolManagerLike(input: AbiInput): boolean {
  if (input.type !== 'address') return false;
  const internal = input.internalType ?? 'address';
  return internal === 'address' || /IPoolManager$/.test(internal);
}

/** ABI-encode one address as a 32-byte word. */
function addressWord(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
}

async function castAbiEncode(signature: string, values: string[]): Promise<ExecResult> {
  return exec('cast', ['abi-encode', signature, ...values], 30_000, process.cwd(), {});
}

// --------------------------------------------------------------------------- //
// Run record
// --------------------------------------------------------------------------- //

/**
 * What the harness's execution probes found, one verdict per implemented
 * callback (`harness/test/HookProbes.sol`). A callback the hook does not
 * implement is absent, not `guarded`: the probe never called it.
 */
export interface HarnessProbes {
  /**
   * Called from an address that is not the PoolManager. `unguarded`: the call
   * returned. `guarded`: it reverted with the hook's own error. `reverted-other`:
   * it reverted with a v4-core error or a Panic, which is not evidence either way.
   */
  eoaGuard: Record<string, EoaGuardVerdict>;
  /**
   * A second pool with the same hook was initialised and the first swap-or-
   * liquidity callback called as the PoolManager with that pool's key.
   * `accepted` is a classification, never a defect: multi-pool hooks are normal.
   */
  exclusivity: ExclusivityVerdict;
  /** Why `not-applicable`, when it is. */
  exclusivityReason?: string;
  /** Called as the PoolManager: did the first return word equal the callback's own selector? */
  selectors: Record<string, SelectorVerdict>;
  /** The unwrapped revert behind each `reverted` selector verdict, raw hex. */
  selectorReverts?: Record<string, string>;
}

export const EOA_GUARD_VERDICTS = ['guarded', 'unguarded', 'reverted-other'] as const;
export const EXCLUSIVITY_VERDICTS = ['rejected', 'accepted', 'not-applicable'] as const;
export const SELECTOR_VERDICTS = ['ok', 'wrong-selector', 'reverted'] as const;
export type EoaGuardVerdict = (typeof EOA_GUARD_VERDICTS)[number];
export type ExclusivityVerdict = (typeof EXCLUSIVITY_VERDICTS)[number];
export type SelectorVerdict = (typeof SELECTOR_VERDICTS)[number];

/** What the harness reports about its own setUp, from `harness/out/hookrisk-run-<id>.json`. */
export interface HarnessRunInfo {
  flags: number;
  customCurve: boolean;
  dynamicFee: boolean;
  permissionsDerived: boolean;
  seeded: 'both' | 'hooked-failed';
  hookedSeedRevert: string;
  /** Absent when the harness that wrote the record predates the probes. */
  probes?: HarnessProbes;
}

/** Parse and validate a run record. Throws on anything malformed, since a wrong `seeded` would silently change which invariants apply. */
export function parseRunRecord(text: string): HarnessRunInfo {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const flags = Number(raw.flags);
  if (!Number.isInteger(flags) || flags < 0) throw new Error(`flags is ${JSON.stringify(raw.flags)}`);
  const seeded = raw.seeded;
  if (seeded !== 'both' && seeded !== 'hooked-failed') throw new Error(`seeded is ${JSON.stringify(seeded)}`);
  for (const key of ['customCurve', 'dynamicFee', 'permissionsDerived'] as const) {
    if (typeof raw[key] !== 'boolean') throw new Error(`${key} is ${JSON.stringify(raw[key])}`);
  }
  return {
    flags,
    customCurve: raw.customCurve as boolean,
    dynamicFee: raw.dynamicFee as boolean,
    permissionsDerived: raw.permissionsDerived as boolean,
    seeded,
    hookedSeedRevert: typeof raw.hookedSeedRevert === 'string' ? raw.hookedSeedRevert : '',
    ...(raw.probes !== undefined ? { probes: parseProbes(raw.probes) } : {}),
  };
}

/**
 * Strict on purpose: a verdict this reader does not know becomes a finding or
 * the absence of one, so a harness that starts writing a new word must be met
 * with a failure here, not with a silently clean report.
 */
function parseProbes(raw: unknown): HarnessProbes {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`probes is ${JSON.stringify(raw)}`);
  const p = raw as Record<string, unknown>;
  const exclusivity = p.exclusivity;
  if (!(EXCLUSIVITY_VERDICTS as readonly unknown[]).includes(exclusivity)) {
    throw new Error(`probes.exclusivity is ${JSON.stringify(exclusivity)}`);
  }
  const probes: HarnessProbes = {
    eoaGuard: verdictMap('probes.eoaGuard', p.eoaGuard, EOA_GUARD_VERDICTS),
    exclusivity: exclusivity as ExclusivityVerdict,
    selectors: verdictMap('probes.selectors', p.selectors, SELECTOR_VERDICTS),
  };
  if (p.exclusivityReason !== undefined) {
    if (typeof p.exclusivityReason !== 'string') throw new Error(`probes.exclusivityReason is ${JSON.stringify(p.exclusivityReason)}`);
    probes.exclusivityReason = p.exclusivityReason;
  }
  if (p.selectorReverts !== undefined) {
    if (typeof p.selectorReverts !== 'object' || p.selectorReverts === null) {
      throw new Error(`probes.selectorReverts is ${JSON.stringify(p.selectorReverts)}`);
    }
    probes.selectorReverts = {};
    for (const [name, value] of Object.entries(p.selectorReverts as Record<string, unknown>)) {
      if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) {
        throw new Error(`probes.selectorReverts.${name} is ${JSON.stringify(value)}`);
      }
      probes.selectorReverts[name] = value;
    }
  }
  return probes;
}

function verdictMap<V extends string>(field: string, raw: unknown, allowed: readonly V[]): Record<string, V> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${field} is ${JSON.stringify(raw)}`);
  const out: Record<string, V> = {};
  const callbacks = new Set(Object.values(CALLBACK_SELECTORS));
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!callbacks.has(name)) throw new Error(`${field} names an unknown callback ${JSON.stringify(name)}`);
    if (!(allowed as readonly unknown[]).includes(value)) throw new Error(`${field}.${name} is ${JSON.stringify(value)}`);
    out[name] = value as V;
  }
  return out;
}

/** One line for the verbose log: what the probes found, worst news first. */
export function summariseProbes(probes: HarnessProbes): string {
  const unguarded = Object.entries(probes.eoaGuard).filter(([, v]) => v === 'unguarded').map(([n]) => n);
  const bad = Object.entries(probes.selectors).filter(([, v]) => v !== 'ok').map(([n, v]) => `${n}=${v}`);
  const parts = [
    unguarded.length ? `unguarded: ${unguarded.join(', ')}` : `eoa guard held on ${Object.keys(probes.eoaGuard).length} callback(s)`,
    bad.length ? `selectors: ${bad.join(', ')}` : 'selectors ok',
    `exclusivity ${probes.exclusivity}`,
  ];
  return parts.join('; ');
}

// --------------------------------------------------------------------------- //
// Observation log
// --------------------------------------------------------------------------- //

/**
 * What the handler actually did, summed over every completed sequence, from
 * `harness/out/hookrisk-obs-<id>.jsonl` (one line per sequence, written by
 * `afterInvariant`). Booleans in the line (`hookedSwapReverted`) become the
 * number of sequences in which they were true.
 *
 * This is the evidence behind a pass. An invariant asserts a property of the
 * state after a sequence; if the sequence never landed a swap or opened a
 * position, the property held over nothing. Before this log existed a hook
 * that refused PoolManager liquidity reported I1/I2/I3 `passed` on a pool that
 * never traded — indistinguishable from a hook the harness had genuinely
 * exercised.
 */
export interface Observations {
  swapsExecuted: number;
  swapsCompared: number;
  swapsSkipped: number;
  hookedSwapReverted: number;
  positionsOpened: number;
  positionsClosed: number;
  donations: number;
  priceChecks: number;
  monotonicityViolations: number;
  exitFailures: number;
}

export const OBSERVATION_FIELDS: ReadonlyArray<keyof Observations> = [
  'swapsExecuted',
  'swapsCompared',
  'swapsSkipped',
  'hookedSwapReverted',
  'positionsOpened',
  'positionsClosed',
  'donations',
  'priceChecks',
  'monotonicityViolations',
  'exitFailures',
];

export interface ObservationLog {
  /** Lines summed. Forge runs each invariant function's sequences separately, so this is runs × invariant functions. */
  sequences: number;
  totals: Observations;
}

/**
 * Sum the observation log. Blank lines are padding (the harness terminates
 * each object itself so concurrent invariant threads cannot interleave two
 * objects; forge's `writeLine` then adds a second newline). Anything else that
 * is not exactly the ten-field object throws: a line the CLI cannot read is a
 * harness/CLI version mismatch, and guessing would defeat the log's purpose.
 */
export function parseObservations(text: string): ObservationLog {
  const totals = Object.fromEntries(OBSERVATION_FIELDS.map((f) => [f, 0])) as unknown as Observations;
  let sequences = 0;
  for (const [index, rawLine] of text.split('\n').entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`line ${index + 1} is not JSON (${(err as Error).message}): ${line.slice(0, 120)}`);
    }
    for (const field of OBSERVATION_FIELDS) {
      const value = parsed[field];
      if (typeof value === 'boolean') {
        totals[field] += value ? 1 : 0;
      } else if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
        totals[field] += value;
      } else {
        throw new Error(`line ${index + 1}: ${field} is ${JSON.stringify(value)}`);
      }
    }
    sequences += 1;
  }
  return { sequences, totals };
}

// --------------------------------------------------------------------------- //
// Running
// --------------------------------------------------------------------------- //

export interface HarnessOptions {
  project: ProjectResolution;
  /** e.g. `src/MyHook.sol`. */
  sourceFile: string;
  contractName: string;
  /**
   * Permission set from `getHookPermissions()` in the target file, or null when
   * the function is inherited — in which case the harness derives it.
   */
  permissions: Record<string, boolean> | null;
  /** `[harness] constructorArgs` from hookrisk.toml, when present. */
  constructorArgs?: string[];
  /** Declared fee bound in basis points, from hookrisk.toml. */
  maxFeeBips: number;
  /** Foundry profile: `scan` for CI, `deep` for an overnight run. */
  profile?: 'scan' | 'deep';
  timeoutMs: number;
  log: (message: string) => void;
  /** Override for tests; normally derived from this module's location. */
  harnessRoot?: string;
  /** Override for tests. */
  runCast?: CastRunner;
}

export interface HarnessOutcome {
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  invariants: InvariantResult[];
  /** forge version, for the manifest's engine row. `n/a` when forge never ran. */
  version: string;
  durationMs: number;
  /** The harness's own account of setUp, when it wrote one. */
  run?: HarnessRunInfo;
  /** Summed handler counters from the observation log; for the manifest's `coverage.observations`. */
  observations?: Observations;
  /** How many sequences those counters cover. */
  observedSequences?: number;
}

/** Run the differential harness and translate the result. */
export async function runHarness(options: HarnessOptions): Promise<HarnessOutcome> {
  const started = Date.now();
  const harnessRoot = options.harnessRoot ?? defaultHarnessRoot();
  const finish = (outcome: Omit<HarnessOutcome, 'durationMs' | 'version'>, version: string): HarnessOutcome => ({
    ...outcome,
    version,
    durationMs: Date.now() - started,
  });

  if (!existsSync(join(harnessRoot, 'foundry.toml'))) {
    return finish(
      skipped(
        `harness project not found at ${harnessRoot}. The dynamic layer ships with the hookrisk repository; ` +
          'install from source to use it.',
      ),
      'n/a',
    );
  }
  if (!existsSync(join(harnessRoot, 'lib', 'v4-core'))) {
    return finish(skipped(`harness dependencies are not materialised — run \`make deps\` in ${harnessRoot}.`), 'n/a');
  }

  const version = await forgeVersion();
  if (!version) {
    return finish(skipped('forge is not installed or not on PATH (HR-E001).'), 'n/a');
  }

  const { project } = options;
  if (!project.artifactPath) {
    return finish(skipped(project.artifactReason ?? 'no compiled artifact found.'), version);
  }

  const artifact = readArtifact(project.artifactPath, options.contractName);
  if ('reason' in artifact) return finish(skipped(artifact.reason), version);

  const ctorArgs = await encodeConstructorArgs(
    options.contractName,
    artifact.constructorInputs,
    options.constructorArgs,
    options.runCast ?? castAbiEncode,
  );
  if ('reason' in ctorArgs) return finish(skipped(ctorArgs.reason), version);

  // Flags: from the source declaration when this file has one, otherwise 0 and
  // the harness reads them from the runtime code. Declaring every permission
  // false is different from inheriting the declaration, and is the one case
  // where there is genuinely nothing to compare.
  const derive = options.permissions === null;
  const flags = derive ? 0 : flagsFrom(options.permissions!);
  if (!derive && flags === 0) {
    return finish(
      skipped(
        `${options.contractName} declares every permission false in getHookPermissions(), so the PoolManager ` +
          'would never invoke it and there is nothing to compare.',
      ),
      version,
    );
  }

  const declaredCustomCurve = options.permissions?.beforeSwapReturnDelta === true;
  const artifactName = basenameOf(options.sourceFile);
  const runId = randomUUID();
  const runRecordPath = join(harnessRoot, 'out', `hookrisk-run-${runId}.json`);
  const observationsPath = join(harnessRoot, 'out', `hookrisk-obs-${runId}.jsonl`);

  options.log(
    `harness: ${artifactName}:${options.contractName} ` +
      (derive ? 'flags=derived-from-runtime' : `flags=0x${flags.toString(16)}`) +
      ` maxFee=${options.maxFeeBips}bips ctorArgs=${ctorArgs.encoded ? `${(ctorArgs.encoded.length - 2) / 64} word(s)` : 'none'}` +
      `${declaredCustomCurve ? ' (custom curve: I2 -> monotonicity)' : ''} run=${runId}`,
  );

  const proc = await exec(
    'forge',
    ['test', '--match-contract', 'GenericHookInvariants', '--json'],
    options.timeoutMs,
    harnessRoot,
    {
      FOUNDRY_PROFILE: options.profile ?? 'scan',
      HOOKRISK_ARTIFACT: `${artifactName}:${options.contractName}`,
      HOOKRISK_CREATION_CODE: artifact.creationCode,
      HOOKRISK_RUNTIME_CODE: artifact.runtimeCode,
      HOOKRISK_FLAGS: String(flags),
      HOOKRISK_CONSTRUCTOR_ARGS: ctorArgs.encoded,
      HOOKRISK_MAX_FEE_BIPS: String(options.maxFeeBips),
      HOOKRISK_CUSTOM_CURVE: declaredCustomCurve ? '1' : '0',
      HOOKRISK_RUN_ID: runId,
    },
  ).catch((err: Error) => ({ code: -1, stdout: '', stderr: err.message }));

  // Read the run record and the observation log before anything can return,
  // and remove them: they are per-run scratch, and a stale one from an earlier
  // run must never be read by a later one — hence the random id as well.
  const record = readRunRecord(runRecordPath);
  const observed = readObservations(observationsPath);

  if (!proc.stdout.trim()) {
    return finish(failed(`forge produced no output: ${lastLines(proc.stderr, 3)}`), version);
  }

  let report: ForgeReport;
  try {
    report = JSON.parse(proc.stdout);
  } catch {
    return finish(failed(`could not parse forge output: ${lastLines(proc.stdout || proc.stderr, 3)}`), version);
  }

  if (record && 'error' in record) return finish(failed(record.error), version);
  if (observed && 'error' in observed) return finish(failed(observed.error), version);
  const run = record ?? undefined;

  // The harness's view wins over ours when it has one: it read the permissions
  // off the deployed code, which is what the PoolManager will obey.
  const customCurve = run?.customCurve ?? declaredCustomCurve;
  const translated = translate(report, {
    customCurve,
    ...(run ? { seeded: run.seeded, hookedSeedRevert: run.hookedSeedRevert } : {}),
    ...(observed ? { observations: observed } : {}),
  });

  const withEvidence = (outcome: Omit<HarnessOutcome, 'durationMs' | 'version'>) => ({
    ...outcome,
    ...(run ? { run } : {}),
    ...(observed ? { observations: observed.totals, observedSequences: observed.sequences } : {}),
  });

  if (translated.status === 'failed') {
    return finish(withEvidence(translated), version);
  }

  if (run && !observed) {
    // setUp finished (the record proves it) and forge reported invariant rows,
    // yet no sequence left its counters behind. Either afterInvariant never
    // ran or the harness predates the log; in both cases the passes above
    // are unverifiable and must not be vouched for.
    return finish(
      withEvidence(
        failed(
          `the harness wrote its run record but no observation log at ${observationsPath}, so nothing says what ` +
            'the sequences exercised and the invariant results cannot be weighed. The harness and CLI versions ' +
            'may be out of step — rebuild both from the same checkout.',
        ),
      ),
      version,
    );
  }

  if (derive && !run) {
    // setUp reported success but left no record, so we do not know which
    // permissions the harness tested under. Reporting the invariants as passed
    // would be vouching for a configuration nobody can see.
    return finish(
      failed(
        `the harness wrote no run record at ${runRecordPath} although setUp succeeded, so the permissions it ` +
          'derived from the runtime code are unknown. The harness and CLI versions may be out of step — ' +
          'rebuild both from the same checkout.',
      ),
      version,
    );
  }

  const failures = translated.invariants.filter((i) => i.status === 'failed').length;
  const inconclusive = translated.invariants.filter((i) => i.status === 'inconclusive').length;
  options.log(
    `harness: ${translated.invariants.length} invariant(s), ${failures} failed` +
      (inconclusive ? `, ${inconclusive} inconclusive` : '') +
      (run ? ` (flags=0x${run.flags.toString(16)}${run.permissionsDerived ? ' derived' : ''}, seeded=${run.seeded}${run.dynamicFee ? ', dynamic fee' : ''})` : '') +
      (observed ? ` observed ${summariseObservations(observed)}` : '') +
      (run?.probes ? `; probes: ${summariseProbes(run.probes)}` : ''),
  );

  return finish(withEvidence({ status: 'ok', invariants: translated.invariants }), version);
}

function readObservations(path: string): ObservationLog | { error: string } | null {
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { error: `could not read the harness observation log ${path}: ${(err as Error).message}` };
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Best effort; the random id keeps a leftover from ever being re-read.
    }
  }
  try {
    return parseObservations(text);
  } catch (err) {
    return { error: `the harness observation log ${path} is malformed (${(err as Error).message}).` };
  }
}

function readRunRecord(path: string): HarnessRunInfo | { error: string } | null {
  if (!existsSync(path)) return null;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { error: `could not read the harness run record ${path}: ${(err as Error).message}` };
  } finally {
    try {
      unlinkSync(path);
    } catch {
      // Best effort; the random id keeps a leftover from ever being re-read.
    }
  }
  try {
    return parseRunRecord(text);
  } catch (err) {
    return { error: `the harness run record ${path} is malformed (${(err as Error).message}).` };
  }
}

async function forgeVersion(): Promise<string | null> {
  try {
    const proc = await exec('forge', ['--version'], 15_000, process.cwd(), {});
    if (proc.code !== 0) return null;
    // `forge Version: 1.7.1` on recent builds, `forge 0.2.0 (abc123 2024-...)` on older ones.
    const match = /forge(?:\s+Version:)?\s+v?(\S+)/i.exec(proc.stdout);
    return match?.[1] ?? proc.stdout.trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------- //
// Translation
// --------------------------------------------------------------------------- //

export interface ForgeTestResult {
  status: string;
  reason?: string | null;
  counterexample?: unknown;
  kind?: { Invariant?: { runs: number; calls: number; reverts: number } };
}

export type ForgeReport = Record<string, { test_results?: Record<string, ForgeTestResult> }>;

export interface TranslateOptions {
  customCurve: boolean;
  seeded?: 'both' | 'hooked-failed';
  hookedSeedRevert?: string;
  /** Summed handler counters; when present, a pass over nothing is downgraded to `inconclusive`. */
  observations?: ObservationLog;
}

export interface Translation {
  status: 'ok' | 'failed';
  reason?: string;
  invariants: InvariantResult[];
}

const INVARIANT_MAP: Record<string, { id: 'I1' | 'I2' | 'I3'; name: string }> = {
  invariant_I1_tokensAreConserved: { id: 'I1', name: INVARIANT_NAMES.I1 },
  invariant_I2_noUndeclaredExtraction: { id: 'I2', name: INVARIANT_NAMES.I2 },
  invariant_I2b_priceIsMonotonic: { id: 'I2', name: 'Price monotonicity (custom curve)' },
  invariant_I2_hookDoesNotBlockSwaps: { id: 'I2', name: 'Hook does not block swaps' },
  invariant_I3_noExitReverted: { id: 'I3', name: INVARIANT_NAMES.I3 },
};

/**
 * Turn forge's per-test results into manifest invariant entries.
 *
 * Several Foundry tests map onto one framework invariant — I2 is asserted by
 * three separate functions — so results are merged, with failure dominating.
 * Reporting three rows for one property would make a single defect look like
 * three, which is the same double-counting problem the engine dedupe layer
 * exists to solve.
 *
 * Two outcomes are failures of the *harness* rather than of the hook, and are
 * reported as such with every invariant `inconclusive`: `setUp()` reverting
 * (forge emits it as a test row of its own and runs nothing else), and a
 * report with no invariant rows at all. Before this, both produced
 * "0 invariant(s), 0 failed" with status ok — a dynamic layer that had not run
 * reporting exactly what a clean hook reports.
 */
export function translate(report: ForgeReport, options: TranslateOptions): Translation {
  const merged = new Map<string, InvariantResult>();

  for (const suite of Object.values(report)) {
    const results = suite.test_results ?? {};

    const setUp = results['setUp()'];
    if (setUp && setUp.status !== 'Success') {
      const revert = unwrapRevert(setUp.reason ?? '');
      const reason =
        `harness setUp failed: ${describeRevert(revert)}. The twin pools could not be built, so no ` +
        'sequence ran and nothing about the hook was observed (HR-E304).';
      return { status: 'failed', reason, invariants: inconclusive(reason, revert.selector) };
    }

    for (const [rawName, result] of Object.entries(results)) {
      const name = rawName.replace(/\(\)$/, '');
      const mapping = INVARIANT_MAP[name];
      if (!mapping) continue;

      // The two I2 variants are mutually exclusive by design: one is skipped
      // whenever the other applies. Discarding the inapplicable one keeps a
      // vacuous pass out of the report.
      if (name === 'invariant_I2_noUndeclaredExtraction' && options.customCurve) continue;
      if (name === 'invariant_I2b_priceIsMonotonic' && !options.customCurve) continue;

      const invariant = toInvariant(mapping.id, mapping.name, result);
      const existing = merged.get(mapping.id);

      if (!existing) {
        merged.set(mapping.id, invariant);
      } else if (invariant.status === 'failed' && existing.status !== 'failed') {
        merged.set(mapping.id, invariant);
      } else if (existing.status !== 'failed') {
        existing.runs = Math.max(existing.runs ?? 0, invariant.runs ?? 0);
        existing.calls = Math.max(existing.calls ?? 0, invariant.calls ?? 0);
      }
    }
  }

  if (merged.size === 0) {
    const reason =
      'forge reported no invariant results for GenericHookInvariants. The harness did not run its sequences — ' +
      'check that the harness builds (`forge build` in harness/) and that HOOKRISK_ARTIFACT reached it.';
    return { status: 'failed', reason, invariants: inconclusive(reason) };
  }

  // Three forge rows merge into I2 and forge lists them alphabetically, so a
  // passing I2 would otherwise be named after whichever row sorts first. A
  // failing I2 keeps the failing row's name, which is the informative one.
  const i2 = merged.get('I2');
  if (i2 && i2.status !== 'failed') {
    i2.name = options.customCurve ? INVARIANT_MAP.invariant_I2b_priceIsMonotonic!.name : INVARIANT_NAMES.I2;
  }

  // I2 against a custom curve is not merely absent, it is inapplicable — a
  // distinction the schema keeps and a reader needs.
  if (options.customCurve && merged.has('I2')) {
    const entry = merged.get('I2')!;
    entry.detail =
      (entry.detail ? `${entry.detail} ` : '') +
      'Output comparison against an unhooked pool does not apply to a custom-curve hook; ' +
      'price monotonicity was asserted instead.';
  }

  // A hook that refuses PoolManager liquidity (the "no v4 liquidity" pattern of
  // a hook that keeps its own reserves) leaves the hooked pool empty. Without a
  // custom curve nothing can be traded, so I2 and I3 measured nothing and must
  // not read as passes; I1 still holds meaning because the hook may have moved
  // tokens during the attempt.
  if (options.seeded === 'hooked-failed' && !options.customCurve) {
    const revert = options.hookedSeedRevert ? describeRevert(unwrapRevert(options.hookedSeedRevert)) : null;
    const detail =
      'The hook rejected the harness\'s initial PoolManager liquidity' +
      (revert ? ` (${revert})` : '') +
      ', so the hooked pool has no v4 liquidity and no swap or exit could be exercised against it. ' +
      'Only a custom-curve hook can trade in that state; this one does not declare beforeSwapReturnDelta.';
    for (const id of ['I2', 'I3'] as const) {
      merged.set(id, { id, name: INVARIANT_NAMES[id], status: 'not-applicable', detail });
    }
  }

  if (options.observations) {
    for (const invariant of merged.values()) downgradeVacuousPass(invariant, options);
  }

  return { status: 'ok', invariants: [...merged.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

/**
 * A pass over sequences that exercised nothing is `inconclusive`, with the
 * counts in the detail so a reader can see what "nothing" was.
 *
 * What counts as relevant differs per invariant: I2 compares swap outputs, so
 * it needs compared swaps; I2b checks price direction, so it needs price
 * checks; I3 withdraws positions, so it needs positions; I1 sums balances
 * after anything at all landed. Only a `passed` row is touched — a failure is
 * evidence whatever the counters say, and the other statuses already carry
 * their own explanation.
 */
function downgradeVacuousPass(invariant: InvariantResult, options: TranslateOptions): void {
  if (invariant.status !== 'passed') return;
  const { totals, sequences } = options.observations!;

  let vacuous: string | null = null;
  if (invariant.id === 'I1' && totals.swapsExecuted + totals.positionsOpened === 0) {
    vacuous = '0 swaps landed and 0 positions opened';
  } else if (invariant.id === 'I2' && !options.customCurve && totals.swapsCompared === 0) {
    vacuous = '0 swaps compared';
  } else if (invariant.id === 'I2' && options.customCurve && totals.priceChecks === 0) {
    vacuous = '0 price checks';
  } else if (invariant.id === 'I3' && totals.positionsOpened === 0) {
    vacuous = '0 positions opened';
  }
  if (!vacuous) return;

  const why: string[] = [];
  if (options.seeded === 'hooked-failed') {
    const revert = options.hookedSeedRevert ? ` (${describeRevert(unwrapRevert(options.hookedSeedRevert))})` : '';
    why.push(`the hook rejected PoolManager liquidity${revert} so the pool never traded`);
  }
  if (totals.hookedSwapReverted > 0) {
    why.push(`a swap that worked without the hook reverted with it in ${totals.hookedSwapReverted} sequence(s)`);
  }

  invariant.status = 'inconclusive';
  invariant.detail =
    `inconclusive, nothing relevant was observed: ${vacuous} across ${sequences} sequences` +
    (why.length ? `; ${why.join('; ')}` : '') +
    `. Observed: ${summariseObservations(options.observations!)}.` +
    (invariant.detail ? ` ${invariant.detail}` : '');
}

function summariseObservations({ totals, sequences }: ObservationLog): string {
  return (
    `${sequences} sequence(s), ${totals.swapsExecuted} swap(s) landed, ${totals.swapsCompared} compared, ` +
    `${totals.priceChecks} price check(s), ${totals.positionsOpened} position(s) opened, ` +
    `${totals.positionsClosed} closed, ${totals.donations} donation(s), ` +
    `${totals.hookedSwapReverted} hooked-only swap revert(s), ${totals.exitFailures} exit failure(s)`
  );
}

function toInvariant(id: 'I1' | 'I2' | 'I3', name: string, result: ForgeTestResult): InvariantResult {
  const stats = result.kind?.Invariant;
  const status = result.status === 'Success' ? 'passed' : result.status === 'Skipped' ? 'skipped' : 'failed';

  const entry: InvariantResult = {
    id,
    name,
    status,
    ...(stats ? { runs: stats.runs, calls: stats.calls, reverts: stats.reverts } : {}),
  };

  if (status === 'failed' && result.reason) {
    const revert = unwrapRevert(result.reason);
    entry.detail = revert.raw === revert.message ? result.reason : `${result.reason} — ${describeRevert(revert)}`;
    entry.counterexample = {
      revertRaw: String(result.counterexample ?? result.reason),
      ...(revert.selector ? { revertSelector: revert.selector } : {}),
    };
  }

  return entry;
}

// --------------------------------------------------------------------------- //
// Revert unwrapping
// --------------------------------------------------------------------------- //

export interface UnwrappedRevert {
  /** The v4 callback whose revert was wrapped, when the selector is one of IHooks'. */
  callback?: string;
  callbackSelector?: string;
  /** The innermost error's 4-byte selector, when there was data. */
  selector?: string;
  /** Human-readable innermost error: `Error("…")`, `Panic(0x11)`, or the selector. */
  message: string;
  raw: string;
}

const WRAPPED_ERROR_SELECTOR = '0x90bfb865';
const ERROR_STRING_SELECTOR = '0x08c379a0';
const PANIC_SELECTOR = '0x4e487b71';

const PANIC_CODES: Record<number, string> = {
  0x01: 'assert failed',
  0x11: 'arithmetic overflow or underflow',
  0x12: 'division by zero',
  0x21: 'invalid enum value',
  0x22: 'corrupted storage byte array',
  0x31: 'pop on empty array',
  0x32: 'array index out of bounds',
  0x41: 'out of memory',
  0x51: 'call to uninitialised function pointer',
};

/**
 * Unwrap v4's ERC-7751 `WrappedError(address,bytes4,bytes,bytes)` down to the
 * hook's own revert.
 *
 * The PoolManager never propagates a hook's revert verbatim:
 * `CustomRevert.bubbleUpAndRevertWith` wraps it with the hook address and the
 * callback selector, and forge prints the wrapper. Both the textual form forge
 * emits (`WrappedError(0x…, 0x259982e5, 0x08c379a0…, 0x…)`) and raw calldata
 * starting with the selector are accepted, and nesting is followed, because a
 * hook that itself calls another contract produces a wrapper inside a wrapper.
 */
export function unwrapRevert(reason: string): UnwrappedRevert {
  const raw = reason.trim();

  const textual = /WrappedError\((0x[0-9a-fA-F]{40}),\s*(0x[0-9a-fA-F]{8}),\s*(0x[0-9a-fA-F]*),\s*(0x[0-9a-fA-F]*)\)/.exec(
    raw,
  );
  if (textual) {
    return { ...withCallback(textual[2]!, unwrapRevert(textual[3]!)), raw };
  }

  if (/^0x[0-9a-fA-F]*$/.test(raw)) {
    return { ...decodeRevertData(raw), raw };
  }

  // forge already rendered it (`revert: …`, `CustomError(…)`, `EvmError: …`).
  return { message: raw, raw };
}

function decodeRevertData(hex: string): Omit<UnwrappedRevert, 'raw'> {
  const data = hex.slice(2).toLowerCase();
  if (data.length < 8) return { message: data.length === 0 ? 'reverted without data' : `0x${data}` };

  const selector = `0x${data.slice(0, 8)}`;
  const body = data.slice(8);

  if (selector === WRAPPED_ERROR_SELECTOR && body.length >= 4 * 64) {
    const callbackSelector = `0x${word(body, 1).slice(0, 8)}`;
    const reasonOffset = Number(BigInt(`0x${word(body, 2)}`)) * 2;
    return withCallback(callbackSelector, decodeRevertData(`0x${readBytes(body, reasonOffset)}`));
  }

  if (selector === ERROR_STRING_SELECTOR && body.length >= 2 * 64) {
    const offset = Number(BigInt(`0x${word(body, 0)}`)) * 2;
    const text = Buffer.from(readBytes(body, offset), 'hex').toString('utf8');
    return { selector, message: `Error(${JSON.stringify(text)})` };
  }

  if (selector === PANIC_SELECTOR && body.length >= 64) {
    const code = Number(BigInt(`0x${word(body, 0)}`));
    const meaning = PANIC_CODES[code];
    return { selector, message: `Panic(0x${code.toString(16).padStart(2, '0')}${meaning ? `: ${meaning}` : ''})` };
  }

  return { selector, message: `custom error ${selector}` };
}

/**
 * Attach the callback a wrapper names to the innermost error it carries. The
 * outermost wrapper wins: that is the IHooks callback the PoolManager invoked,
 * whereas an inner wrapper describes something the hook itself called.
 */
function withCallback(
  callbackSelector: string,
  inner: Omit<UnwrappedRevert, 'raw'> | UnwrappedRevert,
): Omit<UnwrappedRevert, 'raw'> {
  const selector = callbackSelector.toLowerCase();
  const callback = CALLBACK_SELECTORS[selector];
  return {
    message: inner.message,
    ...(inner.selector ? { selector: inner.selector } : {}),
    callbackSelector: selector,
    ...(callback ? { callback } : {}),
  };
}

/** Render an unwrapped revert for a reason string. */
export function describeRevert(revert: UnwrappedRevert): string {
  if (revert.callbackSelector) {
    const callback = revert.callback ?? 'a callback';
    return `${callback} (${revert.callbackSelector}) reverted with ${revert.message}`;
  }
  return revert.message;
}

const word = (body: string, index: number): string => body.slice(index * 64, (index + 1) * 64).padEnd(64, '0');

function readBytes(body: string, offset: number): string {
  const length = Number(BigInt(`0x${word(body, offset / 64)}`)) * 2;
  return body.slice(offset + 64, offset + 64 + length);
}

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //

/** Locate the harness project shipped with hookrisk. */
function defaultHarnessRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(join(here, '..', '..', 'harness'));
}

function skipped(reason: string): Omit<HarnessOutcome, 'durationMs' | 'version'> {
  return {
    status: 'skipped',
    reason,
    invariants: (['I1', 'I2', 'I3'] as const).map((id) => ({
      id,
      name: INVARIANT_NAMES[id],
      status: 'skipped' as const,
      detail: reason,
    })),
  };
}

function failed(reason: string): Omit<HarnessOutcome, 'durationMs' | 'version'> {
  return { status: 'failed', reason, invariants: inconclusive(reason) };
}

/** Every invariant `inconclusive`: the harness ran into something before it could measure. */
function inconclusive(detail: string, revertSelector?: string): InvariantResult[] {
  return (['I1', 'I2', 'I3'] as const).map((id) => ({
    id,
    name: INVARIANT_NAMES[id],
    status: 'inconclusive' as const,
    detail,
    ...(revertSelector ? { counterexample: { revertSelector, revertRaw: detail } } : {}),
  }));
}

const basenameOf = (path: string): string => path.split('/').pop() ?? path;
const lastLines = (s: string, n: number): string => s.trim().split('\n').slice(-n).join(' | ');
const hexPrefixed = (s: string): string => (s.startsWith('0x') || s === '' ? s : `0x${s}`);
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function exec(
  cmd: string,
  args: string[],
  timeoutMs: number,
  cwd: string,
  env: Record<string, string>,
): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new HookriskError('HR-E303', { detail: `${cmd} exceeded ${Math.round(timeoutMs / 1000)}s.` }));
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // forge exits non-zero when a test fails, which for us is a result.
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}
