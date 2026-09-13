/**
 * @id PP-CORE-LIB-102 (POO-1598)
 * @name Paybis widget capture
 * @implements-rules-version v1 (POO-1598 rules v1)
 * @analytics-events none, deliberately. This is diagnostics, not measurement. The on-ramp funnel
 *   (view / started / submitted / completed / abandonment / blocked intent) is already emitted by
 *   the surfaces that OWN the purchase - `/deposit` and the provisioning buy row - and a second
 *   emitter on the same lifecycle would double-count every purchase in GA4 while measuring nothing
 *   new. Nothing here is user-facing, nothing here is a user intent, and the whole module is off in
 *   production unless someone deliberately turns it on.
 *
 * Record the Paybis widget's `postMessage` stream as an ordered, redacted, retrievable sequence, so
 * a single real purchase becomes the fixture set every future test replays for free.
 *
 * ## Why this exists at all (POO-1598)
 *
 * Every unknown blocking the on-ramp epic is the same shape: a vendor behaviour nobody has observed.
 * The documentation sweep (111 of 112 pages, POO-1426) could not close them; the docs say the method
 * list "may vary based on the user's geographical location (geofencing)" and never say what that
 * keys on. Dev runs Paybis SANDBOX, which sells almost nothing, so the questions are not answerable
 * there at any price. The answer is to stop reading and start recording: instrument, take ONE real
 * production purchase, and turn it into fixtures.
 *
 * **Narrowed by POO-1626 (2026-08-17), and the narrowing does not weaken the case for this module.**
 * The sentence above is no longer true by DEGREE: since pool-party-api's POO-1605 the method list
 * and the quote DO resolve on dev, because the vendor boundary maps our two production codes onto
 * sandbox equivalents and restores them on the way back. What stays unobservable there is exactly
 * what this capture exists for: SETTLEMENT, since a sandbox purchase delivers on Sepolia while
 * `EXPECTED_TOKEN_SCOPE` watches Base (POO-1627), and the PRODUCTION method set, which is the
 * geofencing question above and which no sandbox response can answer whatever it resolves.
 *
 * ## Why it is not the breadcrumb trail (PP-CORE-LIB-090)
 *
 * {@link breadcrumbPaybisMessage} already sees every one of these messages, and it is the right tool
 * for a different job. Breadcrumbs are held in memory and attached only to an event that is actually
 * SENT, so a purchase that SUCCEEDS - which is exactly the run this issue needs to record - produces
 * no breadcrumb anywhere. They are also capped per event and are read one incident at a time, which
 * is not how anyone reconstructs an ordered sequence with timings.
 *
 * So the two modules split by PURPOSE and share only the decoder ({@link describePaybisMessage}),
 * because the envelope has three layers and reading the wrong one is the bug that shipped four times
 * (POO-1368, POO-1369, POO-1373, POO-1377). Their MASKING is deliberately different, see below.
 *
 * ## Where a capture lands, and how a human gets the sequence back
 *
 * Every record goes out on the first-party diagnostics rail this app already owns:
 *
 *   `shipClientErrorReport` → `POST /api/client-error` → `logWarn` → container stdout + Sentry Logs
 *
 * That rail was chosen over the three alternatives for reasons that are about RETRIEVAL:
 *
 *   - It survives the page unload that ends many checkouts (`sendBeacon`, with a `keepalive` fetch
 *     fallback). A plain `fetch` does not, and the terminal messages are the ones worth having.
 *   - It writes ONE flat JSON line per record, so the whole session is
 *     `grep '"event":"onramp.paybis_capture"'` over `docker logs`, sorted by `seq`.
 *   - POO-1388 forwards every level to Sentry Logs, so the same sequence is queryable by
 *     `reference:<traceId>` after a container recreate has rotated stdout away (POO-1354).
 *   - It is HARDENED already: body cap, `Sec-Fetch-Site`, a fixed field allowlist, a per-field clip,
 *     never a throw. A second endpoint would have to re-earn all of that, and POO-1471's lesson was
 *     that duplicating this transport lets the two halves drift on the one behaviour that decides
 *     whether a report survives the unload.
 *
 * ### The retrieval command, exactly
 *
 * This gets run ONCE, under pressure, after the one purchase that mattered, so it is written out
 * rather than described. Two details are load-bearing and both were wrong the first time:
 *
 * ```bash
 * docker logs pp_interface_v2 2>&1 \
 *   | grep '"event":"onramp.paybis_capture"' \
 *   | jq -s 'sort_by(.seq) | .[]
 *            | {seq, elapsedMs, step, namespace, droppedKeys, count,
 *               payload: (.payload|fromjson?)}'
 * ```
 *
 *   1. `payload` is a JSON STRING on the wire, not an object (it is serialized here so the ingest's
 *      flat field allowlist can carry it), so it needs `fromjson?` or it reads back as an escaped
 *      blob. The `?` keeps the pipeline alive on the records that have no payload at all.
 *   2. In Sentry Logs the query is `reference:<traceId>`. It is NOT `requestId:<paybis id>`, which
 *      matches nothing: `logger.ts`'s `SENTRY_ATTRIBUTE_ALIASES` promotes `requestId` to Sentry's own
 *      snake_case, so the Paybis id is searchable there as **`request_id:<paybis id>`**. `reference`
 *      is not aliased and is spelled the same in both sinks.
 *
 * The consequence is a BUDGET, and it is stated rather than worked around: the ingest clips each
 * field to 256 characters, so {@link MAX_PAYLOAD_CHARS} bounds the payload here. A capture is a
 * bounded redacted RECORD, never a raw payload dump - which the privacy rule below forbids anyway.
 *
 * ## Redaction: an ALLOW-LIST, and the opposite choice from the breadcrumbs
 *
 * PP-SECURITY: this is designed to run in PRODUCTION against a real buyer's real purchase, and its
 * output is destined for a fixture committed to a repository with a public mirror. Assume anything
 * captured is published forever.
 *
 * PP-CORE-LIB-090 uses a DENYLIST and says why: it exists to surface states the vendor has not told
 * us about, and an allowlist would drop exactly those. That reasoning is right for a breadcrumb and
 * wrong here, because a denylist silently ships the next field Paybis adds, and this output is
 * permanent. So:
 *
 *   - {@link PAYLOAD_ALLOW_LIST} names the STRUCTURED fields a fixture is made of - lifecycle state,
 *     currency, amount, payment method, vendor ids, codes, timestamps, chain. Nothing on it is free
 *     text and nothing on it describes a PERSON.
 *   - Every other key is recorded by NAME ONLY, under `droppedKeys`. That keeps the whole discovery
 *     value the denylist was protecting - a field Paybis adds is visible the first time it fires -
 *     with none of the leak risk, because the value never leaves the browser.
 *   - **NO free text reaches a record at all.** `message` / `reason` / `description` / `error` are
 *     not on the allowlist, and no separate prose path exists either. See the next section: this
 *     module deliberately does not carry `parsePaybisWidgetReason`'s output.
 *   - A nested object or array is recorded by SHAPE, never by content: one level is where a lifecycle
 *     payload keeps its meaning, and depth is where a KYC file would hide.
 *
 * ### Why there is no vendor `reason` here, when there is one on the error path
 *
 * An earlier revision of this module shipped `parsePaybisWidgetReason(data)` as a `reason` field on
 * every record. That was wrong for THIS sink, and the reason is stated in that function's own module
 * (`paybisWidget.ts`): it masks email, phone, separated PAN and 6+ digit runs, and it does NOT mask a
 * NAME. Its note says so, and names the trigger: the mitigation is that the payload reaches a private
 * staff ticket rather than a public channel, and "if that stops being acceptable, the answer is an
 * allowlist of known vendor reason codes mapped to our own copy, not a longer blocklist."
 *
 * This module IS that trigger. Its output is destined for a fixture committed to a repo with a public
 * mirror, and a KYC rejection is one of the likeliest non-happy outcomes of the single real purchase
 * this instrument exists to record. Verified against the shipped patterns, all three of these pass
 * through untouched: "Verification failed for Jane Alice Doe, born 12 March 1985, resident of
 * Lisbon"; "KYC rejected: name mismatch between Jane Doe and JANE A DOE on document"; "Cardholder
 * Jane Doe, card ending 4242, address 14 Rua Augusta, Lisboa".
 *
 * Nothing of value is lost by dropping it, which is why this is a deletion and not a trade:
 *
 *   - The MACHINE-READABLE failure signal is already kept BY VALUE: `code`, `errorCode`, `errorType`
 *     and `statusCode` are on {@link PAYLOAD_ALLOW_LIST}. A fixture is built from those, not prose.
 *   - DISCOVERY is preserved: because no prose key is allow-listed, `message` / `reason` / `error` /
 *     `description` are already named under `droppedKeys`. You learn the field EXISTS, and which one
 *     the vendor used, without its contents.
 *   - The HUMAN-READABLE reason still reaches support unchanged, on the path POO-1390 was actually
 *     reviewed for: `onramp.widget_terminal` -> `vendorReason` in `useOnRampSettlement`. That is a
 *     private staff ticket, which is the destination its masking posture was accepted against.
 *
 * **The one judgement call, made explicitly:** `country` / `countryCode` ARE on the allowlist. They
 * are coarse jurisdiction data, not an IP and not an address, and they are the exact discriminator
 * POO-1597 / POO-1426 Q1 exist to measure ("does the method list differ when Paybis has an IP for
 * the flow?"). Capturing the purchase without them would leave the capture unable to answer the
 * question it was taken for. Recorded in `docs/COMPLIANCE_REGISTER.md` as `CR-CORE-027`.
 *
 * Never captured, by construction: email, name, document or card numbers, and the end-user IP. The
 * IP is not in this stream at all, and POO-1367 already set the precedent of logging the SOURCE
 * rather than the address; the `userIp` the mint forwards to `/v3/request` is mandatory-and-
 * undocumented, so it is redacted from the CAPTURE and never from the REQUEST.
 *
 * ## Correlation ([R2]/[R3]): the contract is fixed, not invented here
 *
 * Three recordings have to join, and they already share a key:
 *
 *   - `apiFetch` sends `x-request-id: <traceId>` to `pool-party-api` on every call
 *     (`trace.ts` → `buildTraceHeaders`), and the API's Paybis capture (S1/S2) stamps that header.
 *   - {@link browserTraceId} is that same id in the browser, taken from Sentry's own trace data.
 *   - Paybis' `requestId` comes back from the mint and is the third key.
 *
 * So every record carries `reference` (the trace id) and `requestId`. When the trace id is genuinely
 * unavailable - Sentry disabled, no DSN, local dev - the record says `traceSource: "unavailable"`
 * and carries no reference. It never mints a substitute: a fabricated id fragments a capture while
 * looking complete, which is worse than an honest gap.
 *
 * ## Two properties that are non-negotiable
 *
 * **It is off unless deliberately enabled** ([R1]): gated on the `onRampCapture` feature flag, read
 * ONCE per session at arm time so a mid-purchase flip cannot split a capture in half.
 *
 * **It is never a gate** ([R6]): every entry point is wrapped, every failure is swallowed, and the
 * caller is the message handler of a live checkout. If capture throws, is disabled, or the payload
 * is unserializable, the purchase proceeds untouched. `paybisCapture.test.ts` proves each case.
 *
 * PP-INTEGRATION-POINT: the payload SHAPES below are vendor-owned and largely unobserved - that is
 * the whole premise of this issue. The allowlist is therefore a superset of the keys Paybis is
 * plausibly using, and `droppedKeys` is what tells us which of them are real. Narrow it once a
 * production capture exists, and delete this module when the fixtures land (POO-1598 S5).
 *
 * Client-safe: no `server-only`, no Node APIs.
 */
