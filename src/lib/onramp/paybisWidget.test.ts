/**
 * @id PP-CORE-LIB-065 (POO-1134, POO-1390)
 * @name Paybis widget adapter — spec
 * @implements-rules-version v4 (POO-1390 rules v2) · v3 (POO-1390 rules v1) · v2 (POO-1129 rules v2)
 *
 * The pure half of the widget seam: the postMessage name parser and the origin guard. Both are the
 * security boundary of the settlement hook ([R5] + the issue's PP-SECURITY note), so they are tested
 * exhaustively here, transport-free.
 */
import { describe, expect, it } from "vitest";
import {
  getPartnerExchangeWidget,
  isPaybisWidgetOrigin,
  PAYBIS_WIDGET_EVENTS,
  parsePaybisWidgetEvent,
  parsePaybisWidgetReason,
} from "./paybisWidget";

describe("parsePaybisWidgetEvent", () => {
  // @rule R5 — the seven event names the hook branches on are recognised from `event.data.name`.
  it.each(PAYBIS_WIDGET_EVENTS)("recognises the %s event from { name }", (name) => {
    expect(parsePaybisWidgetEvent({ name })).toBe(name);
  });

  it("accepts a bare string payload (defensive: some SDK builds post the name directly)", () => {
    expect(parsePaybisWidgetEvent("completed")).toBe("completed");
  });

  it("ignores widget events outside the handled set (showLoader, payment-redirect, …)", () => {
    expect(parsePaybisWidgetEvent({ name: "showLoader" })).toBeNull();
    expect(parsePaybisWidgetEvent({ name: "payment-redirect" })).toBeNull();
  });

  it("returns null for a payload with no usable name", () => {
    expect(parsePaybisWidgetEvent(null)).toBeNull();
    expect(parsePaybisWidgetEvent(undefined)).toBeNull();
    expect(parsePaybisWidgetEvent(42)).toBeNull();
    expect(parsePaybisWidgetEvent({})).toBeNull();
    expect(parsePaybisWidgetEvent({ name: 123 })).toBeNull();
    expect(parsePaybisWidgetEvent({ type: "completed" })).toBeNull();
  });
});

describe("isPaybisWidgetOrigin", () => {
  // @rule R5 — an unvalidated message listener accepts a spoofed `completed` from any frame on the
  // page, which advances the plan against a purchase that never happened (PP-SECURITY).
  it("accepts the sandbox and prod widget hosts", () => {
    expect(isPaybisWidgetOrigin("https://widget.sandbox.paybis.com")).toBe(true);
    expect(isPaybisWidgetOrigin("https://widget.paybis.com")).toBe(true);
  });

  it("accepts the apex and any paybis.com subdomain over https", () => {
    expect(isPaybisWidgetOrigin("https://paybis.com")).toBe(true);
    expect(isPaybisWidgetOrigin("https://pay.paybis.com")).toBe(true);
  });

  it("rejects look-alike hosts that merely contain paybis", () => {
    expect(isPaybisWidgetOrigin("https://evil-paybis.com")).toBe(false);
    expect(isPaybisWidgetOrigin("https://paybis.com.evil.com")).toBe(false);
    expect(isPaybisWidgetOrigin("https://notpaybis.com")).toBe(false);
  });

  it("rejects non-https origins even on the right host", () => {
    expect(isPaybisWidgetOrigin("http://widget.paybis.com")).toBe(false);
  });

  it("rejects a malformed origin", () => {
    expect(isPaybisWidgetOrigin("")).toBe(false);
    expect(isPaybisWidgetOrigin("not a url")).toBe(false);
    // The literal string a sandboxed iframe posts when its origin is opaque.
    expect(isPaybisWidgetOrigin("null")).toBe(false);
  });
});

describe("getPartnerExchangeWidget", () => {
  it("returns null until the loader has attached the SDK", () => {
    expect(getPartnerExchangeWidget()).toBeNull();
  });

  it("returns the SDK once present on window", () => {
    const sdk = { openInEmbed: () => {}, open: () => {}, isLoaded: true };
    window.PartnerExchangeWidget = sdk;
    try {
      expect(getPartnerExchangeWidget()).toBe(sdk);
    } finally {
      window.PartnerExchangeWidget = undefined;
    }
  });
});

/**
 * POO-1373: the real envelope. Shapes taken from the vendor bundle, where
 * `v.STATE = 'state'` is the MESSAGE name and the lifecycle value lives at `payload.state`
 * (`switch (t.name) { case v.STATE: w = t.payload.state; ... }`).
 */
