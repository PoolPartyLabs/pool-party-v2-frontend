/**
 * @id PP-CORE-LIB-068 (POO-243, POO-1388)
 * @name structured logger
 * @implements-rules-version v3 (POO-1388 rules v1) · v2 (POO-1147) · v1 (POO-243)
 *
 * The platform structured logger three modules already asked for by name. `observeAnalyticsFailure`
 * (PP-REW, POO-567), `observeGateContextFailure` (POO-1098) and `mediaSaveLog` (POO-702) each carried
 * the same marker: "swap console.warn for the platform structured logger once one exists". This is it,
 * generalized from `observeAnalyticsFailure` rather than invented, because that prototype had already
 * worked out the two things that matter.
 *
 * ## What was lifted from the prototype
 *
 * 1. A FLAT, greppable context object. Nested shapes are unqueryable in `docker logs | jq`.
 * 2. Deliberate SUPPRESSION of expected non-outages. `observeAnalyticsFailure` stays silent on
 *    `SYSTEM_NOT_CONFIGURED` (mock mode) and a per-wallet 404, because a signal that fires on the
 *    normal case is noise, and noise is why nobody reads the logs. {@link isExpectedNonOutage} keeps
 *    that discipline available to every caller instead of one module.
 *
 * ## What changed
 *
 * One JSON object per line, not `console.warn(msg, obj)`. Node's console renders a second argument
 * with `util.inspect`, which line-wraps and colour-codes: the result is human-shaped and machine-hostile,
 * so it cannot be shipped to a log store or queried. The container writes stdout, so JSON per line is
 * the format that survives the hop. `event` is the stable, greppable token that replaces the old
 * message prefix (`grep '"event":"media.save_failed"'`).
 *
 * ## Privacy
 *
 * Server logs stay inside our infrastructure, but a wallet address is still an identity, so it never
 * lands raw: {@link redactAddresses} masks every `0x…` in any string field down to `0x1234…cdef`.
 * That is deliberately masking and not hashing. An unsalted hash of an address is reversible by
 * anyone holding the (public, enumerable) address set, so it would buy the appearance of privacy and
 * not the fact of it, while an HMAC (`hashWalletAddress`) is async and secret-dependent and cannot be
 * called from a synchronous log path. Masking is honest about what it is: enough to correlate two
 * lines of one incident, not enough to be a wallet.
 *
 * Server-only: the browser reports through `reportClientError` → `/api/client-error`, which re-clips
 * everything server-side (never trust a client-supplied payload) and then logs through here.
 *
 * ## v2 (POO-1147): `error` lines are also Sentry events
 *
 * `logError` forwards to Sentry; `debug`/`info`/`warn` do not. The split is deliberate and it is
 * about volume, not importance. The three `logError` sites (two zod parse failures, one media-save
 * failure) are exactly the "this is broken" class, and the fields they carry - which field drifted,
 * on which endpoint, under which request id - are the artefact that is missing from the exception
 * Next surfaces on its own. `warn` is the degrade class: it is already suppressed for expected
 * non-outages, it is high-volume by design, and the browser-side warns re-logged by
 * `/api/client-error` reach Sentry from the BROWSER already (`reportClientError`), so forwarding them
 * here would double-count the same failure under two different events.
 *
 * {@link redactAddresses} and {@link isExpectedNonOutage} now live in client-safe leaves and are
 * re-exported unchanged, because the browser needs the same masking and the same suppression rule.
 *
 * ## v3 (POO-1388): EVERY level is also a Sentry LOG
 *
 * The v2 split above still holds for ISSUES, and it is not what changed. What changed is that
 * `debug`/`info`/`warn` now reach Sentry as LOGS ({@link forwardToSentryLogs}), a different product
 * with different economics from an issue.
 *
 * The reason is the support handle. A user quotes a reference off the error dialog (POO-1251); under
 * v2 that id resolved to at most the single `error` line, because the surrounding context existed
 * only in container stdout, which a recreate rotates away (POO-1354). An operator could see THAT
 * something failed and never the sequence that led there, which is most of a diagnosis.
 *
 * `enableLogs: true` in `sentry/options.ts` is the other half and neither works alone: the flag is
 * transport with no emitter, and the emitter is a no-op with the flag off. An `error` now does BOTH
 * (issue + log), deliberately, so grouping and alerting are unchanged.
 */
import "server-only";

import { captureMessage, logger as sentryLogger } from "@sentry/nextjs";
import type { ZodIssue } from "zod";
import { isExpectedNonOutage } from "./expectedFailure";
import { redactAddresses } from "./redact";

export { isExpectedNonOutage, redactAddresses };

/** Syslog-ish levels, mapped onto the matching `console` method so container stdout keeps the stream. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Arbitrary flat context attached to a log line. `undefined` values are dropped, never emitted. */
export type LogFields = Record<string, unknown>;

/** One emitted line. `event` is the stable grep token; everything else is context. */
export interface StructuredLogRecord extends LogFields {
  /** ISO-8601 UTC timestamp. */
  ts: string;
  level: LogLevel;
  event: string;
}

