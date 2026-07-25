/**
 * @id PP-STR-MOD-001
 * @name InvestModal — tests
 * Behavior: below-minimum disables Invest with a hint; a short balance flips the CTA to
 * "Deposit & invest" with a shortfall; a funded amount runs the POO-598 handshake
 * amount → building (approve → Permit2 → build) → Review → pending → success, driven by the
 * wallet-sign runner (real per-step progression; "Try again" resumes the failed step).
 *
 * POO-598: "Invest" no longer lands on a synchronous confirm — it kicks off approve → Permit2 → build
 * in a `building` phase (each a ~350ms mock beat), then the flow PAUSES (pauseAfterKey "build") and
 * the modal advances to the Review with the BUILT figures. So every test that clicks "Invest" and then
 * asserts Review content AWAITS the Review first (via the shared `reachReview` helper). The Review CTA
 * ("Confirm investment") RESUMES the paused flow into the send; `strategy_invest_submitted` fires once,
 * from the "Invest" CTA (before the signatures), not from the Review. A pre-send failure (approve /
 * permit rejection, or a failed build) surfaces the error view during `building`, before any Review.
 *
 * Uses fireEvent (not userEvent) for the multi-step dialog flow; the runner is async so the Review /
 * pending phases are awaited via findBy rather than fake-timer advancement (except the countdown test).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import { TransactionError } from "@/lib/tx/sendTransaction";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import type { InvestCtx } from "../hooks/useInvest";
import type { FlowStep } from "../hooks/useWalletSignFlow";
import { InvestModal } from "./InvestModal";
import { settleDeployedUsd, settleOutcome, settleSwapInfo, settleTxError } from "./settle";

vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: vi.fn(async () => {}),
}));

vi.mock("./settle", async (importActual) => {
  const actual = await importActual<typeof import("./settle")>();
  const settleOutcome = vi.fn(() => "success");
  return {
    settleOutcome,
    // POO-499 R6: the modal's mock confirm reads slippage through this. Delegates to settleOutcome
    // for slippage > 0.1% (so the existing `settleOutcome.mockReturnValueOnce("error")` still forces a
    // failure) and forces "error" at/below 0.1% (the deterministic slippage-failure demo trigger).
    settleOutcomeForSlippage: vi.fn((slippagePct: number) =>
      slippagePct <= 0.1 ? "error" : settleOutcome(),
    ),
    settleTxError: vi.fn(() => ({ code: "-32603", message: "execution reverted: mock" })),
    settleTxHash: vi.fn(() => "0xMOCK00000000000000000000000000000000MOCK"),
    // POO-383 R9: full deploy by default; a test overrides it once to force the partial banner.
    settleDeployedUsd: vi.fn((requested: number) => requested),
    // POO-606 (mirrors POO-611/POO-612 in WithdrawModal.test): the mock build attaches a real-shaped
    // swapInfo to `built`, so the mock-mode Review's "You will invest at least" reads its
    // minAmountInStable. Delegates to the REAL settleSwapInfo (deterministic, seeded by amount, no
    // Math.random) so the mock min stays coherent per amount + slippage across the different-amount
    // tests here (a fixed stub would show the same min on a $100 and a $200 invest).
    // POO-1011: wrapped so the gate test can force a catastrophic figure for one build.
    settleSwapInfo: vi.fn(actual.settleSwapInfo),
    MOCK_BUILT_TX: actual.MOCK_BUILT_TX,
  };
});

// Stable push spy so tests can assert the navigation target (e.g. the Deposit & invest top-up URL).
const mockPush = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const strategy: Strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 50,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY",
  status: "active",
  // POO-514 R2: the receipt explorer link derives from the strategy's network.
  network: "base",
  detail: {
    lockupDays: 0,
    managerVerified: true,
    about: "x",
    composition: [],
    mandate: { assets: [], protocols: [], networks: [] },
    riskLimits: {
      maxDrawdown: [],
      leverage: "None",
      rebalancing: "Daily",
      liquidity: "Instant",
      strategyType: "Yield",
      benchmark: "—",
      custody: "Vault",
    },
    fees: { managementPct: 1, performancePct: 10 },
  },
};

/** Build the real 4-step invest sequence for a test: optionally throw at a step, carry a hash, or
 * have the `build` step (index 2) yield built figures (e.g. the real gas estimate, POO-598 R3). */
function realInvestSteps(opts: {
  hash?: string;
  throwAt?: number;
  error?: Error;
  built?: InvestCtx["built"];
  /** POO-810 R4: the decoded receipt amounts the confirm step threads into the flow context. */
  decoded?: InvestCtx["decoded"];
}): FlowStep<InvestCtx>[] {
  const keys = ["approve:USDC", "permit", "build", "confirm:invest"];
  return keys.map((key, index) => ({
    key,
    run: async () => {
      if (opts.throwAt === index) throw opts.error ?? new Error("step failed");
      // POO-598: the build step (index 2) yields the built context so the Review reads real figures.
      if (index === 2 && opts.built) return { built: opts.built };
      // POO-810 R4: the confirm step also threads the decoded USDC refund; chainId is needed so the
      // modal reads it as the real path (mirrors the executor returning both).
      if (index === keys.length - 1 && opts.hash)
        return { txHash: opts.hash, decoded: opts.decoded, chainId: 137 };
      return {};
    },
  }));
}

/** Mirrored from InvestModal.tsx so the fake-timer countdown test advances the exact window. */
const REVIEW_REFRESH_SECS = 10;

function setAmount(value: string) {
  fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value } });
}