describe("parsePaybisWidgetEvent, the nested state envelope (POO-1373)", () => {
  it.each([
    "opened",
    "loaded",
    "closed",
    "completed",
    "cancelled",
    "rejected",
  ])("reads %s from { name: 'state', payload: { state } }", (state) => {
    expect(parsePaybisWidgetEvent({ name: "state", payload: { state } })).toBe(state);
  });

  // The whole defect: this used to return null, so the widget never reported closing, completing or
  // being cancelled, and the checkout sat on "Opening the secure checkout" forever.
  it("no longer drops a nested lifecycle transition", () => {
    expect(parsePaybisWidgetEvent({ name: "state", payload: { state: "closed" } })).not.toBeNull();
  });

  it("still reads the flat error message, which is a message name rather than a state", () => {
    expect(parsePaybisWidgetEvent({ name: "error" })).toBe("error");
  });

  it("ignores a state message carrying a lifecycle value this app does not handle", () => {
    expect(parsePaybisWidgetEvent({ name: "state", payload: { state: "showLoader" } })).toBeNull();
  });

  it("ignores a malformed state envelope rather than guessing", () => {
    expect(parsePaybisWidgetEvent({ name: "state" })).toBeNull();
    expect(parsePaybisWidgetEvent({ name: "state", payload: null })).toBeNull();
    expect(parsePaybisWidgetEvent({ name: "state", payload: { state: 42 } })).toBeNull();
  });

  it("does not treat a non-state message name as a lifecycle value", () => {
    expect(parsePaybisWidgetEvent({ name: "payment-initiated" })).toBeNull();
  });
});

/**
 * POO-1377: the wire format is a JSON STRING wrapping `{ namespace, name, payload }`. Taken from the
 * vendor bundle's own handler:
 *   `let t = e.data; try { t = JSON.parse(e.data) } catch {}`
 *   `let { namespace: n = ``, name: r = ``, payload: i = {} } = t;`
 */
describe("parsePaybisWidgetEvent, the JSON-string envelope (POO-1377)", () => {
  const wire = (state: string) =>
    JSON.stringify({ namespace: "widget", name: "state", payload: { state } });

  it.each([
    "opened",
    "loaded",
    "closed",
    "completed",
    "cancelled",
    "rejected",
  ])("reads %s from the real serialised envelope", (state) => {
    expect(parsePaybisWidgetEvent(wire(state))).toBe(state);
  });

  // The whole defect: this returned null, so a terminal state never reached the frame and the user
  // was stranded inside the widget with the app's "opening" caption under a finished receipt.
  it("no longer drops a serialised terminal state", () => {
    expect(parsePaybisWidgetEvent(wire("cancelled"))).toBe("cancelled");
    expect(parsePaybisWidgetEvent(wire("completed"))).toBe("completed");
  });

  it("reads a serialised flat error message", () => {
    expect(parsePaybisWidgetEvent(JSON.stringify({ namespace: "widget", name: "error" }))).toBe(
      "error",
    );
  });

  it("still accepts the OBJECT form, so a vendor that stops serialising does not break us", () => {
    expect(
      parsePaybisWidgetEvent({ namespace: "widget", name: "state", payload: { state: "closed" } }),
    ).toBe("closed");
  });

  it("ignores a foreign namespace rather than acting on it", () => {
    expect(
      parsePaybisWidgetEvent(
        JSON.stringify({
          namespace: "somebody-else",
          name: "state",
          payload: { state: "completed" },
        }),
      ),
    ).toBeNull();
  });

  it("tolerates a namespace-less envelope, which the vendor defaults to empty", () => {
    expect(
      parsePaybisWidgetEvent(JSON.stringify({ name: "state", payload: { state: "closed" } })),
    ).toBe("closed");
  });

  it("ignores non-JSON strings and malformed envelopes rather than guessing", () => {
    expect(parsePaybisWidgetEvent("not json at all")).toBeNull();
    expect(
      parsePaybisWidgetEvent(JSON.stringify({ namespace: "widget", name: "state" })),
    ).toBeNull();
    expect(parsePaybisWidgetEvent("{ broken json")).toBeNull();
  });

  it("still reads a bare string event name", () => {
    expect(parsePaybisWidgetEvent("completed")).toBe("completed");
  });
});

/**
 * POO-1390: the vendor tells us WHY and we threw it away.
 *
 * Found investigating a real production report (v1.3.0, `ONRAMP_ERROR`, reference
 * a99f6fa428df4fff86f04e1cba8acbb6). Per the vendor bundle transcribed in `paybisWidget.ts`, `error`
 * lives in the MESSAGE-NAME enum and not the state enum, so it arrives flat as
 * `{ name: 'error', payload: {...} }` — and that payload carries the real reason. The parser returned
 * a bare name, so the reason was dropped and the user was shown a message we invented.
 *
 * This extractor is deliberately a SIBLING of `parsePaybisWidgetEvent` rather than a widened return
 * type: one production call site wants the name, ~30 assertions pin the current signature, and the
 * reason is only ever read on a terminal event.
 */