import { isFeatureEnabled } from "@/lib/features";
import { redactSecrets } from "@/lib/observability/redact";
import { currentPath, shipClientErrorReport } from "@/lib/observability/reportClientError";
import { browserTraceId } from "@/lib/observability/sentry/clientContext";
import { describePaybisMessage } from "./paybisBreadcrumbs";

/**
 * The single grep token for the whole stream. One token and not three (start / message / end), so
 * `grep '"event":"onramp.paybis_capture"' | jq -s 'sort_by(.seq)'` returns the entire ordered
 * session in one pass. The `step` field is what separates the three kinds of record.
 *
 * Reading `payload` back needs `fromjson?`, and the Sentry Logs query for the Paybis id is
 * `request_id`, not `requestId`. Both are spelled out under "The retrieval command, exactly" in the
 * module header, because that command gets typed once, under pressure.
 */
export const PAYBIS_CAPTURE_EVENT = "onramp.paybis_capture";

/** The session anchor. Its presence proves the capture was ARMED, which a silent widget cannot. */
export const CAPTURE_START_STEP = "capture:start";
/**
 * The session close. Carries `count`, so a reader can tell a truncated sequence from a lossy one.
 *
 * Two paths reach it, because the hook's `detach()` alone does not cover the one that matters most.
 * `detach()` runs on settle, timeout, every terminal event, reset and unmount, and a buyer who
 * ABANDONS by closing the tab hits none of those: the page simply goes away and the last record
 * would be whatever the widget said last. So the session also closes on `pagehide`, which is the
 * event `sendBeacon` (this rail's transport) exists to be paired with.
 *
 * The residual limit, stated rather than papered over: a `pagehide` with `persisted === true` is the
 * page entering the bfcache, and it may still be RESTORED with the widget mid-checkout, so it is
 * deliberately NOT treated as a close. If that page is then discarded without a restore, the session
 * ends with no `capture:end` record. That is the one case where a sequence has no terminator, and a
 * reader should treat a missing `capture:end` as "unknown completeness", never as "complete".
 */
