/**
 * @id PP-DEP-CMP-004
 * @name StandaloneOnRampRail — tests
 *
 * Drives the rail's orchestration with the REAL `useWalletSignFlow` and stubbed rail deps + widget, so
 * the buy step actually runs and resolves from the (stubbed) widget: it pins the ONE terminal outcome
 * the rail reports to the host for each widget end state — settled, a paid-but-not-landed timeout
 * ([R5], routed to settling), and a non-completing close ([R12] terminal-before-completed => failure).
 *
 * ## The double charge these tests exist for
 *
 * The stub deliberately expands the WHOLE plan (an earlier version stubbed it down to the buy step,
 * which is exactly why a post-settlement swap failure was invisible). Two regressions are locked here,
 * both of which end in one intended deposit being charged twice:
 *
 *   1. a swap-leg failure AFTER the purchase settles is reported as post-settlement, and its retry
 *      resumes the swap rather than re-entering the purchase;
 *   2. a settled purchase whose swap never landed is RESUMED on a fresh mount (the tab-death path,
 *      which no click can reach), and mints no second `requestId`.
 *
 * `useProvisioningRail` is stubbed, but its `openJournal` delegates to the real `createJournal` +
 * `planJournalLegs`, which is what the hook itself does: the guarantee under test is that the record
 * this rail writes is the record a later mount can resume from, and a `vi.fn()` there would prove
 * nothing about it.
 */
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { findStandaloneSwapResume } from "../lib/standaloneOnRampPlan";

const WALLET = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const BASE_CHAIN_ID = 8453;

/** The settled purchase: 0.0343 ETH on Base, worth ~$103 (the $100 deposit plus its gas share). */
const ETH_DELTA = {
  chainId: BASE_CHAIN_ID,
  symbol: "ETH",
  decimals: 18,
  address: "0x0000000000000000000000000000000000000000",
  amount: 0.0343,
  usd: 103,
  amountExact: "0.0343",
};

const rail = vi.hoisted(() => ({
  mint: vi.fn(async (_order: unknown, _options?: unknown) => ({
    requestId: "req-1",
    wallet: "0xabc",
  })),
  /** Set per test to make the ETH->USDC leg fail; resolves by default. */
  swap: vi.fn(async () => ({ txHash: "0xswap" })),
  openJournal: vi.fn(),
  adoptJournal: vi.fn(),
  closeJournal: vi.fn(),
  buildSteps: vi.fn(
    (
      plan: ProvisioningPlan,
      reporters: { runOnRampBuy: (a: unknown) => Promise<void> },
    ): { key: string; run: () => Promise<unknown> }[] =>
      plan.steps
        .filter((step: ProvisioningStep) => step.type !== "op")
        .map((step: ProvisioningStep) => ({
          key: step.key,
          run: async () => {
            if (step.type === "buy") {
              await reporters.runOnRampBuy({
                order: step.order,
                expectedToken: step.toToken === "ETH" ? "ETH-BASE" : "USDC-BASE",
              });
              return {};
            }
            return rail.swap();
          },
        })),
  ),
}));

vi.mock("../../strategies/hooks/useProvisioningRail", async () => {
  const journal = await import("../../strategies/lib/fundingJournal");
  const steps = await import("../../strategies/lib/buildPlanSteps");
  return {
    useProvisioningRail: () => ({
      buildSteps: rail.buildSteps,
      mintOnRampRequest: rail.mint,
      // The hook's own three lines, so the record written here is the record a remount resumes from.
      openJournal: (plan: ProvisioningPlan) => {
        rail.openJournal(plan);
        journal.createJournal({
          wallet: WALLET,
          operation: { kind: "deposit", targetChainId: BASE_CHAIN_ID },
          legs: steps.planJournalLegs(plan),
        });
      },
      adoptJournal: rail.adoptJournal,
      closeJournal: rail.closeJournal,
    }),
  };
});

// Below PAYBIS_GAS_FLOOR_ETH (0.001) and priced, so [R1] buys ETH first and the plan carries the
// ETH->USDC conversion leg this suite is about.
vi.mock("@/lib/balances/useTokenBalances", () => ({
  useTokenBalances: () => ({
    balances: [
      {
        symbol: "ETH",
        name: "Ethereum",
        amount: 0.0001,
        amountExact: "0.0001",
        decimals: 18,
        usd: 0.3,
        chainId: BASE_CHAIN_ID,
        logoUrl: "",
        isNative: true,
        address: "0x0000000000000000000000000000000000000000",
      },
    ],
    isLoading: false,
    totalUsd: 0.3,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: WALLET, isLoading: false }),
}));

