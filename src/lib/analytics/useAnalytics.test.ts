import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONSENT_COOKIE } from "./consent";
import { useAnalytics } from "./useAnalytics";
import { setAnalyticsUserId } from "./userId";

const RAW_ADDRESS = `0x${"a".repeat(40)}`;

function clearConsent(): void {
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
}

describe("useAnalytics", () => {
  beforeEach(() => {
    window.dataLayer = [];
    clearConsent();
  });
  afterEach(() => {
    setAnalyticsUserId(null);
    clearConsent();
  });

  it("pushes a typed event to the dataLayer", () => {
    const { result } = renderHook(() => useAnalytics());
    result.current.track("strategy_invest_started", { strategy_id: "str_1", risk_level: 3 });
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "strategy_invest_started",
        strategy_id: "str_1",
        risk_level: 3,
      }),
    );
  });

  // R2 negative test: no raw address ever lands in a push.
  it("never pushes a raw wallet address", () => {
    const { result } = renderHook(() => useAnalytics());
    result.current.track("auth_signin_completed", { user_id: RAW_ADDRESS });
    const serialized = JSON.stringify(window.dataLayer);
    expect(serialized).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  // R4: user_id only attaches after consent granted.
  it("drops user_id before consent and keeps it after", () => {
    const { result } = renderHook(() => useAnalytics());

    result.current.track("auth_signin_completed", { user_id: "hashed_id", chain_id: 8453 });
    expect(window.dataLayer?.at(-1)).not.toHaveProperty("user_id");

    document.cookie = `${CONSENT_COOKIE}=granted; Path=/`;
    result.current.track("wallet_connect_completed", { user_id: "hashed_id", chain_id: 8453 });
    expect(window.dataLayer?.at(-1)).toMatchObject({ user_id: "hashed_id" });
  });

  // POO-164: the resolved store id rides on every event once consent is granted…
  it("merges the store user_id into events after consent", () => {
    setAnalyticsUserId("c".repeat(64));
    document.cookie = `${CONSENT_COOKIE}=granted; Path=/`;
    const { result } = renderHook(() => useAnalytics());
    result.current.track("page_viewed", { page_path: "/" });
    expect(window.dataLayer?.at(-1)).toMatchObject({ user_id: "c".repeat(64) });
    // …an explicit per-call user_id wins over the store.
    result.current.track("page_viewed", { page_path: "/", user_id: "explicit" });
    expect(window.dataLayer?.at(-1)).toMatchObject({ user_id: "explicit" });
  });

  // POO-164 + R4: the store id is still dropped before consent.
  it("drops the store user_id before consent", () => {
    setAnalyticsUserId("d".repeat(64));
    const { result } = renderHook(() => useAnalytics());
    result.current.track("page_viewed", { page_path: "/" });
    expect(window.dataLayer?.at(-1)).not.toHaveProperty("user_id");
  });
});
