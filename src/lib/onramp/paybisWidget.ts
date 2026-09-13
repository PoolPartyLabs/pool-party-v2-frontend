/**
 * @id PP-CORE-LIB-065 (POO-1134, POO-1390)
 * @name Paybis widget adapter
 * @implements-rules-version v4 (POO-1390 rules v2) · v3 (POO-1390 rules v1) · v2 (POO-1129 rules v2)
 *
 * The single client-side seam onto Paybis' `partner-exchange-widget.js` SDK: the `window`
 * type declaration (v1 duplicated it across four files; there is no such symbol anywhere in this
 * repo, so it is authored fresh here — POO-1134 comment), the loaded-SDK accessor, the postMessage
 * name parser, and the origin guard. Pure and transport-free: the settlement hook composes these,
 * so they unit-test without a DOM widget.
 *
 * ## Contract (Paybis docs, verified 2026-07-30)
 *
 * `docs.payb.is/docs/embedded-mode` + `/docs/internal-events`:
 *   - `window.PartnerExchangeWidget.openInEmbed({ requestId }, containerElement)` renders the widget
 *     INSIDE `containerElement`. Events only fire in embed/iframe mode — a popup cannot be listened
 *     to — which is why the epic requires embed ([R5]).
 *   - `window.PartnerExchangeWidget.openInEmbed` existing as a function is the readiness signal this
 *     app uses. `isLoaded` reads like readiness and is NOT: the SDK sets it once it has been driven,
 *     so gating the first call on it deadlocks (POO-1369). Paybis' own bootstrap stub implements only
 *     `open`, so `openInEmbed` being callable is precisely the proof the real SDK replaced the stub.
 *   - Events reach the parent as `window.postMessage`, discriminated by `event.data.name`.
 *
 * PP-INTEGRATION-POINT: the SDK is loaded by {@link PaybisWidgetScript} from
 * `NEXT_PUBLIC_PAYBIS_WIDGET_URL`; this module only reads what that script attaches. The exact
 * `event.data` payload beyond `name` is Paybis-owned and consumed defensively (name only).
 */
import { redactSecrets } from "@/lib/observability/redact";

/**
 * The widget lifecycle events this app handles. Paybis emits more (`showLoader`, `hideLoader`,
 * `payment-redirect`, …); those are deliberately not in the set, so {@link parsePaybisWidgetEvent}
 * returns null for them and the hook's listener ignores them rather than mis-branching.
 */
export const PAYBIS_WIDGET_EVENTS = [
  "opened",
  "loaded",
  "closed",
  "completed",
  "rejected",
  "cancelled",
  "error",
] as const;

/** One of the handled widget lifecycle events. */
export type PaybisWidgetEvent = (typeof PAYBIS_WIDGET_EVENTS)[number];

/** The slice of Paybis' `PartnerExchangeWidget` SDK this app calls. */
export interface PartnerExchangeWidget {
  /**
   * Render the widget inside `container` (embed mode). The ONLY mode that emits postMessage events,
   * so the only mode this app uses (POO-1134, scope decision: embed-only, no popup fallback).
   */
  openInEmbed(options: { requestId: string }, container: HTMLElement): void;
  /** Popup mode (v1's path). Present on the SDK; unused here because it emits no events. */
  open(options: { requestId: string }): void;
  /**
   * Set by the SDK once it has been DRIVEN, not when it is ready to be driven. Kept because the SDK
   * exposes it, but NEVER gate the first `openInEmbed` on it: that deadlocks (POO-1369). Use
   * `typeof sdk.openInEmbed === "function"` instead.
   */
  isLoaded?: boolean;
}

declare global {
  interface Window {
    /** Attached by `partner-exchange-widget.js` once {@link PaybisWidgetScript} loads it. */
    PartnerExchangeWidget?: PartnerExchangeWidget;
  }
}

/** The loaded Paybis SDK, or null when the script has not attached it yet (or on the server). */
export function getPartnerExchangeWidget(): PartnerExchangeWidget | null {
  if (typeof window === "undefined") return null;
  return window.PartnerExchangeWidget ?? null;
}

/** A string field on an unknown object, or null. */
function stringField(data: unknown, key: string): string | null {
  if (typeof data !== "object" || data === null || !(key in data)) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * The widget's namespace on the wire. Reported when it is something else, never GATED on: the ORIGIN
 * check is this module's security boundary, and hard-coding a vendor internal we cannot verify is
 * exactly what produced POO-1368, POO-1369, POO-1373 and POO-1377 in turn.
 */
const EXPECTED_NAMESPACE = "widget";

/**
 * Decode a postMessage payload into the object the widget actually sent.
 *
 * POO-1377: `event.data` is a JSON STRING. The vendor's own handler proves it:
 *
 *     let t = e.data;
 *     try { t = JSON.parse(e.data) } catch {}
 *     let { namespace: n = ``, name: r = ``, payload: i = {} } = t;
 *
 * The object form is accepted too, because a vendor that stops serialising must not break us a fifth
 * time.
 */
function decodeEnvelope(data: unknown): unknown {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    // A bare string that is not JSON is still a legal event name in the tolerant path below.
    return data;
  }
}

