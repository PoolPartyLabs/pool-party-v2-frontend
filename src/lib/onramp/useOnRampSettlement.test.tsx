/**
 * @id PP-CORE-HOK-025 (POO-1134, POO-1390)
 * @name useOnRampSettlement — spec
 * @implements-rules-version v3 (POO-1390 rules v1) · v2 (POO-1129 rules v2)
 *
 * The heart of the epic. Each business rule maps to at least one it():
 *   [R4] the OBSERVED balance delta is authoritative, never the requested/reported amount.
 *   [R5] `completed` starts a bounded, backing-off poll; terminal events terminate; `closed` with no
 *        terminal event stays resumable; ceiling elapsed is `settling`, not failure.
 *   [R7] the requestId is journaled before opening, so a reload does not mint a second one.
 * Plus the PP-SECURITY origin guard: a spoofed `completed` from a foreign frame never settles.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenBalance } from "@/lib/balances/types";

// --- mocks for the wallet-scoped collaborators (the hook composes, tests inject) ---------------
const mocks = vi.hoisted(() => ({
  isSignedIn: true,
  isLoading: false,
  balances: [] as TokenBalance[],
  getWalletHoldings: vi.fn<() => Promise<TokenBalance[] | null>>(),
  requestBalanceRefresh: vi.fn(),
  reportClientError: vi.fn(),
  // POO-1598 S3: the widget capture, mocked here so the WIRING is asserted (armed on open, fed
  // every vouched message, closed on detach) without this suite depending on the flag or the
  // transport. The module's own behaviour is pinned in `paybisCapture.test.ts`.
  startPaybisCapture: vi.fn(),
  capturePaybisMessage: vi.fn(),
  stopPaybisCapture: vi.fn(),
  // POO-1598 S4: the OTHER sink on the same listener. Mocked so a test can make it throw and prove
  // the two are isolated from each other, which a single shared `observe()` wrapper would not be.
  breadcrumbPaybisMessage: vi.fn(),
}));

vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => ({ isSignedIn: mocks.isSignedIn, status: "signed-in", error: null }),
}));
vi.mock("@/lib/balances/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: mocks.balances,
    totalUsd: 0,
    dayChangeUsd: 0,
    dayChangePct: 0,
    isLoading: mocks.isLoading,
    isRefreshing: false,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/balances/walletHoldingsActions", () => ({
  getWalletHoldingsAction: mocks.getWalletHoldings,
}));
vi.mock("@/lib/balances/balanceRefresh", () => ({
  requestBalanceRefresh: mocks.requestBalanceRefresh,
}));
vi.mock("@/lib/observability/reportClientError", () => ({
  reportClientError: mocks.reportClientError,
}));
vi.mock("./paybisCapture", () => ({
  startPaybisCapture: mocks.startPaybisCapture,
  capturePaybisMessage: mocks.capturePaybisMessage,
  stopPaybisCapture: mocks.stopPaybisCapture,
}));
vi.mock("./paybisBreadcrumbs", () => ({
  breadcrumbPaybisMessage: mocks.breadcrumbPaybisMessage,
}));

import { findResumableOnRampRequest, ONRAMP_JOURNAL_KEY } from "./onRampJournal";
import {
  POLL_CEILING_MS,
  POLL_INITIAL_DELAY_MS,
  POLL_MAX_DELAY_MS,
  useOnRampSettlement,
} from "./useOnRampSettlement";

const WIDGET_ORIGIN = "https://widget.sandbox.paybis.com";
const WALLET = "0xAbCdaBcDABcdabCdaBCDabcDABcDABcdABcDaBCd";

function usdc(amount: number, over: Partial<TokenBalance> = {}): TokenBalance {
  return {
    symbol: "USDC",
    name: "USD Coin",
    amount,
    decimals: 6,
    usd: amount,
    chainId: 8453,
    logoUrl: "",
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    isNative: false,
    ...over,
  };
}

/** Arbitrum: a chain the on-ramp can never deliver to (Paybis sells on Base only). */
const OFF_RAMP_CHAIN_ID = 42_161;

/** Native ETH on Base: the other currency the on-ramp can sell (`ETH-BASE`). */
function ethBase(amount: number, over: Partial<TokenBalance> = {}): TokenBalance {
  return {
    symbol: "ETH",
    name: "Ethereum",
    amount,
    decimals: 18,
    usd: amount * 3_000,
    chainId: 8453,
    logoUrl: "",
    address: "0x0000000000000000000000000000000000000000",
    isNative: true,
    ...over,
  };
}