export const CAPTURE_END_STEP = "capture:end";

/**
 * Message records per session. A checkout emits tens of messages, not hundreds; past this the
 * stream is a vendor loop or a hostile frame, and either way one beacon per message would be a
 * flood on a page that is taking someone's money. Messages past the cap still count toward the end
 * record's `count`, so the truncation is visible rather than silent.
 */
export const MAX_CAPTURED_MESSAGES = 200;

/** Payload keys kept per record. Beyond this a payload is a document, not a lifecycle signal. */
const MAX_PAYLOAD_KEYS = 12;
/** Dropped key NAMES kept per record. The names are ours to bound; the values never travel. */
const MAX_DROPPED_KEYS = 12;
/** Per-value clip inside the payload, so one long string cannot consume the whole budget. */
const MAX_VALUE_CHARS = 80;
/** Whole-payload clip, comfortably inside the ingest route's 256-character per-field re-clip. */
const MAX_PAYLOAD_CHARS = 240;
/** A vendor-controlled step name is clipped like every other vendor string. */
const MAX_STEP_CHARS = 64;

/**
 * The ONLY payload keys recorded by value. See the module header for why this is an allowlist and
 * why the breadcrumb module next door is deliberately the opposite.
 *
 * Grouped by the question each group exists to answer, because an allowlist without a stated purpose
 * grows by accretion:
 *
 *   - lifecycle: where in the checkout the buyer actually was.
 *   - money: POO-1578 / POO-1576 - can the buyer change amount and currency INSIDE the widget, and
 *     does received-fixed pricing hold when they do?
 *   - method: POO-1577 / POO-1426 - which methods the widget really offered, versus the list our
 *     pre-mint call was given.
 *   - ids: the join keys between this recording, the API's, and Paybis' own records.
 *   - codes: a machine-readable failure reason, and the ONLY failure signal this module records. The
 *     human-readable one is not captured at all: it reaches support through the error path
 *     (`onramp.widget_terminal` -> `vendorReason`), which is where its masking posture was reviewed.
 *   - time: POO-1426 T4 - the real quote TTL.
 *   - chain / geo: which asset settled where, and the geofencing discriminator (see the header).
 *
 * Every entry is a value ABOUT THE TRANSACTION. None is a value about the person paying.
 */
