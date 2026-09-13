/**
 * `hookrisk.toml` — declared inputs and gate policy.
 *
 * Some of the framework's nine dimensions cannot be observed from code. Team
 * maturity is a self-assessment by definition, and TVL *potential* depends on
 * incentive plans no tool can see. hookrisk refuses to invent them: a fabricated
 * declaration produces a total that looks authoritative and is not. This file is
 * where a team states them, and the manifest records that they were declared
 * rather than measured.
 *
 * TOML is parsed here rather than with a dependency. The subset a config file
 * needs — tables, scalars, arrays of scalars — is about eighty lines, and for a
 * security tool a dependency that runs at parse time on user-supplied input is
 * worth avoiding when the alternative is this small. Anything outside the subset
 * raises a clear error rather than being silently misread, which is the property
 * that actually matters.
 */

import { readFileSync } from 'node:fs';

import { HookriskError } from './errors.js';

export type TomlValue = string | number | boolean | Array<string | number | boolean>;
export type TomlTable = Record<string, TomlValue>;
export type TomlDocument = Record<string, TomlTable | TomlValue>;

export interface DeclaredInputs {
  teamMaturity?: number;
  tvlPotential?: number;
  /** Largest fee in basis points the hook can ever charge. Invariant I2 bounds against this. */
  maxFeeBips?: number;
  complexity?: number;
  customMath?: number;
  externalDependencies?: number;
  externalLiquidityExposure?: number;
  upgradeability?: number;
  autonomousParameterUpdates?: number;
  priceImpactingBehavior?: number;
}

export interface GatePolicy {
  maxTier?: 'low' | 'medium' | 'high';
  maxSeverity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  /** Fail when static analysis could not examine every function. */
  failOnPartialCoverage?: boolean;
  /**
   * Fail when the tier is undetermined and only its *upper* bound exceeds
   * `maxTier`. Off by default: with most dimensions unmeasured the upper bound
   * is High on every hook, and a gate that fails on the tool's own gaps gates
   * nothing. On, it is the strict posture — "unknown is not a pass".
   */
  failOnInconclusive?: boolean;
  /** Fail when an engine failed or the static engine never recognised the target. Default true. */
  failOnNotAnalysed?: boolean;
}

/** How the differential harness should construct the hook. */
export interface HarnessConfig {
  /**
   * One value per constructor ABI input. `$poolManager`, `$currency0`,
   * `$currency1`, `$owner` and `$hook` are replaced with the harness's own
   * addresses; anything else is passed literally to `cast abi-encode`.
   */
  constructorArgs?: string[];
}

export interface HookriskConfig {
  target?: string;
  declared: DeclaredInputs;
  gate: GatePolicy;
  engines: Record<string, boolean>;
  harness: HarnessConfig;
  /** Path the config was read from, recorded in the manifest. */
  sourcePath?: string;
}

/** Dimensions a team must declare, because hookrisk cannot observe them. */
export const REQUIRED_DECLARATIONS: Array<keyof DeclaredInputs> = ['teamMaturity', 'tvlPotential'];

const DIMENSION_RANGES: Record<string, [number, number]> = {
  complexity: [0, 5],
  customMath: [0, 5],
  externalDependencies: [0, 3],
  externalLiquidityExposure: [0, 3],
  tvlPotential: [0, 5],
  teamMaturity: [0, 3],
  upgradeability: [0, 3],
  autonomousParameterUpdates: [0, 3],
  priceImpactingBehavior: [0, 3],
};

// --------------------------------------------------------------------------- //
// TOML subset parser
// --------------------------------------------------------------------------- //

/**
 * Parse the subset of TOML a hookrisk config uses.
 *
 * Supported: `[table]` headers, `key = value` pairs, strings (single and double
 * quoted, no escapes beyond `\\` and `\"`), integers with optional `_`
 * separators, floats, booleans, and single-line arrays of those. Comments run
 * from `#` to end of line unless inside a string.
 *
 * Not supported, and rejected loudly: nested tables (`[a.b]`), arrays of tables,
 * multi-line strings and arrays, dates. Silently mis-parsing any of those would
 * be worse than refusing them.
 */
