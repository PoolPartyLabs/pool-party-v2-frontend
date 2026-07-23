/**
 * @id PP-STR-MOD-004
 * @name WithdrawModal — tests
 * Behavior: amount/method step (with a $/% toggle + round presets) → building → Review step →
 * pending → success, driven by the wallet-sign runner. The Instant fee + slippage surface in the
 * Review fee block. Uses fireEvent for the dialog flow; the runner is async so pending is awaited
 * via findBy.
 *
 * POO-574: Continue no longer lands on the Review synchronously — it kicks off a server `build`
 * phase (a "Processing…" spinner) whose ~350ms mock beat settles into `awaiting`, and only then does
 * the modal advance to the Review with the BUILT figures. Every test that clicks Continue and then
 * asserts Review content therefore AWAITS the Review first via the shared `reachReview` helper (or an
 * inline `findByText`). The Review CTA now RESUMES the paused flow (`flow.resume()`) into signing; the
 * `strategy_withdraw_submitted` event still fires exactly once, from that Review CTA. In mock mode the
 * build carries no gas so `builtGasUsd` falls back to the $0.30 default and all existing Review
 * figures are unchanged — the ONLY new Review element is the "Refreshes in {n}s" re-quote countdown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { revalidateStrategiesAction } from "@/lib/strategies/revalidateStrategies";
import { priceToTick } from "@/lib/uniswap";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import type { FlowStep } from "../hooks/useWalletSignFlow";
import type { WithdrawCtx } from "../hooks/useWithdraw";
import { settleOutcome, settleSwapInfo, settleTxError } from "./settle";
import { WithdrawModal } from "./WithdrawModal";

vi.mock("./settle", () => {
  const settleOutcome = vi.fn(() => "success");
  return {
    settleOutcome,
    // POO-499 R6: the mock confirm reads slippage through this. Delegates to settleOutcome for
    // slippage > 0.1% (so `settleOutcome.mockReturnValueOnce("error")` still forces a failure) and
    // forces "error" at/below 0.1% (the deterministic slippage-failure demo trigger).
    settleOutcomeForSlippage: vi.fn((slippagePct: number) =>
      slippagePct <= 0.1 ? "error" : settleOutcome(),
    ),
    settleTxError: vi.fn(() => ({ code: "-32603", message: "execution reverted: mock" })),
    settleTxHash: vi.fn(() => "0xMOCK00000000000000000000000000000000MOCK"),
    // POO-611/POO-612: the mock build reads these to attach a real-shaped swapInfo to `built`; the
    // Review then shows the price impact + protocol fee and takes minAmountInStable as the minimum.
    settleSwapInfo: vi.fn(() => ({
      priceImpactPercentage: 0.25,
      protocolFee: 0.2,
      minAmountInStable: 2000,
    })),
    MOCK_BUILT_TX: { to: "0x0000000000000000000000000000000000000000", data: "0x" },
  };
});

// The success path invalidates the catalog (revalidateTag throws "static generation store missing"
// in vitest) and refreshes the router; mock both so the success view renders in tests.
vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: vi.fn(async () => {}),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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
  // POO-505 R2: the explorer link derives from the strategy's network.
  network: "base",
};

const position: Position = {
  id: "p1",
  strategyId: "s1",
  invested: 1800,
  currentValue: 2050,
  totalYield: 250,
  available: 120,
  reinvestment: "auto-compound",
  status: "active",
};

/**
 * A POO-437 raw reserve block for an ETH/USDC pool at ~$3000/ETH, sized so the WHOLE pool position is
 * worth ~$10,000 with a 60/40 value split (2 WETH = $6000, $4000 USDC). The strategy anchor (tvl) is
 * set to 10_000 so `f = totalReceivedMin / tvl` extracts a proportional slice, and the two per-token
 * rows differ (never an even 50/50 or a 1/N artifact).
 */
const ethUsdcTick = Math.round(priceToTick(3000, 18, 6));
const rawPairBlock = {
  totalSupply0: "2000000000000000000", // 2 WETH (18d)
  totalSupply1: "4000000000", // 4000 USDC (6d)
  tickCurrent: ethUsdcTick,
  decimals0: 18,
  decimals1: 6,
};

/**
 * Timings mirrored from WithdrawModal.tsx so the fake-timer tests advance the exact windows the
 * component uses. MOCK_STEP_MS = each mock build/sign beat; REVIEW_REFRESH_SECS = the Review's
 * re-quote countdown. (POO-803 R10 removed the success-screen auto-dismiss.)
 */
const MOCK_STEP_MS = 350;
const REVIEW_REFRESH_SECS = 10;

/** Build the real 2-step withdraw sequence for a test: optionally throw at a step or carry a hash. */
function realWithdrawSteps(opts: {
  hash?: string;
  throwAt?: number;
  error?: Error;
  /** POO-574 R5: the built figures the `build` step returns (e.g. the real gas estimate). */
  built?: WithdrawCtx["built"];
  /** POO-810 R6: the decoded per-token amounts the confirm step threads into the flow context. */
  decoded?: WithdrawCtx["decoded"];
}): FlowStep<WithdrawCtx>[] {
  const keys = ["build", "confirm:withdraw"];
  return keys.map((key, index) => ({
    key,
    run: async () => {
      if (opts.throwAt === index) throw opts.error ?? new Error("step failed");
      // POO-574: the build step (index 0) yields the built context so the Review reads real figures.
      if (index === 0 && opts.built) return { built: opts.built };
      if (index === keys.length - 1 && opts.hash)
        return { txHash: opts.hash, decoded: opts.decoded };
      return {};
    },
  }));
}

/**
 * POO-574: click "Continue" (or a closed exit's CTA) and AWAIT the Review arriving. Continue now
 * kicks off the async `building` phase (the mock ~350ms build beat) that only then advances to the
 * Review with the built figures, so a test can no longer assert Review content synchronously. Awaits
 * the stable Review title before returning so callers proceed exactly where they used to land.
 */
async function reachReview(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  // The Review title only renders once the build settles into `awaiting` and the phase flips.
  await screen.findByText("Review", undefined, { timeout: 3000 });
}