/**
 * Extract a handled lifecycle event from a postMessage payload, or null.
 *
 * ## POO-1377: the envelope has THREE layers, and we were reading one
 *
 * The wire format is a JSON STRING wrapping `{ namespace, name, payload }`, where a lifecycle
 * transition is `name: "state"` with the value at `payload.state`:
 *
 *     "{\"namespace\":\"widget\",\"name\":\"state\",\"payload\":{\"state\":\"cancelled\"}}"
 *
 * Two enums share vocabulary, which is how this survived so long. From the vendor bundle:
 *
 *     v = { STATE:'state', ERROR:'error', PAYMENT_INITIATED:'payment-initiated', ... }   // message
 *     y = { CLOSED:'closed', LOADED:'loaded', COMPLETED:'completed', OPENED:'opened',
 *           CANCELLED:'cancelled', REJECTED:'rejected', PAYOUT_WAITING:'payout-waiting' } // state
 *
 * This was fixed in layers, once per production release, which is the lesson worth keeping:
 * POO-1373 corrected the NESTING but the payload was still a string, so terminal events STILL never
 * arrived and the user was stranded inside the frame with the app's "opening" caption underneath a
 * finished Paybis receipt. `error` matched throughout only by coincidence, because it exists in both
 * enums AND is sometimes sent flat.
 *
 * Every shape is now accepted: JSON string, object, nested `state`, flat name, bare string.
 */
export function parsePaybisWidgetEvent(data: unknown): PaybisWidgetEvent | null {
  const decoded = decodeEnvelope(data);

  const namespace = stringField(decoded, "namespace");
  if (namespace !== null && namespace !== EXPECTED_NAMESPACE) {
    // Not gated on, only reported: an unexpected namespace is a vendor change we want to hear about
    // before it becomes another silent outage.
    reportUnexpectedNamespace(namespace);
    return null;
  }

  // `{ name: 'state', payload: { state: <lifecycle> } }`, the shape the SDK actually emits.
  if (stringField(decoded, "name") === "state") {
    const payload = (decoded as { payload?: unknown }).payload;
    const state = stringField(payload, "state");
    return state !== null && (PAYBIS_WIDGET_EVENTS as readonly string[]).includes(state)
      ? (state as PaybisWidgetEvent)
      : null;
  }

  // A bare string, or the flat `{ name: <lifecycle> }` (which also carries the real `error` message).
  const name = typeof decoded === "string" ? decoded : stringField(decoded, "name");
  return name !== null && (PAYBIS_WIDGET_EVENTS as readonly string[]).includes(name)
    ? (name as PaybisWidgetEvent)
    : null;
}

/**
 * How much of a vendor reason is worth keeping. It becomes dialog copy and rides into a clipboard
 * payload that gets pasted into a support ticket in our Discord (private to staff), so a vendor stack trace must not fit.
 */
const MAX_REASON_CHARS = 200;

/** The keys a reason has been observed or is plausibly carried under, in precedence order. */
const REASON_KEYS = ["message", "reason", "error", "description"] as const;

/**
 * Personal data shapes stripped from a vendor reason before it is shown or copied (Rafael,
 * 2026-08-06).
 *
 * Paybis is a KYC'd payment vendor, so its terminal reasons can carry the identity data it collected
 * to verify the buyer: "KYC rejected for jane.doe@example.com", "card ending 4242", a document
 * number. `redactSecrets` is HEX-ONLY and catches none of it.
 *
 * The decision was NOT to widen masking generally but to stop HOLDING this class at all: we do not
 * want personal information from a third party's KYC file associated with a wallet, in our error
 * dialog, in a support ticket, or in Sentry. The diagnostic value of "card declined" survives; the
 * identity attached to it does not, and we were never the right party to hold it.
 *
 * A blocklist is the weaker tool and is used here knowingly: the alternative is dropping the reason
 * entirely, which loses the cause that made POO-1390 worth doing. The bound below is the backstop,
 * and an unrecognised shape degrades to the generic sentence rather than leaking ([R5]).
 */
const PERSONAL_DATA_PATTERNS: [RegExp, string][] = [
  // Email, the shape the decision was explicitly about.
  [/[^\s<>()[\]{}]+@[^\s<>()[\]{}]+\.[A-Za-z]{2,}/g, "[email]"],
  // Phone BEFORE the digit run, deliberately: the generic rule would eat the national part and
  // leave the country code and prefix standing ("+44 7700 [number]"), which is both a worse label
  // and a partially identifying string. Most specific pattern first.
  [/\+\d[\d\s().-]{7,}\d/g, "[phone]"],
  // A SEPARATED card number: "4242 4242 4242 4242" and "4242-4242-4242-4242". Reviewed finding
  // (POO-1389 review S4): this is the normal human and vendor rendering of a PAN, the most sensitive
  // shape on this list, and the unseparated rule below misses it entirely because no run reaches six
  // digits. Four groups of four, which is every major card scheme's format.
  [/\b\d{4}[\s-]\d{4}[\s-]\d{4}[\s-]\d{3,4}\b/g, "[number]"],
  // A run of 6+ digits: card fragments, document and order numbers. Deliberately not 4, so
  // "card ending 4242" keeps the fragment that helps a user recognise their own card while a full
  // PAN or document number does not survive.
  //
  // The boundary is `(?<![.\d])`, not `\b`: `\b` fails against a letter-adjacent run, so a document
  // number ("AB1234567"), a national id ("QQ123456C") and an IBAN ("GB29NWBK60161331926819") all
  // survived it whole. The lookbehind still spares a decimal figure, so "30.319876" keeps its
  // meaning while "declined for 123456" does not. Over-redaction is the correct side to err on for
  // a third party's KYC file.
  [/(?<![.\d])\d{6,}/g, "[number]"],
];