export function parseToml(text: string, sourcePath = '<inline>'): TomlDocument {
  const document: TomlDocument = {};
  let current: TomlTable | null = null;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const line = stripComment(raw).trim();
    if (line.length === 0) continue;

    const fail = (message: string): never => {
      throw new HookriskError('HR-E101', {
        detail: `${sourcePath}:${i + 1}: ${message}`,
        context: { line: raw.trim() },
      });
    };

    if (line.startsWith('[')) {
      if (line.startsWith('[[')) fail('arrays of tables are not supported');
      const match = /^\[([A-Za-z0-9_-]+)\]$/.exec(line);
      if (!match) fail('unsupported table header (nested tables are not supported)');
      const name = match![1]!;
      current = (document[name] as TomlTable) ?? {};
      document[name] = current;
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) fail('expected `key = value`');
    const key = line.slice(0, eq).trim();
    const valueText = line.slice(eq + 1).trim();
    if (!/^[A-Za-z0-9_-]+$/.test(key)) fail(`invalid key ${JSON.stringify(key)}`);
    if (valueText.length === 0) fail('missing value');

    let value: TomlValue;
    try {
      value = parseValue(valueText);
    } catch (err) {
      fail((err as Error).message);
      throw err; // unreachable; keeps the type checker happy
    }

    if (current) current[key] = value;
    else document[key] = value;
  }

  return document;
}

function stripComment(line: string): string {
  let inString = false;
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === quote) inString = false;
    } else if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseValue(text: string): TomlValue {
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) throw new Error('multi-line arrays are not supported');
    const inner = text.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitTopLevel(inner).map((part) => {
      const value = parseValue(part.trim());
      if (Array.isArray(value)) throw new Error('nested arrays are not supported');
      return value;
    });
  }

  if (text === 'true') return true;
  if (text === 'false') return false;

  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    if (text.length < 2) throw new Error('unterminated string');
    return text.slice(1, -1).replace(/\\(["'\\])/g, '$1');
  }

  const numeric = text.replace(/_/g, '');
  if (/^[+-]?\d+$/.test(numeric)) return Number.parseInt(numeric, 10);
  if (/^[+-]?(\d+\.\d+|\d+[eE][+-]?\d+)$/.test(numeric)) return Number.parseFloat(numeric);

  throw new Error(`unsupported value ${JSON.stringify(text)}`);
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let quote = '';
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
    } else if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) parts.push(tail);
  return parts;
}

// --------------------------------------------------------------------------- //
// Config
// --------------------------------------------------------------------------- //

/** Read and validate a hookrisk.toml. */
export function loadConfig(path: string): HookriskConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new HookriskError('HR-E101', {
      detail: `Could not read ${path}.`,
      cause: err,
    });
  }
  return fromDocument(parseToml(text, path), path);
}