const PAYLOAD_ALLOW_LIST: ReadonlySet<string> = new Set([
  // lifecycle
  "state",
  "status",
  "step",
  "stage",
  "type",
  "mode",
  "direction",
  // money
  "amount",
  "amountFrom",
  "amountTo",
  "amountReceived",
  "amountSpent",
  "receivedAmount",
  "spentAmount",
  "quantity",
  "currency",
  "currencyCode",
  "currencyCodeFrom",
  "currencyCodeTo",
  "fromCurrency",
  "toCurrency",
  "fixed",
  // payment method
  "method",
  "methodCode",
  "paymentMethod",
  "paymentMethodCode",
  // join keys
  "requestId",
  "invoiceId",
  "orderId",
  "paymentId",
  "quoteId",
  "transactionId",
  "partnerOrderId",
  // machine-readable failure
  "code",
  "errorCode",
  "errorType",
  "statusCode",
  // time
  "ttl",
  "expiresAt",
  "createdAt",
  "updatedAt",
  "timestamp",
  // chain and jurisdiction
  "asset",
  "assetCode",
  "chain",
  "network",
  "blockchain",
  "country",
  "countryCode",
  "locale",
  "language",
]);

/** One armed widget session. Module-level because the message handler is not a React component. */
interface CaptureSession {
  /** The Paybis purchase id this session records. One of the three join keys. */
  requestId: string;
  /** The browser trace id, resolved ONCE at arm time so it cannot drift mid-session. */
  reference?: string;
  /** `"sentry"` when a trace id was available, `"unavailable"` when it honestly was not ([R3]). */
  traceSource: "sentry" | "unavailable";
  /** `performance`-independent epoch stamp, so `elapsedMs` needs no second clock. */
  startedAt: number;
  /** Next record number. 0 is always the session-start record. */
  seq: number;
  /** Messages OBSERVED, including any past {@link MAX_CAPTURED_MESSAGES}. */
  observed: number;
}

