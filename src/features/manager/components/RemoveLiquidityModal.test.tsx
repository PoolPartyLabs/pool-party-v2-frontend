/**
 * @id PP-MGR-MOD-003 (POO-312)
 * @name RemoveLiquidityModal.test
 * @implements-rules-version v8 (POO-804 rules v1) · v1 (POO-842 rules v1)
 *
 * Behavior: a >50% selection shows the close alert + a destructive "Close strategy" button; mock
 * mode closes via managerService.closeStrategy; real mode runs useManagerRemoveLiquidity with the
 * percentage + stake + collect flag. POO-517: EVERY path passes a Review before signing (the
 * partial gets the Withdraw-style review + a receipt with the mined tx; a form-promoted close
 * passes the SAME close Review), and the outcome is applied upstream on Done/dismiss.
 *
 * POO-596 (rules v1): the build->review->sign handshake. The Review now renders the BUILT figures
 * after an async `building` step (the form CTA / closeMode-open kick it off), so the navigation tests
 * await the Review; a fake-timer rebuild test asserts the 10s re-quote, and a real-gas test asserts
 * the built `estimatedGasInUsd` drives the Est. fee network line.
 *
 * POO-804 (rules v1): the manager remove family is TOKEN-PAIR ONLY (R1: no USDC receive-as, gear
 * locked, per-token breakdowns render by default — which also fixes the R5 small-balance drop); a
 * form-promoted close raises a Continue / Keep-the-strategy confirmation before building (R3); the
 * close alert carries the expanded copy + the investors note (R2); presets follow the $/% unit in
 * value AND label (R4); the amount input caps decimals (6 in $, 1 in %) and clamps at the max (R7);
 * the console gas note left the form (R6).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import type { RemoveLiquidityTarget } from "./RemoveLiquidityModal";

const mocks = vi.hoisted(() => ({
  mockMode: true,
  closeStrategy: vi.fn(async () => undefined),
  buildSteps: vi.fn(),
}));

// POO-1044 [R3]: the provisioning panel's buy-crypto escape renders the locale-aware Link, which
// resolves Next's app-router navigation. It does not exist under jsdom, so it is stood in for, as
// in every other suite that mounts a navigating component.
vi.mock("@/i18n/navigation", () => ({
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

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.mockMode;
  },
  managerService: { closeStrategy: mocks.closeStrategy },
  // The slippage error view (POO-499) renders TransactionErrorActions → useTxDiagnostics, which
  // reads accountService.getWalletKind(); stub it so the error view mounts in mock mode.
  accountService: { getWalletKind: vi.fn(async () => "embedded") },
}));
vi.mock("../hooks/useManagerRemoveLiquidity", () => ({
  useManagerRemoveLiquidity: () => ({ buildSteps: mocks.buildSteps, execute: vi.fn() }),
}));

import { RemoveLiquidityModal } from "./RemoveLiquidityModal";

const target: RemoveLiquidityTarget = {
  strategyId: "0xpos",
  network: "arbitrum",
  stakeUsd: 1000,
  feesUsd: 12.34,
  gasCostUsd: 0.5,
};

/** POO-596: the Review re-quote window (mirrors the component's REVIEW_REFRESH_SECS). */
const REVIEW_REFRESH_SECS = 10;

/** Real per-token fee breakdown (mirrors mapPosition's fees0/fees1 → claimableFeeTokens). */
const FEE_TOKENS = [
  { symbol: "ETH", amount: 0.05 },
  { symbol: "USDC", amount: 140.4 },
];

/**
 * POO-502 (POO-483 v2 R2): the position's raw reserve block for the client-side value split. An
 * ETH/USDC pool at ~$3,000/ETH whose pool value reconciles to `poolValueUsd` (0.2 WETH ≈ $600 + 400
 * USDC = $1,000), a deliberately NON-even ~60/40 value split. `poolValueUsd` (= detail.aum) is the
 * split anchor; on a $1,000 stake at f = 1 the liquidity leg is the full reserves (0.2 ETH / 400 USDC,
 * $600.01 / $399.99) and the per-token fee USD derives from the same anchor + reserves (0.05 ETH ≈
 * $150.00, 140.4 USDC ≈ $140.40).
 */
const RESERVES = {
  totalSupply0: "200000000000000000",
  totalSupply1: "400000000",
  tickCurrent: -196_256,
  decimals0: 18,
  decimals1: 6,
} as const;

function renderModal(initialPercentage?: number, closeMode?: boolean) {
  const onOpenChange = vi.fn();
  const onRemoved = vi.fn();
  renderWithProviders(
    <RemoveLiquidityModal
      open
      onOpenChange={onOpenChange}
      target={target}
      onRemoved={onRemoved}
      initialPercentage={initialPercentage}
      closeMode={closeMode}
    />,
  );
  return { onOpenChange, onRemoved };
}

