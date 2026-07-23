/**
 * @id PP-STR-MOD-003
 * @name CollectModal — tests
 * Behavior: shows the available yield + destination, then runs confirm → pending → success.
 * Uses fireEvent for the dialog flow (see InvestModal.test for the rationale).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { revalidateStrategiesAction } from "@/lib/strategies/revalidateStrategies";
import { TransactionError } from "@/lib/tx/sendTransaction";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import type { CollectCtx } from "../hooks/useCollectFees";
import type { FlowStep } from "../hooks/useWalletSignFlow";
import { CollectModal } from "./CollectModal";
import { settleOutcome, settleSwapInfo, settleTxError } from "./settle";

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
    // POO-827 (POO-811 mirror): the mock build's manager performance-fee cut — flat 10% of the
    // claimable, so the investor tooltips demo the Performance line ($25.00 on the $250 fixture).
    settlePerformanceFeeUsd: vi.fn((claimableUsd: number) => Math.round(claimableUsd * 10) / 100),
    // POO-615: the handshake mock build carries a real-shaped swapInfo (price impact + protocol fee +
    // min received) that the Review renders. Computed from the args so the POO-516 per-slippage min
    // tests reconcile: the min mirrors the client estimate MINUS the flat $0.20 protocol fee (the mock
    // drops the pool-tier DEX fee, which swapInfo has no field for). The price impact is a fixed 0.25%.
    settleSwapInfo: vi.fn((amount: number, { slippagePct }: { slippagePct?: number }) => ({
      priceImpactPercentage: 0.25,
      protocolFee: 0.2,
      minAmountInStable: Math.max(0, amount * (1 - (slippagePct ?? 0) / 100) - 0.2),
    })),
    MOCK_BUILT_TX: { to: "0x0000000000000000000000000000000000000000", data: "0x" },
  };
});

// The investor success path invalidates the catalog (revalidateTag throws "static generation store
// missing" in vitest) and refreshes the router; mock both so the success view renders in tests.
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
  // POO-505 R3: the explorer link derives from the strategy's network.
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

/** A position whose claimable fees carry the per-token breakdown (POO-417 R3/R5). */
const pairPosition: Position = {
  ...position,
  claimableFeeTokens: [
    { symbol: "ETH", amount: 0.05 },
    { symbol: "USDC", amount: 140.4 },
  ],
};

/** A managed-collect source that exposes the per-token pair (POO-417 R5). */
const managedWithPair = {
  strategyId: "pool-1",
  name: "ETH/USDC",
  initials: "E",
  poolLabel: "Base · 0.30%",
  availableUsd: 120,
  gasEstimateUsd: 0.4,
  feeTokens: [
    { symbol: "ETH", amount: 0.05 },
    { symbol: "USDC", amount: 140.4 },
  ],
  onCollect: vi.fn().mockResolvedValue(undefined),
};

/**
 * POO-802 R0: a real handshake builder for tests — the build step yields `built` (real figures for
 * the Review) and the confirm step resolves the hash (or rejects). Mirrors what
 * useCollectFees.buildSteps / useManagerCollect.buildSteps return in real mode.
 */
function realCollectSteps(opts: {
  built?: CollectCtx["built"];
  hash?: string;
  confirmError?: Error;
  /**
   * POO-810 R5: the decoded per-token amounts the confirm step carries on `ctx.decoded` (what the
   * real useCollectFees confirm step returns after decodeReceipt). Omitted → null (R9 fallback).
   */
  decoded?: CollectCtx["decoded"];
}): FlowStep<CollectCtx>[] {
  return [
    {
      key: "build",
      run: async () => ({ built: opts.built ?? ({ tx: {} } as CollectCtx["built"]) }),
    },
    {
      key: "confirm:collect",
      run: async () => {
        if (opts.confirmError) throw opts.confirmError;
        return {
          txHash: opts.hash ?? "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
          decoded: opts.decoded ?? null,
        };
      },
    },
  ];
}

/**
 * POO-615: the confirm CTA now starts the BUILD → a Review pause → the Review approve → signing.
 * This drives that handshake: click the `Collect $X` CTA (which kicks the build), await the Review
 * (its "Refreshes in …" countdown line), then click the Review approve CTA (also `Collect $X`). Every
 * test that used to click Collect and jump straight to a terminal state now routes through here.
 */
async function reachCollectReview() {
  fireEvent.click(screen.getByRole("button", { name: /^Collect \$/ }));
  // The build settles (~350ms) then the flow pauses on the Review — asserted via the countdown line.
  await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
  fireEvent.click(screen.getByRole("button", { name: /^Collect \$/ }));
}