let session: CaptureSession | null = null;

/**
 * The armed session's `pagehide` listener, held so it is removed with the session it belongs to.
 * Module-level for the same reason {@link session} is: the owner is a message handler, not a
 * component, and a listener that outlived its session would close the NEXT one.
 */
let pageHideListener: ((event: PageTransitionEvent) => void) | null = null;

/** Clip a vendor-controlled label to a bounded length. */
function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Reduce a vendor payload to the allow-listed, masked, primitive-only projection a fixture needs,
 * plus the NAMES of everything that was refused.
 *
 * Deliberately shallow, for the same reason PP-CORE-LIB-090 is: one level is where a lifecycle
 * payload keeps its meaning, and walking deeper turns an unknown third-party shape into an unbounded
 * traversal on a live money path - and into the place a KYC file would hide.
 */
function projectPayload(payload: unknown): {
  kept: Record<string, string | number | boolean>;
  dropped: string[];
} {
  const kept: Record<string, string | number | boolean> = {};
  const dropped: string[] = [];
  if (payload === null || typeof payload !== "object") return { kept, dropped };
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (!PAYLOAD_ALLOW_LIST.has(key)) {
      // NAME only. The value never leaves the browser, and the name is what makes a vendor's new
      // field visible the first time it fires instead of the first time somebody reads a changelog.
      if (dropped.length < MAX_DROPPED_KEYS) dropped.push(clip(key, MAX_STEP_CHARS));
      continue;
    }
    if (Object.keys(kept).length >= MAX_PAYLOAD_KEYS) {
      // Allow-listed but over the cap. Recorded by NAME like a refused key rather than vanishing:
      // a fixture built from a record that silently lost a field is worse than one that says so.
      if (dropped.length < MAX_DROPPED_KEYS) dropped.push(clip(key, MAX_STEP_CHARS));
      continue;
    }
    if (value === null || value === undefined) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      kept[key] = value;
    } else if (typeof value === "string") {
      // `redactSecrets` is the backstop for OUR identity shape, a wallet address, which would be
      // pseudonymous-but-linkable in a committed fixture. It is hex-only and is not the PII control
      // here: the allowlist is.
      kept[key] = clip(redactSecrets(value), MAX_VALUE_CHARS);
    } else {
      // An object or array: record that it was there and its shape, never its contents.
      kept[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]";
    }
  }
  return { kept, dropped };
}

