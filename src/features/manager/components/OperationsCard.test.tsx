/**
 * @id PP-MGR-CMP-017
 * @name OperationsCard.test
 * @implements-rules-version v1
 *
 * Guards the Add-liquidity balance source (POO-303): the manager Add-liquidity opens the investor
 * InvestModal with the PER-NETWORK spendable USDC on the strategy's chain (read via
 * useAccountService().getUsdcBalance(chainId)), NOT the cross-chain sum. Permit2 must not authorize
 * across networks, so the manager flow must read the same per-network source as the investor invest
 * flow (StrategyDetailDataLoader), never useTokenBalances().totalUsd.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { networkToChainId } from "@/lib/chains/config";
import type { ManagerStrategyDetail } from "@/lib/schemas";
import { managerStrategyDetails } from "@/mocks/data/manager";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({
  getUsdcBalance: vi.fn(),
  // Captures the props the InvestModal was rendered with on each render.
  investProps: [] as Array<{
    open: boolean;
    balance: number;
    buildInvestSteps?: unknown;
    resumeAmount?: number | null;
    depositOrigin?: string;
  }>,
}));

// Capture the investor InvestModal's props instead of mounting the real flow (it reaches wagmi).
vi.mock("@/features/strategies/components/InvestModal", () => ({
  InvestModal: ({
    open,
    balance,
    buildInvestSteps,
    resumeAmount,
    depositOrigin,
  }: {
    open: boolean;
    balance: number;
    buildInvestSteps?: unknown;
    resumeAmount?: number | null;
    depositOrigin?: string;
  }) => {
    mocks.investProps.push({ open, balance, buildInvestSteps, resumeAmount, depositOrigin });
    return null;
  },
}));
// The per-network spendable USDC source — the same one the investor invest flow reads (POO-303).
vi.mock("@/lib/account/useAccountService", () => ({
  useAccountService: () => ({ getUsdcBalance: mocks.getUsdcBalance }),
}));
// The other rail modals render closed; stub them to null so the test stays provider-light.
vi.mock("./MoveRangeModal", () => ({ MoveRangeModal: () => null }));
vi.mock("./RemoveLiquidityModal", () => ({ RemoveLiquidityModal: () => null }));
vi.mock("@/features/strategies/components/CollectModal", () => ({ CollectModal: () => null }));

import { OperationsCard } from "./OperationsCard";

/** Clones a manage-detail fixture and pins the pool network so a chain id resolves. */
function fixtureOn(network: string): ManagerStrategyDetail {
  const found = managerStrategyDetails.find((detail) => detail.id === "stable-yield");
  if (!found) throw new Error("missing fixture stable-yield");
  const clone = structuredClone(found);
  clone.pool = { ...clone.pool, network };
  return clone;
}

function renderCard(detail: ManagerStrategyDetail, extra?: { investResume?: number | null }) {
  return renderWithProviders(
    <OperationsCard
      detail={detail}
      onToggleExplore={vi.fn()}
      onSetPaused={vi.fn(async () => {})}
      onCollect={vi.fn(async () => undefined)}
      onRangeMoved={vi.fn()}
      onRemoved={vi.fn()}
      onLiquidityAdded={vi.fn()}
      {...extra}
    />,
  );
}

