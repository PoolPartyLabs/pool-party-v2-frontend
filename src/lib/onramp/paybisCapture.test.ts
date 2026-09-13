/**
 * @id PP-CORE-LIB-102 (POO-1598) - tests
 * @implements-rules-version v1 (POO-1598 rules v1)
 * @analytics-events none. The module under test emits no GA4 event; see its header for why.
 *
 * The contract this pins is a PRODUCTION one: these records are written while a real person is
 * paying with a real card. So the assertions that matter most are the negative ones - the flag is
 * off, the payload key is not on the allow-list, the transport throws - and each of them is the
 * difference between a fixture we can commit and an incident.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/features", () => ({ isFeatureEnabled: vi.fn(() => true) }));
vi.mock("@/lib/observability/sentry/clientContext", () => ({
  browserTraceId: vi.fn(() => "a".repeat(32)),
}));
vi.mock("@/lib/observability/reportClientError", () => ({
  shipClientErrorReport: vi.fn(),
  currentPath: vi.fn(() => "/deposit"),
}));

import { isFeatureEnabled } from "@/lib/features";
import { shipClientErrorReport } from "@/lib/observability/reportClientError";
import { browserTraceId } from "@/lib/observability/sentry/clientContext";
import {
  CAPTURE_END_STEP,
  CAPTURE_START_STEP,
  capturePaybisMessage,
  MAX_CAPTURED_MESSAGES,
  PAYBIS_CAPTURE_EVENT,
  startPaybisCapture,
  stopPaybisCapture,
} from "./paybisCapture";

const enabled = vi.mocked(isFeatureEnabled);
const traceId = vi.mocked(browserTraceId);
const ship = vi.mocked(shipClientErrorReport);

/** Every record shipped so far, in the order the module emitted them. */
const records = () => ship.mock.calls.map(([payload]) => payload as Record<string, unknown>);
/** The records that are widget messages, i.e. neither the session start nor the session end. */
const messages = () =>
  records().filter((r) => r.step !== CAPTURE_START_STEP && r.step !== CAPTURE_END_STEP);
/** The nth message record. Throws rather than returning undefined, so a miss names itself. */
const messageAt = (index: number): Record<string, unknown> => {
  const record = messages()[index];
  if (!record) throw new Error(`no capture message record at index ${index}`);
  return record;
};
/** The last record shipped, whatever kind it is. */
const lastRecord = (): Record<string, unknown> => {
  const record = records().at(-1);
  if (!record) throw new Error("no capture record was shipped");
  return record;
};
/** The `payload` field of the last message record, parsed back from its compact JSON. */
const lastPayload = (): Record<string, unknown> => {
  const raw = messages().at(-1)?.payload;
  return typeof raw === "string" ? JSON.parse(raw) : {};
};

/** A widget envelope on the wire: POO-1377 proved it is a JSON STRING, so default to that shape. */
const wire = (name: string, payload?: unknown) =>
  JSON.stringify({ namespace: "widget", name, ...(payload === undefined ? {} : { payload }) });

/**
 * [R9] The one wallet the capture is scoped to. Deliberately NOT checksum-cased here: the sources
 * that supply an address disagree on EIP-55 casing, and the gate compares case-insensitively.
 */
const CAPTURE_WALLET = "0xfe4c8730817ab1840775dbfd49cf0b83b2cbb408";

beforeEach(() => {
  process.env.NEXT_PUBLIC_ONRAMP_CAPTURE_WALLET = CAPTURE_WALLET;
  // Disarm any session a previous test left armed, THEN clear, so no end record leaks into the next.
  stopPaybisCapture();
  ship.mockReset();
  enabled.mockReset().mockReturnValue(true);
  traceId.mockReset().mockReturnValue("a".repeat(32));
});

