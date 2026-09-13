/**
 * @id PP-CORE-LIB-111 (POO-1813) - tests
 * @name funding buy funnel - tests
 * @implements-rules-version v1 (POO-1813 rules v1)
 * @analytics-events funding_buy_started, funding_buy_submitted, funding_buy_failed, funding_buy_settled
 *
 * Assertions read `window.dataLayer` rather than a mocked `track`, so what is asserted is what GTM
 * would really receive, sanitizer included. That is also what lets the last case prove the negative
 * that matters most on a funding surface: no wallet address, ever.
 */
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { type FundingBuyContext, onRampErrorCode, useFundingBuyFunnel } from "./fundingBuyFunnel";

const PRIVY: FundingBuyContext = {
  rail: "privy",
  attemptId: "att_abc123",
  fiatCurrency: "BRL",
};

function pushed(): Record<string, unknown>[] {
  return (window.dataLayer ?? []) as Record<string, unknown>[];
}

function named(event: string): Record<string, unknown>[] {
  return pushed().filter((entry) => entry.event === event);
}

beforeEach(() => {
  window.dataLayer = [];
});

describe("useFundingBuyFunnel", () => {
  // @rule R3
  it("[R3] emits all four names, which have been declared and dead since POO-1178", () => {
    const { result } = renderHook(() => useFundingBuyFunnel());
    act(() => {
      result.current.started(PRIVY);
      result.current.submitted(PRIVY, "confirmed");
      result.current.settled(PRIVY, { requestedUsd: 100, prefillUsd: 105, deliveredUsd: 103.2 });
      result.current.failed(PRIVY, "popup_blocked");
    });

    expect(pushed().map((entry) => entry.event)).toEqual([
      "funding_buy_started",
      "funding_buy_submitted",
      "funding_buy_settled",
      "funding_buy_failed",
    ]);
  });

  // @rule R3
  it("[R3] carries the rail on every row, so two providers cannot be averaged into one rate", () => {
    const { result } = renderHook(() => useFundingBuyFunnel());
    act(() => {
      result.current.started(PRIVY);
      result.current.started({ ...PRIVY, rail: "paybis" });
    });

    expect(named("funding_buy_started").map((entry) => entry.rail)).toEqual(["privy", "paybis"]);
  });

  // @rule R3
  it("[R3] joins the four rows on OUR attempt id", () => {
    const { result } = renderHook(() => useFundingBuyFunnel());
    act(() => {
      result.current.started(PRIVY);
      result.current.settled(PRIVY, { requestedUsd: 100, prefillUsd: 105, deliveredUsd: 103.2 });
    });

    for (const entry of pushed()) expect(entry.attempt_id).toBe("att_abc123");
  });

  // @rule R3
  it("[R3] omits the attempt id when the adapter refused before minting one", () => {
    // `null` means no surface ever opened, so there is nothing to join to. An empty string would be
    // a key that groups every refusal into one imaginary purchase.
    const { result } = renderHook(() => useFundingBuyFunnel());
    act(() => {
      result.current.failed({ ...PRIVY, attemptId: null }, "missing_default_asset");
    });

    expect(named("funding_buy_failed")[0]).not.toHaveProperty("attempt_id");
  });

  // @rule R4
  it("[R4] settled carries the three figures the buffer measurement needs", () => {
    // requested to prefill is OUR buffer; prefill to delivered is the PROVIDER's spread. Neither was
    // measurable before this event existed, which is the half POO-1811 deliberately left open.
    const { result } = renderHook(() => useFundingBuyFunnel());
    act(() => {
      result.current.settled(PRIVY, { requestedUsd: 100, prefillUsd: 105, deliveredUsd: 103.2 });
    });

    expect(named("funding_buy_settled")[0]).toMatchObject({
      requested_usd: 100,
      prefill_usd: 105,
      delivered_usd: 103.2,
      // GA4 wants a value with a currency, and the honest one is what ARRIVED.
      value: 103.2,
      currency: "USD",
    });
  });

  // @rule R4
  it("[R4] omits prefill_usd rather than sending a zero we never asked for", () => {
    // A buyer paying in another currency is sent no `defaultAmount` at all, so there is no prefill
    // to report. A `0` would be averaged into the buffer series as a real figure; a missing
    // dimension is a row the query skips.
    const { result } = renderHook(() => useFundingBuyFunnel());
    act(() => {
      result.current.settled(PRIVY, { requestedUsd: 100, deliveredUsd: 96.4 });
    });

    const [settled] = named("funding_buy_settled");
    expect(settled).not.toHaveProperty("prefill_usd");
    expect(settled).toMatchObject({ requested_usd: 100, delivered_usd: 96.4 });
  });

  // @rule R1
  it("[R1] maps every classifier reason to its own code, never a shared one", () => {
    // `popup_blocked` and `not_authenticated` are both hard noes and call for opposite fixes, so a
    // folded code would hide exactly the difference the report exists to show.
    expect(onRampErrorCode("popup_blocked")).toBe("ONRAMP_POPUP_BLOCKED");
    expect(onRampErrorCode("not_authenticated")).toBe("ONRAMP_NOT_AUTHENTICATED");
    expect(onRampErrorCode("invalid_destination_asset")).toBe("ONRAMP_INVALID_DESTINATION_ASSET");
    expect(onRampErrorCode("user_exited")).toBe("ONRAMP_USER_EXITED");
    const codes = [
      "popup_blocked",
      "not_authenticated",
      "invalid_destination_address",
      "invalid_destination_chain",
      "invalid_destination_asset",
      "flow_already_open",
      "empty_fiat_assets",
      "no_funding_config",
      "missing_default_asset",
      "unsupported_fiat_asset",
      "destination_unavailable",
      "user_exited",
      "provider_timeout",
      "unknown_error",
      "unknown_success_status",
    ].map(onRampErrorCode);
    expect(new Set(codes).size).toBe(codes.length);
    // And none of them fell through to the fallback, which would fold two reasons into one row.
    expect(codes).not.toContain("ONRAMP_UNMAPPED");
  });

  // @rule R1
  it("[R1] falls back to a namespaced code rather than throwing on an unmapped reason", () => {
    // A provider that adds a rejection message must not be able to break a purchase through the
    // analytics path, and an ONRAMP_UNMAPPED in a report is itself the signal to add an entry.
    expect(onRampErrorCode("something_privy_added_last_week")).toBe("ONRAMP_UNMAPPED");
  });

  // @rule R1
  it("[R1] puts the mapped code on the failure row, beside the raw reason", () => {
    const { result } = renderHook(() => useFundingBuyFunnel());
    act(() => {
      result.current.failed(PRIVY, "popup_blocked");
    });

    expect(named("funding_buy_failed")[0]).toMatchObject({
      reason: "popup_blocked",
      error_code: "ONRAMP_POPUP_BLOCKED",
    });
  });

  it("never puts a wallet address in any row", () => {
    const { result } = renderHook(() => useFundingBuyFunnel());
    act(() => {
      result.current.started(PRIVY);
      result.current.submitted(PRIVY, "maybe");
      result.current.settled(PRIVY, { requestedUsd: 100, prefillUsd: 105, deliveredUsd: 103.2 });
    });

    expect(JSON.stringify(pushed())).not.toMatch(/0x[0-9a-fA-F]{40}/);
  });
});