/**
 * POO-598: enter an amount, click "Invest", and AWAIT the Review arriving. "Invest" now kicks off the
 * async `building` phase (approve → Permit2 → build, each a ~350ms mock beat) that only then pauses and
 * advances to the Review, so a test can no longer assert Review content synchronously. Awaits the
 * Review's stable "Confirm investment" CTA before returning.
 */
async function reachReview(value = "200"): Promise<void> {
  setAmount(value);
  fireEvent.click(screen.getByRole("button", { name: "Invest" }));
  await screen.findByRole("button", { name: "Confirm investment" }, { timeout: 3000 });
}

describe("InvestModal", () => {
  beforeEach(() => {
    window.dataLayer = [];
    mockPush.mockClear();
    // Reset the settle mocks to their happy-path defaults so a test forcing an outcome can't leak.
    vi.mocked(settleOutcome).mockReturnValue("success");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: mock",
    });
  });

  it("disables Invest below the minimum", () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    setAmount("30");
    expect(screen.getByText("Minimum investment is $50.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invest" })).toBeDisabled();
  });

  // @rule POO-807 R1: the visible MOCK indicator renders on the modal in mock mode (the shared
  // header/status mount it; real-mode absence is guarded in the MockBadge + host tests).
  it("[POO-807] shows the MOCK badge in mock mode", () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    expect(screen.getAllByTestId("mock-badge")).toHaveLength(1);
  });

  it("fills the amount with the full wallet balance (6dp) when the balance line is tapped", () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={38.005424} />,
    );
    // Tapping the wallet balance behaves like the Max chip: fills the exact spendable balance.
    fireEvent.click(screen.getByRole("button", { name: "Balance $38.005424" }));
    expect(screen.getByLabelText("Amount to invest")).toHaveValue("38.005424");
  });

  it("calls onInvested on success so the detail refreshes into the owned state", async () => {
    const onInvested = vi.fn();
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        onInvested={onInvested}
      />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 });
    expect(onInvested).toHaveBeenCalled();
  });

  // @rule POO-800 R4 — every swap-bearing Review carries the price impact. The row reads the BUILT
  // swapInfo (mock build attaches settleSwapInfo; real mode reads the server build), so it only
  // renders once a real figure exists — nothing is fabricated pre-build.
  it("(POO-800 R4) the Review shows the Price impact row from the built swapInfo", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    // Nothing fabricated pre-build: on the amount step (before the build attaches settleSwapInfo /
    // before the Review), the Price impact row is absent — it only appears once a real figure exists.
    expect(screen.queryByText("Price impact")).toBeNull();
    await reachReview("200");
    expect(screen.getByText("Price impact")).toBeInTheDocument();
  });

  // @rule POO-1011 R2/R3 — a catastrophic impact (>= 10%) renders the funds-at-risk alert ABOVE the
  // fold and blocks the Confirm CTA until the explicit acknowledgment is checked. The incident
  // figure (92.41%) is the regression anchor: it used to render as one amber row behind Show more.
  it("(POO-1011 R2) a catastrophic price impact blocks Confirm until the risk is acknowledged", async () => {
    vi.mocked(settleSwapInfo).mockReturnValueOnce({
      priceImpactPercentage: 92.41,
      protocolFee: 0.49,
      minAmountInStable: 15,
    });
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    const cta = screen.getByRole("button", { name: "Confirm investment" });
    expect(cta).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toContain("92.41%");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cta).toBeEnabled();
  });

  // POO-819 R4 — the Review "Lock-up" row reads the TOP-LEVEL `lockupDays` the real v2 mapper carries
  // (never fabricates `detail`), so a real locked strategy shows the term instead of always "None". The
  // detail copy is only the mock-parity fallback. @rule R4
  it("[R4] Review shows the real top-level lock-up term (no detail) instead of 'None'", async () => {
    const { detail: _detail, ...bare } = strategy;
    const realStrategy: Strategy = { ...bare, lockupDays: 30 };
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={realStrategy} balance={500} />,
    );
    await reachReview("200");
    expect(screen.getByText("30 days")).toBeInTheDocument();
  });

  // POO-819 R4 — the top-level value wins over a stale detail copy; 0 renders "None". @rule R4
  it("[R4] top-level lockupDays 0 takes precedence over a stale detail value", async () => {
    if (!strategy.detail) throw new Error("fixture detail missing");
    const stale: Strategy = {
      ...strategy,
      lockupDays: 0,
      detail: { ...strategy.detail, lockupDays: 7 },
    };
    renderWithProviders(<InvestModal open onOpenChange={vi.fn()} strategy={stale} balance={500} />);
    await reachReview("200");
    // The top-level 0 wins → the lock-up row reads "None"; the stale "7 days" is never rendered.
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.queryByText("7 days")).toBeNull();
  });

  // @rule POO-598 R3 — the Review keeps a Back button returning to the amount step (re-invest re-signs).
  it("(POO-598 R3) goes back from the Review to the amount step", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    expect(screen.getByText("Review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    // Back at the amount step with the entered amount preserved, and the Invest CTA shown again.
    expect(screen.getByLabelText("Amount to invest")).toHaveValue("200");
    expect(screen.getByRole("button", { name: "Invest" })).toBeInTheDocument();
  });

  it("flips to Deposit & invest when the balance is short", () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    setAmount("600");
    expect(screen.getByText("You need $100.00 more")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deposit & invest" })).toBeEnabled();
  });

  it("routes Deposit & invest to /deposit carrying both the shortfall and the chosen amount (POO-281 R2/R3)", () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    setAmount("600");
    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));
    // Shortfall (600 - 500 = 100) prefills the deposit; the chosen amount (600) rides back via ?invest=.
    expect(mockPush).toHaveBeenCalledTimes(1);
    const target = mockPush.mock.calls[0]?.[0] as string;
    expect(target).toContain("amount=100");
    expect(target).toContain("invest=600");
    // @rule POO-520 R2: the investor flow keeps an origin-free deposit URL (current behavior).
    expect(target).not.toContain("origin=");
  });

  // @rule POO-520 R1: a manager-console invest carries its origin into the deposit deep link, so
  // the deposit resume returns to the console manage view instead of the investor detail.
  it("carries origin=manager in the Deposit & invest URL when opened from the console (POO-520 R1)", () => {
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        depositOrigin="manager"
      />,
    );
    setAmount("600");
    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));
    expect(mockPush).toHaveBeenCalledTimes(1);
    const target = mockPush.mock.calls[0]?.[0] as string;
    expect(target).toContain("amount=100");
    expect(target).toContain("invest=600");
    expect(target).toContain("origin=manager");
  });

  // @rule POO-598 R6 (was POO-281 R3): the top-up resume lands on the AMOUNT step prefilled — NOT
  // auto-building — because tapping "Invest" starts the approve/permit signatures.
  it("resumes on the amount step with the chosen amount prefilled after a top-up (POO-598 R6)", () => {
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={1000}
        resumeAmount={250}
      />,
    );
    // Lands on the amount step with the amount prefilled (6dp), Invest CTA ready — no auto-signing.
    expect(screen.getByLabelText("Amount to invest")).toHaveValue("250");
    expect(screen.getByRole("button", { name: "Invest" })).toBeInTheDocument();
    // Not on a Review / building step yet.
    expect(screen.queryByRole("button", { name: "Confirm investment" })).not.toBeInTheDocument();
  });

  // @rule POO-494 R6: the top-up round-trip resume is a distinct, tracked funnel step.
  it("tracks strategy_invest_resumed when reopened via the top-up return", () => {
    window.dataLayer = [];
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={1000}
        resumeAmount={250}
      />,
    );
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_invest_resumed", strategy_id: "s1", value: 250 }),
    );
  });

  it("runs the funded flow to success", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    setAmount("200");
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));
    // POO-598 R2: approve/permit/build run in the `building` phase (the WalletSteps stepper).
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
    // The Review appears once the build settles; it carries the "You invest" receipt.
    await screen.findByRole("button", { name: "Confirm investment" }, { timeout: 3000 });
    expect(screen.getByText("You invest")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    expect(
      (await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    for (const event of [
      "strategy_invest_started",
      "strategy_invest_submitted",
      "strategy_invest_completed",
    ]) {
      expect(window.dataLayer).toContainEqual(expect.objectContaining({ event }));
    }
    // @rule POO-598 R1 — submitted fires exactly once (from the "Invest" CTA, before the signatures).
    expect(
      (window.dataLayer ?? []).filter(
        (e) => (e as { event?: string }).event === "strategy_invest_submitted",
      ),
    ).toHaveLength(1);
    // @rule R8 — the standardized success receipt: Strategy + Date + Transaction (hash)
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText("0xMOCK…MOCK")).toBeInTheDocument();
  });

  it("shows the error state and retries (resumes) the failed step to success", async () => {
    vi.mocked(settleOutcome).mockReturnValueOnce("error");
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    // The send fails at the confirm step (build succeeded, so the Review was reached).
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Something went wrong", undefined, { timeout: 3000 });
    // POO-461 R4 — an unclassified failure keeps the generic body.
    expect(
      screen.getByText("Your transaction didn't go through and no funds were moved."),
    ).toBeInTheDocument();
    // @rule R1 — the error-details box surfaces the raw settle error + code
    expect(screen.getByText("execution reverted: mock")).toBeInTheDocument();
    expect(screen.getByText("-32603")).toBeInTheDocument();
    // @rule R4 — the box is tinted with the error tokens
    expect(document.querySelector(".bg-error-surface.border-error-border")).not.toBeNull();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_invest_failed" }),
    );
    // @rule R2 — the raw error message must NEVER reach analytics
    expect(JSON.stringify(window.dataLayer)).not.toContain("execution reverted");
    // Try again resumes the failed step; settle now succeeds → success (no full re-confirm).
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      (await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
  });

  // POO-499 R2 (regression from the original incident): a slippage failure then the ONE automatic
  // retry then success — the user never sees an error view.
  it("[POO-499 R2] auto-retries once on a slippage failure and reaches success with no error view", async () => {
    // First confirm fails as slippage; the auto-retried confirm succeeds (default mock).
    vi.mocked(settleOutcome).mockReturnValueOnce("error");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: slippage tolerance exceeded - minimum output amount not met",
    });
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    // The pending notice appears (auto-retry in flight), never the error view.
    expect(
      await screen.findByText(/Retrying at the current price/i, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Something went wrong")).toBeNull();
    // R8 — the automatic retry fired exactly one tx_slippage_retry with { flow, strategy_id }.
    const retries = (window.dataLayer ?? []).filter(
      (e) => (e as { event?: string }).event === "tx_slippage_retry",
    );
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ flow: "invest", strategy_id: "s1" });
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: mock",
    });
  });

  // POO-499 R3: two slippage failures show the slippage-specific error view AND open the settings sheet.
  it("[POO-499 R3] two slippage failures show the slippage error view and open settings", async () => {
    // Both confirm attempts fail as slippage (mock forces error whenever slippage <= 0.1%).
    vi.mocked(settleOutcome).mockReturnValue("error");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: slippage tolerance exceeded - minimum output amount not met",
    });
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    // The slippage-specific error title + body (POO-499 copy) replace the generic error view (the
    // title also appears in the sr-only DialogTitle, so match all).
    expect(
      (await screen.findAllByText("Price moved too much", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/moved beyond your max slippage.*again/i)).toBeInTheDocument();
    expect(
      screen.queryByText("Your transaction didn't go through and no funds were moved."),
    ).toBeNull();
    // The settings sheet auto-opened (its slippage section is visible).
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    // Exactly one automatic retry event (never on the manual/second failure).
    expect(
      (window.dataLayer ?? []).filter(
        (e) => (e as { event?: string }).event === "tx_slippage_retry",
      ),
    ).toHaveLength(1);
    vi.mocked(settleOutcome).mockReturnValue("success");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: mock",
    });
  });

  // POO-499 R4: a non-slippage failure goes straight to the generic error view with no auto-retry.
  it("[POO-499 R4] a non-slippage failure shows the generic view with no auto-retry", async () => {
    vi.mocked(settleOutcome).mockReturnValueOnce("error"); // default settleTxError = unknown kind
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Something went wrong", undefined, { timeout: 3000 });
    expect(
      screen.getByText("Your transaction didn't go through and no funds were moved."),
    ).toBeInTheDocument();
    // No auto-retry fired for a non-slippage failure.
    expect(
      (window.dataLayer ?? []).filter(
        (e) => (e as { event?: string }).event === "tx_slippage_retry",
      ),
    ).toHaveLength(0);
  });

  // POO-887 [R1]/[R2]: a pre-Review failure (a cancelled Permit2) retried via "Try again" re-honors
  // the Review gate - the single confirmation surface POO-598 established - instead of running
  // straight into the money-moving signature. The host enters "building" so the awaiting → review
  // mapping re-engages, and the flow re-pauses after the rebuilt tx.
  it("[POO-887 R1/R2] Try again after a permit cancel re-lands on the Review, never the send", async () => {
    let permitFailed = false;
    const confirmRun = vi.fn(async () => ({ txHash: "0xok" }));
    const steps: FlowStep<InvestCtx>[] = [
      { key: "approve:USDC", run: async () => ({}) },
      {
        key: "permit",
        run: async () => {
          if (!permitFailed) {
            permitFailed = true;
            throw new TransactionError("Permit rejected in wallet");
          }
          return {};
        },
      },
      { key: "build", run: async () => ({}) },
      { key: "confirm:invest", run: confirmRun },
    ];
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={() => steps}
      />,
    );
    setAmount("200");
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));
    // The cancelled permit surfaces the error view BEFORE any Review was shown.
    await screen.findAllByText("Something went wrong", undefined, { timeout: 3000 });
    expect(screen.queryByRole("button", { name: "Confirm investment" })).toBeNull();
    // Try again re-runs permit → build and re-honors the Review pause: the Review CTA appears...
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: "Confirm investment" }, { timeout: 3000 }),
    ).toBeInTheDocument();
    // ...and the money-moving send was NEVER dispatched by the retry.
    expect(confirmRun).not.toHaveBeenCalled();
  });

  // POO-885 [R1]/[R3]/[R4]: a FAILED background 10s re-quote never kills the flow - the Review stays
  // up with the last good quote, `strategy_invest_failed` does NOT fire (the user did nothing), and
  // after 3 consecutive failures the subtle stale-quote hint appears.
  it("[POO-885 R1/R3/R4] background re-quote failures keep the Review, no failure event, hint after 3", async () => {
    vi.useFakeTimers();
    try {
      let buildCalls = 0;
      const buildInvestSteps = vi.fn<() => FlowStep<InvestCtx>[]>(() => [
        { key: "approve:USDC", run: async () => ({ skipped: true }) },
        { key: "permit", run: async () => ({}) },
        {
          key: "build",
          run: async () => {
            buildCalls += 1;
            // The first build succeeds (the Review renders); every 10s re-quote after it fails.
            if (buildCalls > 1) throw new TransactionError("Internal server error");
            return {};
          },
        },
        { key: "confirm:invest", run: async () => ({ txHash: "0xok" }) },
      ]);
      renderWithProviders(
        <InvestModal
          open
          onOpenChange={vi.fn()}
          strategy={strategy}
          balance={500}
          buildInvestSteps={buildInvestSteps}
        />,
      );
      fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value: "200" } });
      fireEvent.click(screen.getByRole("button", { name: "Invest" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText("Review")).toBeInTheDocument();

      // Two failed background re-quotes: still on the Review, no error view, no failure analytics,
      // and no stale hint yet (the +1s overshoot lets each zero-crossing's async rebuild settle).
      await vi.advanceTimersByTimeAsync(2 * REVIEW_REFRESH_SECS * 1000 + 1000);
      expect(buildCalls).toBeGreaterThanOrEqual(3);
      expect(screen.getByText("Review")).toBeInTheDocument();
      expect(screen.queryByText("Something went wrong")).toBeNull();
      expect(screen.queryByText(/Quote may be outdated/)).toBeNull();
      // The third consecutive failure surfaces the subtle hint - still non-fatal.
      await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_SECS * 1000 + 1000);
      expect(screen.getByText(/Quote may be outdated/)).toBeInTheDocument();
      expect(screen.getByText("Review")).toBeInTheDocument();
      // [R3] the passive failures never fired the failure funnel event.
      expect(
        (window.dataLayer ?? []).filter(
          (e) => (e as { event?: string }).event === "strategy_invest_failed",
        ),
      ).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the real failure message during building instead of a silent dead-end", async () => {
    // A step that throws BEFORE any wallet send (e.g. wallet not connected on approve); this runs in
    // the `building` phase, so the error surfaces there — the Review is never reached.
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={() =>
          realInvestSteps({ throwAt: 0, error: new TransactionError("Wallet not connected") })
        }
      />,
    );
    setAmount("200");
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));
    // The actual reason is shown verbatim in the error-details box, without a Review in between.
    expect(await screen.findByText("Wallet not connected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm investment" })).not.toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_invest_failed" }),
    );
    // R2 — the raw error message must NEVER reach analytics.
    expect(JSON.stringify(window.dataLayer)).not.toContain("Wallet not connected");
  });

  it("enforces the $10 platform floor when the manager's minimum is lower", () => {
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, minInvestment: 5 }}
        balance={500}
      />,
    );
    setAmount("7");
    expect(screen.getByText("Minimum investment is $10.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invest" })).toBeDisabled();
    setAmount("10");
    expect(screen.getByRole("button", { name: "Invest" })).toBeEnabled();
  });

  // @rule POO-801 R2/R8 — the "Deployed as" row is gone; the reworded zap note alone explains the
  // conversion, carrying the pair inline.
  it("(POO-801 R2/R8) shows the reworded zap note (no Deployed-as row) for a single-pool strategy", async () => {
    const baseDetail = strategy.detail;
    if (!baseDetail) throw new Error("fixture detail missing");
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={{
          ...strategy,
          detail: { ...baseDetail, poolPair: { token0: "ETH", token1: "USDC" } },
        }}
        balance={500}
      />,
    );
    await reachReview("100");
    expect(screen.queryByText("Deployed as")).not.toBeInTheDocument();
    expect(
      screen.getByText(/automatically converted into the pool's two tokens \(ETH\/USDC\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/they convert back to USDC/)).toBeInTheDocument();
  });

  // POO-481 R3 — real-mode strategies carry the pair TOP-LEVEL only (the mapper omits `detail`),
  // so the zap note must fall back to strategy.poolPair.
  it("shows the zap note from the top-level poolPair when detail is absent (real mode)", async () => {
    const { detail: _detail, ...bareStrategy } = strategy;
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...bareStrategy, poolPair: { token0: "ETH", token1: "USDC" } } as Strategy}
        balance={500}
      />,
    );
    await reachReview("100");
    expect(screen.getByText(/pool's two tokens \(ETH\/USDC\)/)).toBeInTheDocument();
  });

  it("keeps the Review zap-free for multi-asset mandate strategies", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("100");
    expect(screen.getByText("You invest")).toBeInTheDocument();
    expect(screen.queryByText(/pool's two tokens/)).not.toBeInTheDocument();
  });

  // @rule POO-842 R5: the "You invest" hero (6dp amount + ≈USD) is an inline-flex that overflowed
  // the card at 375px with Max-filled balances (e.g. "38.005424 USDC (≈ $38.01)"). It must be
  // allowed to wrap, keeping the right alignment of the receipt value cell.
  it("[POO-842 R5] the You-invest hero wraps instead of overflowing", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("100");
    const hero = screen.getByText(/100(\.\d+)? USDC/).closest("span");
    expect(hero).toHaveClass("flex-wrap");
    expect(hero).toHaveClass("justify-end");
    expect(hero).toHaveClass("inline-flex");
  });

  // @rule POO-801 R1 — the "Pay from | USDC balance" row is gone from the Review.
  it("(POO-801 R1) the Review carries no Pay-from row", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("100");
    expect(screen.queryByText("Pay from")).not.toBeInTheDocument();
    expect(screen.queryByText("USDC balance")).not.toBeInTheDocument();
  });

  // POO-515 R1 / POO-606: the Review carries a slippage-protected minimum line ("You will deploy at
  // least"), mirroring Compound/Withdraw. POO-606: in mock mode the build now attaches the real-shaped
  // settleSwapInfo (POO-611/POO-612 precedent), so the line reads that mock server min — which still
  // tracks the gear slippage (a lower slippage → a smaller haircut → a higher minimum), recomputing
  // when the gear slippage changes.
  it("[POO-515 R1] the Review shows the slippage-protected minimum deploy line, tracking the gear slippage", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("100");
    // Default investor slippage 2% (POO-463 R2) on $100 → the mock server min settleSwapInfo(100, 2%)
    // = 97.86 USDC (net of slippage + price impact + protocol fee), deterministic per amount.
    expect(screen.getByText("You will invest at least")).toBeInTheDocument();
    expect(screen.getByText("97.86 USDC ($97.86)")).toBeInTheDocument();
    // POO-570 R1: the gear lives on the amount (input) step — go Back to reach it. Lowering the
    // slippage to 0.5% recomputes the minimum on the next Review → settleSwapInfo(100, 0.5%) = 99.36.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "0.5%" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));
    expect(
      await screen.findByText("99.36 USDC ($99.36)", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it("[real] builds steps with the entered amount + slippage and shows the on-chain hash", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );

    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();

    expect((await screen.findAllByText("Investment confirmed")).length).toBeGreaterThanOrEqual(1);
    // POO-317: the step builder receives the user's slippage (default 2, POO-463 R2), no longer dropped.
    expect(buildInvestSteps).toHaveBeenCalledWith(200, 2);
    expect(screen.getByText("0xdead…abcd")).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_invest_completed" }),
    );
  });

  // @rule POO-598 R3/R4 — the Review shows the re-quote countdown, and when it lapses without approval
  // the flow RE-QUOTES (re-runs ONLY the build step, reusing the signed approve/permit) in place.
  it("[POO-598 R4] the Review re-quotes (rebuilds) after the countdown lapses without approval", async () => {
    vi.useFakeTimers();
    try {
      // Instant (microtask-only) steps so the pre-pause chain drains in one flush, mirroring the
      // Withdraw rebuild test. Count build-step invocations: a rebuild re-runs the build (index 2).
      const buildRun = vi.fn(async () => ({}));
      const buildInvestSteps = vi.fn<() => FlowStep<InvestCtx>[]>(() => [
        { key: "approve:USDC", run: async () => ({ skipped: true }) },
        { key: "permit", run: async () => ({}) },
        { key: "build", run: buildRun },
        {
          key: "confirm:invest",
          run: async () => ({
            txHash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
          }),
        },
      ]);
      renderWithProviders(
        <InvestModal
          open
          onOpenChange={vi.fn()}
          strategy={strategy}
          balance={500}
          buildInvestSteps={buildInvestSteps}
        />,
      );

      fireEvent.change(screen.getByLabelText("Amount to invest"), { target: { value: "200" } });
      fireEvent.click(screen.getByRole("button", { name: "Invest" }));
      // Flush approve → permit → build (all instant) into the awaiting pause → Review.
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText("Review")).toBeInTheDocument();
      expect(buildRun).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(`Refreshes in ${REVIEW_REFRESH_SECS}s`, { exact: false }),
      ).toBeInTheDocument();

      // Advance the full countdown window: at 0 the Review re-quotes (flow.rebuild re-runs build).
      await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_SECS * 1000);
      // Still on the Review (the refresh happens in place, no navigation) and the build re-ran.
      expect(screen.getByText("Review")).toBeInTheDocument();
      expect(buildRun.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // @rule POO-598 R3 — in REAL mode the built tx carries a real gas estimate (estimatedGasInUsd),
  // which the Review's consolidated fee breakdown must reflect INSTEAD of the $0.30 mock default.
  it("[POO-598 R3] real mode: the built gas ($2.50) drives the Review fee network line, not the $0.30 default", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        // The server build returns the real gas estimate for the add-liquidity tx.
        built: { tx: {}, estimatedGasInUsd: 2.5 } as InvestCtx["built"],
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    // POO-801 R7: the fee detail sits behind Show more.
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    // The breakdown tooltip's accessible name carries the network line at the REAL $2.50 gas, and
    // never the $0.30 mock default.
    const tip = screen.getByRole("button", { name: /Estimated gas \(network fee\)/ });
    expect(tip).toHaveAccessibleName(/Estimated gas \(network fee\) \$2\.50/);
    expect(tip).not.toHaveAccessibleName(/Estimated gas \(network fee\) \$0\.30/);
  });

  // @rule POO-606 — the Review's "You will invest at least" uses the server's authoritative minimum
  // (swapInfo.minAmountInStable, net of slippage + protocol fee) once the build has run, not the flat
  // client gear-slippage estimate.
  it("[POO-606] real mode: the server minAmountInStable drives 'You will invest at least', not the client estimate", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        // Server min = 195.5 USD (net of slippage + protocol fee); distinct from the client 2% estimate
        // on $200 (= 196), so the assertion proves the server figure is used. The block carries all
        // three swapInfo fields: builtTxSchema parses it all-or-nothing (a partial block degrades to
        // undefined), so a min-only swapInfo is a payload the component can never receive (POO-800 R4
        // reads priceImpactPercentage off the same block).
        built: {
          tx: {},
          estimatedGasInUsd: 2.5,
          swapInfo: { minAmountInStable: 195.5, priceImpactPercentage: 0.4, protocolFee: 0.49 },
        } as InvestCtx["built"],
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    expect(screen.getByText("You will invest at least")).toBeInTheDocument();
    // The server figure (195.5), not the flat client estimate (200 × 0.98 = 196).
    expect(screen.getByText("195.5 USDC ($195.50)")).toBeInTheDocument();
    expect(screen.queryByText("196 USDC ($196.00)")).toBeNull();
  });

  // @rule POO-606 — with no swapInfo (build without a swap figure / mock), it degrades to the client
  // gear-slippage estimate (the POO-515 R1 behavior).
  it("[POO-606] falls back to the client slippage estimate when the build carries no swapInfo", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        built: { tx: {}, estimatedGasInUsd: 2.5 } as InvestCtx["built"], // no swapInfo
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    // Default investor slippage 2% on $200 → the client estimate of 196 USDC.
    expect(screen.getByText("196 USDC ($196.00)")).toBeInTheDocument();
  });

  // @rule POO-606 — in mock mode the build attaches a real-shaped settleSwapInfo (mirroring the
  // Withdraw/Remove mock, POO-611/POO-612), so the mock Review's "You will invest at least" reads the
  // mock server min, not the flat client slippage estimate. No buildInvestSteps → the mock steps run.
  it("[POO-606] mock mode: the attached settleSwapInfo min drives 'You will invest at least'", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    expect(screen.getByText("You will invest at least")).toBeInTheDocument();
    // The mock server min settleSwapInfo(200, 2%) = 195.58 (net of slippage + price impact + protocol
    // fee), NOT the flat client slippage estimate (200 × 0.98 = 196). Proves the attached mock swapInfo
    // drives the line in mock mode.
    expect(screen.getByText("195.58 USDC ($195.58)")).toBeInTheDocument();
    expect(screen.queryByText("196 USDC ($196.00)")).toBeNull();
  });

  // @rule POO-514 R1/R2 — the mock success receipt keeps the tx row (truncated settle hash) AND
  // gains the shared explorer link, targeting /tx/{hash} on the strategy's own network.
  it("[POO-514 R2] mock success receipt links the explorer /tx/ URL on the strategy network", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("100");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    expect(
      (await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText("0xMOCK…MOCK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://basescan.org/tx/0xMOCK00000000000000000000000000000000MOCK",
    );
  });

  // @rule POO-514 R3 — real mode shows the MINED hash + its explorer link; the constant mock
  // settleTxHash() must never render in real mode.
  it("[POO-514 R3] real mode links the mined hash and never the mock settle hash", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    expect((await screen.findAllByText("Investment confirmed")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("0xdead…abcd")).toBeInTheDocument();
    expect(screen.queryByText("0xMOCK…MOCK")).toBeNull();
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://basescan.org/tx/0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
    );
  });

  it("[real] shows the error state when a step rejects during building", async () => {
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={() => realInvestSteps({ throwAt: 0, error: new Error("user rejected") })}
      />,
    );

    setAmount("200");
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));
    expect((await screen.findAllByText("Something went wrong")).length).toBeGreaterThanOrEqual(1);
    // POO-461 R3 — "user rejected" classifies, so the body is the kind-specific copy.
    expect(
      screen.getByText("You declined the request in your wallet. No funds were moved."),
    ).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_invest_failed" }),
    );
  });

  // @rule POO-801 R4 (supersedes POO-383 R4) — the Review carries a Max. slippage row in the
  // collapsible detail, showing the gear value with an "Auto" badge while the default applies
  // (POO-799 decision #7). The gear (on the amount step) still owns editing it.
  it("(POO-801 R4) the detail shows Max. slippage with the Auto badge on the default", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Max. slippage")).toBeInTheDocument();
    // Default investor slippage 2% (POO-463 R2) untouched → Auto badge + the percent.
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("2%")).toBeInTheDocument();
  });

  // @rule POO-801 R4 — a custom gear slippage renders the plain percent, no Auto badge.
  it("(POO-801 R4) a custom slippage drops the Auto badge", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    setAmount("200");
    // POO-570 R1: the gear lives on the amount (input) step.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "0.5%" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Invest" }));
    await screen.findByRole("button", { name: "Confirm investment" }, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Max. slippage")).toBeInTheDocument();
    expect(screen.queryByText("Auto")).not.toBeInTheDocument();
    expect(screen.getByText("0.5%")).toBeInTheDocument();
  });

  // @rule POO-801 R6 (reshapes POO-383 R5) — one consolidated Est. fee line whose tooltip carries
  // the REAL figures: protocol fee from the built swapInfo, network gas from the built estimate.
  // The hardcoded DEX line is gone (no backend field yet, POO-521 / POO-799 decision #1).
  it("(POO-801 R6) the fee tooltip reads the built figures and carries no DEX line", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Est. fee")).toBeInTheDocument();
    const tip = screen.getByRole("button", { name: /Protocol fee/ });
    expect(tip).toHaveAccessibleName(/Estimated gas \(network fee\)/);
    expect(tip).toHaveAccessibleName(/Total/);
    expect(tip).not.toHaveAccessibleName(/DEX fee/);
  });

  // @rule POO-801 R6 — real mode: the protocol fee is the built swapInfo.protocolFee in USD, not
  // client percent math; a build without a gas estimate hides the network line rather than
  // fabricating the $0.30 default (POO-799 global directive #1).
  it("(POO-801 R6) real mode reads swapInfo.protocolFee and never fabricates the gas line", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        // No estimatedGasInUsd (optional in builtTxSchema): the network line must disappear.
        built: {
          tx: {},
          swapInfo: { minAmountInStable: 195.5, priceImpactPercentage: 0.4, protocolFee: 0.49 },
        } as InvestCtx["built"],
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Protocol fee/ });
    // The single applicable line: the real $0.49 protocol fee (no Total for one line).
    expect(tip).toHaveAccessibleName(/Protocol fee \$0\.49/);
    expect(tip).not.toHaveAccessibleName(/Estimated gas/);
    expect(screen.queryByText("$0.30")).not.toBeInTheDocument();
  });

  // @rule POO-905 R3 — pre-build (a build without swapInfo), the Review estimates the protocol fee
  // from the API-served rate: amount × protocolFeePct / 100 ($200 × 0.25% = $0.50).
  it("[POO-905 R3] estimates the protocol fee from the served rate when the build carries no swapInfo", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        built: { tx: {}, estimatedGasInUsd: 2.5 } as InvestCtx["built"], // no swapInfo
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, protocolFeePct: 0.25 }}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Protocol fee/ });
    expect(tip).toHaveAccessibleName(/Protocol fee \$0\.50/);
  });

  // @rule POO-905 R3/R6 — once the build lands a swapInfo, its protocolFee (the authoritative server
  // figure) replaces the served-rate estimate ($0.49 built vs the $0.50 estimate on $200).
  it("[POO-905 R6] the built swapInfo.protocolFee wins over the served-rate estimate", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        built: {
          tx: {},
          estimatedGasInUsd: 2.5,
          swapInfo: { minAmountInStable: 195.5, priceImpactPercentage: 0.4, protocolFee: 0.49 },
        } as InvestCtx["built"],
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, protocolFeePct: 0.25 }}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Protocol fee/ });
    expect(tip).toHaveAccessibleName(/Protocol fee \$0\.49/);
    expect(tip).not.toHaveAccessibleName(/\$0\.50/);
  });

  // @rule POO-905 R4 — an absent rate (older backend / v1 fallback) keeps today's behavior: no
  // protocol line, never a client-side constant fallback (POO-799 global directive #1).
  it("[POO-905 R4] no protocolFeePct and no built swapInfo hides the protocol line", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        built: { tx: {}, estimatedGasInUsd: 2.5 } as InvestCtx["built"], // no swapInfo
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy} // no protocolFeePct
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    // The gas line renders alone; no Protocol fee line is fabricated.
    const tip = screen.getByRole("button", { name: /Estimated gas \(network fee\)/ });
    expect(tip).not.toHaveAccessibleName(/Protocol fee/);
    expect(screen.queryByText("$0.50")).not.toBeInTheDocument();
  });

  // @rule POO-801 R7 — the Review adopts the shared collapsible card: the fee detail sits behind
  // Show more / Show less while the hero rows stay visible.
  it("(POO-801 R7) the Review fee detail collapses behind Show more / Show less", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    // Summary stays visible; the detail starts hidden.
    expect(screen.getByText("You invest")).toBeVisible();
    expect(screen.getByText("You will invest at least")).toBeVisible();
    expect(screen.getByText("Lock-up")).toBeVisible();
    expect(screen.getByText("Est. fee")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Est. fee")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getByText("Est. fee")).not.toBeVisible();
  });

  // @rule R9 (POO-383) — the partial-investment banner when less than requested deploys.
  it("(R9) shows the partial-investment banner when less than requested deploys", async () => {
    vi.mocked(settleDeployedUsd).mockReturnValueOnce(150);
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 });
    expect(screen.getByText(/Partial investment\./)).toBeInTheDocument();
    expect(screen.getByText(/We added \$150\.00 of your \$200\.00/)).toBeInTheDocument();
  });

  // POO-1083, from a real fill: 0.0002 USDC stayed behind, two hundredths of a cent, and the strict
  // `deployed < amount` rendered "We added $1.00 of your $1.00. The rest couldn't be added", which
  // reads as a broken product rather than as the dust it describes. A message that names two amounts
  // must not appear when both amounts render the same.
  it("(R9) shows no partial banner when the remainder is smaller than a cent", async () => {
    // $199.9998 of $200: a real sub-cent remainder, invisible at the precision the user is shown.
    vi.mocked(settleDeployedUsd).mockReturnValueOnce(199.9998);
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 });
    expect(screen.queryByText(/Partial investment\./)).not.toBeInTheDocument();
  });

  // @rule R9 (POO-383) — no partial banner on a full fill.
  it("(R9) shows no partial banner on a full fill", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 });
    expect(screen.queryByText(/Partial investment\./)).not.toBeInTheDocument();
  });

  // @rule POO-801 R9/R10/R12 — the receipt card: Strategy + "Amount Invested" always visible;
  // "Fee" (final, not an estimate) + Slippage behind Show more; Date + Transaction stay visible.
  it("(POO-801 R9/R10/R12) the receipt shows Amount Invested and folds Fee + Slippage behind Show more", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 });
    expect(screen.getByText("Amount Invested")).toBeVisible();
    expect(screen.queryByText("Est. fee")).not.toBeInTheDocument();
    expect(screen.getByText("Fee")).not.toBeVisible();
    // Date + Transaction never collapse (they sit below the toggle).
    expect(screen.getByText("Date")).toBeVisible();
    expect(screen.getByText("Transaction")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Fee")).toBeVisible();
    expect(screen.getByText("Slippage")).toBeVisible();
  });

  // @rule POO-801 R11 — the receipt closes via the X (or View position); the Done button is gone.
  it("(POO-801 R11) the receipt has no Done button, keeping View position", async () => {
    renderWithProviders(
      <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={500} />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 });
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View position" })).toBeInTheDocument();
  });

  // @rule POO-810 R4 (supersedes POO-801's dormant-in-real behavior) — real mode: the deployed USD =
  // requested minus the USDC refund decoded from the receipt, so a real partial fill lights up the
  // banner with the REAL figure. The mock settleDeployedUsd walk still stays out in real mode.
  it("[POO-810 R4] real mode derives the partial-fill banner from the decoded USDC refund", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        // $50 refunded to the wallet: deployed = 200 - 50 = 150.
        decoded: { rows: [{ symbol: "USDC", amount: 50, usd: 50 }], usdcUsd: 50 },
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    vi.mocked(settleDeployedUsd).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 });
    // The real refund drives the deployed figure; the mock walk is never consulted in real mode.
    expect(settleDeployedUsd).not.toHaveBeenCalled();
    expect(screen.getByText(/Partial investment\./)).toBeInTheDocument();
    expect(screen.getByText(/We added \$150\.00 of your \$200\.00/)).toBeInTheDocument();
  });

  // @rule POO-810 R9 — real mode with nothing decoded: the deployed figure falls back to the full
  // requested amount (no partial banner), never blank / $0.
  it("[POO-810 R9] real mode falls back to the full requested amount when nothing decoded", async () => {
    const buildInvestSteps = vi.fn(() =>
      realInvestSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        decoded: null,
      }),
    );
    renderWithProviders(
      <InvestModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        balance={500}
        buildInvestSteps={buildInvestSteps}
      />,
    );
    await reachReview("200");
    fireEvent.click(screen.getByRole("button", { name: "Confirm investment" }));
    await screen.findAllByText("Investment confirmed", undefined, { timeout: 3000 });
    expect(screen.queryByText(/Partial investment\./)).not.toBeInTheDocument();
    // R9 fallback: no decoded USDC refund → deployed = requested (the full $200), banner dormant.
    expect(screen.getByText("$200.00")).toBeInTheDocument();
  });
});