describe("gating - [R1] off unless deliberately enabled", () => {
  // @rule R1
  it("ships nothing at all when the feature flag is off", () => {
    enabled.mockReturnValue(false);
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("state", { state: "loaded" }));
    stopPaybisCapture();
    expect(ship).not.toHaveBeenCalled();
  });

  /**
   * @rule R9 — the capture records ONE wallet and fails CLOSED in every other case.
   *
   * This is the property that makes `CR-CORE-027`'s claim true by construction. The flag alone is
   * build-baked, so without this gate "on for one purchase" would mean on for every buyer between
   * two deploys, and those buyers did not consent to a vendor payload that can carry a KYC outcome.
   */
  it.each([
    ["a different wallet", "0x0000000000000000000000000000000000000001", CAPTURE_WALLET],
    ["no wallet at all", undefined, CAPTURE_WALLET],
    ["no configured wallet", CAPTURE_WALLET, ""],
    ["configured wallet is whitespace", CAPTURE_WALLET, "   "],
  ])("captures nothing for %s", (_case, wallet, configured) => {
    process.env.NEXT_PUBLIC_ONRAMP_CAPTURE_WALLET = configured;
    startPaybisCapture({ requestId: "req-1", ...(wallet ? { wallet } : {}) });
    capturePaybisMessage(wire("state", { state: "loaded" }));
    expect(ship).not.toHaveBeenCalled();
  });

  // @rule R9: EIP-55 casing differs between Privy, wagmi and our own journal, so a checksum
  // mismatch must not silently disable the capture the operator deliberately switched on.
  it("matches the configured wallet regardless of checksum casing", () => {
    startPaybisCapture({
      requestId: "req-1",
      wallet: "0xFE4C8730817AB1840775DBFD49CF0B83B2CBB408",
    });
    capturePaybisMessage(wire("state", { state: "loaded" }));
    expect(ship).toHaveBeenCalled();
  });

  // @rule R1
  it("reads the onRampCapture flag, never a raw NEXT_PUBLIC_FEATURE_* env var", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    expect(enabled).toHaveBeenCalledWith("onRampCapture");
  });

  // @rule R1: the decision is taken ONCE per session, so a mid-purchase flip cannot split a capture.
  it("keeps capturing a session that was armed while the flag was on", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    enabled.mockReturnValue(false);
    capturePaybisMessage(wire("state", { state: "loaded" }));
    expect(messages()).toHaveLength(1);
  });

  // @rule R1
  it("ignores a message that arrives with no session armed", () => {
    capturePaybisMessage(wire("state", { state: "loaded" }));
    expect(ship).not.toHaveBeenCalled();
  });
});

describe("correlation - [R2]/[R3] one join key end to end", () => {
  // @rule R2
  it("stamps every record of a session with the same browserTraceId and Paybis requestId", () => {
    startPaybisCapture({ requestId: "req-42", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("state", { state: "loaded" }));
    capturePaybisMessage(wire("payment-initiated"));
    stopPaybisCapture();
    expect(records()).toHaveLength(4);
    for (const record of records()) {
      expect(record).toMatchObject({
        event: PAYBIS_CAPTURE_EVENT,
        reference: "a".repeat(32),
        requestId: "req-42",
        traceSource: "sentry",
      });
    }
  });

  // @rule R3: a minted substitute would fragment the join while looking complete.
  it("records that the trace id was UNAVAILABLE rather than minting a substitute", () => {
    traceId.mockReturnValue(undefined);
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("state", { state: "loaded" }));
    const record = messageAt(0);
    expect(record.traceSource).toBe("unavailable");
    expect(record.reference).toBeUndefined();
  });

  // @rule R2: the id is resolved once at arm time, so it cannot drift mid-session.
  it("does not re-read the trace id per message", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    traceId.mockReturnValue("b".repeat(32));
    capturePaybisMessage(wire("state", { state: "loaded" }));
    expect(messageAt(0).reference).toBe("a".repeat(32));
  });
});

