/**
 * Scan logging.
 *
 * One scan runs several engines and the harness concurrently, each shelling out
 * to a different tool. Once those overlap, a flat stream of progress lines stops
 * being readable and stops being parseable: you cannot tell which subprocess a
 * line came from, and you cannot correlate two scans in the same CI job.
 *
 * So every line is an *event* with a run id and a stage, and the logger decides
 * how to render it:
 *
 *   human (default)   the existing verbose lines, byte for byte, on stderr, and
 *                     only when `--verbose` — the stage is dropped because the
 *                     messages already name themselves (`harness: …`).
 *   json (--log-json) one JSON object per line on stderr, always, whatever
 *                     `--verbose` says: a machine consumer asking for the log
 *                     is asking for all of it.
 *
 * stdout is left alone in both modes. It carries the human summary, or the
 * manifest under `--json`, and nothing else.
 *
 * Engines and the harness take a plain `(message: string) => void`, which is the
 * right interface for them — they should not have to know what a stage is. So
 * {@link Logger.stage} hands out a pre-tagged sink instead of widening theirs.
 */

import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Extra structured context. Only rendered in JSON mode. */
export type LogFields = Record<string, unknown>;

/** Keys the envelope owns; a field of the same name cannot displace them. */
const RESERVED = new Set(['ts', 'runId', 'level', 'stage', 'msg']);

export interface Logger {
  /** Correlates every line of one scan, and the artifacts it produced. */
  readonly runId: string;
  /** True when output is JSON, so callers can skip building expensive fields. */
  readonly json: boolean;
  /**
   * A sink for one stage, with the signature engines and the harness already
   * take. `logger.stage('engine:hookrisk')` returns something that can be passed
   * straight in as `ctx.log`.
   */
  stage(stage: string): (message: string) => void;
  /** Emit one event. */
  event(level: LogLevel, stage: string, msg: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Emit JSON lines instead of the human text. */
  json: boolean;
  /** Human mode only: without it, nothing is printed. */
  verbose: boolean;
  /** Defaults to a fresh UUID. Injected by tests, and by anything replaying. */
  runId?: string;
  /** Defaults to stderr. */
  stream?: { write(chunk: string): unknown };
  /** Injected by tests so a JSON line is comparable. */
  now?: () => Date;
}

export function createLogger(options: LoggerOptions): Logger {
  const runId = options.runId ?? randomUUID();
  const stream = options.stream ?? process.stderr;
  const now = options.now ?? ((): Date => new Date());

  const event = (level: LogLevel, stage: string, msg: string, fields?: LogFields): void => {
    if (options.json) {
      const line: Record<string, unknown> = {
        ts: now().toISOString(),
        runId,
        level,
        stage,
        msg,
      };
      for (const [key, value] of Object.entries(fields ?? {})) {
        // The envelope wins. A stage that logs `{msg: …}` would otherwise
        // silently replace the message, which is the one field a reader greps.
        if (!RESERVED.has(key)) line[key] = value;
      }
      stream.write(`${JSON.stringify(line)}\n`);
      return;
    }

    // Unchanged from the pre-logger CLI: two spaces, the message, a newline.
    if (options.verbose) stream.write(`  ${msg}\n`);
  };

  return {
    runId,
    json: options.json,
    event,
    stage(stage: string) {
      return (message: string): void => event('info', stage, message);
    },
  };
}