describe("CollectModal", () => {
  // @rule POO-1011 R2/R3 — a catastrophic built impact (>= 10%) renders the funds-at-risk alert and
  // blocks the Collect CTA until acknowledged (USDC path; the token-pair payout has no swapInfo, R4).
  it("(POO-1011 R2) a catastrophic price impact blocks Collect until the risk is acknowledged", async () => {
    vi.mocked(settleSwapInfo).mockReturnValueOnce({
      priceImpactPercentage: 92.41,
      protocolFee: 0.2,
      minAmountInStable: 15,
    });
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Collect \$/ }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
    const cta = screen.getByRole("button", { name: /^Collect \$/ });
    expect(cta).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toContain("92.41%");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cta).toBeEnabled();
  });

  beforeEach(() => {
    window.dataLayer = [];
    vi.mocked(revalidateStrategiesAction).mockClear();
    // Reset the settle mocks to their happy-path defaults so a forced outcome can't leak.
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
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    expect(screen.getAllByTestId("mock-badge")).toHaveLength(1);
  });

  it("investor success calls onChanged + invalidates the catalog so the detail refreshes", async () => {
    const onChanged = vi.fn();
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        onChanged={onChanged}
      />,
    );
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(onChanged).toHaveBeenCalled();
    expect(revalidateStrategiesAction).toHaveBeenCalled();
  });

  it("managed (manager) mode does NOT invalidate the catalog from the modal — the console owns it", async () => {
    const onCollect = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        managed={{
          strategyId: "pool-1",
          name: "ETH/USDC",
          initials: "E",
          poolLabel: "Base · 0.30%",
          availableUsd: 120,
          gasEstimateUsd: 0.4,
          onCollect,
        }}
      />,
    );
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(onCollect).toHaveBeenCalled();
    expect(revalidateStrategiesAction).not.toHaveBeenCalled();
  });

  // @rule POO-478 R1 (regression, reshaped by POO-802 R0) — the investor gear still shows both
  // controls and the default 2% slippage threads into the REAL step builder.
  it("[POO-478 R1] investor collect unchanged: gear shows both controls, default slippage 2 threads", async () => {
    const buildCollectSteps = vi.fn(() => realCollectSteps({}));
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    expect(screen.getByText("Transaction deadline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(buildCollectSteps).toHaveBeenCalledWith(false, 2);
  });

  // @rule POO-810 R5 — the success receipt shows the REAL per-token amounts decoded from the receipt
  // (USDC leg as USD), carried on the confirm step's ctx.decoded, not the pre-execute claimable.
  it("[POO-810 R5] success receipt shows the real decoded per-token amounts received", async () => {
    const buildCollectSteps = vi.fn(() =>
      realCollectSteps({
        decoded: {
          rows: [
            { symbol: "USDC", amount: 12.5, usd: 12.5 },
            { symbol: "ETH", amount: 0.0034 },
          ],
          usdcUsd: 12.5,
        },
      }),
    );
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    const rows = screen.getByTestId("collect-received-amounts");
    expect(rows).toHaveTextContent("0.0034 ETH");
    // The USDC leg renders as a USD value (1:1).
    expect(rows).toHaveTextContent("$12.50");
  });

  // @rule POO-810 R9 — when the confirm step decodes nothing (logs unavailable), the receipt falls
  // back to the pre-execute claimable USD, never blank / $0.
  it("[POO-810 R9] success receipt falls back to the claimable USD when nothing decoded", async () => {
    const buildCollectSteps = vi.fn(() => realCollectSteps({ decoded: null }));
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(screen.queryByTestId("collect-received-amounts")).not.toBeInTheDocument();
    // The claimable USD (the position's $250 totalYield) still renders on the receipt (never blank).
    expect(screen.getAllByText("$250.00").length).toBeGreaterThan(0);
  });

  // @rule POO-802 R3 (reshapes POO-384 R2) — the amount row reads "Amount requested".
  it("(POO-802 R3) labels the amount row 'Amount requested'", () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    expect(screen.getByText("Amount requested")).toBeInTheDocument();
    expect(screen.queryByText("Yield earned")).not.toBeInTheDocument();
  });

  // @rule POO-802 R1 — the confirm view keeps only the essentials: no "You receive at least" and
  // no "Est. fee" row before the build has real figures.
  it("(POO-802 R1) the confirm view carries no You-receive-at-least and no Est. fee rows", () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    expect(screen.queryByText(/You receive/)).not.toBeInTheDocument();
    expect(screen.queryByText("Est. fee")).not.toBeInTheDocument();
  });

  // @rule POO-802 R6 (reshapes POO-384 R3, POO-799 decision #1) — the Review's Est. fee tooltip is
  // the canonical breakdown reading the BUILT figures: protocol from settleSwapInfo ($0.20) +
  // network; the hardcoded DEX line is GONE until the build exposes the route fee (POO-521).
  it("(POO-802 R6) the Review fee tooltip reads built figures and carries no DEX line", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await openCollectReview();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Est. fee")).toBeInTheDocument();
    const tip = screen.getByRole("button", { name: /Protocol fee \$0\.20/ });
    expect(tip).toHaveAccessibleName(/Estimated gas \(network fee\)/);
    // POO-827 (POO-811): the mock build carries the performance-fee cut (10% of $250).
    expect(tip).toHaveAccessibleName(/Performance fee \$25\.00/);
    expect(tip).toHaveAccessibleName(/Total/);
    expect(tip).not.toHaveAccessibleName(/DEX fee/);
  });

  // @rule POO-802 R2 (supersedes the POO-516 client math) — the min-received indicator is the
  // Review footer's "≈ X USDC · Arrives instantly", read ONLY from the built swap:
  // settleSwapInfo(250, 2%) = 250 × 0.98 − 0.2 = 244.8.
  it("(POO-802 R2) the Review footer shows the built minimum with the arrival line", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await openCollectReview();
    expect(screen.queryByText(/You receive at least/)).not.toBeInTheDocument();
    expect(screen.getByText("after fees & max. 2% slippage")).toBeInTheDocument();
    expect(screen.getByText("≈ 244.8 USDC · Arrives instantly")).toBeInTheDocument();
  });

  // @rule POO-802 R2 — a gear slippage change re-quotes the built minimum on the next Review:
  // settleSwapInfo(250, 1%) = 250 × 0.99 − 0.2 = 247.3.
  it("(POO-802 R2) the built minimum tracks the gear slippage", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "1%" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await openCollectReview();
    expect(screen.getByText("after fees & max. 1% slippage")).toBeInTheDocument();
    expect(screen.getByText("≈ 247.3 USDC · Arrives instantly")).toBeInTheDocument();
  });

  // @rule POO-802 R2/R4 + POO-923 R3 — the pair payout has no stable swap: NO USDC minimum is
  // fabricated AND the "after fees" caption is dropped entirely; the per-token rows stay (POO-417 R3).
  it("(POO-802 R2) the pair-path Review keeps per-token rows and shows no USDC minimum", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={pairPosition} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await openCollectReview();
    const list = screen.getByTestId("collect-receive-tokens");
    expect(list).toHaveTextContent("0.05 ETH");
    expect(list).toHaveTextContent("140.4 USDC");
    // POO-923 R3: no swap → no "after fees" caption, and no USDC minimum line either.
    expect(screen.queryByText(/after fees/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Arrives instantly/)).not.toBeInTheDocument();
  });

  // @rule POO-802 R2 — managed role parity: the manager Review footer reads the built minimum with
  // the manager gear default (5%): settleSwapInfo(120, 5%) = 120 × 0.95 − 0.2 = 113.8.
  it("(POO-802 R2) the managed Review footer shows the built minimum (manager 5% default)", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} managed={{ ...managedWithPair, feeBps: 30 }} />,
    );
    await openCollectReview();
    expect(screen.getByText("≈ 113.8 USDC · Arrives instantly")).toBeInTheDocument();
    // POO-827 R3: the manager never pays the performance fee to themselves — no line (POO-280).
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(
      screen.getByRole("button", { name: /Estimated gas \(network fee\)/ }),
    ).not.toHaveAccessibleName(/Performance fee/);
  });

  // @rule POO-802 R6/R8 — the receipt keeps the CLAIMABLE snapshot as "Amount Received" and the
  // "$X was added to your balance" body is gone.
  it("(POO-802 R6/R8) the receipt shows Amount Received (claimable snapshot) and no balance body", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(screen.getByText("Amount Received")).toBeInTheDocument();
    expect(screen.getByText("$250.00")).toBeInTheDocument();
    expect(screen.queryByText(/was added to your balance/)).not.toBeInTheDocument();
  });

  // @rule POO-802 R9 — the receipt folds the final Fee + Slippage behind Show more; Date +
  // Transaction never collapse.
  it("(POO-802 R9) the receipt folds Fee + Slippage behind Show more", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(screen.getByText("Fee")).not.toBeVisible();
    expect(screen.getByText("Date")).toBeVisible();
    expect(screen.getByText("Transaction")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Fee")).toBeVisible();
    expect(screen.getByText("Slippage")).toBeVisible();
  });

  // @rule POO-802 R10 (POO-799 decision #4) — the $0.10 PROD floor: below it the CTA disables
  // with the minimum notice.
  it("(POO-802 R10) disables the Collect CTA under the $0.10 minimum", () => {
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={{ ...position, totalYield: 0.05 }}
      />,
    );
    expect(screen.getByRole("button", { name: "Collect $0.05" })).toBeDisabled();
    expect(screen.getByText("Minimum collect is $0.10.")).toBeInTheDocument();
  });

  // @rule R6 (POO-384) — the investor ⚙ offers all three sections: Slippage + Deadline + Receive as.
  // This intentionally restores Slippage+Deadline that POO-280 R5d had removed (Collect was
  // receive-as-only). Not a regression.
  it("[R6] investor ⚙ shows Slippage + Deadline + Receive as", () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    // Slippage + Deadline are unique to the settings dialog (the receipt has no such row).
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    expect(screen.getByText("Transaction deadline")).toBeInTheDocument();
    // "Receive as" appears in both the dialog section header and the receipt row, so assert it is
    // present (≥1) rather than unique.
    expect(screen.getAllByText("Receive as").length).toBeGreaterThanOrEqual(1);
  });

  // @rule POO-478 R2 — SUPERSEDES POO-384 R6's manager-gearless collect. Every on-chain tx exposes
  // slippage + deadline, manager included: a manager collect-as-USDC swaps the pool fees, so the
  // manager must control slippage. The managed gear now renders even with no per-token pair option.
  it("[POO-478 R2] managed mode shows the settings gear with Max slippage + Transaction deadline", () => {
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        managed={{
          strategyId: "pool-1",
          name: "ETH/USDC",
          initials: "E",
          poolLabel: "Base · 0.30%",
          availableUsd: 120,
          gasEstimateUsd: 0.4,
          onCollect: vi.fn().mockResolvedValue(undefined),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    expect(screen.getByText("Transaction deadline")).toBeInTheDocument();
  });

  // @rule POO-525 R2 — a managed detail WITHOUT per-token fee data still gets the full gear: the
  // Receive-as section renders as a fixed, non-interactive USDC-only display (no pair choice exists)
  // instead of disappearing.
  it("[POO-525 R2] managed gear without feeTokens shows Receive as fixed to USDC (non-interactive)", () => {
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        managed={{
          strategyId: "pool-1",
          name: "ETH/USDC",
          initials: "E",
          poolLabel: "Base · 0.30%",
          availableUsd: 120,
          gasEstimateUsd: 0.4,
          onCollect: vi.fn().mockResolvedValue(undefined),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    // The Receive-as section renders (it used to be hidden for the no-pair managed path)…
    expect(screen.getAllByText("Receive as").length).toBeGreaterThanOrEqual(1);
    // …as a fixed USDC display: the value shows, but there is no receive-as button to click.
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "USDC" })).not.toBeInTheDocument();
  });

  // @rule POO-478 R2 — the managed collect threads the gear slippage into onCollect. The manager
  // flow seeds MANAGER_DEFAULT_SLIPPAGE_PCT (5), like the other manager-only flows (Move Range/Close).
  it("[POO-478 R2] managed collect passes the gear slippage (default 5) to onCollect", async () => {
    const onCollect = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        managed={{
          strategyId: "pool-1",
          name: "ETH/USDC",
          initials: "E",
          poolLabel: "Base · 0.30%",
          availableUsd: 120,
          gasEstimateUsd: 0.4,
          onCollect,
        }}
      />,
    );
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    // (collectAsTokenPair=false, slippage=MANAGER_DEFAULT_SLIPPAGE_PCT).
    expect(onCollect).toHaveBeenCalledWith(false, 5);
  });

  // @rule POO-547 R1/R2: the managed collect's custom slippage no longer caps at 5%; a >5% value
  // (e.g. 12.5%) is accepted and surfaces the High-slippage warning, and the Collect CTA stays
  // enabled (warn-only, never blocks).
  it("[POO-547 R1/R2] managed collect accepts a >5% custom slippage and warns without blocking", () => {
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        managed={{
          strategyId: "pool-1",
          name: "ETH/USDC",
          initials: "E",
          poolLabel: "Base · 0.30%",
          availableUsd: 120,
          gasEstimateUsd: 0.4,
          onCollect: vi.fn().mockResolvedValue(undefined),
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    const custom = screen.getByLabelText("Custom");
    fireEvent.change(custom, { target: { value: "12.5" } });
    expect(custom).toHaveValue("12.5");
    expect(screen.getByText("High slippage")).toBeInTheDocument();
    // Close the gear (its modal overlay hides the CTA from the a11y tree); warn-only means the
    // Collect CTA stays enabled once the sheet is dismissed.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Collect $120.00" })).toBeEnabled();
  });

  // POO-417 R3 (kept through POO-802 R4) — picking the token pair renders the per-token amount rows
  // (amounts only) on the Review, below the toggle; the confirm destination copy follows the choice.
  it("[POO-417 R3] token-pair variant renders per-token amount rows on the Review", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={pairPosition} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // POO-504 R1: the confirm destination copy follows the receive-as choice (pair, not USDC).
    expect(screen.getByText("Goes to your wallet as ETH and USDC")).toBeInTheDocument();
    expect(screen.queryByText("Goes to your USDC balance")).toBeNull();
    await openCollectReview();
    // POO-802 R2: the row label drops the "at least" qualifier (the USDC min moved to the footer).
    expect(screen.getByText("You receive")).toBeInTheDocument();
    const list = screen.getByTestId("collect-receive-tokens");
    // Amounts only, at crypto precision — no per-token USD.
    expect(list).toHaveTextContent("0.05 ETH");
    expect(list).toHaveTextContent("140.4 USDC");
    // POO-482 R2: the rows carry the real token logos (majors resolve with no network needed).
    const logos = list.querySelectorAll("img");
    expect(logos).toHaveLength(2);
    expect(logos[0]).toHaveAttribute("src", "/tokens/eth.png");
    expect(logos[1]).toHaveAttribute("src", "/tokens/usdc.png");
  });

  // POO-417 R6c — no per-token data → the token-pair option is not offered (USDC-only).
  it("[POO-417 R6c] offers no token-pair option when the position lacks per-token claimable", () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(screen.queryByRole("button", { name: "ETH / USDC" })).not.toBeInTheDocument();
  });

  // POO-417 R4 (reshaped by POO-802 R6/POO-827) — the pair payout performs no swap: no protocol
  // fee and no DEX line. The performance fee still applies (it cuts the yield, not the swap).
  it("[POO-417 R4] the pair-path fee tooltip carries no swap fees", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={pairPosition} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await openCollectReview();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Estimated gas \(network fee\)/ });
    expect(tip).not.toHaveAccessibleName(/Protocol fee/);
    expect(tip).not.toHaveAccessibleName(/DEX fee/);
    // POO-827: the performance cut rides the yield, so it stays on the pair path too.
    expect(tip).toHaveAccessibleName(/Performance fee \$25\.00/);
  });

  // POO-417 R2 — confirming as the pair passes collectAsTokenPair=true to the real step builder.
  // POO-463 R4 — the gear slippage rides along (default 2%) so the build stops falling back server-side.
  it("[POO-417 R2] passes collectAsTokenPair=true to the step builder on a pair collect", async () => {
    const buildCollectSteps = vi.fn(() =>
      realCollectSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
      }),
    );
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={pairPosition}
        buildCollectSteps={buildCollectSteps}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(buildCollectSteps).toHaveBeenCalledWith(true, 2);
    // @rule POO-505 R3: the receipt links the REAL mined hash on the strategy's network.
    expect(screen.getByText("0xdead…abcd")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://basescan.org/tx/0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
    );
  });

  // POO-417 R1 — the manager gear is ungated when the pool exposes the token pair.
  it("[POO-417 R1] managed mode shows the receive-as gear when the pool exposes the token pair", () => {
    renderWithProviders(<CollectModal open onOpenChange={vi.fn()} managed={managedWithPair} />);
    expect(screen.getByRole("button", { name: "Transaction settings" })).toBeInTheDocument();
  });

  // POO-417 R2 — the manager pair collect passes collectAsTokenPair=true to its mutation.
  // POO-478 R2 — the gear slippage rides along as the second arg (manager default 5%).
  it("[POO-417 R2] managed pair collect calls onCollect(true, 5)", async () => {
    const onCollect = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} managed={{ ...managedWithPair, onCollect }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(onCollect).toHaveBeenCalledWith(true, 5);
  });

  // @rule POO-468 R1: an investor collect success fires onCollected EXACTLY ONCE, so the detail
  // screen can arm its optimistic claimable reset (distinct from onChanged, which the post-write
  // poll re-invokes on every tick and must never arm the override).
  it("[POO-468 R1] investor mock-settle success fires onCollected exactly once", async () => {
    const onCollected = vi.fn();
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        onCollected={onCollected}
      />,
    );
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(onCollected).toHaveBeenCalledTimes(1);
  });

  // @rule POO-468 R1: the managed (manager) path never fires onCollected: the console owns its own
  // optimistic patch (StrategyManageView), not the investor detail override.
  it("[POO-468 R1] managed collect never fires onCollected", async () => {
    const onCollected = vi.fn();
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        managed={{
          strategyId: "pool-1",
          name: "ETH/USDC",
          initials: "E",
          poolLabel: "Base · 0.30%",
          availableUsd: 120,
          gasEstimateUsd: 0.4,
          onCollect: vi.fn().mockResolvedValue(undefined),
        }}
        onCollected={onCollected}
      />,
    );
    await reachCollectReview();
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(onCollected).not.toHaveBeenCalled();
  });

  it("shows the available yield and collects to success", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    expect(screen.getByText("Available to collect")).toBeInTheDocument();
    expect(screen.getAllByText("$250.00").length).toBeGreaterThanOrEqual(1);
    // POO-615: the CTA builds first, then the Review; the wallet handoff only starts on approve.
    await reachCollectReview();
    expect(await screen.findByText("Continue in your wallet")).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Yield collected", undefined, { timeout: 2000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_collect_started" }),
    );
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_collect_completed" }),
    );
    // @rule R8 — the standardized success receipt: Strategy + Date + Transaction (hash)
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText("0xMOCK…MOCK")).toBeInTheDocument();
  });

  it("shows the error state and retries (resumes) the failed step to success", async () => {
    vi.mocked(settleOutcome).mockReturnValueOnce("error");
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    // POO-615: the build succeeds → Review; the settle error throws on the CONFIRM step after approve.
    await reachCollectReview();
    expect(
      (await screen.findAllByText("Something went wrong", undefined, { timeout: 2000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_collect_failed" }),
    );
    // Try again re-runs the failed step; settle now succeeds → success (no full re-confirm).
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      (await screen.findAllByText("Yield collected", undefined, { timeout: 2000 })).length,
    ).toBeGreaterThanOrEqual(1);
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
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachCollectReview();
    expect(
      await screen.findByText(/Retrying at the current price/i, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText("Yield collected", undefined, { timeout: 2000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Something went wrong")).toBeNull();
    const retries = (window.dataLayer ?? []).filter(
      (e) => (e as { event?: string }).event === "tx_slippage_retry",
    );
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ flow: "collect", strategy_id: "s1" });
  });

  // POO-499 R3: two slippage failures show the slippage error view and auto-open settings.
  it("[POO-499 R3] two slippage failures show the slippage error view and open settings", async () => {
    vi.mocked(settleOutcome).mockReturnValue("error");
    vi.mocked(settleTxError).mockReturnValue({
      code: "-32603",
      message: "execution reverted: slippage tolerance exceeded - minimum output amount not met",
    });
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await reachCollectReview();
    // Two mock confirms (first + auto-retry) after the Review approve, so allow ~4s.
    expect(
      (await screen.findAllByText("Price moved too much", undefined, { timeout: 4000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/moved beyond your max slippage.*again/i)).toBeInTheDocument();
    // The settings sheet auto-opened.
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
  });

  // POO-499 R5: the MANAGED (manager) collect wires the same orchestration on the mock-safe path. The
  // managed executor rejects with a slippage error twice → slippage view + settings auto-open.
  it("[POO-499 R5] managed collect shows the slippage error view + opens settings after two failures", async () => {
    const managed = {
      strategyId: "pool-1",
      name: "ETH/USDC",
      initials: "E",
      poolLabel: "Base · 0.30%",
      availableUsd: 120,
      gasEstimateUsd: 0.4,
      note: "The manager pays gas.",
      onCollect: vi
        .fn()
        .mockRejectedValue(
          Object.assign(
            new Error(
              "execution reverted: slippage tolerance exceeded - minimum output amount not met",
            ),
            { code: "-32603" },
          ),
        ),
    };
    renderWithProviders(<CollectModal open onOpenChange={vi.fn()} managed={managed} />);
    await reachCollectReview();
    // First failure auto-retries (the executor is called twice), then the slippage view shows.
    expect(
      (await screen.findAllByText("Price moved too much", undefined, { timeout: 4000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(managed.onCollect).toHaveBeenCalledTimes(2);
    // The managed gear (Max slippage) auto-opened.
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
  });

  // POO-503 (POO-467 R2a/R3) reshaped by POO-802 R0: retryFrom("build") re-runs the REAL build then
  // the send. The step builder is resolved at run time with the CURRENT gear slippage, so the manual
  // "Try again" AFTER the user raises slippage in the auto-opened settings re-quotes at the NEW value.
  it("[POO-503] Try again after raising slippage re-quotes the split collect at the new value", async () => {
    const slippageErr = () =>
      Object.assign(
        new Error(
          "execution reverted: slippage tolerance exceeded - minimum output amount not met",
        ),
        { code: "-32603" },
      );
    // Send 1 (initial) + send 2 (auto-retry) fail with slippage → slippage view + settings auto-open;
    // send 3 (manual Try again after raising slippage) resolves.
    const confirmSlippages: number[] = [];
    let failures = 2;
    const buildCollectSteps = vi.fn((_pair: boolean, slippage: number): FlowStep<CollectCtx>[] => [
      {
        key: "build",
        run: async () => ({ built: { tx: {} } as CollectCtx["built"] }),
      },
      {
        key: "confirm:collect",
        run: async () => {
          confirmSlippages.push(slippage);
          if (failures > 0) {
            failures -= 1;
            throw slippageErr();
          }
          return {
            txHash: "0xabc0000000000000000000000000000000000000000000000000000000001234",
          };
        },
      },
    ]);
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );

    await reachCollectReview();
    // The auto-retry runs (send 2) and resolves to a second slippage failure → the slippage view +
    // the settings sheet auto-open.
    expect(
      (await screen.findAllByText("Price moved too much", undefined, { timeout: 4000 })).length,
    ).toBeGreaterThanOrEqual(1);
    // The first two sends used the investor default (2%).
    expect(confirmSlippages).toEqual([2, 2]);

    // The user raises the gear to 1% in the auto-opened settings, then taps Try again.
    fireEvent.click(screen.getByRole("button", { name: "1%" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      (await screen.findAllByText("Yield collected", undefined, { timeout: 2000 })).length,
    ).toBeGreaterThanOrEqual(1);
    // The re-quote (send 3) carried the RAISED slippage, proving the builder resolves live.
    expect(confirmSlippages).toEqual([2, 2, 1]);
  });

  it("[R3] runs the real handshake steps and shows the on-chain hash on success", async () => {
    const buildCollectSteps = vi.fn(() =>
      realCollectSteps({
        hash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
      }),
    );
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );

    // POO-615: the real steps resolve instantly (no mock beat), so the wallet-handoff window is
    // transient — assert the success outcome directly (the pending window is covered by the mock path).
    await reachCollectReview();
    expect(
      (await screen.findAllByText("Yield collected", undefined, { timeout: 2000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(buildCollectSteps).toHaveBeenCalled();
    // The real tx hash, not the mock settle hash.
    expect(screen.getByText("0xdead…abcd")).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_collect_completed" }),
    );
  });

  it("[R3] shows the error state when the real send rejects", async () => {
    const buildCollectSteps = vi.fn(() =>
      realCollectSteps({ confirmError: new Error("user rejected") }),
    );
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );

    await reachCollectReview();
    expect(
      (await screen.findAllByText("Something went wrong", undefined, { timeout: 2000 })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_collect_failed" }),
    );
  });

  it("surfaces the real send failure message instead of a silent dead-end", async () => {
    // Real-mode send that throws the backend reason (e.g. a reverted collect); this used to be
    // swallowed into a blank generic error, so the user saw "nothing happened".
    const buildCollectSteps = vi.fn(() =>
      realCollectSteps({
        confirmError: new TransactionError("execution reverted: nothing to collect"),
      }),
    );
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );

    await reachCollectReview();
    // The actual reason is now shown verbatim in the error-details box.
    expect(
      await screen.findByText("execution reverted: nothing to collect", undefined, {
        timeout: 2000,
      }),
    ).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_collect_failed" }),
    );
    // R2 — the raw error message must NEVER reach analytics.
    expect(JSON.stringify(window.dataLayer)).not.toContain("execution reverted");
  });

  // @rule POO-802 R0 — the REAL build's figures pause on the Review: gas from estimatedGasInUsd,
  // protocol from swapInfo, the min in the footer. Nothing mock renders in real mode.
  it("(POO-802 R0) real mode: the Review reads the REAL built figures, not the mock walk", async () => {
    const buildCollectSteps = vi.fn(() =>
      realCollectSteps({
        built: {
          tx: {},
          estimatedGasInUsd: 2.5,
          swapInfo: { priceImpactPercentage: 0.4, protocolFee: 0.49, minAmountInStable: 243.1 },
        } as CollectCtx["built"],
      }),
    );
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );
    await openCollectReview();
    // The footer minimum is the REAL built figure.
    expect(screen.getByText("≈ 243.1 USDC · Arrives instantly")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Protocol fee \$0\.49/ });
    expect(tip).toHaveAccessibleName(/Estimated gas \(network fee\) \$2\.50/);
    expect(tip).not.toHaveAccessibleName(/\$0\.30/);
    // POO-827 R4: the build carried no performanceFeeInUsd -> no line, never a fabricated $0.
    expect(tip).not.toHaveAccessibleName(/Performance fee/);
    // The real price impact (0.40%), not the mock 0.25%.
    expect(screen.getByText("0.40%")).toBeInTheDocument();
  });

  // @rule POO-827 R1/R2 — a real collect build carrying performanceFeeInUsd (POO-811) renders the
  // Performance line in the canonical breakdown, in order (after Protocol).
  it("(POO-827) real mode renders the Performance fee line from the built estimate", async () => {
    const buildCollectSteps = vi.fn(() =>
      realCollectSteps({
        built: {
          tx: {},
          estimatedGasInUsd: 2.5,
          performanceFeeInUsd: 1.2,
          swapInfo: { priceImpactPercentage: 0.4, protocolFee: 0.49, minAmountInStable: 243.1 },
        } as CollectCtx["built"],
      }),
    );
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );
    await openCollectReview();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Performance fee \$1\.20/ });
    // Canonical order (POO-800 R2): Network, then Protocol, then Performance.
    expect(tip).toHaveAccessibleName(
      /Estimated gas \(network fee\) \$2\.50 .* Protocol fee \$0\.49 .* Performance fee \$1\.20/,
    );
  });

  // @rule POO-802 R0 — a real build WITHOUT a gas estimate hides the network line rather than
  // fabricating the $0.30 mock default (POO-799 directive #1).
  it("(POO-802 R0) real mode never fabricates the gas line when the build omits it", async () => {
    const buildCollectSteps = vi.fn(() =>
      realCollectSteps({
        built: {
          tx: {},
          swapInfo: { priceImpactPercentage: 0.4, protocolFee: 0.49, minAmountInStable: 243.1 },
        } as CollectCtx["built"],
      }),
    );
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        strategy={strategy}
        position={position}
        buildCollectSteps={buildCollectSteps}
      />,
    );
    await openCollectReview();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Protocol fee \$0\.49/ });
    expect(tip).not.toHaveAccessibleName(/Estimated gas/);
    expect(screen.queryByText("$0.30")).not.toBeInTheDocument();
  });

  it("managed mode surfaces the real onCollect failure instead of a silent dead-end", async () => {
    // The manager-console collect path swallowed its error the same way the investor path used to
    // (follow-up to the investor fix): the real backend reason must reach the error-details box.
    const onCollect = vi
      .fn()
      .mockRejectedValue(new TransactionError("execution reverted: caller is not the manager"));
    renderWithProviders(
      <CollectModal
        open
        onOpenChange={vi.fn()}
        managed={{
          strategyId: "pool-1",
          name: "ETH/USDC",
          initials: "E",
          poolLabel: "Base · 0.30%",
          availableUsd: 120,
          gasEstimateUsd: 0.4,
          onCollect,
        }}
      />,
    );

    await reachCollectReview();
    expect(
      await screen.findByText("execution reverted: caller is not the manager", undefined, {
        timeout: 2000,
      }),
    ).toBeInTheDocument();
    // The manager console isn't in the investor analytics catalog, so the message can't leak there.
    expect(JSON.stringify(window.dataLayer)).not.toContain("execution reverted");
  });

  // POO-615: the build→review→sign handshake — the Review shows the BUILT figures (real-shaped
  // swapInfo) before signing. Helpers reach the Review (build ~350ms) and read its rows.

  /** Reach the Review WITHOUT approving: click the Collect CTA and wait for the countdown line. */
  async function openCollectReview() {
    fireEvent.click(screen.getByRole("button", { name: /^Collect \$/ }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
  }

  // @rule POO-613 R1 — the Review shows the built swap's price impact on the USDC-swap path, from the
  // mocked settleSwapInfo (0.25%).
  it("[POO-615] the Review shows the built price impact on the USDC-swap path", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await openCollectReview();
    expect(screen.getByText("Price impact")).toBeInTheDocument();
    // The mocked settleSwapInfo returns a fixed 0.25%.
    expect(screen.getByText("0.25%")).toBeInTheDocument();
  });

  // @rule POO-417 R4 — the token-pair payout performs no swap, so the Review shows NO price-impact row
  // (swapInfo is undefined on that path).
  it("[POO-615] the Review hides the price impact on the token-pair path", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={pairPosition} />,
    );
    // Pick the token pair before building.
    fireEvent.click(screen.getByRole("button", { name: "Transaction settings" }));
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await openCollectReview();
    expect(screen.queryByText("Price impact")).toBeNull();
  });

  // @rule POO-615 R4 — the Review carries the shared re-quote countdown ("Refreshes in 10s").
  it("[POO-615] the Review shows the re-quote countdown", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await openCollectReview();
    expect(screen.getByText("Refreshes in 10s")).toBeInTheDocument();
  });

  // @rule POO-615 (reshaped by POO-802 R6) — the Review's Est. fee row folds the BUILT swap's
  // protocol fee ($0.20 from the mock) into its canonical breakdown (behind Show more).
  it("[POO-615] the Review Fee row folds in the built swap protocol fee", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await openCollectReview();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    // The consolidated-fee tooltip trigger exposes the built protocol fee ($0.20) in its breakdown.
    const tip = screen.getByRole("button", { name: /Protocol fee \$0\.20/ });
    expect(tip).toHaveAccessibleName(/Estimated gas \(network fee\)/);
  });

  // @rule POO-615 R3 (reshaped by POO-802 R2) — the min received comes from the built swap's
  // minAmountInStable (250 × 0.98 − $0.20 protocol = 244.80), shown as the footer arrival line.
  it("[POO-615] the Review min received comes from the built swap minAmountInStable", async () => {
    renderWithProviders(
      <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    await openCollectReview();
    // settleSwapInfo(250, {slippagePct: 2}).minAmountInStable = 250 × 0.98 − 0.2 = 244.8.
    expect(screen.getByText("≈ 244.8 USDC · Arrives instantly")).toBeInTheDocument();
  });
});