describe("ordering and timing - [R4]", () => {
  // @rule R4
  it("numbers records monotonically from the session-start record", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("showLoader"));
    capturePaybisMessage(wire("state", { state: "loaded" }));
    stopPaybisCapture();
    expect(records().map((r) => r.seq)).toEqual([0, 1, 2, 3]);
    expect(records()[0]?.step).toBe(CAPTURE_START_STEP);
    expect(lastRecord().step).toBe(CAPTURE_END_STEP);
  });

  // @rule R4
  it("carries elapsed milliseconds since the session was armed", () => {
    vi.useFakeTimers();
    try {
      startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
      vi.advanceTimersByTime(1_500);
      capturePaybisMessage(wire("state", { state: "loaded" }));
      expect(records()[0]?.elapsedMs).toBe(0);
      expect(messageAt(0).elapsedMs).toBe(1_500);
    } finally {
      vi.useRealTimers();
    }
  });

  // @rule R4: the step is the STATE, not the literal "state", so the sequence reads as a lifecycle.
  it("names a state transition by its state", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("state", { state: "cancelled" }));
    expect(messageAt(0).step).toBe("state:cancelled");
  });

  // @rule R4: an object envelope must record identically to the JSON-string one (POO-1377).
  it("accepts the object envelope as well as the JSON string", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage({ namespace: "widget", name: "state", payload: { state: "completed" } });
    expect(messageAt(0)).toMatchObject({ step: "state:completed", namespace: "widget" });
  });
});

