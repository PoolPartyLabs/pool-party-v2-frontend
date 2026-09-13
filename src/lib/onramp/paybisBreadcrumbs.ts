/**
 * @id PP-CORE-LIB-090 (POO-1404, POO-1598)
 * @name Paybis widget breadcrumbs
 * @implements-rules-version v1 (POO-1598 rules v1) · v1 (POO-1404 rules v1)
 * @analytics-events none, a diagnostics sink rather than a product surface. The on-ramp funnel is
 *   measured by the screens that own the purchase; a second emitter on the same lifecycle would
 *   double-count every purchase in GA4 while measuring nothing new.
 *
 * Record every message the Paybis widget sends us as a Sentry breadcrumb, so a captured on-ramp
 * failure arrives with the SEQUENCE that produced it instead of only its last frame.
 *
 * ## The gap this closes, stated exactly
 *
 * POO-1387/1388/1390 made an on-ramp failure produce a Sentry event and a log line, and POO-1390
 * added the vendor's own reason. Between them they answer "what failed" and "what did Paybis say".
 * They do not answer "what was happening just before", and on a third-party embedded checkout that
 * is usually the question, because the interesting part happens inside an iframe we cannot see into.
 *
 * The SDK's default breadcrumbs do not help here. It instruments console, fetch/XHR, DOM clicks and
 * navigation; the widget communicates over `postMessage`, which it does not touch. So the single
 * richest signal available to us was being dropped on the floor.
 *
 * ## Why it records the messages we DISCARD, not just the ones we act on
 *
 * `parsePaybisWidgetEvent` deliberately returns `null` for anything outside `PAYBIS_WIDGET_EVENTS`
 * (`showLoader`, `payment-initiated`, `payout-waiting`, `payment-redirect`, …) so the hook cannot
 * mis-branch on a state it does not model. That is right for CONTROL FLOW and wrong for
 * DIAGNOSIS: those are exactly the steps a user walks through before the thing dies, and their
 * absence is why a report can say "it broke at the payment step" while our telemetry says only
 * "error".
 *
 * So this sits BEFORE the parser, sees the raw envelope, and records everything. An unrecognised
 * name is recorded under its own name rather than dropped, which also means a vendor that adds a
 * lifecycle state shows up in the timeline the first time it fires instead of the first time
 * somebody reads their changelog.
 *
 * ## What it costs, and the two bounds that keep it honest
 *
 * Breadcrumbs are held in memory and attached only to an event that is actually SENT, so a session
 * that never fails costs one array and no network. `MAX_PAYLOAD_KEYS` and the value clipping in
 * {@link summarisePayload} stop a vendor payload from inflating an event, and every string runs
 * through the same masking the rest of this seam uses, because a KYC step's payload is exactly where
 * an email or a document number would appear.
 *
 * PP-SECURITY: called only AFTER `isPaybisWidgetOrigin` has vouched for the sender. Any other frame
 * on the page can post a message; recording those would let a hostile iframe write our incident
 * timeline.
 */
import { addBreadcrumb } from "@sentry/nextjs";
import { redactSecrets } from "@/lib/observability/redact";

/**
 * Keys whose VALUE is redacted outright, regardless of shape (POO-1404 security review).
 *
 * `redactSecrets` masks hex only: an `0x`-prefixed run of 8+, or a bare run of 40+. It is
 * structurally blind to the data a KYC vendor actually holds. A CPF is eleven digits, an email has
 * no hex run, a name is a name. This is the PIX flow, so those are not hypothetical fields.
 *
 * A DENYLIST rather than a key allowlist, deliberately, because the module exists to surface states
 * the vendor has not told us about and an allowlist would drop exactly those. The tradeoff is stated
 * rather than hidden: a field named something we did not anticipate gets through, and the value-level
 * email pattern below is the second line for the most likely of those.
 */
const SENSITIVE_KEY =
  /email|phone|mobile|tel|name|document|passport|card|pan|iban|cpf|cnpj|ssn|tax|dob|birth|address|street|postal|zip/i;

/** Value-level backstop for the shape most likely to appear under a key we did not predict. */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/** Names and states are clipped too: an unbounded one can push the event past Sentry's size limit. */
const MAX_STEP_CHARS = 64;

/** Beyond this many keys a payload is a document, not a signal. */
const MAX_PAYLOAD_KEYS = 12;
/** Per-value clip. Long enough for a reason, short enough that ten of them are not an event. */
const MAX_VALUE_CHARS = 120;