describe("[POO-1390] parsePaybisWidgetReason", () => {
  it("reads the reason from the flat error envelope the vendor actually sends", () => {
    expect(parsePaybisWidgetReason({ name: "error", payload: { message: "Card declined" } })).toBe(
      "Card declined",
    );
  });

  it("reads it through the JSON-string envelope, the shape that reaches postMessage", () => {
    const wire = JSON.stringify({
      namespace: "widget",
      name: "error",
      payload: { message: "3-D Secure failed" },
    });
    expect(parsePaybisWidgetReason(wire)).toBe("3-D Secure failed");
  });

  it("accepts the other plausible vendor keys, since the exact shape is unverified", () => {
    expect(parsePaybisWidgetReason({ name: "error", payload: { reason: "expired" } })).toBe(
      "expired",
    );
    expect(parsePaybisWidgetReason({ name: "error", payload: { error: "declined" } })).toBe(
      "declined",
    );
    expect(parsePaybisWidgetReason({ name: "error", message: "top level" })).toBe("top level");
  });

  it("[R5] degrades to undefined on every shape that carries no reason", () => {
    expect(parsePaybisWidgetReason({ name: "error" })).toBeUndefined();
    expect(parsePaybisWidgetReason({ name: "error", payload: null })).toBeUndefined();
    expect(parsePaybisWidgetReason({ name: "error", payload: { message: 42 } })).toBeUndefined();
    expect(parsePaybisWidgetReason({ name: "error", payload: { message: "   " } })).toBeUndefined();
    expect(parsePaybisWidgetReason("not json at all")).toBeUndefined();
    expect(parsePaybisWidgetReason(null)).toBeUndefined();
    expect(parsePaybisWidgetReason(undefined)).toBeUndefined();
    expect(parsePaybisWidgetReason(42)).toBeUndefined();
  });

  it("[R3] bounds the reason, so a vendor stack cannot become dialog copy", () => {
    const long = "x".repeat(500);
    const reason = parsePaybisWidgetReason({ name: "error", payload: { message: long } });
    // 200 kept characters plus the truncation marker, matching `logger.ts`'s MAX_STRING_CHARS
    // convention where the ellipsis is extra rather than counted against the budget.
    expect(reason).toHaveLength(201);
    expect(reason?.endsWith("…")).toBe(true);
  });

  it("[R3] masks an address the vendor embedded in its own message", () => {
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    const reason = parsePaybisWidgetReason({
      name: "error",
      payload: { message: `payout to ${wallet} failed` },
    });
    expect(reason).not.toContain(wallet);
  });
});

/**
 * Rafael, 2026-08-06: Paybis is a KYC'd vendor, so its terminal reasons can carry the identity data
 * it collected to verify the buyer. We do not want that associated with a wallet in our dialog, in a
 * support ticket or in Sentry. `redactSecrets` is hex-only and catches none of it.
 */
describe("[POO-1390] vendor KYC identity data never survives", () => {
  const reason = (message: string) =>
    parsePaybisWidgetReason({ name: "error", payload: { message } });

  it("strips an email, the shape the decision was about", () => {
    const out = reason("KYC rejected for jane.doe@example.com, document expired");
    expect(out).not.toContain("jane.doe@example.com");
    expect(out).toContain("[email]");
    // ...and the DIAGNOSTIC half survives, which is the whole reason the reason is shown at all.
    expect(out).toContain("KYC rejected");
  });

  it("strips a long digit run (PAN, document or order number) but keeps a card's last four", () => {
    expect(reason("Card 4242424242424242 declined")).not.toContain("4242424242424242");
    // A four-digit fragment is how a user recognises WHICH card, and is not identifying on its own.
    expect(reason("Card ending 4242 declined by issuer")).toContain("4242");
  });

  it("strips a phone number", () => {
    const out = reason("Verification SMS to +44 7700 900123 failed");
    expect(out).not.toContain("7700 900123");
    expect(out).toContain("[phone]");
  });

  it("leaves an ordinary vendor reason completely alone", () => {
    expect(reason("Payment method not available in your region")).toBe(
      "Payment method not available in your region",
    );
  });

  it("still applies the hex mask, so both rules run and neither replaces the other", () => {
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    const out = reason(`payout to ${wallet} for user@x.io failed`);
    expect(out).not.toContain(wallet);
    expect(out).not.toContain("user@x.io");
  });
});

/**
 * POO-1389 review S4. The reviewer ran the original three patterns against realistic vendor strings
 * and produced a table of what survived. These are the rows that came back UNCHANGED.
 */
describe("[POO-1390] the KYC shapes that used to survive", () => {
  const reason = (m: string) => parsePaybisWidgetReason({ name: "error", payload: { message: m } });

  it("strips a SEPARATED card number, the normal way a PAN is written", () => {
    expect(reason("Card 4242 4242 4242 4242 declined")).toBe("Card [number] declined");
    expect(reason("Card 4242-4242-4242-4242 declined")).toBe("Card [number] declined");
  });

  it("strips a letter-adjacent document number, national id and IBAN", () => {
    expect(reason("Document AB1234567 not accepted")).not.toContain("1234567");
    expect(reason("IBAN GB29NWBK60161331926819 rejected")).not.toContain("60161331926819");
  });

  it("still keeps a decimal figure, which is diagnostic and not identifying", () => {
    expect(reason("Amount 30.31 below minimum")).toBe("Amount 30.31 below minimum");
  });

  it("still keeps a four-digit card fragment", () => {
    expect(reason("Card ending 4242 declined")).toContain("4242");
  });
});