describe("redaction - [R5] allow-list, never a deny-list", () => {
  // @rule R5
  it("keeps the structured fields a fixture is made of", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(
      wire("state", {
        state: "completed",
        currencyCodeFrom: "EUR",
        currencyCodeTo: "USDC-BASE",
        amount: 100,
        paymentMethod: "sepa",
        invoiceId: "INV-9",
      }),
    );
    expect(lastPayload()).toMatchObject({
      state: "completed",
      currencyCodeFrom: "EUR",
      currencyCodeTo: "USDC-BASE",
      amount: 100,
      paymentMethod: "sepa",
      invoiceId: "INV-9",
    });
  });

  // @rule R5: the whole reason this is an allow-list. A deny-list ships the next field Paybis adds.
  it("never records the VALUE of a key outside the allow-list", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(
      wire("kyc", {
        email: "jane.doe@example.com",
        firstName: "Jane",
        documentNumber: "12345678901",
        cardNumber: "4242 4242 4242 4242",
        userIp: "203.0.113.7",
        somethingPaybisAddedLastNight: "whatever this turns out to be",
      }),
    );
    const serialized = JSON.stringify(messageAt(0));
    for (const secret of [
      "jane.doe@example.com",
      "Jane",
      "12345678901",
      "4242 4242 4242 4242",
      "203.0.113.7",
      "whatever this turns out to be",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  // @rule R5: dropping the value must not drop the DISCOVERY, which is why the key name survives.
  it("records the NAME of every dropped key, so a new vendor field is still visible", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("kyc", { email: "a@b.co", somethingNew: 1, state: "review" }));
    const dropped = String(messageAt(0).droppedKeys).split(",");
    expect(dropped).toContain("email");
    expect(dropped).toContain("somethingNew");
    expect(dropped).not.toContain("state");
  });

  /**
   * @rule R5: NO free text at all, and this is the assertion that keeps it that way.
   *
   * An earlier revision shipped `parsePaybisWidgetReason(data)` as a `reason` field on every record.
   * That reader masks email / phone / PAN / digit runs and does NOT mask a NAME - its own module says
   * so - and this sink's output is a fixture committed to a repo with a public mirror. A KYC
   * rejection naming the buyer is one of the likeliest outcomes of the single real purchase this
   * instrument exists to record.
   *
   * The message below is chosen so the old code would FAIL this test rather than pass it vacuously:
   * `parsePaybisWidgetReason` returns a non-empty string for it (there is a `message` key on the
   * payload), and every regex in `PERSONAL_DATA_PATTERNS` leaves the name standing.
   */
  it("records no vendor prose at all, not even through the masked reason reader", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(
      JSON.stringify({
        name: "error",
        payload: { message: "KYC rejected: name mismatch between Jane Doe and JANE A DOE" },
      }),
    );
    const record = messageAt(0);
    expect(record.reason).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain("Jane Doe");
    expect(lastPayload().message).toBeUndefined();
  });

  // @rule R5: dropping the prose must not drop the DISCOVERY that the vendor sent prose at all, or
  // which key it used. That is what makes the deletion above a free one.
  it("still names the prose key it refused, so the field is discoverable without its contents", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(
      JSON.stringify({
        name: "error",
        payload: { message: "KYC rejected for Jane Doe", errorCode: "KYC_REJECTED" },
      }),
    );
    const record = messageAt(0);
    expect(String(record.droppedKeys).split(",")).toContain("message");
    // The machine-readable half survives BY VALUE, which is what a fixture is actually built from.
    expect(lastPayload().errorCode).toBe("KYC_REJECTED");
  });

  // @rule R5: `step` is vendor-controlled and, for a bare non-JSON message, is the raw string's first
  // 64 characters. It gets the same masking pass the allow-listed values do.
  it("masks a wallet address that rides the step, the namespace or a dropped key name", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    capturePaybisMessage(`sent to ${wallet}`);
    expect(String(messageAt(0).step)).not.toContain(wallet);

    capturePaybisMessage(
      JSON.stringify({ namespace: `ns-${wallet}`, name: "state", payload: { [wallet]: "x" } }),
    );
    const record = messageAt(1);
    expect(String(record.namespace)).not.toContain(wallet);
    expect(String(record.droppedKeys)).not.toContain(wallet);
  });

  // @rule R5/[R7]: an allow-listed key past the per-record cap is named, not silently lost. A
  // fixture built from a record that quietly dropped a field is worse than one that says so.
  it("names an allow-listed key it had to drop for the key cap", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    const wide = Object.fromEntries(
      [
        "state",
        "status",
        "step",
        "stage",
        "type",
        "mode",
        "direction",
        "amount",
        "amountFrom",
        "amountTo",
        "currency",
        "currencyCode",
        "paymentMethod",
        "invoiceId",
      ].map((k) => [k, "v"]),
    );
    capturePaybisMessage(wire("state", wide));
    const record = messageAt(0);
    expect(Object.keys(JSON.parse(String(record.payload)))).toHaveLength(12);
    expect(String(record.droppedKeys)).toContain("invoiceId");
  });

  // @rule R5: a nested shape is where PII hides, so record that it was there and never its contents.
  it("records a nested object or array by shape, never by content", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("state", { state: { secret: "x" }, amount: [1, 2, 3] }));
    expect(lastPayload()).toMatchObject({ state: "[object]", amount: "[array:3]" });
  });

  // @rule R5: an address is the app's identity and is linkable; it is masked even if it slips in.
  it("masks a wallet address that rides an allow-listed string field", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    capturePaybisMessage(wire("state", { state: `sent to ${wallet}` }));
    expect(String(lastPayload().state)).not.toContain(wallet);
  });
});

describe("never a gate - [R6]", () => {
  // @rule R6: the caller is a live checkout's message handler. Nothing here may reach it.
  it("swallows a transport failure instead of throwing at the message handler", () => {
    ship.mockImplementation(() => {
      throw new Error("beacon exploded");
    });
    expect(() => startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET })).not.toThrow();
    expect(() => capturePaybisMessage(wire("state", { state: "loaded" }))).not.toThrow();
    expect(() => stopPaybisCapture()).not.toThrow();
  });

  // @rule R6
  it("swallows a flag-resolution failure and captures nothing", () => {
    enabled.mockImplementation(() => {
      throw new Error("registry exploded");
    });
    expect(() => startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET })).not.toThrow();
    expect(() => capturePaybisMessage(wire("state", { state: "loaded" }))).not.toThrow();
    expect(ship).not.toHaveBeenCalled();
  });

  // @rule R6: a circular or hostile payload is a vendor input, not a reason to break a purchase.
  it("survives an unserializable payload", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    const circular: Record<string, unknown> = { state: "loaded" };
    circular.self = circular;
    expect(() => capturePaybisMessage({ name: "state", payload: circular })).not.toThrow();
  });

  // @rule R6
  it("survives every malformed envelope shape", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    for (const input of [undefined, null, 0, "", "not json", [], { name: 5 }]) {
      expect(() => capturePaybisMessage(input)).not.toThrow();
    }
  });
});

