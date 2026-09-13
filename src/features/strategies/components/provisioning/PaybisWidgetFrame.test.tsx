/**
 * @id PP-CORE-CMP-066 (POO-1134, POO-1136)
 * @name PaybisWidgetFrame — tests
 * @implements-rules-version v4 (POO-1136 / POO-1129 rules v3) · v2 (POO-1129 rules v2)
 *
 * The component's own wiring: it opens the embedded widget once the async SDK has loaded, surfaces
 * the lifecycle caption, reports settlement / terminal to the host once, and degrades to an
 * unavailable state when the SDK never loads. The settlement mechanics themselves are proven against
 * the hook (`useOnRampSettlement.test.tsx`); here the hook is mocked to drive states.
 *
 * POO-1136 adds the terminal-completeness suite: the host awaits a promise only this frame settles, so
 * a state this component reaches and never reports is a permanent hang behind a locked modal.
 */
import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnRampSettlementStatus } from "@/lib/onramp/useOnRampSettlement";
import { renderWithProviders, screen } from "../../../../../tests/utils/renderWithProviders";
import { PaybisWidgetFrame, SDK_READY_MAX_WAIT_MS } from "./PaybisWidgetFrame";

const hook = vi.hoisted(() => ({
  status: "idle" as OnRampSettlementStatus,
  deltaByToken: [] as unknown[],
  open: vi.fn(),
  reset: vi.fn(),
  // POO-1371: a trustworthy balance baseline. Default true so existing cases exercise the happy path.
  isBaselineReady: true,
}));

// POO-1135: the frame is gated OFF in mock mode. The default test env IS mock mode, so the real-behaviour
// suites below force real mode; the dedicated suite flips it back on. A getter so a per-test toggle is
// seen live by the frame's render-time read.
const svc = vi.hoisted(() => ({ isMockMode: false }));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return svc.isMockMode;
  },
}));

vi.mock("@/lib/onramp/useOnRampSettlement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/onramp/useOnRampSettlement")>();
  return {
    ...actual,
    useOnRampSettlement: () => ({
      status: hook.status,
      deltaByToken: hook.deltaByToken,
      open: hook.open,
      reset: hook.reset,
      isBaselineReady: hook.isBaselineReady,
    }),
  };
});

function installWidget() {
  window.PartnerExchangeWidget = { openInEmbed: vi.fn(), open: vi.fn(), isLoaded: true };
}

beforeEach(() => {
  hook.status = "idle";
  hook.deltaByToken = [];
  hook.open.mockReset();
  hook.reset.mockReset();
  hook.isBaselineReady = true;
  svc.isMockMode = false;
  window.PartnerExchangeWidget = undefined;
});
afterEach(() => {
  vi.useRealTimers();
  window.PartnerExchangeWidget = undefined;
});