/** Ship one record on the first-party rail. Never throws: see [R6] in the module header. */
function emit(fields: Record<string, string | number | boolean | undefined>): void {
  const active = session;
  if (!active) return;
  try {
    shipClientErrorReport({
      event: PAYBIS_CAPTURE_EVENT,
      path: currentPath(),
      requestId: active.requestId,
      traceSource: active.traceSource,
      ...(active.reference ? { reference: active.reference } : {}),
      seq: active.seq,
      ...fields,
    });
  } catch {
    // Diagnostics, never a gate.
  }
  active.seq += 1;
}

/**
 * [R9] The capture records ONE named wallet's purchases, and nobody else's.
 *
 * Rafael, 2026-08-17, choosing this over an unscoped window: the flag alone is a build-time switch,
 * so "on for one purchase" would really mean "on for EVERY buyer between the enable deploy and the
 * disable deploy", and turning it off is a second release rather than a flip. Those buyers did not
 * consent, and a vendor payload about them can carry a KYC outcome. Scoping makes the compliance
 * claim in `CR-CORE-027` true BY CONSTRUCTION rather than by intention.
 *
 * Compared case-insensitively because EIP-55 checksum casing differs by source (Privy, wagmi and our
 * own journal do not agree on it), and an address that fails to match here fails CLOSED: no capture,
 * no record, the purchase entirely unaffected.
 *
 * Absent or blank config means NOBODY is captured, not everybody. That is the safe direction for a
 * value that ships baked into a production bundle: a missing env var must never widen the
 * population, and this is exactly the mistake that turns a targeted capture into a mass one.
 */
function isCaptureWallet(wallet?: string): boolean {
  const configured = process.env.NEXT_PUBLIC_ONRAMP_CAPTURE_WALLET?.trim();
  if (!configured) return false;
  if (!wallet) return false;
  return configured.toLowerCase() === wallet.trim().toLowerCase();
}

/**
 * Arm the capture for one widget session ([R1]/[R2]).
 *
 * Called from `useOnRampSettlement.open()`, which is the only place that holds both the
 * server-minted `requestId` and the moment the widget is about to be handed the buyer. Re-arming
 * closes the previous session first, so a second purchase in the same page load is a separate,
 * self-delimited sequence rather than a continuation of the first.
 */
export function startPaybisCapture({
  requestId,
  wallet,
}: {
  requestId: string;
  wallet?: string;
}): void {
  try {
    stopPaybisCapture();
    // PP-INTEGRATION-POINT: `onRampCapture` gates a temporary production instrumentation run
    // (POO-1598). Off everywhere by default; turned on deliberately for one capture and turned off
    // again. Read here, ONCE per session, so a flag flip mid-purchase cannot split a capture.
    if (!isFeatureEnabled("onRampCapture")) return;
    if (!isCaptureWallet(wallet)) return;
    const reference = browserTraceId();
    session = {
      requestId,
      reference,
      // [R3] An honest gap beats a minted substitute: a fabricated id fragments the join between
      // this recording, the API's Paybis capture and Paybis' own, while looking complete.
      traceSource: reference ? "sentry" : "unavailable",
      startedAt: Date.now(),
      seq: 0,
      observed: 0,
    };
    armPageHideClose();
    emit({ step: CAPTURE_START_STEP, elapsedMs: 0 });
  } catch {
    // Arming must never break opening a purchase. Unwind fully: a half-armed session that kept its
    // `pagehide` listener would emit an end record for a session that never started.
    session = null;
    disarmPageHideClose();
  }
}

/**
 * Close the session when the tab goes away ([R7]).
 *
 * `detach()` covers settle, timeout, every terminal event, reset and unmount; it does NOT cover a
 * buyer closing the tab, which is a real abandonment and one of the outcomes worth recording. This
 * is the same event `sendBeacon` is designed for, so the end record has the transport it needs.
 *
 * `persisted` is honoured: that is the bfcache case, where the page may come back with the widget
 * still mid-checkout, and closing there would truncate a live capture. See {@link CAPTURE_END_STEP}
 * for the residual gap that leaves.
 */