describe("WithdrawModal", () => {
  // @rule POO-1011 R2/R3 — a catastrophic built impact (>= 10%) renders the funds-at-risk alert and
  // blocks Confirm until acknowledged (USDC-payout path; the pair payout carries no swapInfo, R4).
  it("(POO-1011 R2) a catastrophic price impact blocks Confirm until the risk is acknowledged", async () => {
    vi.mocked(settleSwapInfo).mockReturnValueOnce({
      priceImpactPercentage: 92.41,
      protocolFee: 0.2,
      minAmountInStable: 15,
    });
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    const cta = screen.getByRole("button", { name: "Confirm withdrawal" });
    expect(cta).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toContain("92.41%");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cta).toBeEnabled();
  });

  beforeEach(() => {
    window.dataLayer = [];
    // Reset the settle mocks to happy-path defaults so a forced outcome can't leak between tests.
    vi.mocked(settleOutcome).mockReturnValue("success");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: mock",
    });
  });

  // @rule POO-807 R1: the visible MOCK indicator renders on the modal in mock mode (the shared
  // header/status mount it; real-mode absence is guarded in the MockBadge + host tests).
  it("[POO-807] shows the MOCK badge in mock mode", () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    expect(screen.getAllByTestId("mock-badge")).toHaveLength(1);
  });

  it("runs the regular withdrawal through the Review step to success", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    // POO-574: Continue now builds first (async), then the Review appears — await it.
    await reachReview();
    // POO-386 R6: a dedicated Review step (not the old "Confirm withdrawal" summary).
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Amount requested")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    for (const event of [
      "strategy_withdraw_started",
      "strategy_withdraw_submitted",
      "strategy_withdraw_completed",
    ]) {
      expect(window.dataLayer).toContainEqual(expect.objectContaining({ event }));
    }
  });

  // @rule POO-514 R1/R2 — the REGULAR (non-closed) success receipt also carries the tx row + the
  // shared explorer link on the strategy's network (POO-505 had it on the closed receipt only).
  it("[POO-514 R2] the regular success receipt links the explorer on the strategy network", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText("0xMOCK…MOCK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://basescan.org/tx/0xMOCK00000000000000000000000000000000MOCK",
    );
  });

  it("on success calls onChanged + invalidates the catalog so the detail refreshes", async () => {
    const onChanged = vi.fn();
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        onChanged={onChanged}
      />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    expect(onChanged).toHaveBeenCalled();
    expect(revalidateStrategiesAction).toHaveBeenCalled();
  });

  // POO-847 (Murilo 2026-07-11): an OWNED (isPoolManager) position on the investor surface — the
  // payout is pair-locked (POO-804 R1) and an ACTIVE full exit CLOSES the pool with the
  // manage-path signaling (close alert + investors note + Continue/Keep confirm + close CTAs).

  it("[POO-847 R4] owned full exit shows the close alert, destructive CTA and the Continue/Keep confirm", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, isPoolManager: true }}
      />,
    );
    // The seed is the full balance → close signaling on the amount step, not the dust notice.
    expect(
      screen.getByText(/closes this strategy and collects its accrued fees/),
    ).toBeInTheDocument();
    expect(screen.getByText(/All investors' liquidity is removed/)).toBeInTheDocument();
    // The CTA is the deliberate close, gated on the POO-804 R3-parity confirm.
    fireEvent.click(screen.getByRole("button", { name: "Close strategy" }));
    expect(await screen.findByText("Close this strategy?")).toBeInTheDocument();
    // Keep the strategy returns to the amount step untouched.
    fireEvent.click(screen.getByRole("button", { name: "Keep the strategy" }));
    expect(screen.queryByText("Review")).toBeNull();
    // Continue proceeds to the Review, whose CTA is the destructive close too.
    fireEvent.click(screen.getByRole("button", { name: "Close strategy" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByText("Review", undefined, { timeout: 3000 });
    const closeCta = screen.getByRole("button", { name: "Close strategy" });
    expect(closeCta).toBeInTheDocument();
    // Signing lands on the CLOSE receipt, never "Withdrawal successful".
    fireEvent.click(closeCta);
    await screen.findAllByText("Strategy closed", undefined, { timeout: 3000 });
    expect(screen.queryByText("Withdrawal successful")).toBeNull();
  });

  // @rule POO-847 R4: an owned removal AT/UNDER 50% (non-dust) stays a partial — the investor
  // Continue CTA, no close signaling (the > 50% / dust promotion is asserted below).
  it("[POO-847 R4] owned <= 50% partial keeps the investor Continue with no close signaling", () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, isPoolManager: true }}
      />,
    );
    // $500 of $2050 = ~24% (<= 50%) → stays a partial.
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "500" } });
    expect(screen.queryByText(/closes this strategy and collects/)).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close strategy" })).toBeNull();
  });

  // @rule POO-847 R4 (>50% promotion): an owned removal STRICTLY over 50% now PROMOTES to a full
  // pool close — the destructive close alert + investors note replace the partial affordance, the
  // CTA becomes "Close strategy" (gated on the Continue/Keep confirm) and signing lands on the CLOSE
  // receipt. This supersedes the earlier "owned partial stays a partial above 50%" behavior.
  it("[POO-847 R4] owned > 50% partial promotes to the destructive close signaling", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, isPoolManager: true }}
      />,
    );
    // $1500 of $2050 = ~73% (> 50%) → close promotion, mirroring desktop POO-312.
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "1500" } });
    expect(
      screen.getByText(/closes this strategy and collects its accrued fees/),
    ).toBeInTheDocument();
    expect(screen.getByText(/All investors' liquidity is removed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    // The CTA is the deliberate close, gated on the Continue/Keep confirm.
    fireEvent.click(screen.getByRole("button", { name: "Close strategy" }));
    expect(await screen.findByText("Close this strategy?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Review", undefined, { timeout: 3000 });
    const closeCta = screen.getByRole("button", { name: "Close strategy" });
    fireEvent.click(closeCta);
    await screen.findAllByText("Strategy closed", undefined, { timeout: 3000 });
    expect(screen.queryByText("Withdrawal successful")).toBeNull();
  });

  // @rule POO-847/POO-804 R1: the owned payout never swaps — receive-as is a fixed pair display
  // and every build (partial included) rides receiveAsPair=true.
  it("[POO-847/POO-804 R1] owned receive-as is pair-locked and the build rides receiveAsPair", async () => {
    const buildWithdrawSteps = vi.fn(() => realWithdrawSteps({ hash: "0xhash" }));
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, isPoolManager: true }}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "500" } });
    // The gear shows the FIXED pair display — no USDC option, no interactive picker.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(await screen.findAllByText("ETH / USDC")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "USDC" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ETH / USDC" })).toBeNull();
    // The partial build carries receiveAsPair=true without any picker interaction.
    expect(buildWithdrawSteps).toHaveBeenLastCalledWith(500, 2, true);
  });

  it("[POO-847 R4] a closed owned position keeps the investor claim copy (no close signaling)", () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, isPoolManager: true, status: "closed" }}
      />,
    );
    expect(screen.queryByText(/closes this strategy and collects/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Close strategy" })).toBeNull();
  });

  // POO-844: money-truth batch — the built minimum gets a plausibility floor (R2), every
  // amountText writer is sanitized (R3), the seed re-syncs on open (R4) and a sub-floor position
  // can no longer show an uncorrectable >100% (R5).

  // @rule POO-844 R2: a built minimum MATERIALLY below the client floor (a dropped route leg,
  // POO-845) suppresses the real arrival line instead of displaying the broken figure.
  it("[POO-844 R2] real Review hides the arrival line when the built minimum is implausibly low", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xhash",
        built: {
          tx: {},
          estimatedGasInUsd: 0.08,
          // $100 withdraw at 2% slippage → client floor ≈ $97.9; 45 is the dropped-leg class.
          swapInfo: { minAmountInStable: 45, protocolFee: 0.01, priceImpactPercentage: 0.01 },
        } as WithdrawCtx["built"],
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "100" } });
    await reachReview();
    expect(screen.queryByText(/Arrives instantly/)).toBeNull();
  });

  // @rule POO-844 R2: a plausible built minimum keeps the arrival line (the POO-612 behavior).
  it("[POO-844 R2] real Review keeps the arrival line for a plausible built minimum", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xhash",
        built: {
          tx: {},
          estimatedGasInUsd: 0.08,
          swapInfo: { minAmountInStable: 97, protocolFee: 0.01, priceImpactPercentage: 0.01 },
        } as WithdrawCtx["built"],
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "100" } });
    await reachReview();
    expect(screen.getByText(/≈ 97 USDC · Arrives instantly/)).toBeInTheDocument();
  });

  // @rule POO-844 R2: a built minimum ABOVE the requested amount is just as implausible (the
  // 333x scale-trap class) — suppressed, never displayed.
  it("[POO-844 R2] real Review hides the arrival line when the built minimum exceeds the amount", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xhash",
        built: {
          tx: {},
          estimatedGasInUsd: 0.08,
          swapInfo: { minAmountInStable: 500, protocolFee: 0.01, priceImpactPercentage: 0.01 },
        } as WithdrawCtx["built"],
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "100" } });
    await reachReview();
    expect(screen.queryByText(/Arrives instantly/)).toBeNull();
  });

  // @rule POO-844 R2: when the estimated costs swallow the amount the plausibility floor is 0 and
  // NOTHING can be validated — the line is suppressed rather than showing "≈ 0 USDC".
  it("[POO-844 R2] real Review hides the arrival line when fees swallow the amount", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xhash",
        built: {
          tx: {},
          // $2 withdraw, $2.50 gas → floor 0: no plausibility test is possible.
          estimatedGasInUsd: 2.5,
          swapInfo: { minAmountInStable: 1.9, protocolFee: 0.01, priceImpactPercentage: 0.01 },
        } as WithdrawCtx["built"],
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "2" } });
    await reachReview();
    expect(screen.queryByText(/Arrives instantly/)).toBeNull();
  });

  // @rule POO-844 R3: the $/% flip re-sanitizes against the NEXT unit — a stale $ amount above the
  // refreshed balance converts to a clamped 100, never 100.4 (the v2.dev screenshot).
  it("[POO-844 R3] the unit flip clamps at 100% when the balance drifted below the typed amount", () => {
    const { rerender } = renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("2050");
    // The position refreshes LOWER while the modal stays open (post-write poll / LP drift): the
    // seeded $2050 is now above the $2040 balance.
    rerender(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, currentValue: 2040 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "%" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("100");
  });

  // @rule POO-844 R3: the Max chip writes through the sanitizer — a raw float balance caps at the
  // 6-decimal $ precision instead of landing 15+ characters in the input.
  it("[POO-844 R3] Max caps a full-precision float balance at 6 decimals", () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, currentValue: 2033.4515678901846 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("2033.451567");
  });

  // @rule POO-844 R4: the modal stays mounted with `open` controlled, so the seed re-syncs from the
  // LIVE balance when it opens (a stale mount-time seed can never survive into a session).
  it("[POO-844 R4] re-seeds the amount from the live balance when the modal opens", () => {
    const { rerender } = renderWithProviders(
      <WithdrawModal open={false} onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    rerender(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, currentValue: 1500 }}
      />,
    );
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("1500");
  });

  // @rule POO-844 R5: a sub-floor position (input locked) can still flip units, but the flip now
  // lands on the clamped 100% — the uncorrectable 100.4-style display is gone.
  it("[POO-844 R5] below the dust floor the unit flip shows a clamped 100%", () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, invested: 4.96, currentValue: 4.96 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "%" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("100");
  });

  // @rule R2 (POO-386)
  it("(R2) toggles $ / % preserving the equivalent amount", () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    const input = screen.getByLabelText("Amount to withdraw");
    fireEvent.change(input, { target: { value: "1025" } });
    // $1025 of a $2050 balance = 50%. Switching unit preserves the equivalent.
    fireEvent.click(screen.getByRole("button", { name: "%" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("50");
    fireEvent.click(screen.getByRole("button", { name: "$" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("1025");
  });

  // @rule R3 (POO-386)
  it("(R3) %-mode presets set 25/50/75/Max", () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "%" }));
    fireEvent.click(screen.getByRole("button", { name: "50%" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("50");
    fireEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("100");
  });

  // @rule R6 (POO-386)
  it("(R6, POO-803 R7) Review shows the summary card + caption; the fee detail folds", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Instant withdrawal/ }));
    await reachReview();
    expect(screen.getByText("Amount requested")).toBeVisible();
    expect(screen.getByText("Fees available to collect")).toBeVisible();
    // POO-463 R2: the investor default is 2% now.
    expect(screen.getByText("after fees & max. 2% slippage")).toBeInTheDocument();
    // POO-803 R5: the retired rows are gone; the fee detail sits behind Show more.
    expect(screen.queryByText("You receive at least")).not.toBeInTheDocument();
    expect(screen.queryByText("Total received (min)")).not.toBeInTheDocument();
    expect(screen.getByText("Est. fee")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Est. fee")).toBeVisible();
    expect(screen.getByText("Max. slippage")).toBeVisible();
  });

  // @rule R6 (POO-386) reshaped by POO-481 R1: receive-as is BINARY (USDC <-> the pool pair),
  // USDC is always the default, and the pair is picked through the settings gear. POO-483 R3 v2: the
  // rows now come from the reserve split, so the fixture carries the raw block.
  it("(R6/POO-481) Review lists the PAIR tokens once the pair is selected (mock mode)", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, ...rawPairBlock } as Position}
      />,
    );
    // POO-923 R1 (supersedes POO-846 R1): the USDC default collapses to the single USD figure —
    // the per-token split shows only once the pair is picked.
    await reachReview();
    expect(screen.queryByTestId("withdraw-amount-tokens")).toBeNull();
    // POO-570 R1: the gear moved to the input step — go back and pick the pair through it.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    const list = screen.getByTestId("withdraw-amount-tokens");
    // Exactly the two pool tokens: the old N-option artifact (a row per option, incl. the USDC
    // OPTION itself) is gone.
    expect(list.children).toHaveLength(2);
    expect(list.textContent).toContain("ETH");
  });

  // @rule R1 (POO-481) — pair source precedence: the position's claimableFeeTokens (real
  // per-token data) win over any strategy pair field.
  it("[POO-481 R1] derives the pair option from claimableFeeTokens first", () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, poolPair: { token0: "AAA", token1: "BBB" } }}
        position={
          {
            ...position,
            claimableFeeTokens: [
              { symbol: "ETH", amount: 0.05 },
              { symbol: "USDC", amount: 145 },
            ],
          } as Position
        }
      />,
    );
    // POO-570 R1: the gear lives on the input step now — open it there (no Continue needed).
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(screen.getByRole("button", { name: "ETH / USDC" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AAA / BBB" })).toBeNull();
  });

  // @rule R2 (POO-481) — real mode with the pair selected but NO raw reserve block degrades to the
  // honest USD total (POO-483 R4): with the raw block absent the split is null, so no rows render.
  it("[POO-481 R2] real mode with the pair selected (no raw block) shows the USD total, not rows", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    // POO-570 R1: pick the pair via the input-step gear, then advance to the Review.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    expect(screen.queryByTestId("withdraw-amount-tokens")).toBeNull();
    // The choice still shows on the display-only Receive as row.
    expect(screen.getByText("ETH / USDC")).toBeInTheDocument();
    // POO-481 R4: picking the pair rebuilds the steps with receiveAsPair=true.
    expect(buildWithdrawSteps).toHaveBeenLastCalledWith(2050, 2, true);
  });

  // @rule R6 — the real success receipt shows the REAL per-token amounts decoded from the receipt
  // (USDC leg as USD), not the pre-broadcast "Total received" estimate.
  it("[POO-810 R6] real success receipt shows the decoded per-token amounts received", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        decoded: {
          rows: [
            { symbol: "USDC", amount: 980.25, usd: 980.25 },
            { symbol: "ETH", amount: 0.012 },
          ],
          usdcUsd: 980.25,
        },
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    const rows = screen.getByTestId("withdraw-received-amounts");
    expect(rows).toHaveTextContent("0.012 ETH");
    // The USDC leg renders as a USD value (1:1).
    expect(rows).toHaveTextContent("$980.25");
    // POO-844 R1: a MIXED payout (a non-USDC leg carries no USD) cannot compose a truthful total —
    // usdcUsd covers only the USDC side — so the body + Total keep the estimate composition.
    expect(screen.getByText(/\$2,050\.00 has been sent to your balance/)).toBeInTheDocument();
    expect(screen.getByText("$2,300.00")).toBeInTheDocument();
  });

  // @rule POO-844 R1: when EVERY decoded leg is USDC, the decoded figure is the ALL-IN payout
  // (principal + the fees this withdraw collected) — the body and Total received show IT, never
  // decoded + the fee snapshot (double count) and never the pre-broadcast estimate.
  it("[POO-844 R1] all-USDC decode drives the body and Total received (no fee double-count)", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xhash",
        decoded: {
          rows: [{ symbol: "USDC", amount: 980.25, usd: 980.25 }],
          usdcUsd: 980.25,
        },
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    expect(screen.getByText(/\$980\.25 has been sent to your balance/)).toBeInTheDocument();
    // POO-844 (fees copy): the all-in decode already INCLUDES the fees, so the fee line reads
    // "Fees collected (included)" (never the plain label that could read as adding on top).
    expect(screen.getByText("Fees collected (included)")).toBeInTheDocument();
    expect(screen.queryByText("Fees collected")).toBeNull();
    expect(screen.getByText("$250.00")).toBeInTheDocument();
    expect(screen.getByText("Total received")).toBeInTheDocument();
    expect(screen.getByText("$980.25")).toBeInTheDocument();
    expect(screen.queryByText("$1,230.25")).toBeNull();
  });

  // @rule POO-844 R1: the PAIR payout's decode carries a truthy USDC leg (X/USDC pools) that is
  // only HALF the value — the Total must keep the estimate composition, never collapse to the leg.
  it("[POO-844 R1] pair payout keeps the estimate total (decoded USDC leg never understates it)", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xhash",
        decoded: {
          rows: [
            { symbol: "ETH", amount: 0.165 },
            { symbol: "USDC", amount: 505, usd: 505 },
          ],
          usdcUsd: 505,
        },
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    // Total = estimate 2050 + snapshotted fees 250, NOT the $505 USDC leg (+ fees).
    expect(screen.getByText("$2,300.00")).toBeInTheDocument();
    expect(screen.queryByText("$755.00")).toBeNull();
    expect(screen.queryByText("$505.00")).toBeNull();
  });

  // @rule POO-844 R1 (raw-values refinement): an X/USDC pair whose non-USDC leg went UNPRICED (its
  // meta failed to resolve, so `buildReceivedLegs` emits a raw base-unit row with no `usd` and flips
  // `hasUnpricedLeg`) must NOT collapse to the all-USDC verbatim USD. The receipt shows the RAW
  // per-token amounts (USDC leg as USD, the unpriced leg as a raw amount + short label), and Total
  // keeps the honest estimate composition (never the USDC-only figure that omits the unpriced leg).
  it("[POO-844 R1] unpriced pair leg renders raw amounts, not a collapsed USDC-only total", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xhash",
        decoded: {
          // The USDC leg priced (USD), the non-USDC leg UNPRICED: raw base-unit amount, short
          // address label, no `usd`. `hasUnpricedLeg` is what buildReceivedLegs sets for this.
          rows: [
            { symbol: "USDC", amount: 505, usd: 505 },
            { symbol: "0x82aF…Bab1", amount: 165_000_000_000_000_000 },
          ],
          usdcUsd: 505,
          hasUnpricedLeg: true,
        },
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    // Amount Received renders the per-token rows: the USDC leg as USD, the unpriced leg as a RAW
    // amount with its short address label — the leg is visible, not silently dropped.
    const rows = screen.getByTestId("withdraw-received-amounts");
    expect(rows).toHaveTextContent("$505.00");
    expect(rows).toHaveTextContent("0x82aF…Bab1");
    // The verbatim all-USDC path is OFF: Total keeps the estimate (2050 + 250 fees), NOT the $505
    // USDC-only figure that omits the unpriced leg.
    expect(screen.getByText("$2,300.00")).toBeInTheDocument();
    expect(screen.queryByText("$505.00")).toBeNull();
    // The fee line stays the plain label (fees genuinely ADD here; they are not baked into Total).
    expect(screen.getByText("Fees collected")).toBeInTheDocument();
    expect(screen.queryByText("Fees collected (included)")).toBeNull();
  });

  // @rule POO-844 R1 (regression) — the genuine all-priced all-USDC case still shows the VERBATIM
  // decoded USD (no raw-values regression from the unpriced-leg change).
  it("[POO-844 R1] all-priced all-USDC decode still shows the verbatim USD (no regression)", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xhash",
        decoded: {
          rows: [{ symbol: "USDC", amount: 980.25, usd: 980.25 }],
          usdcUsd: 980.25,
          hasUnpricedLeg: false,
        },
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    // Verbatim decoded USD on the body + Total; the fee line reads the "(included)" copy.
    expect(screen.getByText(/\$980\.25 has been sent to your balance/)).toBeInTheDocument();
    expect(screen.getByText("Total received")).toBeInTheDocument();
    expect(screen.getByText("$980.25")).toBeInTheDocument();
    expect(screen.getByText("Fees collected (included)")).toBeInTheDocument();
  });

  // @rule R9 — when the receipt decoded nothing, the real receipt falls back to the pre-broadcast
  // "Total received" USD (never blank / $0).
  it("[POO-810 R9] real success receipt falls back to the USD total when nothing decoded", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        decoded: null,
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    expect(screen.queryByTestId("withdraw-received-amounts")).toBeNull();
  });

  // @rule R3 v2 (POO-483) — pair selected + raw block: exactly two per-token rows with amount, USD
  // and a resolved logo, in MOCK mode (the default, no buildWithdrawSteps).
  it("[POO-483 R3] pair selected + raw block: renders two per-token rows with amount, USD and logo (mock)", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, ...rawPairBlock } as Position}
      />,
    );
    // POO-570 R1: pick the pair on the input step (gear), then advance to the Review.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();

    const rows = screen.getByTestId("withdraw-amount-tokens");
    // Exactly the two pool tokens (no USDC-option artifact, no 1/N row).
    expect(rows.children).toHaveLength(2);
    expect(rows.textContent).toContain("ETH");
    expect(rows.textContent).toContain("USDC");
    // Each row carries an estimated USD in parentheses (transaction-display consistency).
    expect(rows.textContent).toMatch(/\(\$/);
    // A resolved logo (major token) renders as an <img>, not the initial chip.
    expect(rows.querySelectorAll("img").length).toBeGreaterThanOrEqual(1);
  });

  // @rule R3 v2 (POO-483) — the split is value-weighted (60/40 here), NOT an even 1/N split: the two
  // USD legs must differ. This kills the old MOCK_TOKEN_PRICE_USD even-split math.
  it("[POO-483 R3] the mock split is value-weighted, not an even 1/N split", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, ...rawPairBlock } as Position}
      />,
    );
    // POO-570 R1: pick the pair on the input step (gear), then advance to the Review.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();

    const rows = screen.getByTestId("withdraw-amount-tokens");
    const [row0, row1] = Array.from(rows.children);
    // 60/40 value split → the two USD parentheticals are not equal.
    expect(row0?.textContent).not.toEqual(row1?.textContent);
  });

  // @rule R3 v2 (POO-483) — SAME code path in real mode: with the raw block present, real mode also
  // renders the two rows (no mode fork).
  it("[POO-483 R3] real mode with the raw block renders the same two per-token rows", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, ...rawPairBlock } as Position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    // POO-570 R1: pick the pair on the input step (gear), then advance to the Review.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();

    const rows = screen.getByTestId("withdraw-amount-tokens");
    expect(rows.children).toHaveLength(2);
    expect(rows.textContent).toContain("ETH");
    expect(rows.textContent).toContain("USDC");
  });

  // @rule R4 (POO-483) — pair selected WITHOUT the raw block degrades to the honest USD total in real
  // mode: no fabricated per-token rows.
  it("[POO-483 R4] pair selected without the raw block keeps the honest USD total (real mode)", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    // POO-570 R1: pick the pair on the input step (gear), then advance to the Review.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    // No token rows — the split is null (no raw block), so the honest USD total stands.
    expect(screen.queryByTestId("withdraw-amount-tokens")).toBeNull();
    // The choice still shows on the display-only Receive as row.
    expect(screen.getByText("ETH / USDC")).toBeInTheDocument();
  });

  // @rule R1 (POO-923, supersedes POO-483 R4→POO-846 R1) — USDC selected: the per-token split is
  // OMITTED (single USD figure), while the USDC payout semantics stay — the arrival footer (min
  // indicator, POO-803 R7) still carries the built USDC min.
  it("[POO-923 R1] USDC selected: the split is omitted, the USDC payout semantics stay", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, ...rawPairBlock } as Position}
      />,
    );
    await reachReview();
    expect(screen.queryByTestId("withdraw-amount-tokens")).toBeNull();
    expect(screen.getByText(/≈ 2,000 USDC/)).toBeInTheDocument();
  });

  // @rule R5 (POO-483) — the label is unchanged when the rows are shown. POO-923 R3 supersedes the
  // caption half: the pair payout has no stable swap, so the "after fees" caption is dropped entirely.
  it("[POO-483 R5→POO-923 R3] the pair payout drops the caption; the retired min row stays gone", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, ...rawPairBlock } as Position}
      />,
    );
    // POO-570 R1: pick the pair on the input step (gear), then advance to the Review.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    expect(screen.queryByText("You receive at least")).not.toBeInTheDocument();
    // POO-923 R3: neither caption variant renders on the pair payout.
    expect(screen.queryByText(/after fees/)).not.toBeInTheDocument();
    expect(screen.getByTestId("withdraw-amount-tokens")).toBeInTheDocument();
  });

  // POO-515 R2: receive-as = the token pair keeps the pool tokens (no stable swap), so the Max
  // slippage component (and any DEX fee) drops out of the Est. fee AND the min-received math; only
  // the network gas (plus the mock Instant fee, when chosen) remains.
  it("[POO-515 R2→POO-803 R7] the pair payout drops the swap figures; USDC keeps them", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={position}
      />,
    );
    await reachReview();
    // USDC (default): the canonical Est. fee = mock gas ($0.30) + built swap protocol ($0.20) —
    // the old client slippage line left the tooltip (Max. slippage is its own detail row now).
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.getByText("Price impact")).toBeInTheDocument();
    expect(screen.getByText("0.25%")).toBeInTheDocument();
    // The arrival footer carries the built minimum (POO-612 minAmountInStable).
    expect(screen.getByText(/≈ 2,000 USDC/)).toBeInTheDocument();
    // POO-570 R1: the gear moved to the input step — go back and pick the pair through it.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    // Pair payout: no stable swap → gas-only tooltip, no price impact, no fabricated USDC arrival.
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Estimated gas/ });
    expect(tip).not.toHaveAccessibleName(/Protocol fee/);
    expect(screen.queryByText("Price impact")).toBeNull();
    expect(screen.queryByText(/≈ /)).toBeNull();
  });

  it("can go back from Review to the amount step", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    expect(screen.getByText("Review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    // Back at the amount step (the Continue CTA is shown again).
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("shows the error state on a failed settle", async () => {
    vi.mocked(settleOutcome).mockReturnValueOnce("error");
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Something went wrong", undefined, { timeout: 3000 });
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_withdraw_failed" }),
    );
    // @rule R2 — the raw error message must NEVER reach analytics
    expect(JSON.stringify(window.dataLayer)).not.toContain("execution reverted");
  });

  // POO-499 R2: a slippage failure then the ONE automatic retry then success — no error view.
  it("[POO-499 R2] auto-retries once on a slippage failure and reaches success with no error view", async () => {
    vi.mocked(settleOutcome).mockReturnValueOnce("error");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: slippage tolerance exceeded - minimum output amount not met",
    });
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    expect(
      await screen.findByText(/Retrying at the current price/i, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    await screen.findAllByText("Withdrawal successful", undefined, { timeout: 3000 });
    expect(screen.queryByText("Something went wrong")).toBeNull();
    const retries = (window.dataLayer ?? []).filter(
      (e) => (e as { event?: string }).event === "tx_slippage_retry",
    );
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ flow: "withdraw", strategy_id: "s1" });
  });

  // POO-499 R3: two slippage failures show the slippage error view and open settings.
  it("[POO-499 R3] two slippage failures show the slippage error view and open settings", async () => {
    vi.mocked(settleOutcome).mockReturnValue("error");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: slippage tolerance exceeded - minimum output amount not met",
    });
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    expect(
      (await screen.findAllByText("Price moved too much", undefined, { timeout: 3000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/moved beyond your max slippage.*again/i)).toBeInTheDocument();
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
  });

  it("closed position: full-balance withdraw goes closed → Review → sign, instant", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, status: "closed" }}
        position={{ ...position, status: "closed", available: 0 }}
      />,
    );
    // Full balance + Instant — no amount field, no method chooser — on the closed step. POO-570:
    // the chip reads only "Instant" (settlement is immediate); it no longer claims "No fee" because
    // a closed exit is not fee-free (gas + swap slippage on the token→USDC conversion + protocol fees).
    expect(screen.getByText("Withdrawing your full balance")).toBeInTheDocument();
    expect(screen.getByText("$2,050.00")).toBeInTheDocument();
    expect(screen.getByText("Instant")).toBeInTheDocument();
    expect(screen.queryByText("Instant · No fee")).not.toBeInTheDocument();
    expect(screen.queryByText("How would you like to withdraw?")).not.toBeInTheDocument();

    // POO-570 R3 + POO-574: the closed step CTA now reads "Continue" and only advances to the Review
    // (no direct closed → sign). Continue kicks off the async build, so await the Review. The
    // submitted event fires from the Review CTA, not this one.
    await reachReview();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(window.dataLayer).not.toContainEqual(
      expect.objectContaining({ event: "strategy_withdraw_submitted" }),
    );

    // The Review CTA starts the signing.
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal complete", undefined, { timeout: 3000 });
    // @rule R8 — the standardized success receipt: Strategy + Date + Transaction (hash)
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText("0xMOCK…MOCK")).toBeInTheDocument();
    expect(screen.getByText("$2,050.00 sent to your account · instant")).toBeInTheDocument();
    // POO-570: the closed receipt drops the fee row entirely — a closed exit is not fee-free, so
    // asserting "No fee" would be misleading. (The OPEN Regular/Instant receipts keep their fee row.)
    expect(screen.queryByText("No fee")).not.toBeInTheDocument();
    // POO-505 R2: the link targets the real /tx/ URL on the position's network (mock settle hash
    // in mock mode), never the explorer home.
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://basescan.org/tx/0xMOCK00000000000000000000000000000000MOCK",
    );
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_withdraw_completed", value: 2050 }),
    );
    // POO-570 R3: the submitted event now fires exactly once, from the Review CTA.
    const submitted = (window.dataLayer ?? []).filter(
      (e) => (e as { event?: string }).event === "strategy_withdraw_submitted",
    );
    expect(submitted).toHaveLength(1);
  });

  it("[R1] real mode hides the method choice and runs the steps to the on-chain hash", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );

    // No Regular/Instant method choice in real mode.
    expect(screen.queryByRole("radio", { name: /Instant withdrawal/ })).not.toBeInTheDocument();

    await reachReview();
    expect(screen.getByText("Review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();

    // The real tx hash (full balance ⇒ full exit), not the mock settle hash.
    expect(await screen.findByText("0xdead…abcd")).toBeInTheDocument();
    // POO-514 R2/R3: the regular receipt links the MINED hash on the strategy's network.
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://basescan.org/tx/0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
    );
    // POO-317: the step builder receives the user's slippage (default 2, POO-463 R2), no longer dropped.
    // POO-481 R4: plus the receive-as choice (default USDC → false).
    expect(buildWithdrawSteps).toHaveBeenCalledWith(2050, 2, false);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_withdraw_completed" }),
    );
  });

  it("[POO-313] dust rule: a partial leaving < $5 promotes to a full withdraw + shows the alert", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );

    // Leave $3 (< $5) → dust alert appears.
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "2047" } });
    expect(screen.getByText(/your full balance will be withdrawn/)).toBeInTheDocument();

    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));

    // Promoted to the full balance (full exit), not the typed $2047.
    expect(await screen.findByText("0xdead…abcd")).toBeInTheDocument();
    expect(buildWithdrawSteps).toHaveBeenCalledWith(2050, 2, false);
  });

  // @rule R8 (POO-403)
  it("(R8) a sub-$5 position warns on open and drops the partial presets", () => {
    const tiny: Position = { ...position, invested: 4.96, currentValue: 4.96 };
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={tiny} />,
    );
    // The dust alert shows immediately, before any interaction.
    expect(screen.getByText(/your full balance will be withdrawn/)).toBeInTheDocument();
    // The partial presets (which would round past the $4.96 balance) are gone; only Max remains.
    expect(screen.getByRole("button", { name: "Max" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$5.00" })).not.toBeInTheDocument();
  });

  // @rule POO-803 R1 — the dust promotion now triggers at EXACTLY $5 left (≤ floor, was <).
  it("(POO-803 R1) a partial leaving exactly $5 promotes to a full withdraw", () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    // $2,050 balance − $2,045 = exactly $5.00 left → promoted, alert shown.
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "2045" } });
    expect(screen.getByText(/your full balance will be withdrawn/)).toBeInTheDocument();
  });

  // @rule POO-803 R2 — a balance at/below the $5 floor opens prefilled at the max with the input
  // LOCKED ($ and %): the only possible withdraw is the full one.
  it("(POO-803 R2) a sub-floor balance opens at the max with the input locked", () => {
    const tiny: Position = { ...position, invested: 4.96, currentValue: 4.96 };
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={tiny} />,
    );
    const input = screen.getByLabelText("Amount to withdraw");
    expect(input).toHaveValue("4.96");
    expect(input).toBeDisabled();
    // The lock holds across the unit toggle (% mode too).
    fireEvent.click(screen.getByRole("button", { name: "%" }));
    expect(screen.getByLabelText("Amount to withdraw")).toBeDisabled();
  });

  // @rule POO-803 R2 boundary — exactly $5.00 now counts as sub-floor (≤, was <).
  it("(POO-803 R2) a balance of exactly $5 is sub-floor: alert on open, input locked", () => {
    const tiny: Position = { ...position, invested: 5, currentValue: 5 };
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={tiny} />,
    );
    expect(screen.getByText(/your full balance will be withdrawn/)).toBeInTheDocument();
    expect(screen.getByLabelText("Amount to withdraw")).toBeDisabled();
  });

  // @rule POO-803 R3 — $ input: at most 6 decimals (USDC precision), clamped at the balance.
  it("(POO-803 R3) the $ input caps at 6 decimals and clamps at the balance", () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    const input = screen.getByLabelText("Amount to withdraw");
    fireEvent.change(input, { target: { value: "12.1234567" } });
    expect(input).toHaveValue("12.123456");
    fireEvent.change(input, { target: { value: "99999" } });
    expect(input).toHaveValue("2050");
  });

  // @rule POO-803 R3 — % input: at most 1 decimal, clamped at 100.
  it("(POO-803 R3) the % input caps at 1 decimal and clamps at 100", () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "%" }));
    const input = screen.getByLabelText("Amount to withdraw");
    fireEvent.change(input, { target: { value: "55.55" } });
    expect(input).toHaveValue("55.5");
    fireEvent.change(input, { target: { value: "150" } });
    expect(input).toHaveValue("100");
  });

  // @rule R9 (POO-403), reshaped by POO-512 R1: with no lock-up "instantly" is now the INSTANT
  // method's promise; the Regular method carries its own 2-business-days line (next test).
  it("(R9/POO-512 R1) the Review footer says instant for the Instant method with no lock-up", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Instant withdrawal/ }));
    await reachReview();
    expect(screen.getByText(/Arrives instantly/)).toBeInTheDocument();
  });

  // @rule R1 (POO-512): in mock mode the footer respects the CHOSEN method — Regular (the default)
  // promises about 2 business days, matching the method card, never "instantly".
  it("[POO-512 R1] mock Regular: the Review footer says about 2 business days", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    expect(screen.getByText(/Arrives in about 2 business days/)).toBeInTheDocument();
    expect(screen.queryByText(/Arrives instantly/)).toBeNull();
  });

  // @rule R2 (POO-512): real mode has no method choice (POO-302 R1 collapses it to an instant,
  // fee-free withdrawal) — the footer stays instant even though `method` idles at "regular".
  it("[POO-512 R2→POO-803 R8] real mode: the arrival shows the BUILT minimum, never a fabricated one", async () => {
    const { unmount } = renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={() =>
          realWithdrawSteps({
            built: {
              tx: {},
              estimatedGasInUsd: 2.5,
              swapInfo: { priceImpactPercentage: 0.4, protocolFee: 0.49, minAmountInStable: 1990 },
            } as WithdrawCtx["built"],
          })
        }
      />,
    );
    await reachReview();
    expect(screen.getByText(/≈ 1,990 USDC · Arrives instantly/)).toBeInTheDocument();
    expect(screen.queryByText(/Arrives in about 2 business days/)).toBeNull();
    unmount();
    // A real build WITHOUT a swap minimum shows NO arrival line (POO-799 directive #1).
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={() => realWithdrawSteps({})}
      />,
    );
    await reachReview();
    expect(screen.queryByText(/Arrives/)).toBeNull();
  });

  it("(R9) the Review footer shows the lock-up term when the strategy is locked", async () => {
    const locked = { ...strategy, detail: { lockupDays: 7 } } as unknown as Strategy;
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={locked} position={position} />,
    );
    await reachReview();
    expect(screen.getByText(/Arrives in 7 days/)).toBeInTheDocument();
    expect(screen.getByText(/per strategy lock-up/)).toBeInTheDocument();
  });

  // POO-819 R4 — the real (v2) mapper carries the lock-up TOP-LEVEL and never fabricates `detail`, so
  // the Review footer must read `strategy.lockupDays` and show the term in real mode too (not the
  // instant arrival it used to default to). @rule R4
  it("[R4] reads the top-level lockupDays (real mode, no detail) for the locked footer", async () => {
    const locked = { ...strategy, lockupDays: 7 } as Strategy;
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={locked} position={position} />,
    );
    await reachReview();
    expect(screen.getByText(/Arrives in 7 days/)).toBeInTheDocument();
    expect(screen.getByText(/per strategy lock-up/)).toBeInTheDocument();
  });

  // @rule R10 (POO-403)
  it("(R10) the Review Fee row exposes a breakdown tooltip", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    // POO-803 R7: the fee detail folds; the tooltip lists the canonical components (network +
    // protocol + Total) — the client slippage line left the breakdown (its own row now).
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Estimated gas \(network fee\)/ });
    expect(tip).toHaveAccessibleName(/Protocol fee/);
    expect(tip).toHaveAccessibleName(/Total/);
    expect(tip).not.toHaveAccessibleName(/Max slippage/);
  });

  it("[R3] real mode shows the error state when a step rejects", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        // POO-574: throw at the SIGN step (index 1), not the build — the build must settle so the
        // Review renders, then the wallet send rejects on approve, driving the error view + the
        // `strategy_withdraw_failed` event (which fires from the pending phase, post-approval).
        buildWithdrawSteps={() =>
          realWithdrawSteps({ throwAt: 1, error: new Error("user rejected") })
        }
      />,
    );

    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    expect((await screen.findAllByText("Something went wrong")).length).toBeGreaterThanOrEqual(1);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_withdraw_failed" }),
    );
  });

  // POO-434 R3: a locked strategy's withdrawal is "initiated" (funds arrive after the lock-up),
  // while an instant one (the default, asserted above) reads "Withdrawal successful".
  it("[POO-434 R3] locked strategy: the success screen reads 'Withdrawal started' (initiated)", async () => {
    const locked = { ...strategy, detail: { lockupDays: 7 } } as unknown as Strategy;
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={locked} position={position} />,
    );
    await reachReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findAllByText("Withdrawal started", undefined, { timeout: 3000 });
  });

  // POO-434 R3 REVERSED by POO-803 R10: the receipt stays open until the user closes it.
  it("(POO-803 R10) the success screen does NOT auto-close", async () => {
    vi.useFakeTimers();
    try {
      const onOpenChange = vi.fn();
      renderWithProviders(
        <WithdrawModal open onOpenChange={onOpenChange} strategy={strategy} position={position} />,
      );
      // POO-574: Continue runs the build first. Flush its ~350ms beat AND the follow-up settle →
      // effect → phase-flip render chain (a second drained tick) so the modal advances to the
      // Review — assert it before approving (the build beat is well inside the Review's 10s re-quote
      // window, so no rebuild interferes).
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await vi.advanceTimersByTimeAsync(MOCK_STEP_MS + 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText("Review")).toBeInTheDocument();
      // Approve → resume into the sign step, then flush its beat (+ the settle render chain) to reach
      // the success screen. "Withdrawal successful" renders twice (sr-only + status title), so ≥1.
      fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
      await vi.advanceTimersByTimeAsync(MOCK_STEP_MS + 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getAllByText("Withdrawal successful").length).toBeGreaterThan(0);
      // No timer dismisses the receipt — it stays until the user closes it (R10).
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // POO-548: investor Withdraw review refinements — the $ default (R2), a Fees-available row (R3),
  // per-token Amount requested + Fees on the pair path (R4), and the fee source (R5 =
  // position.totalYield). POO-570 supersedes the R1 gear placement (see below).

  // @rule R1 (POO-570): the settings gear now lives on the INPUT step, not the Review — for an
  // active position that input step is the amount/method step, which now SHOWS the gear, while the
  // Review no longer does. This is the inversion of the old POO-548 R1 (which guarded the amount
  // step as gearless). Regression guard for the NEW placement.
  it("[POO-570 R1] the amount step has the settings gear; the Review does not (regression)", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    // The amount/method (input) step now exposes the gear.
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transaction settings" })).toBeInTheDocument();
    // Advancing to the Review drops the gear (it moved off the Review to the input step). POO-574:
    // the Review now arrives after the async build, so await it before asserting the gear is gone.
    await reachReview();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Transaction settings" })).toBeNull();
  });

  // @rule R1 (POO-570): the CLOSED-position step KEEPS its gear — it is the input step for a closed
  // exit (closed → Review → sign), so the gear stays there (and is off the Review). Do NOT remove it.
  it("[POO-570 R1] the closed-position step keeps its settings gear", () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, status: "closed" }}
        position={{ ...position, status: "closed", available: 0 }}
      />,
    );
    // The closed input step (before the Review) exposes the gear; the Review that follows does not.
    expect(screen.getByText("Withdrawing your full balance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transaction settings" })).toBeInTheDocument();
  });

  // @rule R2 (POO-548): the amount opens in $ mode (already the default — guard). The $ toggle is
  // pressed and the seeded value is the full balance in dollars.
  it("[POO-548 R2] the amount opens in $ mode (guard)", () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    expect(screen.getByRole("button", { name: "$", pressed: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("2050");
  });

  // @rule R3/R5 (POO-548): the Review shows a "Fees available to collect" row directly below "Amount
  // requested", sourced from position.totalYield (the SAME field the Home Yield column uses).
  it("[POO-548 R3/R5] the Review shows a Fees-available row sourced from totalYield", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    expect(screen.getByText("Amount requested")).toBeInTheDocument();
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
    // position.totalYield = 250 → $250.00.
    expect(screen.getByText("$250.00")).toBeInTheDocument();
  });

  // @rule R3 (POO-548): the row shows even at $0.00 (no accrued yield).
  it("[POO-548 R3] the Fees-available row shows even at $0.00", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, totalYield: 0 }}
      />,
    );
    await reachReview();
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
    // The fees value is $0.00 (no accrued yield); "Remaining invested" is also $0.00 on a full
    // withdraw, so assert at least one $0.00 value renders (the row is present, not hidden at zero).
    expect(screen.getAllByText("$0.00").length).toBeGreaterThanOrEqual(1);
  });

  // @rule POO-923 R1 (supersedes POO-846 R1): the per-token breakdown belongs ONLY on the pair
  // payout — it describes the pool unwind. A USDC payout is one USDC figure, so the split is omitted
  // even when the reserve block resolves; the single USD figure stands.
  it("[POO-923 R1] Amount requested omits the per-token split on the USDC payout", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, ...rawPairBlock } as Position}
      />,
    );
    await reachReview();
    // USDC default → no per-token rows; the single USD figure (full $2,050 withdraw) renders.
    expect(screen.queryByTestId("withdraw-amount-tokens")).toBeNull();
    expect(screen.getByText("$2,050.00")).toBeInTheDocument();
  });

  // @rule POO-923 R2 (BE context from POO-846): pool-party-api ZEROES the reserve block for
  // non-manager rows today (portfolio utils `isPoolManager ? … : '0'` — the live v2.dev repro: pair
  // selected, no rows). On the pair payout an unresolved/zeroed split degrades to the honest single
  // USD figure, never NaN rows; real investor rows light up once the BE sends the block for every row.
  it("[POO-923 R2] a zeroed investor reserve block degrades to the single USD figure", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={
          { ...position, ...rawPairBlock, totalSupply0: "0", totalSupply1: "0" } as Position
        }
      />,
    );
    // Even with the pair explicitly selected (the reported repro), no split can resolve.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    expect(screen.queryByTestId("withdraw-amount-tokens")).toBeNull();
    expect(screen.queryByTestId("withdraw-fees-tokens")).toBeNull();
    // The single honest USD figure stands (full withdraw of the $2,050 position).
    expect(screen.getByText("$2,050.00")).toBeInTheDocument();
  });

  // @rule POO-923 R2 (feature from POO-548 R4): the Fees-available row splits per token on the pair
  // path (the per-token breakdown now renders only on the pair payout).
  it("[POO-923 R2] token pair: the Fees-available row splits into per-token rows", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, ...rawPairBlock } as Position}
      />,
    );
    // POO-570 R1: pick the pair on the input step (gear), then advance to the Review.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
    const feeRows = screen.getByTestId("withdraw-fees-tokens");
    expect(feeRows.children).toHaveLength(2);
    expect(feeRows.textContent).toContain("ETH");
    expect(feeRows.textContent).toContain("USDC");
  });

  // @rule R4 (POO-548): "You receive at least" stays a SINGLE total line even on the pair path (it
  // still renders the per-token receive rows as before — that is POO-498, unchanged — while Amount
  // requested and Fees are the NEW splits). The single-total decision is about not forking it into a
  // second, separate total; here we guard that the existing receive rows remain intact.
  it("(POO-803 R5) the retired Review rows are gone", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachReview();
    expect(screen.queryByText("You receive at least")).toBeNull();
    expect(screen.queryByText("Remaining invested")).toBeNull();
    expect(screen.queryByText("Total received (min)")).toBeNull();
  });

  // @rule POO-923 R1 (supersedes POO-548 R4→POO-846 R1): USDC mode collapses BOTH Amount requested
  // and Fees available to their single USD figures even when the reserve block resolves.
  it("[POO-923 R1] USDC mode omits BOTH splits when the reserve block resolves", async () => {
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={{ ...strategy, tvl: 10_000, poolPair: { token0: "ETH", token1: "USDC" } }}
        position={{ ...position, ...rawPairBlock } as Position}
      />,
    );
    await reachReview();
    expect(screen.queryByTestId("withdraw-amount-tokens")).toBeNull();
    expect(screen.queryByTestId("withdraw-fees-tokens")).toBeNull();
    // The rows themselves stay (as single USD figures) — only the per-token breakdown is dropped.
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
  });

  // @rule POO-513 R2: closing the modal resets the gear settings (slippage + deadline +
  // receive-as) to the flow defaults, so a reopened Withdraw never carries a stale custom
  // slippage into the build; the gear also re-derives its custom field from the reset (R1).
  it("[POO-513 R2] resets the gear slippage to the default when the modal closes", async () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    // POO-570 R1: the gear now lives on the method (input) step. Set a custom 9% via it there, then
    // advance to the Review whose caption reads the live gear slippage.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.change(screen.getByLabelText("Custom"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    expect(screen.getByText(/max\. 9% slippage/)).toBeInTheDocument();
    // Close the modal via the X. The test keeps `open`, so the internal reset (after the 150ms
    // close animation) is observable in place: back at the method step with the default slippage.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument(),
    );
    // The gear (on the method step) reopens on the default preset with the custom field cleared
    // (POO-513 R1), and the Review caption is back to the default slippage.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(screen.getByLabelText("Custom")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachReview();
    expect(screen.getByText(/max\. 2% slippage/)).toBeInTheDocument();
  });

  // POO-574 R3: the Review shows a visible re-quote countdown ("Refreshes in {n}s"); if it lapses
  // without approval the flow RE-QUOTES — the build (`pauseAfterKey`) step re-runs — refreshing the
  // built figures WITHOUT leaving the Review. Uses fake timers to advance the full 10s window and
  // asserts the build step ran a second time (via a spy on the build step's `run`).
  it("[POO-574 R3] the Review re-quotes (rebuilds) after the countdown lapses without approval", async () => {
    vi.useFakeTimers();
    try {
      // Count build-step invocations directly: a rebuild re-runs the build (index 0) step.
      const buildRun = vi.fn(async () => ({}));
      const buildWithdrawSteps = vi.fn<() => FlowStep<WithdrawCtx>[]>(() => [
        { key: "build", run: buildRun },
        {
          key: "confirm:withdraw",
          run: async () => ({
            txHash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
          }),
        },
      ]);
      renderWithProviders(
        <WithdrawModal
          open
          onOpenChange={vi.fn()}
          strategy={strategy}
          position={position}
          buildWithdrawSteps={buildWithdrawSteps}
        />,
      );

      // Continue → build → Review. Flush the microtask-only build so the Review renders.
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText("Review")).toBeInTheDocument();
      // The build ran exactly once to reach the Review; the countdown shows the full window.
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

  // POO-574 R5: in REAL mode the built tx carries a real gas estimate (estimatedGasInUsd), which the
  // Review's "Est. fees" breakdown/tooltip must reflect INSTEAD of the $0.30 mock default. Injects a
  // build step returning { built: { estimatedGasInUsd: 2.5 } } and asserts the network line reads
  // $2.50 (not $0.30). USDC default (no pair) so slippage stays and the total moves with the gas.
  it("[POO-574 R5] real mode: the built gas ($2.50) drives the Est. fees network line, not the $0.30 default", async () => {
    const buildWithdrawSteps = vi.fn(() =>
      realWithdrawSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        // The server build returns the real gas estimate for the withdraw tx.
        built: { tx: {}, estimatedGasInUsd: 2.5 } as WithdrawCtx["built"],
      }),
    );
    renderWithProviders(
      <WithdrawModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildWithdrawSteps={buildWithdrawSteps}
      />,
    );
    await reachReview();
    // POO-803 R7: the fee detail folds behind Show more. The breakdown tooltip's accessible name
    // carries the network line at the REAL $2.50 gas, and never the $0.30 mock default.
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Estimated gas \(network fee\)/ });
    expect(tip).toHaveAccessibleName(/Estimated gas \(network fee\) \$2\.50/);
    expect(tip).not.toHaveAccessibleName(/Estimated gas \(network fee\) \$0\.30/);
    // POO-803: the canonical Est. fee sums only REAL figures — the built gas alone here ($2.50);
    // the old client slippage component left the row (Max. slippage is its own detail row).
    expect(screen.getAllByText("$2.50").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("$0.30")).toBeNull();
  });

  // @rule POO-846 R3 — the invested balance line is a tappable button (was static text) that fills
  // the amount with the unit-aware max, exactly like the Max chip, in BOTH $ and % modes.
  it("[POO-846 R3] tapping the invested total fills the amount with the unit-aware max", () => {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    // The label carries the USD invested regardless of unit: formatUsd(2050) === "$2,050.00".
    const invested = () => screen.getByRole("button", { name: "Invested $2,050.00" });
    // $ mode (default): fills the balance (position.currentValue = 2050).
    fireEvent.click(invested());
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("2050");
    // % mode: fills 100 (the unit-aware max).
    fireEvent.click(screen.getByRole("button", { name: "%" }));
    fireEvent.click(invested());
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("100");
  });
});