/** A loaded Paybis SDK whose openInEmbed is a spy. */
function installWidget() {
  const openInEmbed = vi.fn();
  window.PartnerExchangeWidget = { openInEmbed, open: vi.fn(), isLoaded: true };
  return openInEmbed;
}

/** Post a widget lifecycle message from a given origin. */
function postWidgetEvent(name: string, origin: string = WIDGET_ORIGIN) {
  window.dispatchEvent(new MessageEvent("message", { data: { name }, origin }));
}

/**
 * Post the FLAT error envelope the vendor actually sends (POO-1390): `error` is in Paybis' message-name
 * enum rather than its state enum, so it arrives with its reason in the payload.
 */
function postWidgetError(reason: string, origin: string = WIDGET_ORIGIN) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: JSON.stringify({ namespace: "widget", name: "error", payload: { message: reason } }),
      origin,
    }),
  );
}

const container = () => document.createElement("div");

beforeEach(() => {
  localStorage.clear();
  mocks.isSignedIn = true;
  mocks.isLoading = false;
  mocks.balances = [];
  mocks.getWalletHoldings.mockReset();
  mocks.requestBalanceRefresh.mockReset();
  mocks.reportClientError.mockReset();
  mocks.startPaybisCapture.mockReset();
  mocks.capturePaybisMessage.mockReset();
  mocks.stopPaybisCapture.mockReset();
  mocks.breadcrumbPaybisMessage.mockReset();
  window.PartnerExchangeWidget = undefined;
});
afterEach(() => {
  vi.useRealTimers();
  window.PartnerExchangeWidget = undefined;
});

describe("open() guards", () => {
  // @rule R4 — a pre-SIWE baseline reads a false zero and the delta becomes the whole wallet, so the
  // hook refuses to open (and therefore to snapshot) without a session.
  it("refuses to open when not signed in", () => {
    mocks.isSignedIn = false;
    const openInEmbed = installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    expect(openInEmbed).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
  });

  it("refuses to open while the baseline is still loading", () => {
    mocks.isLoading = true;
    const openInEmbed = installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    expect(openInEmbed).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
  });

  it("errors when the SDK script has not loaded", () => {
    // no installWidget()
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    expect(result.current.status).toBe("error");
  });

  it("opens the widget in embed mode and reflects the 'opened' event", () => {
    const openInEmbed = installWidget();
    const el = container();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: el,
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    expect(openInEmbed).toHaveBeenCalledWith({ requestId: "req-1" }, el);
    act(() => postWidgetEvent("opened"));
    expect(result.current.status).toBe("open");
  });
});

describe("[R7] one purchase per step", () => {
  // @rule R7: the requestId is journaled BEFORE opening, so a reload finds it and reuses it.
  it("journals the requestId before opening", () => {
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    expect(findResumableOnRampRequest(WALLET)?.requestId).toBe("req-1");
    // The record exists in the store the mint site (POO-1135) will read on reload.
    expect(localStorage.getItem(ONRAMP_JOURNAL_KEY)).toContain("req-1");
  });
});

describe("[R5] + PP-SECURITY message handling", () => {
  // @rule R5: a spoofed `completed` from a foreign frame must never advance settlement.
  it("ignores a message from a non-Paybis origin", async () => {
    installWidget();
    mocks.balances = [usdc(5)];
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed", "https://evil.example.com"));
    expect(result.current.status).toBe("opening");
  });

  it("ignores unhandled widget events", () => {
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("showLoader"));
    expect(result.current.status).toBe("opening");
  });

  // @rule R5: rejected / cancelled / error terminate with the matching state.
  it.each([
    "rejected",
    "cancelled",
    "error",
  ] as const)("terminates on %s and publishes a refresh once", (event) => {
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent(event));
    expect(result.current.status).toBe(event);
    expect(mocks.requestBalanceRefresh).toHaveBeenCalledTimes(1);
    // The purchase intent is terminal, so a re-entry mints fresh rather than resuming it.
    expect(findResumableOnRampRequest(WALLET)).toBeNull();
  });

  // @rule R5: `closed` with no terminal event stays resumable and does not publish.
  it("treats a bare close as resumable, not terminal", () => {
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("closed"));
    expect(result.current.status).toBe("closed");
    expect(mocks.requestBalanceRefresh).not.toHaveBeenCalled();
    expect(findResumableOnRampRequest(WALLET)?.requestId).toBe("req-1");
  });

  // @rule R5 (clarified) — a terminal event arriving AFTER `completed` describes the widget's UI, not
  // the money: the payment is already made. Aborting would retire the intent while the funds may still
  // be landing, and the mint site (POO-1135) would then mint a SECOND requestId for a paid purchase.
  it.each([
    "rejected",
    "cancelled",
    "error",
  ] as const)("does not abort reconciliation when %s arrives after completed", async (event) => {
    vi.useFakeTimers();
    installWidget();
    mocks.balances = [usdc(5)];
    mocks.getWalletHoldings.mockResolvedValue([usdc(105)]);
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed"));
    expect(result.current.status).toBe("reconciling");

    act(() => postWidgetEvent(event));
    // The poll is untouched and the record is NOT terminal: it stays resumable.
    expect(result.current.status).toBe("reconciling");
    expect(findResumableOnRampRequest(WALLET)?.requestId).toBe("req-1");

    // And it goes on to settle on the real delta, proving the poll was never detached.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INITIAL_DELAY_MS + 10);
    });
    expect(result.current.status).toBe("settled");
    expect(result.current.deltaByToken[0]?.amount).toBeCloseTo(100);
  });
});