/** Build a config from an already-parsed document. Exposed for tests. */
export function fromDocument(document: TomlDocument, sourcePath?: string): HookriskConfig {
  const declaredTable = (document.declared as TomlTable) ?? {};
  const gateTable = (document.gate as TomlTable) ?? {};
  const enginesTable = (document.engines as TomlTable) ?? {};
  const harnessTable = (document.harness as TomlTable) ?? {};

  const declared: DeclaredInputs = {};
  for (const [key, value] of Object.entries(declaredTable)) {
    if (key === 'maxFeeBips') {
      if (typeof value !== 'number' || value < 0 || value > 10_000) {
        throw new HookriskError('HR-E103', {
          detail: `[declared] maxFeeBips must be an integer between 0 and 10000, got ${JSON.stringify(value)}.`,
        });
      }
      declared.maxFeeBips = value;
      continue;
    }

    const range = DIMENSION_RANGES[key];
    if (!range) {
      throw new HookriskError('HR-E101', {
        detail: `[declared] has unknown key ${JSON.stringify(key)}.`,
        context: { known: Object.keys(DIMENSION_RANGES).join(', ') },
      });
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < range[0] || value > range[1]) {
      throw new HookriskError('HR-E101', {
        detail: `[declared] ${key} must be an integer in ${range[0]}-${range[1]}, got ${JSON.stringify(value)}.`,
      });
    }
    (declared as Record<string, number>)[key] = value;
  }

  const gate: GatePolicy = {};
  if (gateTable.maxTier !== undefined) {
    const tier = String(gateTable.maxTier);
    if (!['low', 'medium', 'high'].includes(tier)) {
      throw new HookriskError('HR-E101', {
        detail: `[gate] maxTier must be low, medium or high, got ${JSON.stringify(tier)}.`,
      });
    }
    gate.maxTier = tier as GatePolicy['maxTier'];
  }
  if (gateTable.maxSeverity !== undefined) {
    const severity = String(gateTable.maxSeverity);
    if (!['info', 'low', 'medium', 'high', 'critical'].includes(severity)) {
      throw new HookriskError('HR-E101', {
        detail: `[gate] maxSeverity must be one of info, low, medium, high, critical.`,
      });
    }
    gate.maxSeverity = severity as GatePolicy['maxSeverity'];
  }
  if (gateTable.failOnPartialCoverage !== undefined) {
    gate.failOnPartialCoverage = Boolean(gateTable.failOnPartialCoverage);
  }
  if (gateTable.failOnNotAnalysed !== undefined) {
    if (typeof gateTable.failOnNotAnalysed !== 'boolean') {
      throw new HookriskError('HR-E101', {
        detail: `[gate] failOnNotAnalysed must be true or false, got ${JSON.stringify(gateTable.failOnNotAnalysed)}.`,
      });
    }
    gate.failOnNotAnalysed = gateTable.failOnNotAnalysed;
  }
  if (gateTable.failOnInconclusive !== undefined) {
    // Strictly a boolean. `"false"` is truthy, and a gate policy silently read
    // as its opposite is exactly the kind of misparse this file refuses.
    if (typeof gateTable.failOnInconclusive !== 'boolean') {
      throw new HookriskError('HR-E101', {
        detail: `[gate] failOnInconclusive must be true or false, got ${JSON.stringify(gateTable.failOnInconclusive)}.`,
      });
    }
    gate.failOnInconclusive = gateTable.failOnInconclusive;
  }

  const engines: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(enginesTable)) {
    engines[key] = Boolean(value);
  }

  // Strict on purpose. A misspelt key here (`constructorArg`) would leave the
  // harness without arguments and skip the dynamic layer with a message about
  // a missing key the author believes they wrote.
  const harness: HarnessConfig = {};
  for (const [key, value] of Object.entries(harnessTable)) {
    if (key !== 'constructorArgs') {
      throw new HookriskError('HR-E101', {
        detail: `[harness] has unknown key ${JSON.stringify(key)}.`,
        context: { known: 'constructorArgs' },
      });
    }
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
      throw new HookriskError('HR-E101', {
        detail: `[harness] constructorArgs must be an array of strings, one per constructor argument, got ${JSON.stringify(value)}.`,
        context: { example: 'constructorArgs = ["$poolManager", "3000", "$owner"]' },
      });
    }
    harness.constructorArgs = value as string[];
  }

  return {
    target: typeof document.target === 'string' ? document.target : undefined,
    declared,
    gate,
    engines,
    harness,
    sourcePath,
  };
}

/**
 * Assert that every dimension hookrisk cannot observe has been declared.
 *
 * Deliberately has no defaults. A default team maturity would be a number the
 * tool made up, folded into a total that a reader will take as an assessment.
 * The framework's whole concern in §2 is that self-scoring is easy to game;
 * inventing the self-score on the team's behalf is worse than asking.
 */