/**
 * A string longer than this is truncated. Upstream messages and zod paths are short; anything longer
 * is an accident (a whole response body, a stack) and a log store charges by the byte for it.
 */
const MAX_STRING_CHARS = 512;
/** Beyond this many zod issues the tail adds no diagnostic value: the first few name the drift. */
const MAX_ISSUES = 20;
/** Nested depth beyond this is dropped: a flat line is the point. */
const MAX_DEPTH = 3;
/** Arrays longer than this are truncated (with a `+N more` marker) rather than emitted whole. */
const MAX_ARRAY_ITEMS = 25;

/** Clip + redact a string for a log line. */
function safeString(value: string): string {
  const redacted = redactAddresses(value);
  return redacted.length > MAX_STRING_CHARS ? `${redacted.slice(0, MAX_STRING_CHARS)}…` : redacted;
}

/**
 * Reduce any value to something JSON-safe, bounded and PII-masked. Errors become their name+message
 * (never a stack: it is long, noisy, and the `event` + `code` already localise the failure), BigInt
 * becomes a string (the on-chain numerics convention), functions and symbols are dropped.
 */
function toLogSafe(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return safeString(value);
  if (value instanceof Error) return safeString(`${value.name}: ${value.message}`);
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => toLogSafe(item, depth + 1));
    return value.length > MAX_ARRAY_ITEMS
      ? [...items, `+${value.length - MAX_ARRAY_ITEMS} more`]
      : items;
  }
  if (typeof value === "object") {
    const out: LogFields = {};
    for (const [key, item] of Object.entries(value as LogFields)) {
      const safe = toLogSafe(item, depth + 1);
      if (safe !== undefined) out[key] = safe;
    }
    return out;
  }
  return undefined;
}

/** Build the record without emitting it. Exported for tests and for the ingest route's re-clip. */
export function buildLogRecord(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
): StructuredLogRecord {
  // `event` is masked like any other string, which it was NOT before POO-1388.
  //
  // It used to be assigned verbatim and then skipped by the loop below, which was defensible while a
  // log line went only to our own stdout. It is not defensible now: `forwardToSentryLogs` promotes
  // this exact string to the Sentry log MESSAGE, and `/api/client-error` passes a CLIENT-SUPPLIED
  // `event` straight into `logWarn`. An unauthenticated caller could therefore write arbitrary,
  // unmasked text into the third-party store that `trace-investigate` teaches an operator to read as
  // evidence when answering "did this user's money move". A no-op on every real event token
  // (`api.response_parse_failed`, `catalog.v2_degraded`): they carry no hex and are far under the cap.
  const record: StructuredLogRecord = {
    ts: new Date().toISOString(),
    level,
    event: safeString(event),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (key === "ts" || key === "level" || key === "event") continue;
    const safe = toLogSafe(value);
    if (safe !== undefined) record[key] = safe;
  }
  return record;
}

/** The console method per level, so a warn keeps landing on stderr and an info on stdout. */
const SINK: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

/**
 * Emit one JSON object on one line. Never throws: an observability call that can take down the
 * caller is worse than no observability at all (this is the whole reason the degrade paths below
 * are safe to instrument).
 *
 * (POO-1147) `error` lines are ALSO sent to Sentry, from the already-built record, so the event
 * carries the same masked, clipped, flat fields the log line does and cannot disagree with it. A
 * no-op when Sentry is disabled; wrapped in its own `try` so a vendor failure cannot cost us the
 * stdout line, which is the sink we control.
 */
export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  let record: StructuredLogRecord | undefined;
  try {
    record = buildLogRecord(level, event, fields);
    SINK[level](JSON.stringify(record));
  } catch {
    // A circular or unserializable field must not break the request being logged.
  }
  if (record) forwardToSentryLogs(level, record);
  if (level === "error" && record) forwardErrorToSentry(record);
}

/**
 * Attribute keys that are promoted to Sentry's own snake_case convention, so a log attribute and the
 * TAG that `forwardErrorToSentry` sets for the same value are searchable by the same name. Without
 * this, an error's issue is found by `trace_id` and its surrounding log lines by `traceId`, which is
 * the exact seam a support handle is supposed to remove.
 */
const SENTRY_ATTRIBUTE_ALIASES: Record<string, string> = {
  traceId: "trace_id",
  requestId: "request_id",
};

/**
 * Ship one record to Sentry LOGS, at its own level (POO-1388 [R2]).
 *
 * ## Why this exists next to `forwardErrorToSentry` rather than instead of it
 *
 * They answer different questions. An `error` line files an ISSUE, which is what groups, alerts and
 * carries a release; this ships a LOG, which is what gives an operator the `info`/`warn` context
 * AROUND that failure. Before this, only the first existed, so a trace id a user quoted resolved to
 * the single failing line and nothing else - the timeline that makes the failure legible lived only
 * in container stdout, which a recreate rotates away (POO-1354). An `error` therefore does both, on
 * purpose, and that is asserted rather than left to be discovered.
 *
 * The record is ALREADY masked and bounded by `buildLogRecord`, so this cannot widen what a log line
 * discloses ([R3]): it re-ships the exact object stdout received, only under different key names.
 */