describe("[R4] settlement from the observed balance delta", () => {
  it("polls after completed and settles on the observed delta, not the requested amount", async () => {
    vi.useFakeTimers();
    installWidget();
    mocks.balances = [usdc(5)]; // baseline: 5 USDC on Base
    // The user changed the amount inside the widget: we requested ~100 but 137 actually landed.
    mocks.getWalletHoldings.mockResolvedValue([usdc(142)]);
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed"));
    expect(result.current.status).toBe("reconciling");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INITIAL_DELAY_MS + 10);
    });

    expect(result.current.status).toBe("settled");
    expect(result.current.deltaByToken).toHaveLength(1);
    // 142 observed − 5 baseline = 137, the AUTHORITATIVE figure (not the ~100 we requested).
    expect(result.current.deltaByToken[0]?.amount).toBeCloseTo(137);
    expect(mocks.requestBalanceRefresh).toHaveBeenCalledTimes(1);
    expect(findResumableOnRampRequest(WALLET)).toBeNull(); // marked settled
  });

  // @rule R4 — a false-zero poll (cookie expired mid-widget → []) never reads as "all balances
  // dropped"; the poll keeps waiting for a real positive delta.
  it("does not settle on an empty/unproven poll read", async () => {
    vi.useFakeTimers();
    installWidget();
    mocks.balances = [usdc(50)];
    mocks.getWalletHoldings.mockResolvedValueOnce([]); // unproven
    mocks.getWalletHoldings.mockResolvedValue([usdc(150)]); // then the real delta
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INITIAL_DELAY_MS + 10);
    });
    // First read was [] → still reconciling, no false settle.
    expect(result.current.status).toBe("reconciling");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_CEILING_MS);
    });
    expect(result.current.status).toBe("settled");
    expect(result.current.deltaByToken[0]?.amount).toBeCloseTo(100);
  });

  it("does not publish per poll tick, only once at settlement", async () => {
    vi.useFakeTimers();
    installWidget();
    mocks.balances = [usdc(5)];
    mocks.getWalletHoldings.mockResolvedValueOnce([usdc(5)]); // no change yet
    mocks.getWalletHoldings.mockResolvedValueOnce([usdc(5)]); // still nothing
    mocks.getWalletHoldings.mockResolvedValue([usdc(105)]); // finally lands
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_CEILING_MS);
    });
    expect(result.current.status).toBe("settled");
    expect(mocks.requestBalanceRefresh).toHaveBeenCalledTimes(1);
  });

  // @rule R5: ceiling elapsed with no delta is the settling phase, not a failure; stays resumable.
  it("times out to settling (not failure) when no delta appears before the ceiling", async () => {
    vi.useFakeTimers();
    installWidget();
    mocks.balances = [usdc(5)];
    mocks.getWalletHoldings.mockResolvedValue([usdc(5)]); // never grows
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed"));
    // Past the ceiling PLUS one more max-backoff interval, so the first post-ceiling tick fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_CEILING_MS + POLL_MAX_DELAY_MS + 100);
    });
    expect(result.current.status).toBe("timed-out");
    // Money may still be in flight, so the intent stays resumable (never marked failed).
    expect(findResumableOnRampRequest(WALLET)?.requestId).toBe("req-1");
    expect(mocks.requestBalanceRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps polling after a bare close once completed has fired", async () => {
    vi.useFakeTimers();
    installWidget();
    mocks.balances = [usdc(5)];
    mocks.getWalletHoldings.mockResolvedValue([usdc(105)]);
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed"));
    act(() => postWidgetEvent("closed")); // user closed the frame after paying

    // @rule R12 (POO-1136) — the ORDERING this depends on: the `closed` branch returns BEFORE
    // `setFlowStatus("closed")` once `completed` has been seen, so a post-payment close never surfaces
    // as `closed` at all. `PaybisWidgetFrame` now treats `closed` as terminal and fails the buy step
    // on it, which is only correct while this holds: reverse it and a paid purchase would be aborted
    // mid-reconcile and re-charged on retry.
    expect(result.current.status).toBe("reconciling");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INITIAL_DELAY_MS + 10);
    });
    expect(result.current.status).toBe("settled");
  });
});