/**
 * PP-NOTE (POO-1389 review S4): a NAME is not addressable by any of this, and no regex will make it
 * so. "KYC rejected for Jane Doe" passes through. That is a stated limitation rather than a covered
 * case: the mitigations are the 200-character bound above and the fact that the payload reaches a
 * private staff ticket rather than a public channel. If that stops being acceptable, the answer is
 * an allowlist of known vendor reason codes mapped to our own copy, not a longer blocklist.
 */

/** Strip third-party KYC identity data from a vendor string. */
function redactPersonalData(value: string): string {
  return PERSONAL_DATA_PATTERNS.reduce(
    (acc, [pattern, token]) => acc.replace(pattern, token),
    value,
  );
}

/** First non-empty string among {@link REASON_KEYS} on `source`, already trimmed. */
function readReason(source: unknown): string | undefined {
  for (const key of REASON_KEYS) {
    const value = stringField(source, key);
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * A human-readable reason from a terminal widget message, or `undefined` (POO-1390 [R1]).
 *
 * ## Why this exists
 *
 * `error` is in the vendor's MESSAGE-NAME enum, not its state enum (see {@link parsePaybisWidgetEvent}),
 * so it arrives flat as `{ name: 'error', payload: {...} }` and that payload carries the real reason.
 * {@link parsePaybisWidgetEvent} returns a bare name, so until POO-1390 the reason was decoded and
 * then dropped, and the user was shown `"The purchase did not complete"` — a message we invented
 * while the vendor's own was in hand. That cost a production incident its diagnosis.
 *
 * ## Why it is a sibling and not a widened return type
 *
 * One production call site wants the name, roughly thirty assertions pin the current signature, and
 * the reason is read only on a terminal event. Re-decoding a small envelope on the rare terminal
 * message is cheaper than churning that surface.
 *
 * PP-INTEGRATION-POINT (POO-1390): the exact payload SHAPE is unverified — the vendor bundle proves
 * the flat `error` envelope exists but not which key holds the text. {@link REASON_KEYS} therefore
 * accepts the plausible set and [R5] degrades to `undefined` rather than guessing. Narrow this once a
 * real payload is captured in Sentry (which the same issue makes possible).
 *
 * The result is masked and bounded: it becomes user-visible copy AND rides into the "Copy error"
 * payload, which is pasted into a private staff support ticket, so it gets the same treatment as any other string
 * on that path.
 */
export function parsePaybisWidgetReason(data: unknown): string | undefined {
  const decoded = decodeEnvelope(data);
  if (decoded === null || typeof decoded !== "object") return undefined;
  const payload = (decoded as { payload?: unknown }).payload;
  const reason = readReason(payload) ?? readReason(decoded);
  if (!reason) return undefined;
  // Both, in this order: `redactSecrets` for our own hex shapes, then the vendor's KYC identity data.
  const masked = redactPersonalData(redactSecrets(reason));
  return masked.length > MAX_REASON_CHARS ? `${masked.slice(0, MAX_REASON_CHARS)}…` : masked;
}

/** Reported once per distinct namespace, so a vendor change is loud without flooding the sink. */
const seenNamespaces = new Set<string>();
function reportUnexpectedNamespace(namespace: string): void {
  if (seenNamespaces.has(namespace)) return;
  seenNamespaces.add(namespace);
  try {
    // Lazily required so this pure module stays importable from a non-browser context.
    void import("@/lib/observability/reportClientError").then(({ reportClientError }) => {
      reportClientError(
        "onramp.widget_unexpected_namespace",
        new Error("Paybis widget message carried an unrecognised namespace"),
        { namespace },
      );
    });
  } catch {
    // Reporting must never break event handling.
  }
}

/**
 * Whether a postMessage `event.origin` is a real Paybis widget origin.
 *
 * PP-SECURITY (POO-1134): the message listener MUST validate this before trusting any event. Without
 * it a `completed` spoofed by any other frame on the page would advance the plan against a purchase
 * that never happened. Requires https and an exact `paybis.com` apex or a `.paybis.com` subdomain, so
 * `evil-paybis.com` and `paybis.com.evil.com` are both rejected. Matches the `https://*.paybis.com`
 * CSP allowlist (POO-1138) rather than widening past it.
 */
export function isPaybisWidgetOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && (hostname === "paybis.com" || hostname.endsWith(".paybis.com"));
  } catch {
    return false;
  }
}