/**
 * Event tokens excluded from the Sentry LOG channel (POO-1387 review, Rafael 2026-08-06).
 *
 * `csp.violation` is emitted once per Report-Only violation by every visitor, is unbounded, is driven
 * by whatever extensions and injected scripts a stranger's browser is running, and carries no
 * `traceId`. So it can never answer the question this channel exists for, which is "what happened
 * under the reference this user quoted", while consuming the same budget as the events that can.
 * `options.ts` supplies the reason that makes it matter: an exhausted quota drops ERROR events too.
 *
 * The Privy relay's PER-REQUEST events (`privy.webhook.relay.forwarded`, `.rejected`, `.unreadable`)
 * are the same shape of cost for the same reason: the relay sits on the only public door the stack
 * has, so an unauthenticated flood bills one log event per POST, and the quota it burns is the quota
 * the real ERROR events need. Its OUTAGE events (`privy.webhook.relay.unreachable` and
 * `.unconfigured`) are deliberately NOT here: they fire only when the API is down or misconfigured,
 * they stop on their own once it is back, and losing that alert costs more than the quota does.
 *
 * They still reach stdout and still file a Sentry ISSUE through `forwardErrorToSentry` when they are
 * an `error`. This suppresses one sink, not the signal.
 */
const LOG_CHANNEL_EXCLUDED_EVENTS = new Set([
  "csp.violation",
  "privy.webhook.relay.forwarded",
  "privy.webhook.relay.rejected",
  "privy.webhook.relay.unreadable",
]);

function forwardToSentryLogs(level: LogLevel, record: StructuredLogRecord): void {
  if (LOG_CHANNEL_EXCLUDED_EVENTS.has(record.event)) return;
  try {
    const attributes: LogFields = {};
    for (const [key, value] of Object.entries(record)) {
      // `ts` and `level` are Sentry's own envelope fields, and `event` becomes the log message.
      if (key === "ts" || key === "level" || key === "event") continue;
      attributes[SENTRY_ATTRIBUTE_ALIASES[key] ?? key] = value;
    }
    sentryLogger[level](record.event, attributes);
  } catch {
    // Best-effort by definition: the stdout line above already landed, and it is the sink we own.
  }
}

/**
 * Send one `error` record to Sentry as a message keyed on the stable `event` token, so it groups by
 * failure KIND (`api.response_parse_failed`) rather than by whatever string the upstream produced.
 * The trace id is a tag, which is what makes a Sentry issue and a container log line searchable by
 * the same value.
 */
function forwardErrorToSentry(record: StructuredLogRecord): void {
  try {
    // Same skip list as `buildLogRecord`: `ts` and `level` are Sentry's own envelope fields, and
    // `event` is promoted to the message + a tag.
    const extra: LogFields = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "ts" || key === "level" || key === "event") continue;
      extra[key] = value;
    }
    const tags: Record<string, string> = { log_event: record.event };
    if (typeof record.traceId === "string") tags.trace_id = record.traceId;
    if (typeof record.requestId === "string") tags.request_id = record.requestId;
    captureMessage(record.event, { level: "error", tags, extra });
  } catch {
    // Reporting is best-effort by definition; the stdout line above already landed.
  }
}

export const logDebug = (event: string, fields?: LogFields): void =>
  logEvent("debug", event, fields);
export const logInfo = (event: string, fields?: LogFields): void => logEvent("info", event, fields);
export const logWarn = (event: string, fields?: LogFields): void => logEvent("warn", event, fields);
export const logError = (event: string, fields?: LogFields): void =>
  logEvent("error", event, fields);

/** One zod issue, flattened to the four fields that actually name the drift. */
export interface LoggedZodIssue {
  /** Dotted path into the payload, e.g. `strategies.0.tvlUsd`. `<root>` when the issue is top-level. */
  path: string;
  /** Zod's discriminator, e.g. `invalid_type`, `unrecognized_keys`. */
  code: string;
  /** What the schema wanted, when the issue carries it. */
  expected?: string;
  /** What the payload had, when the issue carries it. */
  received?: string;
  message: string;
}

/**
 * Flatten `ZodIssue[]` into the log payload that answers the only question a parse failure raises:
 * WHICH field drifted, and from what to what.
 *
 * `expected`/`received` are read by duck-typing because they exist on some issue variants and not
 * others, and for `invalid_type` (the drift that actually happens across a service boundary) they are
 * type NAMES, not values. Both are clipped and address-masked anyway, since a literal/enum issue can
 * carry a real value.
 */
export function summarizeZodIssues(issues: readonly ZodIssue[]): LoggedZodIssue[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => {
    const raw = issue as unknown as Record<string, unknown>;
    const summary: LoggedZodIssue = {
      path: issue.path.length > 0 ? issue.path.join(".") : "<root>",
      code: issue.code,
      message: safeString(issue.message),
    };
    if (raw.expected !== undefined) summary.expected = safeString(String(raw.expected));
    if (raw.received !== undefined) summary.received = safeString(String(raw.received));
    return summary;
  });
}