/** The breadcrumb category, so a reader can filter the widget's story out of the page's. */
export const PAYBIS_BREADCRUMB_CATEGORY = "onramp.paybis";

/**
 * Flatten a vendor payload to a bounded, masked, primitive-only bag.
 *
 * Deliberately shallow: one level is where a lifecycle payload keeps its meaning, and walking deeper
 * turns an unknown third-party shape into an unbounded traversal on the failure path.
 */
function summarisePayload(payload: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (payload === null || typeof payload !== "object") return out;
  let kept = 0;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (kept >= MAX_PAYLOAD_KEYS) break;
    if (value === null || value === undefined) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "string") {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = "[redacted]";
        kept += 1;
        continue;
      }
      const masked = redactSecrets(value).replace(EMAIL, "[email]");
      out[key] = masked.length > MAX_VALUE_CHARS ? `${masked.slice(0, MAX_VALUE_CHARS)}…` : masked;
    } else {
      // An object or array: record that it was there and its shape, not its contents.
      out[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
    }
    kept += 1;
  }
  return out;
}

/**
 * Decode just enough of the envelope to name the step. Mirrors `parsePaybisWidgetEvent`'s tolerance
 * (JSON string, object, nested `state`, flat name, bare string) WITHOUT its allowlist, because the
 * point here is to see the states we do not model.
 */
/** Clip a vendor-controlled label. Unbounded here can push the event past Sentry's size limit,
 * which would DROP the error this module exists to enrich. */
const clip = (v: string): string => (v.length > MAX_STEP_CHARS ? v.slice(0, MAX_STEP_CHARS) : v);

export interface PaybisMessageDescription {
  /** The lifecycle step, already clipped: `state:<state>` for a transition, else the message name. */
  step: string;
  /** The envelope's `namespace`, when it sent one. Reported, never gated on (see the module header). */
  namespace?: string;
  /** The envelope's `payload`, untouched. Every consumer is responsible for its own masking. */
  payload: unknown;
}

/**
 * Exported for the ONE other reader of this stream, `capturePaybisMessage` (PP-CORE-LIB-102,
 * POO-1598).
 *
 * That module records the same messages for a different purpose, a replayable fixture of a real
 * production purchase rather than a breadcrumb attached to an error, and the two deliberately do
 * NOT share their redaction: this one is a denylist because it exists to surface states the vendor
 * has not told us about, and the capture is an allowlist because its output is destined for a
 * committed artifact in a public repo. What they must never disagree on is the DECODE, because the
 * envelope has three layers and reading the wrong one is precisely the bug that shipped four times
 * (POO-1368, POO-1369, POO-1373, POO-1377). So the decoder is shared and the masking is not.
 */
export function describePaybisMessage(data: unknown): PaybisMessageDescription {
  let decoded: unknown = data;
  if (typeof data === "string") {
    try {
      decoded = JSON.parse(data);
    } catch {
      return { step: data.slice(0, 64), payload: undefined };
    }
  }
  if (decoded === null || typeof decoded !== "object") {
    return { step: String(decoded).slice(0, 64), payload: undefined };
  }
  const source = decoded as { name?: unknown; namespace?: unknown; payload?: unknown };
  const name = typeof source.name === "string" ? clip(source.name) : "unknown";
  const namespace = typeof source.namespace === "string" ? clip(source.namespace) : undefined;
  const payload = source.payload;
  // `{ name: 'state', payload: { state } }` is the shape the SDK actually emits, so surface the
  // STATE as the step rather than the literal string "state" ten times in a row.
  if (name === "state" && payload !== null && typeof payload === "object") {
    const state = (payload as { state?: unknown }).state;
    if (typeof state === "string") return { step: `state:${clip(state)}`, namespace, payload };
  }
  return { step: name, namespace, payload };
}

/**
 * Record one widget message. Never throws: a breadcrumb may not become the error it exists to
 * explain, and this runs inside the message listener of a live checkout.
 */
export function breadcrumbPaybisMessage(data: unknown): void {
  try {
    const { step, payload } = describePaybisMessage(data);
    addBreadcrumb({
      category: PAYBIS_BREADCRUMB_CATEGORY,
      type: "info",
      // `error` is the one state worth colouring, so a timeline shows where it turned.
      level: step === "error" || step.startsWith("state:rejected") ? "error" : "info",
      message: step,
      data: summarisePayload(payload),
    });
  } catch {
    // Best-effort by definition.
  }
}
