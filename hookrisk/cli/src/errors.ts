/**
 * Error catalogue for the TypeScript side.
 *
 * Loads the same `errors/catalog.json` the Python detectors load, so a failure
 * reads identically whichever surface produced it. The catalogue is the source
 * of truth; this file is a reader, not a second copy.
 *
 * The Python detectors report findings only; classification is the CLI's
 * equivalent and `docs/TROUBLESHOOTING.md`, which is generated from the same
 * file.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ErrorCode = string;

export interface ErrorSpec {
  code: ErrorCode;
  title: string;
  cause: string;
  fix: string[];
  exitCode: number;
  match: RegExp[];
  seeAlso: string[];
}

interface RawEntry {
  code: string;
  title: string;
  cause: string;
  fix?: string[];
  exitCode: number;
  match?: string[];
  seeAlso?: string[];
}

interface RawCatalog {
  version: number;
  reserved: Record<string, string>;
  errors: RawEntry[];
}

/** Used when a failure cannot be matched to anything more specific. */
export const FALLBACK_CODE = 'HR-E901';

/** Scan completed and the risk gate failed. A result, not an error. */
export const EXIT_GATE_FAILED = 2;

let cached: Map<ErrorCode, ErrorSpec> | null = null;
let cachedReserved: Record<string, string> = {};

function candidatePaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const override = process.env.HOOKRISK_ERROR_CATALOG;
  return [
    ...(override ? [override] : []),
    // dist/ -> package root -> repo root
    resolve(join(here, '..', '..', 'errors', 'catalog.json')),
    resolve(join(here, '..', 'errors', 'catalog.json')),
  ];
}

/** Parse and cache the catalogue. */
export function catalog(): Map<ErrorCode, ErrorSpec> {
  if (cached) return cached;

  let raw: RawCatalog | null = null;
  const tried: string[] = [];
  for (const path of candidatePaths()) {
    tried.push(path);
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as RawCatalog;
      break;
    } catch {
      // Try the next location.
    }
  }

  if (!raw) {
    // Deliberately a plain Error: without the catalogue we cannot describe this
    // failure in the catalogue's own terms, and pretending otherwise recurses.
    throw new Error(
      `hookrisk error catalogue not found. Searched:\n  ${tried.join('\n  ')}\n` +
        'Set HOOKRISK_ERROR_CATALOG to its location.',
    );
  }

  cachedReserved = raw.reserved ?? {};
  cached = new Map(
    raw.errors.map((entry) => [
      entry.code,
      {
        code: entry.code,
        title: entry.title,
        cause: entry.cause,
        fix: entry.fix ?? [],
        exitCode: entry.exitCode,
        match: (entry.match ?? []).map((p) => new RegExp(p, 'im')),
        seeAlso: entry.seeAlso ?? [],
      },
    ]),
  );
  return cached;
}

export function reservedExitCodes(): Record<string, string> {
  catalog();
  return cachedReserved;
}

export function specFor(code: ErrorCode): ErrorSpec {
  const entries = catalog();
  return entries.get(code) ?? entries.get(FALLBACK_CODE)!;
}

/**
 * Map raw tool output onto a catalogue entry.
 *
 * Entries are tested in catalogue order, which runs most specific to most
 * general, so a message matching both a precise and a broad entry gets the
 * precise diagnosis.
 */
export function classify(text: string): ErrorSpec | null {
  if (!text) return null;
  for (const spec of catalog().values()) {
    if (spec.match.length > 0 && spec.match.some((re) => re.test(text))) {
      return spec;
    }
  }
  return null;
}

/** A catalogue code already embedded in a rendered message. */
const EMBEDDED_CODE = /\bHR-E\d{3}\b/;

/**
 * The catalogue code for a failure, or undefined when nothing matches.
 *
 * Companion to {@link describeFailure}, which produces prose for a human. This
 * produces the identifier a machine branches on: `engines[].errorCode` in the
 * manifest, `errorCode` in a `--log-json` line, a CI job asserting *which*
 * failure it got rather than that it got one.
 *
 * It reads an already-rendered reason first. Engine reasons come from
 * `describeFailure`, so they open with the code; re-running the match regexes
 * over that text would re-derive it from a paraphrase and can land somewhere
 * else, which is how a single failure ends up with two names.
 */
export function errorCodeFor(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const embedded = EMBEDDED_CODE.exec(output);
  if (embedded) return embedded[0];
  return classify(output)?.code;
}

/**
 * One-line diagnosis of raw tool output, for an engine's `reason` field.
 *
 * `HR-E203 Target compiles under forge but not under Slither: Error (7920):
 * Identifier not found or not unique. --> src/RefHook.sol:144:59` is something
 * a user can act on. The empty string after a colon, which is what the Slither
 * adapter used to produce, is not. So the contract here is: never empty. A
 * catalogue match gives the code and title; the most informative line of output
 * follows; with no match the last three non-empty lines stand in; with no output
 * at all the caller's `fallback` does.
 */
export function describeFailure(output: string, fallback = 'the tool produced no output'): string {
  const text = output.trim();
  if (!text) return fallback;

  const spec = classify(text);
  const line = mostInformativeLine(text);
  if (spec) return `${spec.code} ${spec.title}${line ? `: ${line}` : ''}`;

  const tail = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-3)
    .join(' | ');
  return tail || fallback;
}