// A widget stub: the real embed + settlement is exercised by useOnRampSettlement's own suite; here the
// buttons stand in for its terminal callbacks so the rail's routing is deterministic.
vi.mock("../../strategies/components/provisioning/PaybisWidgetFrame", () => ({
  PaybisWidgetFrame: ({
    onSettled,
    onTerminal,
  }: {
    onSettled?: (deltas: unknown[]) => void;
    onTerminal?: (status: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSettled?.([ETH_DELTA])}>
        stub-settle
      </button>
      <button type="button" onClick={() => onTerminal?.("closed")}>
        stub-close
      </button>
      <button type="button" onClick={() => onTerminal?.("timed-out")}>
        stub-timeout
      </button>
    </div>
  ),
  PaybisWidgetFrameView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import type { StandaloneOnRampFailure } from "./StandaloneOnRampRail";
import { StandaloneOnRampRail } from "./StandaloneOnRampRail";

type RailProps = ComponentProps<typeof StandaloneOnRampRail>;

function renderRail(handlers: Partial<RailProps>) {
  return renderWithProviders(
    <StandaloneOnRampRail
      receiveUsd={100}
      {...(handlers.paymentMethod === undefined ? {} : { paymentMethod: handlers.paymentMethod })}
      {...(handlers.currencyCodeFrom === undefined
        ? {}
        : { currencyCodeFrom: handlers.currencyCodeFrom })}
      {...(handlers.confirmResume === undefined ? {} : { confirmResume: handlers.confirmResume })}
      onSettled={handlers.onSettled ?? vi.fn()}
      onSettling={handlers.onSettling ?? vi.fn()}
      onFailed={handlers.onFailed ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  rail.mint.mockClear();
  rail.openJournal.mockClear();
  rail.adoptJournal.mockClear();
  rail.closeJournal.mockClear();
  rail.buildSteps.mockClear();
  rail.swap.mockClear();
  rail.swap.mockImplementation(async () => ({ txHash: "0xswap" }));
});

afterEach(() => {
  window.localStorage.clear();
});

describe("StandaloneOnRampRail", () => {
  // @rule R7/R8: the buy runs through the bound rail's mint (which resumes before minting) and opens
  // the widget; a settled delta is the confirmed settlement the host reports as success.
  it("reports onSettled once the purchase settles from the widget", async () => {
    const onSettled = vi.fn();
    renderRail({ onSettled });
    fireEvent.click(await screen.findByRole("button", { name: "stub-settle" }));
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(rail.mint).toHaveBeenCalledTimes(1);
    // @rule R4: the receipt figures are the OBSERVED delta, never the pre-purchase estimate.
    const settlement = onSettled.mock.calls[0]?.[0] as { settledUsd: number; receivedUsdc: number };
    expect(settlement.settledUsd).toBe(103);
    // The funding share of the delivered value; the gas share stays native so the conversion can run.
    expect(settlement.receivedUsdc).toBeGreaterThan(99);
    expect(settlement.receivedUsdc).toBeLessThan(103);
    // Nothing is in flight any more, so the recovery record must not survive the success.
    expect(rail.closeJournal).toHaveBeenCalled();
  });

  /**
   * @rule POO-1513 S2 — the boundary the buyer's choice used to die at.
   *
   * `StandaloneOnRampRailProps` had four members and none was a payment method, so the mint re-derived
   * one with `pickDefaultPaymentMethod` and every `/deposit` purchase opened on a card no matter what
   * the picker was told. The choice has to reach `mintOnRampRequest`, because that is what puts it on
   * both the quote and `createOnRampRequestAction` (POO-1578 S3).
   */
  it("[POO-1513 S2] passes the buyer's chosen method to the mint", async () => {
    renderRail({ paymentMethod: "poolparty-sepa", onSettled: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "stub-settle" }));
    await waitFor(() => expect(rail.mint).toHaveBeenCalledTimes(1));
    expect(rail.mint.mock.calls[0]?.[1]).toEqual({ paymentMethod: "poolparty-sepa" });
  });

  // Omitted, the mint's own `pickDefaultPaymentMethod` fallback still applies (POO-1578 S4), which is
  // what keeps every caller without a picker working. It must not be sent an `undefined` either.
  it("[POO-1513 S2] sends no method when the buyer expressed no preference", async () => {
    renderRail({ onSettled: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "stub-settle" }));
    await waitFor(() => expect(rail.mint).toHaveBeenCalledTimes(1));
    expect(rail.mint.mock.calls[0]?.[1]).toEqual({});
  });

  /**
   * @rule POO-1630 — the SAME boundary swallowed the currency, and adding a currency control made it
   * reachable.
   *
   * With no `currencyCodeFrom` prop the mint re-resolves the currency from scratch
   * (`useProvisioningRail`: `currencyOverride = receivedFixed ? settledCurrencyCodeFrom :
   * order.fiatCurrency`, both undefined from here). A buyer who moved to BRL to reach Pix therefore
   * got a mint that resolved USD, found no `directa24_pix`, and fell back to a CARD in USD: they
   * approved one currency and one method and the checkout opened another of each.
   *
   * It travels with the method rather than instead of it, because the pair is what the review priced.
   */
  it("[POO-1630] passes the review's currency to the mint, beside the method", async () => {
    renderRail({
      paymentMethod: "directa24_pix",
      currencyCodeFrom: "BRL",
      onSettled: vi.fn(),
    });
    fireEvent.click(await screen.findByRole("button", { name: "stub-settle" }));
    await waitFor(() => expect(rail.mint).toHaveBeenCalledTimes(1));
    expect(rail.mint.mock.calls[0]?.[1]).toEqual({
      paymentMethod: "directa24_pix",
      currencyCodeFrom: "BRL",
    });
  });

  // A host with no currency control (or one whose set was unreadable) sends nothing, and the mint's
  // own resolution still applies. As above, absent must not become an explicit `undefined`.
  //
  // This assertion doubles as POO-1642's absence guard: `toEqual` is exact, so a `confirmResume`
  // added unconditionally to the options object would red this test and the two above it.
  it("[POO-1630] sends no currency when the host has none to give", async () => {
    renderRail({ paymentMethod: "poolparty-sepa", onSettled: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "stub-settle" }));
    await waitFor(() => expect(rail.mint).toHaveBeenCalledTimes(1));
    expect(rail.mint.mock.calls[0]?.[1]).toEqual({ paymentMethod: "poolparty-sepa" });
  });

  /**
   * @rule POO-1642 [R1] — the THIRD thing this boundary swallowed, and the expensive one.
   *
   * POO-1384 built `confirmResume` so an in-flight purchase intent that has aged out with no
   * observed payment asks the BUYER instead of deciding silently. `ProvisioningPanel` passes it;
   * this rail did not, and `useProvisioningRail`'s own comment states the consequence: "absent a
   * `confirmResume` ... this falls through to minting, which is exactly the pre-POO-1384 behavior."
   * That fall-through is a second Paybis intent minted beside a purchase whose funds may still be
   * landing, i.e. the card charged twice for one deposit.
   *
   * It travels in the SAME options object as the method and the currency, by the same conditional
   * spread, because all three are one answer to one question: what did the buyer actually agree to.
   */
  it("[POO-1642 R1] passes the host's resume question to the mint, beside the method and currency", async () => {
    const confirmResume = vi.fn(async () => "new" as const);
    renderRail({
      paymentMethod: "directa24_pix",
      currencyCodeFrom: "BRL",
      confirmResume,
      onSettled: vi.fn(),
    });
    fireEvent.click(await screen.findByRole("button", { name: "stub-settle" }));
    await waitFor(() => expect(rail.mint).toHaveBeenCalledTimes(1));
    expect(rail.mint.mock.calls[0]?.[1]).toEqual({
      paymentMethod: "directa24_pix",
      currencyCodeFrom: "BRL",
      confirmResume,
    });
  });

  /**
   * @rule POO-1642 [R1] — the question is the HOST's, not the rail's, so it must not be re-derived
   * here from a value that moves.
   *
   * Read through a ref for the same reason `paymentMethodRef` and `currencyCodeFromRef` are: putting
   * it in `runOnRampBuy`'s deps would rebuild `flowSteps` and re-expand a plan that is already
   * running. A host that re-creates the callback on every render (the ordinary case, since it closes
   * over the prompt's own state) would otherwise reset a flow that runs for minutes.
   */
  it("[POO-1642 R1] does not rebuild the running plan when the host's question changes identity", async () => {
    const { rerender } = renderRail({ confirmResume: vi.fn(async () => "new" as const) });
    await screen.findByRole("button", { name: "stub-settle" });
    const buildsBefore = rail.buildSteps.mock.calls.length;
    rerender(
      <StandaloneOnRampRail
        receiveUsd={100}
        confirmResume={vi.fn(async () => "new" as const)}
        onSettled={vi.fn()}
        onSettling={vi.fn()}
        onFailed={vi.fn()}
      />,
    );
    expect(rail.buildSteps.mock.calls.length).toBe(buildsBefore);
  });

  // @rule R5: a reconcile timeout is paid-but-not-landed, routed to the settling screen, never a failure.
  it("routes a timed-out settlement to onSettling", async () => {
    const onSettling = vi.fn();
    const onFailed = vi.fn();
    renderRail({ onSettling, onFailed });
    fireEvent.click(await screen.findByRole("button", { name: "stub-timeout" }));
    await waitFor(() => expect(onSettling).toHaveBeenCalledTimes(1));
    expect(onFailed).not.toHaveBeenCalled();
  });

  // @rule R12: a non-completing close (terminal before `completed`) is a failure — nothing moved, so
  // the host may safely re-enter the purchase.
  it("reports a PRE-settlement failure when the widget closes without completing", async () => {
    const onFailed = vi.fn();
    const onSettled = vi.fn();
    renderRail({ onFailed, onSettled });
    fireEvent.click(await screen.findByRole("button", { name: "stub-close" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    expect(onSettled).not.toHaveBeenCalled();
    const failure = onFailed.mock.calls[0]?.[0] as StandaloneOnRampFailure;
    expect(failure.error.code).toBe("ONRAMP_CLOSED");
    expect(failure.settled).toBe(false);
    // Nothing settled, so nothing owes a conversion and no recovery record is written.
    expect(rail.openJournal).not.toHaveBeenCalled();
  });

  // The blocking defect: the card was charged, the ETH landed, and the conversion leg then failed on
  // one of the most ordinary actions there are (a rejected signature, a failed chain switch, a failed
  // quote). Reported as POST-settlement, and its retry RESUMES the swap: it must never re-run the buy,
  // because a second buy is a second card charge and leaves the first purchase's ETH stranded.
  it("reports a POST-settlement swap failure and retries only the swap, minting nothing new", async () => {
    const onFailed = vi.fn();
    rail.swap.mockRejectedValueOnce(new Error("user rejected the signature"));
    renderRail({ onFailed });

    fireEvent.click(await screen.findByRole("button", { name: "stub-settle" }));
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));

    const failure = onFailed.mock.calls[0]?.[0] as StandaloneOnRampFailure;
    expect(failure.settled).toBe(true);
    expect(rail.mint).toHaveBeenCalledTimes(1);
    expect(rail.swap).toHaveBeenCalledTimes(1);

    failure.retry();

    // Only the failed step re-runs: the purchase is untouched and no second requestId is minted.
    await waitFor(() => expect(rail.swap).toHaveBeenCalledTimes(2));
    expect(rail.mint).toHaveBeenCalledTimes(1);
  });

  // The door Try again does not close: a tab killed between the settled buy and the completed swap
  // leaves no in-flight rail at all. A later mount must find the journaled conversion and finish it,
  // never mint a fresh purchase (the balance now clears the gas floor, so a re-derived plan would buy
  // USDC direct and leave the first purchase's ETH behind).
  it("resumes a settled-but-unconverted purchase on a fresh mount without minting again", async () => {
    rail.swap.mockRejectedValueOnce(new Error("tab died mid-signature"));
    const first = renderRail({ onFailed: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "stub-settle" }));
    await waitFor(() => expect(rail.swap).toHaveBeenCalledTimes(1));

    // The conversion is durably recorded, with a real amount to convert.
    const resume = findStandaloneSwapResume(WALLET);
    expect(resume).not.toBeNull();
    expect(resume?.plan.steps[0]?.leg?.amountIn).toMatch(/^[1-9]\d*$/);

    first.unmount();
    rail.mint.mockClear();
    rail.swap.mockClear();
    rail.buildSteps.mockClear();

    const onSettled = vi.fn();
    renderRail({ onSettled });
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));

    // No second purchase, and the run consisted of the conversion alone.
    expect(rail.mint).not.toHaveBeenCalled();
    expect(rail.swap).toHaveBeenCalledTimes(1);
    const resumedPlan = rail.buildSteps.mock.calls[0]?.[0] as ProvisioningPlan;
    expect(resumedPlan.steps.map((step) => step.key)).toEqual(["buy-swap"]);
    // It writes to the record the earlier session opened rather than opening a second one.
    expect(rail.adoptJournal).toHaveBeenCalledWith(resume?.journalId);
    // Nothing was observed in this run, so the host is told there is no delta to put on a receipt.
    expect(onSettled).toHaveBeenCalledWith(null);
  });
});