describe("the escape hatch (POO-1377)", () => {
  // @rule POO-1377: a third-party iframe we do not control must NEVER be the only thing that can
  // release our own modal. A dropped terminal event sealed the user inside the frame, with the
  // "opening" caption under a FINISHED Paybis receipt and no way to click out of the app.
  it("offers an exit that reports the same terminal the widget's own Close emits", async () => {
    vi.useFakeTimers();
    installWidget();
    const onTerminal = vi.fn();
    const { getByRole } = renderWithProviders(
      <PaybisWidgetFrame
        requestId="req-exit"
        expectedToken="USDC-BASE"
        wallet="0xWALLET"
        onTerminal={onTerminal}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    await act(async () => {
      getByRole("button", { name: /Close checkout/i }).click();
    });

    expect(onTerminal).toHaveBeenCalledWith("closed");
  });

  // @rule POO-1377: reported exactly once. A second report would resolve a promise the host has
  // already settled.
  it("does not report twice when the widget also terminates", async () => {
    vi.useFakeTimers();
    installWidget();
    const onTerminal = vi.fn();
    const { getByRole } = renderWithProviders(
      <PaybisWidgetFrame
        requestId="req-once"
        expectedToken="USDC-BASE"
        wallet="0xWALLET"
        onTerminal={onTerminal}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    const button = getByRole("button", { name: /Close checkout/i });
    await act(async () => {
      button.click();
      button.click();
    });

    expect(onTerminal).toHaveBeenCalledTimes(1);
  });
});

describe("opening", () => {
  // @rule POO-1372: the SDK sizes its OWN iframe to `height: 100%`. A percentage height resolves
  // against the containing block's HEIGHT, and `min-height` does not establish one, so under
  // `min-h-` alone the iframe collapsed to the browser default 150px inside a full-size box.
  // `relative` is required too: `openInEmbed` appends its preloader with `position: absolute`.
  it("gives the widget container a definite height and a positioning context", async () => {
    vi.useFakeTimers();
    installWidget();
    const { getByTestId } = renderWithProviders(
      <PaybisWidgetFrame requestId="req-size" expectedToken="USDC-BASE" wallet="0xWALLET" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    const cls = getByTestId("paybis-widget-container").className;
    expect(cls).toContain("relative");
    // A DEFINITE height, not merely a minimum: this is what the vendor's `height: 100%` resolves to.
    expect(cls).toMatch(/(^|\s)h-\[/);
  });

  // @rule POO-1371: THE PRODUCTION RACE. `open()` refuses without a trustworthy balance baseline
  // ([R4]: a still-loading snapshot is a false zero and the delta would claim the whole wallet), but
  // that condition is TRANSIENT and the frame called `open()` the instant the SDK was ready, while
  // `useTokenBalances` was still in flight. The result was a TERMINAL ONRAMP_ERROR.
  it("waits instead of opening while the balance baseline is not ready", async () => {
    vi.useFakeTimers();
    hook.isBaselineReady = false;
    installWidget();

    renderWithProviders(
      <PaybisWidgetFrame requestId="req-wait" expectedToken="USDC-BASE" wallet="0xWALLET" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // Not opened, and crucially not FAILED either: still waiting.
    expect(hook.open).not.toHaveBeenCalled();
  });

  // @rule POO-1369: THE PRODUCTION REGRESSION. On v1.2.1 every purchase reported
  // ONRAMP_UNAVAILABLE with `window.PartnerExchangeWidget` present and `isLoaded === false`, because
  // the frame gated `open()` on a flag the SDK only sets once it has been DRIVEN. Waiting for it
  // could never end. Readiness is now `openInEmbed` being callable.
  //
  // Note the old suite could not have caught this: `installWidget` sets `isLoaded: true`, so it
  // passes with either gate. This case is the one that distinguishes them.
  it("opens even when isLoaded is false, because isLoaded is not a readiness signal", async () => {
    vi.useFakeTimers();
    window.PartnerExchangeWidget = { openInEmbed: vi.fn(), open: vi.fn(), isLoaded: false };

    renderWithProviders(
      <PaybisWidgetFrame requestId="req-unloaded" expectedToken="USDC-BASE" wallet="0xWALLET" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(hook.open).toHaveBeenCalledTimes(1);
    expect(hook.open.mock.calls[0]?.[0]?.requestId).toBe("req-unloaded");
  });

  // @rule POO-1369: the stub Paybis' bootstrap installs implements ONLY `open` (popup). It is not
  // able to serve embed mode, so it must NOT be mistaken for the loaded SDK.
  it("does not open against the bootstrap stub, which has no openInEmbed", async () => {
    vi.useFakeTimers();
    window.PartnerExchangeWidget = { open: vi.fn() } as never;

    renderWithProviders(
      <PaybisWidgetFrame requestId="req-stub" expectedToken="USDC-BASE" wallet="0xWALLET" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(hook.open).not.toHaveBeenCalled();
  });

  it("opens the embedded widget once the SDK is loaded, with the requestId and wallet", async () => {
    vi.useFakeTimers();
    installWidget();
    renderWithProviders(
      <PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" wallet="0xWALLET" />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(hook.open).toHaveBeenCalledTimes(1);
    const call = hook.open.mock.calls[0]?.[0];
    expect(call?.requestId).toBe("req-1");
    expect(call?.wallet).toBe("0xWALLET");
    expect(call?.container).toBeInstanceOf(HTMLElement);
    // [R4] the order's currency code rides through, so the detector scopes to the purchased token.
    expect(call?.expectedToken).toBe("USDC-BASE");
  });

  it("shows the unavailable state when the SDK never loads", async () => {
    vi.useFakeTimers();
    // no installWidget()
    renderWithProviders(<PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SDK_READY_MAX_WAIT_MS + 200);
    });
    expect(hook.open).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't load the secure checkout/i)).toBeInTheDocument();
  });
});

describe("lifecycle chrome", () => {
  /**
   * POO-1927 [R5]: this attribution is CORRECT and the assertion on it is load-bearing.
   *
   * That issue made the plan card's vendor credit rail-derived, because it named Paybis on charges
   * Privy brokers through Stripe or MoonPay. This frame is a different case: it IS the Paybis rail,
   * so naming Paybis inside it is honest and stays while the rail exists (POO-1819 keeps it as the
   * 72-hour rollback target; POO-1809 removes it with the modules). A blanket find-and-replace over
   * the `poweredByPaybis` key is what [R5] forbids, and this line is what fails when one is tried.
   */
  it("renders the container and the Paybis attribution", () => {
    installWidget();
    hook.status = "open";
    renderWithProviders(<PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" />);
    expect(screen.getByTestId("paybis-widget-container")).toBeInTheDocument();
    expect(screen.getByText("Powered by Paybis")).toBeInTheDocument();
    expect(screen.getByText(/complete your purchase/i)).toBeInTheDocument();
  });

  it("shows the confirmed caption when settled", () => {
    installWidget();
    hook.status = "settled";
    renderWithProviders(<PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" />);
    expect(screen.getByText("Purchase confirmed.")).toBeInTheDocument();
  });
});

describe("host callbacks", () => {
  it("reports the delta once on settlement", async () => {
    installWidget();
    hook.status = "idle";
    const onSettled = vi.fn();
    const { rerender } = renderWithProviders(
      <PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" onSettled={onSettled} />,
    );
    hook.status = "settled";
    hook.deltaByToken = [{ symbol: "USDC", amount: 100 }];
    rerender(
      <PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" onSettled={onSettled} />,
    );
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(onSettled).toHaveBeenCalledWith([{ symbol: "USDC", amount: 100 }]);
  });

  it("reports a terminal status once", async () => {
    installWidget();
    hook.status = "idle";
    const onTerminal = vi.fn();
    const { rerender } = renderWithProviders(
      <PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" onTerminal={onTerminal} />,
    );
    hook.status = "rejected";
    rerender(
      <PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" onTerminal={onTerminal} />,
    );
    await waitFor(() => expect(onTerminal).toHaveBeenCalledWith("rejected", undefined));
    expect(onTerminal).toHaveBeenCalledTimes(1);
  });

  /**
   * POO-1136 — every dead end reports, or the host hangs.
   *
   * The host (`ProvisioningPanel`) awaits a promise only this frame can settle. A state that reported
   * neither settlement nor terminal left the buy step pending forever inside a dismissal-locked modal,
   * with a caption offering a restart the UI could not deliver. These are the two that did it.
   */
  describe("the states that used to hang the host (POO-1136)", () => {
    // `closed` is the most common abandonment action: the user shuts the checkout without paying.
    // Safe to treat as terminal because the hook only ever REACHES `closed` before `completed`
    // ([R12], pinned in `useOnRampSettlement.test.tsx`), so it never describes a paid purchase.
    it("forwards a pre-completed close as terminal", async () => {
      installWidget();
      hook.status = "idle";
      const onTerminal = vi.fn();
      const { rerender } = renderWithProviders(
        <PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" onTerminal={onTerminal} />,
      );
      hook.status = "closed";
      rerender(
        <PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" onTerminal={onTerminal} />,
      );

      await waitFor(() => expect(onTerminal).toHaveBeenCalledWith("closed", undefined));
      expect(onTerminal).toHaveBeenCalledTimes(1);
    });

    // The SDK ceiling. `open()` was never called, so the HOOK sits at `idle` and cannot report this:
    // only the frame knows it has given up, and only the frame can release the host.
    it("forwards the SDK-unavailable verdict as terminal", async () => {
      vi.useFakeTimers();
      // no installWidget(): the SDK never attaches.
      const onTerminal = vi.fn();
      renderWithProviders(
        <PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" onTerminal={onTerminal} />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SDK_READY_MAX_WAIT_MS + 200);
      });

      expect(hook.open).not.toHaveBeenCalled();
      expect(onTerminal).toHaveBeenCalledTimes(1);
      expect(onTerminal).toHaveBeenCalledWith("unavailable");
    });

    // A settlement still wins: the terminal report is one-shot and must never fire after it.
    it("never reports terminal once the purchase has settled", async () => {
      installWidget();
      hook.status = "idle";
      const onSettled = vi.fn();
      const onTerminal = vi.fn();
      const props = {
        requestId: "req-1",
        expectedToken: "USDC-BASE" as const,
        onSettled,
        onTerminal,
      };
      const { rerender } = renderWithProviders(<PaybisWidgetFrame {...props} />);
      hook.status = "settled";
      rerender(<PaybisWidgetFrame {...props} />);
      await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));

      hook.status = "closed";
      rerender(<PaybisWidgetFrame {...props} />);

      expect(onTerminal).not.toHaveBeenCalled();
    });
  });
});

describe("mock mode (POO-1135)", () => {
  it("never opens the widget and shows a documented placeholder", async () => {
    svc.isMockMode = true;
    installWidget();
    renderWithProviders(<PaybisWidgetFrame requestId="req-1" expectedToken="USDC-BASE" />);

    // There is no real SDK or holdings rail in mock mode, so the frame must not attempt to embed: a
    // real open would only ever reach `timed-out` and make the visual harness look broken.
    expect(hook.open).not.toHaveBeenCalled();
    expect(screen.getByText("Buy crypto is not available in mock mode.")).toBeInTheDocument();
    // The attribution and container still render, so the placeholder reads as this component.
    expect(screen.getByText("Powered by Paybis")).toBeInTheDocument();
  });
});