describe("RemoveLiquidityModal", () => {
  beforeEach(() => {
    mocks.mockMode = true;
    mocks.closeStrategy.mockClear();
    // A resolving 2-step sequence (build → send) for the real-mode runner path.
    mocks.buildSteps.mockReset().mockReturnValue([
      { key: "build", run: async () => ({}) },
      { key: "confirm:removeLiquidity", run: async () => ({ txHash: "0xhash" }) },
    ]);
  });

  // @rule POO-807 R1: the visible MOCK indicator renders on the modal in mock mode (the shared
  // header/status mount it; real-mode absence is guarded in the MockBadge + host tests).
  it("[POO-807] shows the MOCK badge in mock mode", () => {
    renderModal();
    expect(screen.getAllByTestId("mock-badge")).toHaveLength(1);
  });

  it("shows the close alert + a Close button once removal exceeds 50%", async () => {
    const user = userEvent.setup();
    renderModal();
    // Default 25% → partial (Withdraw button, no alert).
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.queryByText(/closes this strategy/)).not.toBeInTheDocument();

    // POO-804 R4: the presets follow the $ unit (default mode), so 75% reads $750.00.
    await user.click(screen.getByRole("button", { name: "$750.00" }));
    expect(screen.getByText(/closes this strategy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close strategy" })).toBeInTheDocument();
  });

  // @rule POO-804 R2: the close alert carries the EXPANDED copy (close + withdraw-all + collect
  // fees in one sentence) plus the note that all investors' liquidity is removed and becomes
  // available to withdraw at any time.
  it("[POO-804 R2] the close alert shows the expanded copy + the investors note", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "$750.00" }));
    expect(
      screen.getByText(
        "Withdrawing more than 50% closes this strategy and withdraws all your liquidity and collects accrued fees.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "All investors' liquidity is removed and becomes available to withdraw at any time.",
      ),
    ).toBeInTheDocument();
  });

  // @rule POO-804 R2: the DUST promotion keeps its own first line + the fees note, and gains the
  // same investors note.
  it("[POO-804 R2] the dust alert keeps the fees note and gains the investors note", () => {
    renderWithProviders(
      <RemoveLiquidityModal
        open
        onOpenChange={vi.fn()}
        // A $9 stake at 50% leaves $4.50 → dust promotion.
        target={{ ...target, stakeUsd: 9 }}
        onRemoved={vi.fn()}
        initialPercentage={50}
      />,
    );
    expect(screen.getByText(/less than \$5/)).toBeInTheDocument();
    expect(
      screen.getByText("Withdraws all your liquidity and collects accrued fees."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "All investors' liquidity is removed and becomes available to withdraw at any time.",
      ),
    ).toBeInTheDocument();
  });

  // @rule POO-804 R6: the console gas note left the Remove form (the key stays for the other
  // manager surfaces; only this modal's render is gone).
  it("[POO-804 R6] the form no longer shows the gas note", () => {
    renderModal();
    expect(screen.queryByText(/You pay the network gas for these actions/)).toBeNull();
  });

  // @rule POO-547 R1/R2: the manager Remove/Close custom slippage no longer caps at 5%; a >5% value
  // (e.g. 12.5%) is accepted and surfaces the High-slippage warning, and the form CTA stays enabled.
  it("[POO-547 R1/R2] accepts a >5% custom slippage and warns without blocking the CTA", async () => {
    const user = userEvent.setup();
    renderModal();
    // POO-570 R1: the ⚙ gear lives on the amount/form step now — open it directly on the form.
    await user.click(screen.getByRole("button", { name: "Transaction settings" }));
    const custom = await screen.findByLabelText("Custom");
    await user.clear(custom);
    await user.type(custom, "12.5");
    expect(custom).toHaveValue("12.5");
    expect(screen.getByText("High slippage")).toBeInTheDocument();
    // Close the gear (its modal overlay hides the CTA from the a11y tree); warn-only means the form
    // CTA stays enabled once the sheet is dismissed.
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled();
  });

  it("mock mode: a >50% close runs managerService.closeStrategy and reports closed", async () => {
    const user = userEvent.setup();
    const { onRemoved } = renderModal();
    await user.click(screen.getByRole("button", { name: "$750.00" }));
    // POO-517 R2 + POO-596 + POO-804 R3: the form CTA raises the close confirmation; Continue
    // builds → close Review; its CTA (after the async build) signs.
    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Close strategy" }));
    // The multistep wallet-signing modal shows while the mock steps run.
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
    await waitFor(() => expect(mocks.closeStrategy).toHaveBeenCalledWith("0xpos"));
    // POO-517 R1: the flow parks on the Strategy-closed receipt; Done applies the close upstream.
    expect(await screen.findByText(/on the way/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onRemoved).toHaveBeenCalledWith(true);
  });

  it("real mode: builds the steps with the percentage + stake + collect flag and reports closed", async () => {
    mocks.mockMode = false;
    const user = userEvent.setup();
    const { onRemoved } = renderModal();
    await user.click(screen.getByRole("button", { name: "$750.00" }));
    // POO-517 R2 + POO-804 R3: form CTA → confirmation → close Review → its CTA starts the signing.
    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Close strategy" }));
    expect(mocks.buildSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "arbitrum",
        positionId: "0xpos",
        percentage: 75,
        stakeUsd: 1000,
        // POO-804 R1: the manager remove family is token-pair only.
        collectAsUsdc: false,
        // POO-463 R4: the gear slippage reaches the real close tx (manager default 5%).
        slippageTolerance: 5,
      }),
    );
    // POO-517 R1: the receipt parks; Done applies the close upstream.
    expect(await screen.findByText(/on the way/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onRemoved).toHaveBeenCalledWith(true);
  });

  // POO-509 hardened by POO-804 R1: EVERY manager remove builds with the token pair
  // (collectAsUsdc: false) — the receive-as choice is gone from the whole family.
  it("forces the token pair on a full close, never USDC (POO-509 / POO-804 R1)", async () => {
    mocks.mockMode = false;
    const user = userEvent.setup();
    renderModal(100);
    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    // POO-804 R3: the typed/seeded ≥50% path confirms before building.
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(mocks.buildSteps).toHaveBeenCalledWith(
      expect.objectContaining({ percentage: 100, collectAsUsdc: false }),
    );
  });

  // POO-804 R1 (was POO-509 close-only): the ⚙ gear shows receive-as as a FIXED token-pair display
  // on the close — no USDC option, no interactive choice.
  it("close: the settings gear shows a locked token-pair receive-as, no USDC (POO-804 R1)", async () => {
    const user = userEvent.setup();
    renderModal(100, true);
    // POO-596: the gear lives on the Review, reached after the async build.
    await user.click(await screen.findByRole("button", { name: "Transaction settings" }));
    // POO-525 R2 fixed display: a non-interactive chip, not a button group.
    expect((await screen.findAllByText("Token pair")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Token pair" })).toBeNull();
    expect(screen.queryByRole("button", { name: "USDC" })).toBeNull();
  });

  // POO-804 R1: the PARTIAL remove is token-pair locked too (reverses the POO-509 partial-USDC
  // carve-out) — the gear shows the same fixed display on the form.
  it("partial remove: the gear shows a locked token-pair receive-as, no USDC (POO-804 R1)", async () => {
    const user = userEvent.setup();
    renderModal(25);
    await user.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect((await screen.findAllByText("Token pair")).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Token pair" })).toBeNull();
    expect(screen.queryByRole("button", { name: "USDC" })).toBeNull();
  });

  it("shows the USD value the selected percentage removes", async () => {
    const user = userEvent.setup();
    renderModal();
    // Default 25% of a $1,000 stake → partial.
    expect(screen.getByText("You'll withdraw")).toBeInTheDocument();
    expect(screen.getByText("≈ $250.00")).toBeInTheDocument();
    // 50% is still a partial (only > 50% promotes to a full close). POO-804 R4: $-mode label.
    await user.click(screen.getByRole("button", { name: "$500.00" }));
    expect(screen.getByText("≈ $500.00")).toBeInTheDocument();
  });

  it("always shows the pool contents split — liquidity and fees (POO-324)", () => {
    renderModal();
    expect(screen.getByText("Strategy balance")).toBeInTheDocument();
    expect(screen.getByText("Liquidity")).toBeInTheDocument();
    // POO-804 R4: the $-mode "$1,000.00" PRESET also matches by text — scope to the figure span.
    expect(screen.getByText("$1,000.00", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Fees")).toBeInTheDocument();
    expect(screen.getByText("$12.34")).toBeInTheDocument();
  });

  it("opens in the close state when launched at 100% (e.g. from Close strategy)", () => {
    renderModal(100);
    expect(screen.getByText(/closes this strategy/)).toBeInTheDocument();
    expect(screen.getByText(/collects accrued fees/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close strategy" })).toBeInTheDocument();
    expect(screen.getByText("≈ $1,000.00")).toBeInTheDocument();
  });

  // POO-388 R2: the Close-strategy entry skips the amount form and opens straight into the
  // Review → Pending → Confirmed sequence at 100%. POO-504 R5: the review keeps only the hero
  // minimum ("You'll receive at least"); the Remaining invested / Amount / Total received (min)
  // rows are gone.
  it("close mode opens directly in the Review (no amount form) with a minimal row set (R2)", async () => {
    renderModal(100, true);
    // POO-596: the Review renders after the async build. The amount picker stays gone (no form step).
    expect(await screen.findByText("Amount requested")).toBeInTheDocument();
    expect(screen.queryByLabelText("Amount to withdraw")).toBeNull();
    expect(screen.getAllByText("$1,000.00").length).toBeGreaterThan(0);
    // POO-803 R5: the You'll-receive row left the card; the summary carries the figures.
    expect(screen.getByText("Amount requested")).toBeInTheDocument();
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
    expect(screen.queryByText("You'll receive at least")).toBeNull();
    // POO-504 R5: the redundant rows are removed from the close review.
    expect(screen.queryByText("Remaining invested")).toBeNull();
    expect(screen.queryByText("Total received (min)")).toBeNull();
    expect(screen.getByRole("button", { name: "Close strategy" })).toBeInTheDocument();
  });

  // @rule R2: the close also collects accrued pool fees, so the Review "you receive at least" is
  // principal + accrued fees − costs. POO-515 R2: the close payout is the TOKEN PAIR (forced,
  // POO-509) — no stable swap — so the Max slippage component (and any DEX fee) drops out of the
  // fee estimate; only the network gas remains:
  // 1000 + 12.34 − 0.50 gas = 1011.84.
  it("close review adds accrued fees to the minimum received (R2, POO-515 R2)", async () => {
    renderModal(100, true);
    // Costs row: gas only ($0.50) — no slippage component on the pair payout (Review after the build).
    expect(await screen.findByText("$0.50")).toBeInTheDocument();
    expect(screen.queryByText("$50.50")).toBeNull();
    // Minimum received (hero, POO-504 R5: the only expression of the minimum) includes accrued fees.
    // POO-803 R8: the close is pair-forced (POO-509) — no USDC minimum is fabricated, so no
    // arrival line renders; the accrued fees stay visible on their own row.
    expect(screen.queryByText(/≈ /)).toBeNull();
  });

  it("close mode: confirming closes the strategy, shows Strategy closed, and Done reports closed (R2)", async () => {
    const user = userEvent.setup();
    const { onRemoved, onOpenChange } = renderModal(100, true);
    // POO-596: closeMode builds first; the Review "Close strategy" CTA appears after the async build.
    await user.click(await screen.findByRole("button", { name: "Close strategy" }));
    // Multistep wallet handoff while the mock close runs.
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();
    await waitFor(() => expect(mocks.closeStrategy).toHaveBeenCalledWith("0xpos"));
    // The Confirmed screen (unique body copy), not an immediate close.
    expect(await screen.findByText(/on the way/)).toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
    // Done applies the close to the dashboard and dismisses the dialog.
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onRemoved).toHaveBeenCalledWith(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // @rule POO-514 R1/R3 — the close Confirmed receipt shows the MINED flow.txHash (truncated) and
  // the shared explorer link on the position's network; the hash was previously dropped entirely.
  it("[POO-514 R3] real close receipt shows the mined hash + the explorer link", async () => {
    mocks.mockMode = false;
    mocks.buildSteps.mockReturnValue([
      { key: "build", run: async () => ({}) },
      {
        key: "confirm:closePosition",
        run: async () => ({
          txHash: "0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
        }),
      },
    ]);
    const user = userEvent.setup();
    renderModal(100, true);
    await user.click(await screen.findByRole("button", { name: "Close strategy" }));
    expect(await screen.findByText(/on the way/)).toBeInTheDocument();
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText("0xdead…abcd")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://arbiscan.io/tx/0xdeadbeef0000000000000000000000000000000000000000000000000000abcd",
    );
  });

  // @rule POO-514 R3 — mock mode keeps the mock settle hash and still renders the row + link.
  it("[POO-514 R3] mock close receipt keeps the settle hash + the explorer link", async () => {
    const user = userEvent.setup();
    renderModal(100, true);
    await user.click(await screen.findByRole("button", { name: "Close strategy" }));
    expect(await screen.findByText(/on the way/)).toBeInTheDocument();
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText("0xMOCK…MOCK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://arbiscan.io/tx/0xMOCK00000000000000000000000000000000MOCK",
    );
  });

  // POO-499 R3: two slippage failures (gear slippage <= 0.1%) show the slippage error view and
  // re-open the settings gear; the mock close is never reached (the confirm throws first).
  it("[POO-499 R3] two slippage failures show the slippage error view and re-open settings", async () => {
    const user = userEvent.setup();
    renderModal(100, true);
    // POO-596: the gear is on the Review (reached after the async build). Set a demo-failing 0.05%
    // slippage through it, then close it.
    await user.click(await screen.findByRole("button", { name: "Transaction settings" }));
    const custom = await screen.findByLabelText("Custom");
    await user.clear(custom);
    await user.type(custom, "0.05");
    await user.click(screen.getByRole("button", { name: "Done" }));

    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    // Two 0.35s mock beats per attempt (first + auto-retry), so allow ~4s.
    await waitFor(
      () => expect(screen.getAllByText("Price moved too much").length).toBeGreaterThanOrEqual(1),
      { timeout: 4000 },
    );
    expect(screen.getByText(/moved beyond your max slippage.*again/i)).toBeInTheDocument();
    // The settings sheet auto-opened again.
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    // The mock service close is never reached (the confirm throws before it).
    expect(mocks.closeStrategy).not.toHaveBeenCalled();
  });

  // POO-424: the close Review gains the investor-Withdraw settings surface — a ⚙ gear (R3) hosting
  // slippage/deadline/receive-as, a consolidated "Fee" row with a slippage+network tooltip (R5),
  // a lock-up-aware arrival footer (R6) and a display-only receive-as row (R4). The mocked managed
  // remove hook + service keep the close flow side-effect free, so these assert pure UI behavior.

  // @rule R3 (POO-424): the Settings gear opens the shared TransactionSettingsDialog.
  it("close review: the settings gear opens the transaction settings dialog (R3)", async () => {
    const user = userEvent.setup();
    renderModal(100, true);
    // The settings sheet is closed initially — its slippage/deadline sections aren't mounted.
    expect(screen.queryByText("Max slippage")).toBeNull();
    expect(screen.queryByText("Transaction deadline")).toBeNull();
    // POO-596: the gear next to the Dialog X (on the Review, reached after the async build) carries
    // the shared settings title as its accessible name.
    await user.click(await screen.findByRole("button", { name: "Transaction settings" }));
    expect(await screen.findByText("Max slippage")).toBeInTheDocument();
    expect(screen.getByText("Transaction deadline")).toBeInTheDocument();
  });

  // @rule R5 (POO-424) reshaped by POO-515 R2: the close payout is the token pair (forced,
  // POO-509), so there is NO stable swap — the consolidated "Est. fee" row shows the network gas
  // only (no Max slippage component), the caption drops the slippage qualifier, and changing the
  // gear slippage does NOT move the fee estimate.
  it("close review: the pair payout drops slippage from the fee estimate (POO-515 R2)", async () => {
    const user = userEvent.setup();
    renderModal(100, true);
    // POO-596: the consolidated row label (POO-504 R2: "Est. fee") + its gas-only tooltip render on
    // the Review, reached after the async build.
    await user.click(await screen.findByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Est. fee")).toBeInTheDocument();
    const tip = screen.getByRole("button", { name: /Estimated gas/ });
    expect(tip).not.toHaveAccessibleName(/Max slippage/);
    // Gas only ($0.50), regardless of the 5% manager default slippage.
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    // POO-923 R3: the pair payout swaps nothing → the "after fees" caption is dropped entirely.
    expect(screen.queryByText(/after fees/)).not.toBeInTheDocument();
    // Bump slippage to 1% via the gear → the fee estimate stays gas-only ($0.50).
    await user.click(screen.getByRole("button", { name: "Transaction settings" }));
    await user.click(await screen.findByRole("button", { name: "1%" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    expect(screen.queryByText("$10.50")).toBeNull();
  });

  // @rule R2 (POO-515, B1 reconcile with #354's partial fee row) + POO-804 R1: the PARTIAL remove
  // is a pair payout ALWAYS now, so it skips the stable swap — the consolidated Fee row drops the
  // Max slippage line and the caption drops the slippage qualifier, with no gear interaction.
  it("partial review: the pair payout drops slippage from the fee estimate (POO-515 R2)", async () => {
    const user = userEvent.setup();
    renderWithReserves();
    await advanceToReview(user);
    // POO-803 R7: the fee detail folds behind Show more; the gas-only tooltip has no slippage line.
    await user.click(await screen.findByRole("button", { name: "Show more" }));
    const tip = screen.getByRole("button", { name: /Estimated gas/ });
    expect(tip).not.toHaveAccessibleName(/Max slippage/);
    // POO-923 R3: the pair payout swaps nothing → the "after fees" caption is dropped entirely
    // (the Max. slippage ROW behind Show more may still render).
    expect(screen.queryByText(/after fees/)).not.toBeInTheDocument();
  });

  // @rule R7 (POO-445) superseded by POO-803 R8: the close is pair-forced (POO-509), so NO USDC
  // arrival line is fabricated; a locked target still shows the lock-up term (next test).
  it("close review: no caption or arrival line on the pair-forced close (POO-803 R8, POO-923 R3)", async () => {
    renderModal(100, true);
    // Anchor on the review card; the "after fees" caption it used to carry is dropped (POO-923 R3).
    expect(await screen.findByText("Amount requested")).toBeInTheDocument();
    expect(screen.queryByText(/after fees/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Arrives/)).toBeNull();
    expect(screen.queryByText(/per strategy lock-up/)).toBeNull();
  });

  it("close review: the arrival footer shows the lock-up term when locked (R6)", async () => {
    const onOpenChange = vi.fn();
    const onRemoved = vi.fn();
    renderWithProviders(
      <RemoveLiquidityModal
        open
        onOpenChange={onOpenChange}
        target={{ ...target, lockupDays: 7 }}
        onRemoved={onRemoved}
        initialPercentage={100}
        closeMode
      />,
    );
    // lockupDays > 0 → the locked branch (Review after the build): day count + the lock-up qualifier.
    expect(await screen.findByText(/Arrives in 7 days/)).toBeInTheDocument();
    expect(screen.getByText(/per strategy lock-up/)).toBeInTheDocument();
  });

  // @rule R4 (POO-424): the close Review carries a display-only "Receive as" row reflecting the
  // current choice (the editable control moved into the gear). POO-509: a close always shows the
  // token pair (USDC is disabled on the close-pool path), so the row reads "Token pair".
  it("close review: the receive-as row shows the token pair, not USDC (POO-509)", async () => {
    renderModal(100, true);
    // POO-596: the Review (with the receive-as row) renders after the async build. "Receive as" also
    // heads the gear's section, but the gear is closed here, so assert ≥1 to be robust.
    expect(await screen.findByText("Token pair")).toBeInTheDocument();
    expect(screen.getAllByText("Receive as").length).toBeGreaterThanOrEqual(1);
  });

  // POO-324 item 2 / POO-417 R1, reshaped by POO-804 R1: the manager receives the token pair
  // ALWAYS, so the "In the pool" fees line splits into per-token rows (the real fees0/fees1
  // breakdown) by DEFAULT — no gear interaction; absent per-token data keeps the USD figure.
  function renderWithFeeTokens(over: Partial<RemoveLiquidityTarget> = {}) {
    const onRemoved = vi.fn();
    renderWithProviders(
      <RemoveLiquidityModal
        open
        onOpenChange={vi.fn()}
        target={{ ...target, feeTokens: FEE_TOKENS, ...over }}
        onRemoved={onRemoved}
      />,
    );
  }

  it("[POO-804 R1] fees split per token by default — no USDC figure, no gear needed", () => {
    renderWithFeeTokens();
    const rows = screen.getByTestId("remove-fee-tokens");
    expect(rows).toHaveTextContent("ETH");
    expect(rows).toHaveTextContent("0.05");
    expect(rows).toHaveTextContent("USDC");
    // The single USD fees figure is replaced by the per-token rows.
    expect(screen.queryByText("$12.34")).not.toBeInTheDocument();
    // POO-482 R2: the rows carry the real token logos (majors resolve with no network needed).
    const logos = rows.querySelectorAll("img");
    expect(logos).toHaveLength(2);
    expect(logos[0]).toHaveAttribute("src", "/tokens/eth.png");
  });

  it("[POO-324] no per-token data (real mode, pre-POO-325): fees stay USD-only", () => {
    renderWithFeeTokens({ feeTokens: undefined });
    expect(screen.getByText("$12.34")).toBeInTheDocument();
    expect(screen.queryByTestId("remove-fee-tokens")).not.toBeInTheDocument();
  });

  // POO-502 (POO-483 v2 R2/R4 + expansions): with receive-as = the token pair AND the raw reserve
  // block present, the manager Remove/Close gains three per-token estimates from the client-side
  // split: the Liquidity leg rows (R2), estimated USD on the fee rows (Expansion 2), and the close
  // Review "You receive (min)" per-token breakdown (Expansion 1). Absent block / USDC degrade honestly.
  function renderWithReserves(over: Partial<RemoveLiquidityTarget> = {}, closeMode = false) {
    const onRemoved = vi.fn();
    renderWithProviders(
      <RemoveLiquidityModal
        open
        onOpenChange={vi.fn()}
        target={{
          ...target,
          feeTokens: FEE_TOKENS,
          reserves: { token0: "ETH", token1: "USDC", ...RESERVES },
          poolValueUsd: 1000,
          ...over,
        }}
        onRemoved={onRemoved}
        initialPercentage={closeMode ? 100 : undefined}
        closeMode={closeMode}
      />,
    );
    return { onRemoved };
  }

  /** Advance the partial form into the Review (POO-596: the CTA builds, then the Review renders).
   * POO-804 R1: the pair is the only receive-as — no gear interaction needed anymore. */
  async function advanceToReview(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Withdraw" })); // form → building
    await screen.findByText("Amount requested"); // POO-596: building → review
  }

  // @rule R2 (POO-502) + POO-804 R1: the Liquidity leg renders one TokenAmountRow per token — amount
  // + de-emphasized USD + logo — from the reserve split, BY DEFAULT (the pair is the only payout).
  // Full stake at f = 1 → 0.2 ETH ($600.01) / 400 USDC ($399.99).
  it("[POO-502 R2] reserves present: the Liquidity leg renders per-token rows with amount + USD + logo", () => {
    renderWithReserves();

    const rows = screen.getByTestId("remove-liquidity-tokens");
    expect(rows).toHaveTextContent("ETH");
    expect(rows).toHaveTextContent("0.2");
    expect(rows).toHaveTextContent("USDC");
    expect(rows).toHaveTextContent("400");
    // De-emphasized USD per row (parenthesized), summing back to the stake.
    expect(rows).toHaveTextContent("$600.01");
    expect(rows).toHaveTextContent("$399.99");
    // The single liquidity USD figure is replaced by the per-token rows (the $-mode "$1,000.00"
    // PRESET button still matches by text — scope to the figure span).
    expect(screen.queryByText("$1,000.00", { selector: "span" })).not.toBeInTheDocument();
    // Real token logos on each row (majors resolve without a network).
    const logos = rows.querySelectorAll("img");
    expect(logos).toHaveLength(2);
    expect(logos[0]).toHaveAttribute("src", "/tokens/eth.png");
  });

  // @rule Expansion 2 (POO-502): the per-token FEE rows gain client-estimated USD from the split price.
  // 0.05 ETH ≈ $150.00, 140.4 USDC ≈ $140.40 (derived from the anchor + reserves, not a fixed table).
  it("[POO-502 Expansion 2] reserves present: fee rows carry client-estimated USD", () => {
    renderWithReserves();

    const feeRows = screen.getByTestId("remove-fee-tokens");
    expect(feeRows).toHaveTextContent("0.05");
    expect(feeRows).toHaveTextContent("$150.00");
    expect(feeRows).toHaveTextContent("140.4");
    expect(feeRows).toHaveTextContent("$140.40");
  });

  // @rule Expansion 1 / R7 (POO-502): the close Review "You receive (min)" ALSO breaks into per-token
  // rows — by default now (POO-804 R1). POO-515 R2: the pair payout drops the slippage cost, so
  // totalReceivedMin = 1000 + 12.34 − 0.50 = 1011.84, which the split CLAMPS at the $1,000 anchor
  // (POO-483 v2 R6) → the full reserves: 0.2 ETH ($600.01) / 400 USDC ($399.99).
  it("[POO-502 Expansion 1] close review: 'You receive (min)' breaks into per-token rows", async () => {
    renderWithReserves({}, true);
    // POO-803 R5/R6: the You-receive split left the card — the pair breakdown lives on the
    // Amount-requested + Fees-available rows (with logos + estimated USD).
    const rows = await screen.findByTestId("withdraw-amount-tokens");
    expect(rows).toHaveTextContent("ETH");
    expect(rows).toHaveTextContent("USDC");
    expect(rows.textContent).toMatch(/\(\$/);
    expect(screen.getByTestId("withdraw-fees-tokens")).toBeInTheDocument();
    expect(screen.queryByText("≈ 1,011.84 USDC")).not.toBeInTheDocument();
  });

  // @rule R4 (POO-502): NO raw block → the Liquidity leg keeps the single USD figure (the POO-324
  // degrade template), never fabricated rows; the fee rows stay amounts-only.
  it("[POO-502 R4] without reserves: the Liquidity leg stays the single USD figure", () => {
    renderWithReserves({ reserves: undefined, poolValueUsd: undefined });
    // Liquidity leg unchanged: single USD figure (scoped past the $-mode preset), no per-token rows.
    expect(screen.getByText("$1,000.00", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByTestId("remove-liquidity-tokens")).not.toBeInTheDocument();
    // Fee rows still render (POO-324) but amounts-only — no estimated USD without the split.
    const feeRows = screen.getByTestId("remove-fee-tokens");
    expect(feeRows).toHaveTextContent("0.05");
    expect(feeRows).not.toHaveTextContent("$150.00");
  });

  // @rule POO-804 R5 (regression, was the POO-509 USDC default dropping the split): a SMALL balance
  // partial that does NOT promote to a close ($10 stake, 25% → leftover $7.50 > $5) keeps the
  // per-token breakdown of BOTH Liquidity and Fees — on the form AND on the Review.
  it("[POO-804 R5] $10 stake at 25%: the form and Review keep both per-token breakdowns", async () => {
    const user = userEvent.setup();
    renderWithReserves({ stakeUsd: 10, poolValueUsd: 10 });
    // Not closing: no alert, the partial Withdraw CTA stands.
    expect(screen.queryByText(/closes this strategy/)).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    // Form: both splits render with logos.
    expect(screen.getByTestId("remove-liquidity-tokens")).toBeInTheDocument();
    const feeRows = screen.getByTestId("remove-fee-tokens");
    expect(feeRows.querySelectorAll("img").length).toBe(2);
    // Review: the shared card renders both per-token rows too.
    await advanceToReview(user);
    expect(screen.getByTestId("withdraw-amount-tokens")).toBeInTheDocument();
    expect(screen.getByTestId("withdraw-fees-tokens")).toBeInTheDocument();
  });

  // POO-517: the PARTIAL remove path gains the Withdraw-style Review before signing (R1) and a
  // success receipt with the mined tx (R1); a form-promoted close (typed > 50% or dust) routes
  // through the SAME close Review — no path goes form → signing directly (R2).

  // @rule R1 (POO-517): the partial Review — amount summary, "You'll receive at least" off the gear
  // slippage, ONE consolidated Fee row (buildFeeRow, slippage + network tooltip), a display-only
  // Receive-as row, and the lock-up-aware arrival footer (instant here — no lock-up on the target).
  it("[POO-517 R1] partial remove: the form CTA opens a Review, not the wallet handoff", async () => {
    const user = userEvent.setup();
    renderModal(); // default 25% of $1,000 → partial
    await user.click(screen.getByRole("button", { name: "Withdraw" })); // form → building

    // During the build the signing flow has NOT started; the Review renders once it settles (POO-596).
    expect(screen.queryByText("Continue in your wallet")).toBeNull();
    expect(await screen.findByText("Amount requested")).toBeInTheDocument();
    expect(screen.getByText("$250.00")).toBeInTheDocument();
    // POO-803 R5: the You'll-receive row left the card; the summary carries the figures.
    expect(screen.getByText("Amount requested")).toBeInTheDocument();
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
    expect(screen.queryByText("You'll receive at least")).toBeNull();
    // POO-804 R1 (POO-803 R8): the pair payout never fabricates a USDC arrival figure — no line.
    expect(screen.queryByText(/Arrives/)).toBeNull();
    // POO-804 R1 (POO-515 R2): the pair payout skips the stable swap — the canonical Est. fee is
    // gas-only ($0.50, no protocol fee), the Max. slippage row keeps its Auto badge on the 5% seed.
    await user.click(await screen.findByRole("button", { name: "Show more" }));
    expect(screen.getByText("Est. fee")).toBeInTheDocument();
    expect(screen.getByText("$0.50")).toBeInTheDocument();
    const tip = screen.getByRole("button", { name: /Estimated gas \(network fee\) \$0\.50/ });
    expect(tip).not.toHaveAccessibleName(/Protocol fee/);
    expect(tip).not.toHaveAccessibleName(/Max slippage/);
    expect(screen.getByText("Max. slippage")).toBeInTheDocument();
    expect(screen.getByText("Auto")).toBeInTheDocument();
    // POO-612 R1 inverted by R1: no stable swap → no price-impact row.
    expect(screen.queryByText("Price impact")).toBeNull();
    // Display-only receive-as: locked to the token pair (POO-804 R1).
    expect(screen.getAllByText("Receive as").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Token pair")).toBeInTheDocument();
  });

  // @rule R1 (POO-517): the partial review keeps the lock-up branch for when the data lands.
  it("[POO-517 R1] partial review: the arrival footer shows the lock-up term when locked", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RemoveLiquidityModal
        open
        onOpenChange={vi.fn()}
        target={{ ...target, lockupDays: 7 }}
        onRemoved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Withdraw" })); // form → building
    expect(await screen.findByText(/Arrives in 7 days/)).toBeInTheDocument();
    expect(screen.getByText(/per strategy lock-up/)).toBeInTheDocument();
  });

  // @rule R1 (POO-517): the partial success RECEIPT — amount received + the mined tx hash with an
  // explorer link (inline getExplorerTxUrl, POO-505 precedent) — and Done reports the reduced stake
  // (false + newStakeUsd) instead of the old silent close.
  it("[POO-517 R1] partial receipt: amount received + mined tx + explorer link; Done reports the reduced stake", async () => {
    const user = userEvent.setup();
    const { onRemoved, onOpenChange } = renderModal();
    await user.click(screen.getByRole("button", { name: "Withdraw" })); // form → building
    await user.click(await screen.findByRole("button", { name: "Withdraw" })); // review → signing
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();

    // The receipt parks — no silent dismissal. (The title renders visibly + as the sr-only
    // DialogTitle, so assert on all matches.)
    expect((await screen.findAllByText("Withdrawal successful")).length).toBeGreaterThanOrEqual(1);
    // POO-803 R9/R11: the unified receipt labels. POO-804: the pair payout skips the swap (no 5%
    // slippage haircut) and the total matches the card's own rows: Amount Received (250) + Fees
    // collected (12.34) − gas (0.50) = 261.84.
    expect(screen.getByText("Amount Received")).toBeInTheDocument();
    expect(screen.getByText("$250.00")).toBeInTheDocument();
    expect(screen.getByText("Fees collected")).toBeInTheDocument();
    expect(screen.getByText("$12.34")).toBeInTheDocument();
    expect(screen.getByText("Total received")).toBeInTheDocument();
    expect(screen.getByText("$261.84")).toBeInTheDocument();
    // Mined tx row (mock settle hash in mock mode) + the explorer link on the target's network.
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByText("0xMOCK…MOCK")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
      "href",
      "https://arbiscan.io/tx/0xMOCK00000000000000000000000000000000MOCK",
    );
    expect(onRemoved).not.toHaveBeenCalled();

    // Done applies the partial upstream with the reduced stake (25% off $1,000 → $750 remains).
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onRemoved).toHaveBeenCalledWith(false, 750);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // @rule R2 (POO-517) + POO-804 R3: a TYPED promotion (> 50%) raises the close confirmation, then
  // routes through the SAME close Review as the OperationsCard Close button — the form CTA never
  // signs directly.
  it("[POO-517 R2 / POO-804 R3] a typed 80% confirms, then passes the close Review before signing", async () => {
    const user = userEvent.setup();
    const { onRemoved } = renderModal();
    // POO-548 R2: the amount opens in $ mode; switch to % to type a percentage.
    await user.click(screen.getByRole("button", { name: "%" }));
    const input = screen.getByLabelText("Amount to withdraw");
    await user.clear(input);
    await user.type(input, "80");
    await user.click(screen.getByRole("button", { name: "Close strategy" }));

    // POO-804 R3: the Continue / Keep-the-strategy confirmation interposes — nothing built yet.
    expect(await screen.findByText("Close this strategy?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This strategy will close and all investors' liquidity will be removed and available to withdraw at any time. Continue?",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep the strategy" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // The close Review, not the wallet handoff — nothing signed yet.
    expect(screen.queryByText("Continue in your wallet")).toBeNull();
    expect(mocks.closeStrategy).not.toHaveBeenCalled();
    expect(await screen.findByText("Amount requested")).toBeInTheDocument();
    // POO-803 R5: the You'll-receive row left the card; the summary carries the figures.
    expect(screen.getByText("Amount requested")).toBeInTheDocument();
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
    expect(screen.queryByText("You'll receive at least")).toBeNull();

    // Confirming the Review runs the close and parks on the Strategy-closed receipt.
    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    await waitFor(() => expect(mocks.closeStrategy).toHaveBeenCalledWith("0xpos"));
    expect(await screen.findByText(/on the way/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onRemoved).toHaveBeenCalledWith(true);
  });

  // @rule POO-804 R3: "Keep the strategy" dismisses the confirmation and returns to the form —
  // nothing builds, nothing signs.
  it("[POO-804 R3] Keep the strategy returns to the form without building", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "$750.00" }));
    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    expect(await screen.findByText("Close this strategy?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep the strategy" }));
    // Back on the form: the amount input stands, no Review, nothing ran.
    expect(screen.getByLabelText("Amount to withdraw")).toBeInTheDocument();
    expect(screen.queryByText("Amount requested")).toBeNull();
    expect(mocks.closeStrategy).not.toHaveBeenCalled();
  });

  // @rule R2 (POO-517) + POO-804 R3: the DUST promotion confirms too (it also closes the strategy),
  // then passes the same close Review.
  it("[POO-517 R2] a dust-promoting amount confirms, then passes the close Review too", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RemoveLiquidityModal
        open
        onOpenChange={vi.fn()}
        // A $9 stake: removing 50% leaves $4.50 → dust → promoted close (not the > 50% rule).
        target={{ ...target, stakeUsd: 9 }}
        onRemoved={vi.fn()}
        initialPercentage={50}
      />,
    );
    expect(screen.getByText(/less than \$5/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    // POO-804 R3: the confirmation interposes on the dust promotion too.
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    // The close Review renders; nothing signed yet.
    expect(screen.queryByText("Continue in your wallet")).toBeNull();
    expect(mocks.closeStrategy).not.toHaveBeenCalled();
    expect(await screen.findByText("Amount requested")).toBeInTheDocument();
  });

  // @rule R1 (POO-517): real mode — the partial signs only from the Review CTA and Done reports the
  // reduced stake for the optimistic patch (R3's input).
  it("[POO-517 R1] real mode: partial signs from the Review and Done reports the reduced stake", async () => {
    mocks.mockMode = false;
    const user = userEvent.setup();
    const { onRemoved } = renderModal();
    await user.click(screen.getByRole("button", { name: "Withdraw" })); // form → building
    await user.click(await screen.findByRole("button", { name: "Withdraw" })); // review → signing
    expect(mocks.buildSteps).toHaveBeenCalledWith(
      // POO-804 R1: the partial builds with the token pair too (USDC left the family).
      expect.objectContaining({ percentage: 25, stakeUsd: 1000, collectAsUsdc: false }),
    );
    expect((await screen.findAllByText("Withdrawal successful")).length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onRemoved).toHaveBeenCalledWith(false, 750);
  });

  // POO-548: refinements to the manager Remove/Close — the gear leaves the form (R1), the amount
  // opens in $ (R2), the Review shows a Fees-available row below Amount requested (R3), and both
  // Amount requested + the fees row split per token on the token-pair path (R4).

  // @rule R1 (POO-570): the amount/form step now DOES show the slippage-config gear — it moved off
  // the partial Review onto the input step (reverses POO-548 R1). The gear's accessible name is
  // "Transaction settings".
  it("[POO-570 R1] the amount form shows the settings gear", () => {
    renderModal(); // form step (default 25%)
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transaction settings" })).toBeInTheDocument();
  });

  // @rule R1 (POO-548): the close Review keeps its gear (it is the settings entry for the exit).
  it("[POO-548 R1] the close Review still shows the settings gear", async () => {
    renderModal(100, true); // opens into the build, then the close Review (POO-596)
    expect(await screen.findByRole("button", { name: "Transaction settings" })).toBeInTheDocument();
  });

  // @rule R1 (POO-570): the partial Review no longer shows the gear — it lives on the form now
  // (reverses POO-548 R1). This guards the new placement: advancing to the partial Review drops the
  // gear from the header (only Back remains).
  it("[POO-570 R1] the partial Review no longer shows the settings gear", async () => {
    const user = userEvent.setup();
    renderModal(); // default 25% partial
    await user.click(screen.getByRole("button", { name: "Withdraw" })); // form → building → review
    expect(screen.queryByRole("button", { name: "Transaction settings" })).toBeNull();
  });

  // @rule R2 (POO-548): the amount input opens in $ mode, seeded to the USD equivalent of the
  // initial percentage (25% of $1,000 → $250), with the $ toggle pressed. The derived percentage
  // math is preserved: the "You'll withdraw" line reads ≈ $250.00 for the default seed.
  it("[POO-548 R2] the amount opens in $ mode seeded to the USD equivalent", () => {
    renderModal(); // default 25% of $1,000
    // The $ unit is active (aria-pressed) and the value is the USD equivalent, not the raw "25".
    expect(screen.getByRole("button", { name: "$", pressed: true })).toBeInTheDocument();
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("250");
    // The derived percentage is intact: 25% of $1,000 removes $250.
    expect(screen.getByText("≈ $250.00")).toBeInTheDocument();
  });

  // @rule R2 (POO-548): flipping $ → % → $ preserves the equivalent amount AND the derived percentage
  // (planRemoval/dust/close thresholds run off the percentage, so it must survive the round-trip).
  it("[POO-548 R2] flipping $/% preserves the equivalent amount and the derived percentage", async () => {
    const user = userEvent.setup();
    renderModal(); // $250 (25% of $1,000)
    const input = screen.getByLabelText("Amount to withdraw");
    expect(input).toHaveValue("250");
    // $250 → % shows 25 (the derived percentage).
    await user.click(screen.getByRole("button", { name: "%" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("25");
    // The removed-value line still reads $250 (percentage preserved through the unit flip).
    expect(screen.getByText("≈ $250.00")).toBeInTheDocument();
    // % → $ restores $250.
    await user.click(screen.getByRole("button", { name: "$" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("250");
  });

  // @rule R3 (POO-548): the partial Review shows a "Fees available to collect" row directly below
  // "Amount requested", even when the accrued fees are $0.00.
  it("[POO-548 R3] the partial Review shows a Fees-available row below Amount requested", async () => {
    const user = userEvent.setup();
    renderModal(); // default 25% partial, target.feesUsd = 12.34
    await user.click(screen.getByRole("button", { name: "Withdraw" })); // form → building
    expect(await screen.findByText("Amount requested")).toBeInTheDocument();
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
    // The fees figure (single USD in USDC mode) is the accrued fee.
    expect(screen.getByText("$12.34")).toBeInTheDocument();
  });

  // @rule R3 (POO-548): the row shows even at $0.00 (every withdraw collects the accrued fees; the
  // row is always present so the manager always sees it).
  it("[POO-548 R3] the Fees-available row shows even at $0.00", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RemoveLiquidityModal
        open
        onOpenChange={vi.fn()}
        target={{ ...target, feesUsd: 0 }}
        onRemoved={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Withdraw" })); // form → building
    expect(await screen.findByText("Fees available to collect")).toBeInTheDocument();
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });

  // @rule R3 (POO-548): the close Review shows the Fees-available row below Amount requested too.
  it("[POO-548 R3] the close Review shows the Fees-available row", async () => {
    renderModal(100, true); // build → close review; target.feesUsd = 12.34
    expect(await screen.findByText("Amount requested")).toBeInTheDocument();
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
  });

  // @rule R4 (POO-548): on the token-pair path the "Amount requested" splits into per-token rows
  // (amount + USD + logo) via the shared split, AND the Fees-available row splits into the per-token
  // fee rows. The single Amount-requested USD figure is replaced by the rows. Uses the partial Review
  // (default 25% at f = 0.25 of the $1,000 anchor).
  it("[POO-548 R4] token pair: Amount requested splits into per-token rows with logos", async () => {
    const user = userEvent.setup();
    renderWithReserves(); // feeTokens + reserves + poolValueUsd 1000, default 25% partial
    // POO-804 R1: the pair is the default (and only) payout — just advance to the Review.
    await advanceToReview(user);

    const amountRows = screen.getByTestId("withdraw-amount-tokens");
    expect(amountRows).toHaveTextContent("ETH");
    expect(amountRows).toHaveTextContent("USDC");
    // Two logos on the amount split.
    const logos = amountRows.querySelectorAll("img");
    expect(logos).toHaveLength(2);
    expect(logos[0]).toHaveAttribute("src", "/tokens/eth.png");
  });

  // @rule R4 (POO-548): the Fees-available row splits per token on the token-pair path (amount +
  // estimated USD + logo), reusing the SAME per-token fee split as the pool-contents fee rows.
  it("[POO-548 R4] token pair: the Fees-available row splits into per-token fee rows", async () => {
    const user = userEvent.setup();
    renderWithReserves();
    // POO-804 R1: the pair is the default (and only) payout — just advance to the Review.
    await advanceToReview(user);
    expect(screen.getByText("Fees available to collect")).toBeInTheDocument();
    const feeRows = screen.getByTestId("withdraw-fees-tokens");
    expect(feeRows).toHaveTextContent("ETH");
    expect(feeRows).toHaveTextContent("0.05");
    expect(feeRows).toHaveTextContent("USDC");
    expect(feeRows).toHaveTextContent("140.4");
  });

  // POO-804 R4: the quick presets follow the $/% unit in VALUE and LABEL (the label was hardcoded
  // to "{preset}%" regardless of the unit).

  // @rule POO-804 R4: $ mode (the default) shows $ preset labels; clicking one sets the $ value.
  it("[POO-804 R4] $ mode: presets read as dollar figures and set the dollar value", async () => {
    const user = userEvent.setup();
    renderModal(); // default $ mode, $1,000 stake
    for (const label of ["$250.00", "$500.00", "$750.00", "$1,000.00"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "75%" })).toBeNull();
    // 50% stays a partial, so the removed value tracks the preset exactly.
    await user.click(screen.getByRole("button", { name: "$500.00" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("500");
    expect(screen.getByText("≈ $500.00")).toBeInTheDocument();
  });

  // @rule POO-804 R4: % mode keeps the percentage labels.
  it("[POO-804 R4] % mode: presets read as percentages and set the percentage", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "%" }));
    for (const label of ["25%", "50%", "75%", "100%"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // 50% stays a partial, so the removed value tracks the preset exactly.
    await user.click(screen.getByRole("button", { name: "50%" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("50");
    expect(screen.getByText("≈ $500.00")).toBeInTheDocument();
  });

  // POO-804 R7 (POO-803 R3 parity): the amount input whitelists digits + a single dot, caps the
  // decimals (6 in $ mode, 1 in % mode) and CLAMPS at the maximum (the stake / 100%).

  // @rule POO-804 R7: $ mode — 6 decimals max, never above the stake, extra dots dropped.
  it("[POO-804 R7] $ input caps 6 decimals, clamps at the stake and dedupes dots", async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByLabelText("Amount to withdraw");
    await user.clear(input);
    await user.type(input, "12.1234567");
    expect(input).toHaveValue("12.123456");
    await user.clear(input);
    await user.type(input, "99999");
    expect(input).toHaveValue("1000");
    await user.clear(input);
    await user.type(input, "1.2.3");
    expect(input).toHaveValue("1.23");
  });

  // @rule POO-804 R7: % mode — 1 decimal max, never above 100%.
  it("[POO-804 R7] % input caps 1 decimal and clamps at 100", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "%" }));
    const input = screen.getByLabelText("Amount to withdraw");
    await user.clear(input);
    await user.type(input, "55.55");
    expect(input).toHaveValue("55.5");
    await user.clear(input);
    await user.type(input, "150");
    expect(input).toHaveValue("100");
  });

  // @rule POO-804 R7: the $/% flip re-sanitizes against the NEXT unit's caps — $333.33 converts to
  // 33.333% which must land as 1 decimal, not the raw round2.
  it("[POO-804 R7] the unit flip re-sanitizes the converted value", async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByLabelText("Amount to withdraw");
    await user.clear(input);
    await user.type(input, "333.33");
    await user.click(screen.getByRole("button", { name: "%" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("33.3");
  });

  // @rule POO-804 R7/R4: a raw float stake never leaks past the caps — the clamp floors the max to
  // the decimal cap and the 100% preset floors at the stake, so text ≤ max always holds.
  it("[POO-804 R7] a float stake clamps floored to the cap; the 100% preset never exceeds it", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RemoveLiquidityModal
        open
        onOpenChange={vi.fn()}
        target={{ ...target, stakeUsd: 1234.5678901 }}
        onRemoved={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Amount to withdraw");
    await user.clear(input);
    await user.type(input, "9999");
    // Clamped to the stake floored at 6 decimals (never above, never more precise than the cap).
    expect(input).toHaveValue("1234.56789");
    // The 100% preset chip labels AND sets the floored-2-decimals stake (label matches the value).
    await user.click(screen.getByRole("button", { name: "$1,234.56" }));
    expect(screen.getByLabelText("Amount to withdraw")).toHaveValue("1234.56");
  });

  // POO-596: the build→review→sign handshake. The Review renders the BUILT figures after an async
  // build, re-quotes on a 10s countdown, and only signs on approve.

  // @rule POO-596 R4: the Review re-quotes (rebuilds) after the countdown lapses without approval —
  // a rebuild re-runs the build (index 0) step in place, without leaving the Review.
  it("[POO-596 R4] the Review re-quotes (rebuilds) after the countdown lapses without approval", async () => {
    vi.useFakeTimers();
    try {
      mocks.mockMode = false;
      const buildRun = vi.fn(async () => ({}));
      mocks.buildSteps.mockReturnValue([
        { key: "build", run: buildRun },
        { key: "confirm:removeLiquidity", run: async () => ({ txHash: "0xhash" }) },
      ]);
      renderModal(100, true); // closeMode → auto-build → Review
      // Flush the microtask-only build so the Review renders.
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByText("Amount requested")).toBeInTheDocument();
      expect(buildRun).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(`Refreshes in ${REVIEW_REFRESH_SECS}s`, { exact: false }),
      ).toBeInTheDocument();
      // At 0 the Review re-quotes (flow.rebuild re-runs the build) in place — no navigation.
      await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_SECS * 1000);
      expect(screen.getByText("Amount requested")).toBeInTheDocument();
      expect(buildRun.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // @rule POO-596 R3: in REAL mode the built tx carries a real gas estimate (estimatedGasInUsd), which
  // the close Review's gas-only "Est. fee" tooltip reflects INSTEAD of the target.gasCostUsd ($0.50).
  it("[POO-596 R3] real mode: the built gas ($2.50) drives the Est. fee network line, not the $0.50 default", async () => {
    mocks.mockMode = false;
    mocks.buildSteps.mockReturnValue([
      { key: "build", run: async () => ({ built: { tx: {}, estimatedGasInUsd: 2.5 } }) },
      { key: "confirm:removeLiquidity", run: async () => ({ txHash: "0xhash" }) },
    ]);
    const user = userEvent.setup();
    renderModal(100, true); // closeMode → build → close Review (pair forced → gas-only fee)
    // POO-803 R7: the fee detail folds behind Show more.
    await user.click(await screen.findByRole("button", { name: "Show more" }));
    const tip = await screen.findByRole("button", { name: /Estimated gas/ });
    expect(tip).toHaveAccessibleName(/Estimated gas \(network fee\) \$2\.50/);
    expect(tip).not.toHaveAccessibleName(/\$0\.50/);
  });

  // @rule POO-842 R1: in $ mode (the POO-548 default) a 4-figure stake renders labels like
  // "$1,000.00" that need ~75-85px each, while grid-cols-4 gives ~59px per chip at 375px — the
  // 4th chip clipped at the dialog edge. Below sm the presets lay out 2x2; the POO-804 R4
  // label/value invariant is untouched (full formatUsd labels, never truncated).
  it("[POO-842 R1] the $ preset chips lay out 2x2 below sm with full labels", () => {
    renderModal();
    // stakeUsd 1000 → the 4 chips: $250.00 / $500.00 / $750.00 / $1,000.00 (labels intact).
    const last = screen.getByRole("button", { name: "$1,000.00" });
    expect(screen.getByRole("button", { name: "$250.00" })).toBeInTheDocument();
    const grid = last.parentElement;
    expect(grid).toHaveClass("grid-cols-2");
    expect(grid).toHaveClass("sm:grid-cols-4");
    expect(grid).not.toHaveClass("grid-cols-4");
  });
});