export function assertDeclarationsComplete(config: HookriskConfig): void {
  const missing = REQUIRED_DECLARATIONS.filter((key) => config.declared[key] === undefined);
  if (missing.length === 0) return;

  throw new HookriskError('HR-E101', {
    detail: `hookrisk.toml is missing [declared] ${missing.join(', ')}.`,
    context: {
      config: config.sourcePath ?? 'hookrisk.toml',
      hint: 'run `hookrisk init` to generate a commented template',
    },
  });
}

/** The template `hookrisk init` writes. */
export function configTemplate(): string {
  return `# hookrisk configuration
#
# Declared inputs are the dimensions hookrisk cannot observe from code. It will
# not guess them: a fabricated declaration produces a total that looks
# authoritative and is not.
#
# Brackets below are the Uniswap Foundation's own, from the Hooks Security
# Framework section 2.

[declared]

# Team maturity (0-3). Self-assessed by definition.
#   0  Audited production deployments across 2+ codebases, mature DevOps,
#      active incident response, demonstrated responsibility in past disclosures
#   1  At least one audited production deployment, some operational experience
#   2  Has deployed to production without demonstrable operational maturity
#   3  No prior production deployments, or none with audits and operational rigor
teamMaturity = 3

# TVL potential (0-5). Ask what this pool could hold, not what it holds today.
#   0  Under $100K      1  $100K-$1M      2  $1M-$5M
#   3  $5M-$15M         4  $15M-$50M      5  $50M+ or major integration
tvlPotential = 0

# Largest fee, in basis points, the hook can ever charge a swapper.
# Invariant I2 asserts output never falls short of an unhooked pool by more
# than this. Setting it to 0 is a much stronger claim, and hookrisk will hold
# you to it.
maxFeeBips = 0

# Any dimension hookrisk measures can be overridden here. The manifest records
# the override and keeps the measured value alongside it, so a reader can see
# that you disagreed with the tool and by how much.
# upgradeability = 0

[gate]

# Fail CI when the measured tier is above this one. Commented out on purpose:
# hookrisk measures three of the nine dimensions today, so on most hooks the
# tier is a range (the report says "between Low and High") and a tier gate
# would be gating the tool's coverage, not your hook. Uncomment once the
# declared and measured dimensions leave the tier determined, or set
# failOnInconclusive below to make the range itself a failure.
# maxTier = "medium"

# Fail CI on any finding at or above this severity. Classifications (INFO
# findings that describe the hook rather than accuse it) never count.
maxSeverity = "high"

# Fail when static analysis could not examine every function (HR-E205).
# Right for a release gate on your own hook; too strict for third-party code.
failOnPartialCoverage = false

# Fail when the tier is undetermined and only its upper bound exceeds maxTier.
# Six of the nine dimensions have no detector yet, so with this off an
# undetermined tier passes the tier gate and the report says why. true is the
# strict posture: unknown is not a pass, and you declare the unmeasured
# dimensions in [declared] until the range closes.
failOnInconclusive = false

# Fail when hookrisk could not assess the hook at all: an engine failed (the
# project does not compile under Slither, the harness could not stand the hook
# up) or static analysis never recognised the contract as a v4 hook. A scan
# that assessed nothing must not read as a clean pass. Skipped engines, whose
# reason is recorded, do not count.
failOnNotAnalysed = true

[engines]

# hookrisk's own Slither detectors.
hookrisk = true

# BlockSec HookScan (AGPL-3.0, https://github.com/blocksecteam/hookscan).
# Runs as an isolated container and needs \`docker pull futuretech6/hookscan\`.
# Findings both engines agree on are merged into one at raised confidence.
blocksec = false

[harness]

# Constructor arguments for the differential harness, one string per ABI input.
# Not needed when the constructor takes nothing or only the IPoolManager.
# Placeholders are replaced with the harness's own deployment:
#   $poolManager  $currency0  $currency1  $owner (the test contract)  $hook
# Anything else is passed literally to \`cast abi-encode\`, so write values the
# way cast accepts them (decimal integers, 0x-prefixed addresses and bytes).
# constructorArgs = ["$poolManager", "3000", "$owner"]
`;
}