describe("bounded - [R7]", () => {
  // @rule R7: a chatty or hostile widget must not turn a purchase into a beacon flood.
  it("stops shipping message records past the per-session cap", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    for (let i = 0; i < MAX_CAPTURED_MESSAGES + 25; i += 1) {
      capturePaybisMessage(wire("showLoader"));
    }
    expect(messages()).toHaveLength(MAX_CAPTURED_MESSAGES);
  });

  // @rule R7: the end record is how a reader tells a truncated sequence from a lossy one.
  it("closes the session with the total number of messages OBSERVED", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    for (let i = 0; i < MAX_CAPTURED_MESSAGES + 25; i += 1) {
      capturePaybisMessage(wire("showLoader"));
    }
    stopPaybisCapture();
    expect(lastRecord()).toMatchObject({
      step: CAPTURE_END_STEP,
      count: MAX_CAPTURED_MESSAGES + 25,
    });
  });

  // @rule R7
  it("closes a session exactly once, however many times it is stopped", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    stopPaybisCapture();
    stopPaybisCapture();
    expect(records().filter((r) => r.step === CAPTURE_END_STEP)).toHaveLength(1);
  });

  /**
   * @rule R7: the hook's `detach()` covers settle, timeout, every terminal event, reset and unmount.
   * It does NOT cover a buyer closing the tab, which is a real abandonment and one of the outcomes
   * worth recording, and without this the sequence would simply stop with no terminator.
   */
  it("closes the session when the tab goes away", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("payment-initiated"));
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    expect(lastRecord()).toMatchObject({ step: CAPTURE_END_STEP, count: 1 });
  });

  // @rule R7: a bfcache `pagehide` may still be RESTORED with the widget mid-checkout, so closing
  // there would truncate a live capture. The residual gap is stated on CAPTURE_END_STEP.
  it("does not close a session on a bfcache pagehide", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    expect(records().some((r) => r.step === CAPTURE_END_STEP)).toBe(false);
  });

  // @rule R7: the listener belongs to its session. One that outlived it would close the NEXT one.
  it("drops the pagehide listener with the session it belongs to", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    stopPaybisCapture();
    ship.mockClear();
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    expect(ship).not.toHaveBeenCalled();
  });

  // @rule R7: re-arming is what `open()` does on every fresh purchase; the old session must close.
  it("closes the previous session when a new one is armed", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("showLoader"));
    startPaybisCapture({ requestId: "req-2", wallet: CAPTURE_WALLET });
    const end = records().find((r) => r.step === CAPTURE_END_STEP);
    expect(end).toMatchObject({ requestId: "req-1", count: 1 });
    capturePaybisMessage(wire("showLoader"));
    expect(messages().at(-1)).toMatchObject({ requestId: "req-2", seq: 1 });
  });
});

describe("transport - [R8] the existing first-party diagnostics rail", () => {
  // @rule R8: one grep token for the whole ordered stream, in the container log and Sentry Logs.
  it("ships every record under one event token, through shipClientErrorReport", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("state", { state: "loaded" }));
    stopPaybisCapture();
    expect(records().every((r) => r.event === PAYBIS_CAPTURE_EVENT)).toBe(true);
    expect(records().every((r) => r.path === "/deposit")).toBe(true);
  });

  // @rule R8: the route re-clips every field, so nothing oversized is worth building or sending.
  it("bounds the serialized payload well under the ingest's per-field clip", () => {
    startPaybisCapture({ requestId: "req-1", wallet: CAPTURE_WALLET });
    capturePaybisMessage(wire("state", { state: "x".repeat(5_000) }));
    expect(String(messageAt(0).payload).length).toBeLessThanOrEqual(256);
  });
});