/** A Python traceback frame, or the caret/tilde rulers 3.13 prints beneath one. */
const TRACEBACK_NOISE = /^(Traceback \(most recent call last\)|\s*File "|\s*[~^]+\s*$)/;

/** crytic-compile relays forge's streams with these prefixes. */
const RELAY_PREFIX = /^(stdout|stderr):\s*/;

/**
 * The line worth showing from a failed tool run.
 *
 * A solc diagnostic (`Error (7920): ...`) is the actual cause of nearly every
 * compile failure, and it is followed by a `--> file:line:col` pointer, so the
 * two are joined and preferred over anything else. Failing that, the last line
 * that is not traceback scaffolding: Python prints the exception message last,
 * which is exactly where the useful text sits.
 */
export function mostInformativeLine(output: string): string | undefined {
  const lines = output
    .split('\n')
    .map((l) => l.replace(RELAY_PREFIX, '').trimEnd())
    .filter((l) => l.trim().length > 0 && !TRACEBACK_NOISE.test(l));

  // Numbered, so forge's own `Error: Compiler run failed:` wrapper does not win
  // over the diagnostic it wraps.
  const solc = lines.findIndex((l) => /^Error \(\d+\):/.test(l.trim()));
  if (solc >= 0) {
    const pointer = lines.slice(solc + 1, solc + 3).find((l) => /^\s*-->/.test(l));
    const message = lines[solc]!.trim();
    return pointer ? `${message} ${pointer.trim()}` : message;
  }

  return lines.length > 0 ? lines[lines.length - 1]!.trim() : undefined;
}

export interface HookriskErrorOptions {
  detail?: string;
  rawOutput?: string;
  context?: Record<string, string>;
  cause?: unknown;
}

/** A failure with a catalogue entry behind it. */
export class HookriskError extends Error {
  readonly spec: ErrorSpec;
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly rawOutput?: string;
  readonly context: Record<string, string>;

  constructor(code: ErrorCode, options: HookriskErrorOptions = {}) {
    const spec = specFor(code);
    super(`[${spec.code}] ${spec.title}`);
    this.name = 'HookriskError';
    this.spec = spec;
    this.code = spec.code;
    this.detail = options.detail;
    this.rawOutput = options.rawOutput;
    this.context = options.context ?? {};
    if (options.cause !== undefined) this.cause = options.cause;
  }

  get exitCode(): number {
    return this.spec.exitCode;
  }

  /** Classify raw output and build the matching error. */
  static fromOutput(text: string, options: HookriskErrorOptions = {}): HookriskError {
    const spec = classify(text);
    return new HookriskError(spec?.code ?? FALLBACK_CODE, { ...options, rawOutput: text });
  }

  /**
   * Format for a terminal: title, cause, numbered fixes, then raw output.
   *
   * Raw output goes last and is truncated. It matters for debugging but it is
   * the least useful thing on screen, and leading with it is how tools teach
   * users to ignore their own error messages.
   */
  render(useColour = supportsColour()): string {
    const c = useColour
      ? { bold: '[1m', dim: '[2m', red: '[31m', reset: '[0m' }
      : { bold: '', dim: '', red: '', reset: '' };

    const lines: string[] = [`${c.red}${c.bold}${this.code}${c.reset}${c.bold}  ${this.spec.title}${c.reset}`, ''];

    if (this.detail) lines.push(`  ${this.detail}`, '');
    lines.push(`  ${c.dim}Why:${c.reset} ${this.spec.cause}`, '');

    if (this.spec.fix.length > 0) {
      lines.push(`  ${c.dim}Try:${c.reset}`);
      this.spec.fix.forEach((step, i) => lines.push(`    ${i + 1}. ${step}`));
      lines.push('');
    }

    const contextKeys = Object.keys(this.context);
    if (contextKeys.length > 0) {
      const width = Math.max(...contextKeys.map((k) => k.length));
      lines.push(`  ${c.dim}Context:${c.reset}`);
      for (const [key, value] of Object.entries(this.context)) {
        lines.push(`    ${key.padEnd(width)}  ${value}`);
      }
      lines.push('');
    }

    if (this.spec.seeAlso.length > 0) {
      lines.push(`  ${c.dim}See also:${c.reset}`);
      this.spec.seeAlso.forEach((url) => lines.push(`    ${url}`));
      lines.push('');
    }

    if (this.rawOutput) {
      const all = this.rawOutput.trim().split('\n');
      const shown = all.slice(-12);
      const elided = all.length - shown.length;
      lines.push(
        `  ${c.dim}Tool output${elided > 0 ? ` (last 12 of ${all.length} lines)` : ''}:${c.reset}`,
      );
      shown.forEach((line) => lines.push(`    ${c.dim}${line}${c.reset}`));
      lines.push('');
    }

    lines.push(`  ${c.dim}Full reference: docs/TROUBLESHOOTING.md#${this.code.toLowerCase()}${c.reset}`);
    return lines.join('\n');
  }
}

/**
 * Colour only when a human is plausibly reading.
 *
 * Honours NO_COLOR (https://no-color.org) and FORCE_COLOR, and stays quiet when
 * the stream is redirected. The stream is a parameter because hookrisk writes
 * to both: errors and the progress log go to stderr, the scan summary to
 * stdout, and `hookrisk scan … > report.txt` must not put escape codes in the
 * file just because the terminal on the other stream is interactive.
 */
export function supportsColour(stream: { isTTY?: boolean } = process.stderr): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(stream.isTTY);
}