describe("[R4] only the purchase settles, not any delta in the window", () => {
  /** Open, fire `completed`, and run the poll to its ceiling. */
  async function reconcileToCeiling(holdings: TokenBalance[], baseline: TokenBalance[]) {
    vi.useFakeTimers();
    installWidget();
    mocks.balances = baseline;
    mocks.getWalletHoldings.mockResolvedValue(holdings);
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INITIAL_DELAY_MS + 10);
    });
    return result;
  }

  // @rule R4 — the reconcile window is up to ten minutes, so an unrelated inbound credit on ANOTHER
  // chain will sometimes land inside it. Paybis sells on Base only, so that can never be the purchase.
  it("does not settle on growth on a non-Base chain", async () => {
    const result = await reconcileToCeiling(
      [usdc(5), usdc(505, { chainId: OFF_RAMP_CHAIN_ID })], // +500 USDC on Arbitrum
      [usdc(5), usdc(5, { chainId: OFF_RAMP_CHAIN_ID })],
    );
    expect(result.current.status).toBe("reconciling");
    expect(result.current.deltaByToken).toEqual([]);

    // And it never settles later either: the ceiling turns it into the settling phase, not a purchase.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_CEILING_MS + POLL_MAX_DELAY_MS + 100);
    });
    expect(result.current.status).toBe("timed-out");
  });

  // @rule R4 — same window, same wallet, right chain, wrong token: still not this purchase.
  it("does not settle on growth in a different Base token", async () => {
    const result = await reconcileToCeiling(
      [usdc(5), ethBase(1)], // the order bought USDC-BASE; ETH on Base grew instead
      [usdc(5), ethBase(0)],
    );
    expect(result.current.status).toBe("reconciling");
    expect(result.current.deltaByToken).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_CEILING_MS + POLL_MAX_DELAY_MS + 100);
    });
    expect(result.current.status).toBe("timed-out");
  });

  // @rule R4 — the positive case: growth in the expected Base token settles, and `deltaByToken` reports
  // the observed figure for THAT token only, which is what POO-1135 sizes the downstream legs from.
  it("settles on growth in the expected Base token, reporting only that token", async () => {
    const result = await reconcileToCeiling(
      [usdc(142), usdc(505, { chainId: OFF_RAMP_CHAIN_ID }), ethBase(1)],
      [usdc(5), usdc(5, { chainId: OFF_RAMP_CHAIN_ID }), ethBase(0)],
    );
    expect(result.current.status).toBe("settled");
    expect(result.current.deltaByToken).toHaveLength(1);
    expect(result.current.deltaByToken[0]?.symbol).toBe("USDC");
    expect(result.current.deltaByToken[0]?.chainId).toBe(8453);
    expect(result.current.deltaByToken[0]?.amount).toBeCloseTo(137);
  });

  // @rule R4 — the token is an INPUT, so an ETH-BASE order settles on ETH and ignores the USDC growth.
  it("follows the order's currency code when it is ETH-BASE", async () => {
    vi.useFakeTimers();
    installWidget();
    mocks.balances = [usdc(5), ethBase(0)];
    mocks.getWalletHoldings.mockResolvedValue([usdc(105), ethBase(0.05)]);
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "ETH-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INITIAL_DELAY_MS + 10);
    });
    expect(result.current.status).toBe("settled");
    expect(result.current.deltaByToken).toHaveLength(1);
    expect(result.current.deltaByToken[0]?.symbol).toBe("ETH");
    expect(result.current.deltaByToken[0]?.amount).toBeCloseTo(0.05);
  });
});

