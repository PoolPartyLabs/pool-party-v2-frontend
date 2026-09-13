/**
 * @id PP-CORE-LIB-090 (POO-1404) — tests
 * @implements-rules-version v1 (POO-1404 rules v1)
 *
 * The contract: a captured on-ramp failure arrives with the widget's own sequence attached. The
 * assertions worth reading are the ones about the messages we DISCARD for control flow, because
 * those are the steps a user actually walks through and they were the missing evidence in the
 * 2026-08-06 PIX report (reference 0627f0495ed8448da1b3760bbb7c88c9, which resolved to nothing).
 */
import { addBreadcrumb } from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { breadcrumbPaybisMessage, PAYBIS_BREADCRUMB_CATEGORY } from "./paybisBreadcrumbs";

vi.mock("@sentry/nextjs", () => ({ addBreadcrumb: vi.fn() }));
const crumb = vi.mocked(addBreadcrumb);

/** The last breadcrumb recorded, as the SDK would have received it. */
const last = () => crumb.mock.calls.at(-1)?.[0];

beforeEach(() => crumb.mockReset());

describe("breadcrumbPaybisMessage", () => {
  it("records a state transition under its STATE, not the literal name 'state'", () => {
    breadcrumbPaybisMessage(
      JSON.stringify({ namespace: "widget", name: "state", payload: { state: "loaded" } }),
    );
    expect(last()).toMatchObject({ category: PAYBIS_BREADCRUMB_CATEGORY, message: "state:loaded" });
  });

  /**
   * THE point of this module. `parsePaybisWidgetEvent` returns null for these so the hook cannot
   * mis-branch, which is correct for control flow and is exactly what left an incident timeline
   * empty. They must reach the breadcrumb trail.
   */
  it("records the lifecycle messages the PARSER deliberately discards", () => {
    for (const name of ["showLoader", "payment-initiated", "payout-waiting", "payment-redirect"]) {
      breadcrumbPaybisMessage(JSON.stringify({ namespace: "widget", name }));
      expect(last()?.message).toBe(name);
    }
    expect(crumb).toHaveBeenCalledTimes(4);
  });

  it("records a vendor state we have never seen, so a new one shows up the first time it fires", () => {
    breadcrumbPaybisMessage(JSON.stringify({ name: "state", payload: { state: "kyc-review" } }));
    expect(last()?.message).toBe("state:kyc-review");
  });

  it("marks a terminal error at error level, so a timeline shows where it turned", () => {
    breadcrumbPaybisMessage({ name: "error", payload: { message: "Card declined" } });
    expect(last()).toMatchObject({ level: "error", message: "error" });
    expect(last()?.data).toMatchObject({ message: "Card declined" });
  });

  it("keeps the payload, which is the half that says WHY", () => {
    breadcrumbPaybisMessage({
      name: "payment-initiated",
      payload: { method: "pix", amount: 30.31 },
    });
    expect(last()?.data).toMatchObject({ method: "pix", amount: 30.31 });
  });

  it("masks an address and clips a long value, because a KYC payload is where those appear", () => {
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    breadcrumbPaybisMessage({ name: "error", payload: { to: wallet, note: "x".repeat(400) } });
    const data = last()?.data as Record<string, string>;
    expect(data.to).not.toContain(wallet);
    expect((data.note ?? "").length).toBeLessThanOrEqual(121);
  });

  it("bounds the number of keys, so a vendor document cannot become the event", () => {
    const payload = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
    breadcrumbPaybisMessage({ name: "state", payload });
    expect(Object.keys(last()?.data ?? {}).length).toBeLessThanOrEqual(12);
  });

  it("records a nested object as a shape rather than walking it", () => {
    breadcrumbPaybisMessage({ name: "state", payload: { deep: { a: { b: 1 } }, list: [1, 2, 3] } });
    expect(last()?.data).toMatchObject({ deep: "[object]", list: "[array:3]" });
  });

  it("survives every shape a hostile or broken sender can produce", () => {
    for (const input of [null, undefined, 42, "not json", "{ broken", {}, { name: 7 }, []]) {
      expect(() => breadcrumbPaybisMessage(input)).not.toThrow();
    }
  });

  it("never throws when the SDK itself does", () => {
    crumb.mockImplementationOnce(() => {
      throw new Error("sdk exploded");
    });
    expect(() => breadcrumbPaybisMessage({ name: "loaded" })).not.toThrow();
  });
});