describe("OperationsCard — Add-liquidity balance source", () => {
  beforeEach(() => {
    mocks.getUsdcBalance.mockReset();
    mocks.investProps.length = 0;
  });

  // @rule POO-303: the manager Add-liquidity reads the spendable USDC on the strategy's chain.
  it("reads the per-network spendable USDC for the strategy's chain (not the cross-chain sum)", async () => {
    const perNetworkBalance = 38.005424; // strategy chain (arbitrum) spendable USDC, full precision
    mocks.getUsdcBalance.mockResolvedValue(perNetworkBalance);
    const detail = fixtureOn("arbitrum");

    renderCard(detail);

    // The balance read targets the strategy's chain, never an aggregate over all networks.
    await waitFor(() =>
      expect(mocks.getUsdcBalance).toHaveBeenCalledWith(networkToChainId("arbitrum")),
    );

    // Open Add liquidity and assert the InvestModal received the per-network balance.
    await userEvent.click(screen.getByRole("button", { name: "Add liquidity" }));
    await waitFor(() => {
      const opened = mocks.investProps.filter((p) => p.open);
      expect(opened.length).toBeGreaterThan(0);
      expect(opened.at(-1)?.balance).toBe(perNetworkBalance);
    });

    // It is NOT a cross-chain sum: getUsdcBalance is called per-chain, with a single chain id.
    expect(mocks.getUsdcBalance).toHaveBeenCalledTimes(1);
    expect(mocks.getUsdcBalance).toHaveBeenCalledWith(networkToChainId("arbitrum"));
  });

  // @rule POO-303: a different chain reads a different per-network balance (the source is chain-keyed).
  it("keys the balance read on the strategy's own chain id", async () => {
    mocks.getUsdcBalance.mockResolvedValue(12.5);
    const detail = fixtureOn("base");

    renderCard(detail);

    await waitFor(() =>
      expect(mocks.getUsdcBalance).toHaveBeenCalledWith(networkToChainId("base")),
    );
    expect(mocks.getUsdcBalance).not.toHaveBeenCalledWith(networkToChainId("arbitrum"));
  });

  // @rule POO-469: mock mode keeps the InvestModal mock walk — OperationsCard wires NO real builder
  // (buildInvestSteps stays undefined), so the dialog runs mockInvestSteps() and never reaches wagmi.
  // (Real mode wires it; covered by StrategyManageViewRealMode.test.tsx.)
  it("does not wire a real invest builder in mock mode (buildInvestSteps undefined)", async () => {
    mocks.getUsdcBalance.mockResolvedValue(100);

    renderCard(fixtureOn("arbitrum"));

    await waitFor(() => expect(mocks.investProps.length).toBeGreaterThan(0));
    expect(mocks.investProps.at(-1)?.buildInvestSteps).toBeUndefined();
  });

  // @rule POO-520 R1: the manager Add-liquidity flags its deposit deep link with origin=manager, so
  // an insufficient-funds top-up resumes back on the console manage view, not the investor detail.
  it("flags the InvestModal with the manager deposit origin (POO-520 R1)", async () => {
    mocks.getUsdcBalance.mockResolvedValue(100);

    renderCard(fixtureOn("arbitrum"));

    await waitFor(() => expect(mocks.investProps.length).toBeGreaterThan(0));
    expect(mocks.investProps.at(-1)?.depositOrigin).toBe("manager");
  });

  // @rule POO-520 R1: returning from the deposit top-up, the manage view re-arms the add-liquidity
  // modal at the preserved amount (the InvestModal resumes at Confirm & sign, POO-494 rules).
  it("arms the add-liquidity modal at the resume amount from a deposit round-trip (POO-520 R1)", async () => {
    mocks.getUsdcBalance.mockResolvedValue(500);

    renderCard(fixtureOn("arbitrum"), { investResume: 250 });

    await waitFor(() => {
      const opened = mocks.investProps.filter((p) => p.open);
      expect(opened.length).toBeGreaterThan(0);
      expect(opened.at(-1)?.resumeAmount).toBe(250);
    });
  });

  // @rule POO-520 R1 (guard): no resume context means the modal stays closed and unarmed.
  it("keeps the add-liquidity modal closed without a resume context", async () => {
    mocks.getUsdcBalance.mockResolvedValue(500);

    renderCard(fixtureOn("arbitrum"));

    await waitFor(() => expect(mocks.investProps.length).toBeGreaterThan(0));
    expect(mocks.investProps.filter((p) => p.open)).toHaveLength(0);
    expect(mocks.investProps.at(-1)?.resumeAmount ?? null).toBeNull();
  });

  // @rule R5 (POO-548): the Collect button enablement is driven by detail.claimableFeesUsd, which
  // the mapper now sources from totalYield when uncollectedFeesUsd is present-but-zero. A non-zero
  // claimable enables Collect; zero disables it. (The mapper fix is what makes claimableFeesUsd
  // non-zero when the API returns uncollectedFeesUsd: 0 while the Yield column shows the real fee.)
  it("[POO-548 R5] Collect is enabled when claimableFeesUsd > 0", async () => {
    mocks.getUsdcBalance.mockResolvedValue(100);
    const detail = fixtureOn("arbitrum");
    detail.claimableFeesUsd = 0.02; // the real accrued fee (totalYield-sourced)

    renderCard(detail);

    await waitFor(() => expect(mocks.getUsdcBalance).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Collect fees" })).toBeEnabled();
  });

  // @rule R5 (POO-548): a zero claimable correctly disables Collect (no fabricated enablement).
  it("[POO-548 R5] Collect is disabled when claimableFeesUsd is 0", async () => {
    mocks.getUsdcBalance.mockResolvedValue(100);
    const detail = fixtureOn("arbitrum");
    detail.claimableFeesUsd = 0;

    renderCard(detail);

    await waitFor(() => expect(mocks.getUsdcBalance).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Collect fees" })).toBeDisabled();
  });
});

describe("OperationsCard — coming-soon controls (POO-738)", () => {
  beforeEach(() => {
    mocks.getUsdcBalance.mockReset();
    mocks.investProps.length = 0;
    mocks.getUsdcBalance.mockResolvedValue(100);
  });

  // @rule POO-738: listing + pausing have no backend yet (POO-314), so both controls are inert with a
  // "coming soon" hint. They must be SOFT-disabled (aria-disabled), NOT natively `disabled`: a native
  // `disabled` control drops out of the tab order, so the focus-triggered hint would be unreachable by
  // keyboard. So each control is aria-disabled but stays keyboard-focusable, and its click is inert.
  it("marks the Show-in-Strategies switch and Pause deposits inert but keyboard-focusable", async () => {
    renderCard(fixtureOn("arbitrum"));
    await waitFor(() => expect(mocks.getUsdcBalance).toHaveBeenCalled());
    const toggle = screen.getByRole("switch", { name: "Show in Strategies list" });
    const pause = screen.getByRole("button", { name: "Pause deposits" });
    // aria-disabled marks them inert to AT; NOT natively disabled, so they stay in the tab order.
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).not.toBeDisabled();
    expect(pause).toHaveAttribute("aria-disabled", "true");
    expect(pause).not.toBeDisabled();
  });

  // @rule POO-738 (R3): the "coming soon" hint must be keyboard-reachable — focusing an inert control
  // exposes its tooltip. A native-disabled control (removed from the tab order) could not be focused,
  // so the hint would only surface on mouse hover. Focus lands, and the role=tooltip hint is exposed.
  it("[R3] exposes the coming-soon hint on keyboard focus of each inert control", async () => {
    const user = userEvent.setup();
    renderCard(fixtureOn("arbitrum"));
    await waitFor(() => expect(mocks.getUsdcBalance).toHaveBeenCalled());

    const toggle = screen.getByRole("switch", { name: "Show in Strategies list" });
    // Keyboard focus reaches the inert control (native-disabled would refuse focus).
    toggle.focus();
    expect(toggle).toHaveFocus();
    // The hint sits inside the same focus-within group as the control, so focus reveals it.
    const toggleHint = toggle.parentElement?.querySelector('[role="tooltip"]');
    expect(toggleHint).toHaveTextContent("Coming soon");

    const pause = screen.getByRole("button", { name: "Pause deposits" });
    pause.focus();
    expect(pause).toHaveFocus();
    const pauseHint = pause.parentElement?.querySelector('[role="tooltip"]');
    expect(pauseHint).toHaveTextContent("Coming soon");

    // Both hints are present in the DOM (opacity-toggled CSS tooltips).
    const hints = screen.getAllByRole("tooltip");
    expect(hints.length).toBeGreaterThanOrEqual(2);
    for (const hint of hints) expect(hint).toHaveTextContent("Coming soon");

    // Activating the inert controls does nothing (the coming-soon behavior is non-actionable).
    await user.click(toggle);
    await user.click(pause);
    expect(mocks.investProps.filter((p) => p.open)).toHaveLength(0);
    // No confirm dialog opens off the inert Pause.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // @rule POO-738: activating the inert Show-in-Strategies switch never calls back into the listing
  // mutation (the click is suppressed), so no service write is reachable from the UI.
  it("does not fire onToggleExplore or onSetPaused when the inert controls are clicked", async () => {
    const user = userEvent.setup();
    const onToggleExplore = vi.fn();
    const onSetPaused = vi.fn(async () => {});
    renderWithProviders(
      <OperationsCard
        detail={fixtureOn("arbitrum")}
        onToggleExplore={onToggleExplore}
        onSetPaused={onSetPaused}
        onCollect={vi.fn(async () => undefined)}
        onRangeMoved={vi.fn()}
        onRemoved={vi.fn()}
        onLiquidityAdded={vi.fn()}
      />,
    );
    await waitFor(() => expect(mocks.getUsdcBalance).toHaveBeenCalled());
    await user.click(screen.getByRole("switch", { name: "Show in Strategies list" }));
    await user.click(screen.getByRole("button", { name: "Pause deposits" }));
    expect(onToggleExplore).not.toHaveBeenCalled();
    expect(onSetPaused).not.toHaveBeenCalled();
  });

  // @rule POO-840 R4 — iOS taps neither hover nor focus a soft-disabled control, so the CSS
  // hover/focus-within hint left the inert controls as silent dead taps on touch. A tap now
  // reveals the hint explicitly; tapping outside (or another control) dismisses it.
  it("[POO-840 R4] a tap reveals the coming-soon hint; a tap outside dismisses it", async () => {
    const user = userEvent.setup();
    renderCard(fixtureOn("arbitrum"));
    await waitFor(() => expect(mocks.getUsdcBalance).toHaveBeenCalled());

    const toggle = screen.getByRole("switch", { name: "Show in Strategies list" });
    const toggleHint = toggle.parentElement?.querySelector('[role="tooltip"]');
    expect(toggleHint).toHaveClass("opacity-0");

    await user.click(toggle);
    expect(toggleHint).toHaveClass("opacity-100");

    // A tap on the other inert control dismisses this hint and reveals its own.
    const pause = screen.getByRole("button", { name: "Pause deposits" });
    await user.click(pause);
    expect(toggleHint).toHaveClass("opacity-0");
    const pauseHint = pause.parentElement?.querySelector('[role="tooltip"]');
    expect(pauseHint).toHaveClass("opacity-100");

    // A tap anywhere outside dismisses the open hint.
    await user.click(document.body);
    expect(pauseHint).toHaveClass("opacity-0");
  });
});