describe("reset", () => {
  it("returns to idle and detaches, so a stale message no longer settles", () => {
    installWidget();
    mocks.balances = [usdc(5)];
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    act(() => postWidgetEvent("rejected"));
    expect(result.current.status).toBe("idle");
  });
});

/**
 * POO-1390. Both halves of the incident that produced the v1.3.0 production report (reference
 * a99f6fa428df4fff86f04e1cba8acbb6, code ONRAMP_ERROR): the vendor's reason was decoded and dropped,
 * and this path filed nothing to Sentry, so the reference the user quoted led nowhere.
 */
describe("[POO-1390] a terminal widget state is neither silent nor speechless", () => {
  const openFlow = () => {
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("opened"));
    return result;
  };

  it("[R3] surfaces the vendor's own reason instead of the sentence this app invented", () => {
    const result = openFlow();
    act(() => postWidgetError("Card declined by issuer"));

    expect(result.current.status).toBe("error");
    expect(result.current.terminalReason).toBe("Card declined by issuer");
  });

  it("[R2] files a Sentry report, so the quoted reference finally leads somewhere", () => {
    const result = openFlow();
    act(() => postWidgetError("Card declined by issuer"));

    expect(result.current.status).toBe("error");
    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.widget_terminal",
      expect.any(Error),
      expect.objectContaining({ status: "error", vendorReason: "Card declined by issuer" }),
      expect.anything(),
    );
  });

  it("[R5] a terminal event with no payload still reports, and carries no invented reason", () => {
    const result = openFlow();
    act(() => postWidgetEvent("rejected"));

    expect(result.current.status).toBe("rejected");
    expect(result.current.terminalReason).toBeUndefined();
    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.widget_terminal",
      expect.any(Error),
      expect.objectContaining({ status: "rejected" }),
      expect.anything(),
    );
  });

  /**
   * @rule POO-1403 R3 — this is the event an operator lands on for an on-ramp failure, and until now
   * it named the vendor's state without naming the vendor's PURCHASE. The `requestId` is the only
   * identifier Paybis support can act on, so it rides here as an INDEXED tag: `extra` is stored and
   * not indexed, which is no use to someone searching an invoice.
   */
  it("[POO-1403 R3] tags the report with the vendor's own purchase id", () => {
    const result = openFlow();
    act(() => postWidgetError("Card declined by issuer"));

    expect(result.current.status).toBe("error");
    const tags = mocks.reportClientError.mock.calls[0]?.[3];
    expect(tags).toEqual({ pp_paybis_request_id: "req-1" });
  });

  // POO-1387 [R4]: a user shutting their own checkout is INTENT, not a defect, exactly like a
  // dismissed wallet prompt. `IGNORED_ERRORS` would not have caught it, since the message reads
  // "Paybis widget terminated: cancelled" and matches none of those patterns. Abandonment is an
  // ANALYTICS event class (premise 11), not an error-tracker one.
  it("[R4] does NOT file a Sentry report when the user cancels their own order", () => {
    const result = openFlow();
    act(() => postWidgetEvent("cancelled"));

    expect(result.current.status).toBe("cancelled");
    expect(mocks.reportClientError).not.toHaveBeenCalled();
  });

  it("[R4] a terminal event AFTER completed is still ignored: the double-charge guard is untouched", () => {
    const result = openFlow();
    act(() => postWidgetEvent("completed"));
    expect(result.current.status).toBe("reconciling");

    act(() => postWidgetError("too late to matter"));

    expect(result.current.status).toBe("reconciling");
    expect(result.current.terminalReason).toBeUndefined();
    expect(mocks.reportClientError).not.toHaveBeenCalled();
  });

  it("clears a previous failure's reason when a fresh purchase opens", () => {
    const result = openFlow();
    act(() => postWidgetError("Card declined by issuer"));
    expect(result.current.terminalReason).toBe("Card declined by issuer");

    act(() =>
      result.current.open({
        requestId: "req-2",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    expect(result.current.terminalReason).toBeUndefined();
  });
});

/**
 * POO-1598 S3: the widget capture rides the SAME listener as the breadcrumb trail.
 *
 * These assertions exist because the failure mode is silence. A capture that is never armed, never
 * fed, or never closed produces no error and no test failure anywhere else. It produces a missing
 * fixture, discovered only after the one real production purchase this instrument exists for has
 * already been spent.
 */
describe("[POO-1598] the Paybis widget capture is wired to the one vouched listener", () => {
  // @rule R2: armed with the SERVER-minted requestId, at the moment the widget is handed over.
  it("arms the capture with the purchase's requestId when the widget opens", () => {
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1598",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    // [R9] The wallet rides along, because the capture is scoped to ONE operator address and the
    // hook is the only place that holds it. Passing the requestId alone would arm for every buyer.
    expect(mocks.startPaybisCapture).toHaveBeenCalledWith({
      requestId: "req-1598",
      wallet: WALLET,
    });
  });

  // @rule R5: every message the parser DISCARDS still reaches the capture, which is the half of
  // the checkout no schema documents and the whole reason S3 exists.
  it("feeds it every vouched message, including the ones the parser drops", () => {
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1598",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => {
      postWidgetEvent("showLoader");
      postWidgetEvent("payment-initiated");
      postWidgetEvent("loaded");
    });
    expect(mocks.capturePaybisMessage).toHaveBeenCalledTimes(3);
  });

  // PP-SECURITY: a foreign frame must not be able to write our fixture set, which would then be
  // replayed in tests as if it were vendor behaviour.
  it("never feeds it a message from a foreign origin", () => {
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1598",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed", "https://evil-paybis.com"));
    expect(mocks.capturePaybisMessage).not.toHaveBeenCalled();
  });

  // @rule R7: the session-end record carries the observed count, so it has to fire on the terminal
  // path too, not only on unmount.
  it("closes the capture when a terminal event detaches the listener", () => {
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1598",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    mocks.stopPaybisCapture.mockClear();
    act(() => postWidgetEvent("rejected"));
    expect(mocks.stopPaybisCapture).toHaveBeenCalled();
  });

  // @rule R6: capture is diagnostics and never a gate. A throwing capture must not stop the
  // purchase from advancing: `completed` still has to start reconciliation.
  it("keeps settling the purchase when the capture throws", () => {
    mocks.capturePaybisMessage.mockImplementation(() => {
      throw new Error("capture exploded");
    });
    mocks.getWalletHoldings.mockResolvedValue([usdc(100)]);
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1598",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("completed"));
    expect(result.current.status).toBe("reconciling");
  });

  // @rule R6: arming an instrument must never be the reason a purchase fails to open. Without the
  // caller-side guard this throws straight out of `open()` and `openInEmbed` is never reached.
  it("still opens the widget when arming the capture throws", () => {
    mocks.startPaybisCapture.mockImplementation(() => {
      throw new Error("arming exploded");
    });
    const openInEmbed = installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1598",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    expect(openInEmbed).toHaveBeenCalledWith({ requestId: "req-1598" }, expect.anything());
    expect(result.current.status).toBe("opening");
  });

  /**
   * @rule R6 (POO-1598 S4): the two sinks are isolated from EACH OTHER, not only from the money.
   *
   * One `observe()` wrapping both calls would satisfy "never gates the purchase" and still be wrong:
   * a throw in the breadcrumb sink would skip the capture call for that message, so the always-on
   * diagnostic could silently punch holes in the flag-gated one. The whole argument for keeping the
   * two sinks separate is that neither may break the other.
   */
  it("still records the capture when the breadcrumb sink throws, and the reverse", () => {
    mocks.breadcrumbPaybisMessage.mockImplementation(() => {
      throw new Error("breadcrumb exploded");
    });
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1598",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("showLoader"));
    expect(mocks.capturePaybisMessage).toHaveBeenCalledTimes(1);

    mocks.breadcrumbPaybisMessage.mockReset();
    mocks.capturePaybisMessage.mockImplementation(() => {
      throw new Error("capture exploded");
    });
    act(() => postWidgetEvent("payment-initiated"));
    expect(mocks.breadcrumbPaybisMessage).toHaveBeenCalledTimes(1);
  });

  // @rule R6: `detach()` is how the listener and the poll timer are torn down. A throwing capture
  // teardown there would leak both, and would leave a terminal state unset.
  it("still terminates the flow when closing the capture throws", () => {
    mocks.stopPaybisCapture.mockImplementation(() => {
      throw new Error("closing exploded");
    });
    installWidget();
    const { result } = renderHook(() => useOnRampSettlement());
    act(() =>
      result.current.open({
        requestId: "req-1598",
        container: container(),
        expectedToken: "USDC-BASE",
        wallet: WALLET,
      }),
    );
    act(() => postWidgetEvent("rejected"));
    expect(result.current.status).toBe("rejected");
  });
});