function armPageHideClose(): void {
  if (typeof window === "undefined") return;
  const listener = (event: PageTransitionEvent) => {
    if (event.persisted) return;
    stopPaybisCapture();
  };
  pageHideListener = listener;
  window.addEventListener("pagehide", listener);
}

/** Drop the armed session's `pagehide` listener. Idempotent, like the close it belongs to. */
function disarmPageHideClose(): void {
  if (pageHideListener && typeof window !== "undefined") {
    window.removeEventListener("pagehide", pageHideListener);
  }
  pageHideListener = null;
}

/**
 * Record one vouched widget message ([R4]/[R5]).
 *
 * Called from the hook's single message handler, AFTER `isPaybisWidgetOrigin` has vouched for the
 * sender and alongside {@link breadcrumbPaybisMessage} - never instead of it, and never from a
 * second listener. A no-op when no session is armed, which is the normal production state.
 *
 * PP-SECURITY: recording an unvouched message would let any other frame on the page write our
 * fixture set, which would then be replayed as if it were vendor behaviour.
 */
export function capturePaybisMessage(data: unknown): void {
  const active = session;
  if (!active) return;
  try {
    active.observed += 1;
    if (active.observed > MAX_CAPTURED_MESSAGES) return;
    const { step, namespace, payload } = describePaybisMessage(data);
    const { kept, dropped } = projectPayload(payload);
    const serialized = Object.keys(kept).length > 0 ? JSON.stringify(kept) : undefined;
    // NO vendor prose is recorded, deliberately. See "Why there is no vendor `reason` here" in the
    // module header: `parsePaybisWidgetReason` does not mask NAMES, and this sink's output is a
    // committed fixture in a repo with a public mirror. The machine-readable failure signal is kept
    // by value (`code` / `errorCode` / `errorType` / `statusCode`), the prose field is still named
    // under `droppedKeys`, and the human-readable reason still reaches support through
    // `onramp.widget_terminal` -> `vendorReason`. Do not add it back.
    //
    // `step`, `namespace` and `droppedKeys` are all VENDOR-controlled strings and get the same
    // `redactSecrets` pass the allow-listed values do: `describePaybisMessage` falls back to the
    // first 64 characters of a bare non-JSON message as the step, so an un-redacted `step` is the
    // one place a raw vendor string could reach a record verbatim.
    emit({
      step: clip(redactSecrets(step), MAX_STEP_CHARS),
      elapsedMs: Date.now() - active.startedAt,
      ...(namespace ? { namespace: clip(redactSecrets(namespace), MAX_STEP_CHARS) } : {}),
      ...(serialized ? { payload: clip(serialized, MAX_PAYLOAD_CHARS) } : {}),
      ...(dropped.length > 0
        ? { droppedKeys: clip(redactSecrets(dropped.join(",")), MAX_VALUE_CHARS) }
        : {}),
    });
  } catch {
    // A vendor payload we cannot serialize is not a reason to break a purchase.
  }
}

/**
 * Close the armed session ([R7]).
 *
 * Called from the hook's `detach()`, which runs on settle, timeout, every terminal event, reset and
 * unmount. Idempotent: a second call after the session is closed does nothing, so the end record
 * appears exactly once however many of those paths fire.
 *
 * The `count` it carries is the number of messages OBSERVED, which is what lets a reader distinguish
 * "the widget emitted twelve messages" from "the widget emitted forty and twenty-eight beacons were
 * lost or truncated". Without it a sequence cannot be known to be complete, and a fixture built from
 * an incomplete sequence is worse than no fixture.
 */
export function stopPaybisCapture(): void {
  const active = session;
  // The listener is dropped even with no session armed, so a failed arm cannot leave one behind.
  disarmPageHideClose();
  if (!active) return;
  try {
    emit({
      step: CAPTURE_END_STEP,
      elapsedMs: Date.now() - active.startedAt,
      count: active.observed,
    });
  } catch {
    // Closing must never break tearing a purchase down.
  } finally {
    session = null;
  }
}
