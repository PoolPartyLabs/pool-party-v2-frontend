/**
 * @id PP-STR-SCR-002 (POO-468)
 * @name Strategy Detail: optimistic claimable reset tests
 * @implements-rules-version v1
 *
 * [R1] After a confirmed investor Collect, every claimable-fee figure (the position card's
 * Available cell, the Collect CTA amount, the Compound gate) resets optimistically to $0 WHILE the
 * `position` prop is still the stale pre-collect object. The override yields to the first refetched
 * value whose totalYield DIFFERS from the collect-time snapshot (fresh accrual is never masked); a
 * stale refetch equal to the snapshot never resurrects the old figure.
 * [R2] Real-mode focused, but the override is client-side, so the open mock screen reads $0 too:
 * these tests drive the modal's mock settle path and never mutate the mock service.
 * [R3] `totalYield` backs BOTH the Available figure and the Total yield row; both zero together.
 *
 * Follows the view-level post-write precedent (StrategyManageViewRefresh.test) and the CollectModal
 * fireEvent dialog-flow style.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
  within,
} from "../../../tests/utils/renderWithProviders";
import { StrategyDetailScreen } from "./StrategyDetailScreen";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

// The collect success path invalidates the catalog + positions caches (revalidateTag throws
// "static generation store missing" in vitest); mock both actions so success renders.
vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: vi.fn(async () => {}),
}));

const strategy: Strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 100,
  tvl: 1_250_000,
  investors: 312,
  estReturn: 7.4,
  rateType: "APY",
  status: "active",
};

/** The pre-collect position: the server keeps serving this stale object during the indexer lag. */
const stalePosition: Position = {
  id: "p1",
  strategyId: "s1",
  invested: 1800,
  currentValue: 2050,
  totalYield: 290.4,
  available: 120,
  reinvestment: "auto-compound",
  status: "active",
  claimableFeeTokens: [
    { symbol: "ETH", amount: 0.05 },
    { symbol: "USDC", amount: 140.4 },
  ],
};

const chartData = [
  { value: 100, label: "Mon" },
  { value: 110, label: "Tue" },
  { value: 105, label: "Wed" },
  { value: 120, label: "Thu" },
];

/** Renders the owned screen with the given position (defaults to the stale pre-collect object). */
function renderScreen(position: Position = stalePosition) {
  return renderWithProviders(
    <StrategyDetailScreen
      strategy={strategy}
      position={position}
      balance={50}
      chartData={chartData}
    />,
  );
}

/**
 * Drives the Collect flow to its success view (mock settle), then closes the dialog. POO-615: the
 * dialog CTA now starts the BUILD → a Review pause → the Review approve → signing, so click the CTA,
 * wait for the Review countdown, then click the Review approve CTA before the terminal state.
 */
async function collectToSuccess() {
  const [openCta] = screen.getAllByRole("button", { name: "Collect $290.40" });
  if (!openCta) throw new Error("expected the Collect CTA");
  fireEvent.click(openCta);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Collect $290.40" }));
  // The build settles (~350ms) then the flow pauses on the Review; approve to sign.
  await within(screen.getByRole("dialog")).findByText(/Refreshes in/, undefined, { timeout: 2000 });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Collect $290.40" }),
  );
  await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
}

beforeEach(() => {
  window.dataLayer = [];
});

describe("StrategyDetailScreen: optimistic claimable reset (POO-468)", () => {
  // @rule R1: collect success zeroes Available + drops the Collect/Compound CTAs even though the
  // position prop is STILL the stale pre-collect object (no refetch has landed yet).
  it("[R1] resets the claimable figures to $0 on collect success while the position prop is stale", async () => {
    renderScreen();
    // Pre-collect: the claimable figures show the stale 290.4.
    expect(screen.getAllByText("$290.40").length).toBeGreaterThanOrEqual(1);
    await collectToSuccess();
    // Post-collect, pre-refetch: every claimable figure reads $0 and the CTAs are gone.
    expect(screen.queryByRole("button", { name: "Collect $290.40" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compound" })).toBeNull();
    // Available + Total yield both derive from totalYield (R3): the card now shows $0.00.
    expect(screen.getAllByText("$0.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("$290.40")).toBeNull();
  });

  // @rule R1: a poll refetch that still returns the pre-collect value (indexer lag) must NOT
  // resurrect the old figure: the override only yields to a DIFFERING totalYield.
  it("[R1] a stale refetch equal to the snapshot keeps the figures at $0", async () => {
    const view = renderScreen();
    await collectToSuccess();
    view.rerender(
      <StrategyDetailScreen
        strategy={strategy}
        position={{ ...stalePosition }}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.queryByRole("button", { name: "Collect $290.40" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compound" })).toBeNull();
    expect(screen.getAllByText("$0.00").length).toBeGreaterThanOrEqual(1);
  });

  // @rule R1/R3: the first refetched value that DIFFERS from the snapshot clears the override, so
  // fresh accrual is never masked. The clear un-zeros BOTH the USD figures AND the per-token
  // claimable rows together (the override zeroed both while armed): the token pair inside the
  // Collect modal shows the fresh non-zero amounts, not the zeroed override.
  it("[R1] yields to the first fresh server value that differs from the snapshot", async () => {
    const view = renderScreen();
    await collectToSuccess();
    view.rerender(
      <StrategyDetailScreen
        strategy={strategy}
        position={{ ...stalePosition, totalYield: 0.42 }}
        balance={50}
        chartData={chartData}
      />,
    );
    expect(screen.getAllByRole("button", { name: "Collect $0.42" }).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getAllByText("$0.42").length).toBeGreaterThanOrEqual(1);
    // Per-token rows also reflect the fresh (non-zero) values, not the zeroed override: open the
    // Collect modal, switch to the token pair (POO-417 gear → settings dialog), and read the
    // amounts-only rows. The modal's post-Done phase reset is deferred (~150ms), so reopen then
    // await the confirm-phase gear before opening the settings dialog.
    const [reopenCta] = screen.getAllByRole("button", { name: "Collect $0.42" });
    if (!reopenCta) throw new Error("expected the refreshed Collect CTA");
    fireEvent.click(reopenCta);
    const gear = await screen.findByRole(
      "button",
      { name: "Transaction settings" },
      { timeout: 2000 },
    );
    fireEvent.click(gear);
    fireEvent.click(screen.getByRole("button", { name: "ETH / USDC" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // POO-802 R2: the per-token "Receive as" rows moved from the confirm view into the Review
    // (the CollapsibleReceiptRows after the build pause). Drive into the Review before reading them:
    // click the Collect CTA and await the re-quote countdown (mirrors CollectModal.test's
    // openCollectReview helper).
    fireEvent.click(screen.getByRole("button", { name: "Collect $0.42" }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
    const tokenRows = screen.getByTestId("collect-receive-tokens");
    expect(tokenRows).toHaveTextContent("0.05 ETH");
    expect(tokenRows).toHaveTextContent("140.4 USDC");
  });
});

describe("StrategyDetailScreen: /financials cutover retires the POO-468 override (POO-936)", () => {
  /** A per-strategy /financials block: distinct served figures so the card is unambiguously ledger-sourced. */
  const positionFinancials = {
    invested: 1500,
    currentValue: 2222,
    available: 88,
    totalYield: 333,
    collectedFees: { "24h": 1, "7d": 2, "30d": 3, all: 300 },
    feesEarned: { "24h": 1, "7d": 2, "30d": 3 },
    provisional: false,
  };

  // @rule R1/R5: the "Your position" card shows the SERVED ledger figures, not the position-sourced ones.
  it("[R1] renders the served ledger figures in the Your position card", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={stalePosition}
        balance={50}
        chartData={chartData}
        positionFinancials={positionFinancials}
      />,
    );
    // Invested 1500 + current value 2222 are the served figures (the position holds 1800 / 2050).
    expect(screen.getAllByText("$1,500.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$2,222.00").length).toBeGreaterThanOrEqual(1);
    // Total yield is the served 333 (not the position's 290.4).
    expect(screen.getAllByText("+$333.00").length).toBeGreaterThanOrEqual(1);
  });

  // @rule R3: after a collect the override never arms (no optimistic $0) — the CTA stays on the real
  // position claimable, and the card keeps showing the served figures (no zeroing).
  it("[R3] does NOT zero the card on collect success (the override is disabled)", async () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={stalePosition}
        balance={50}
        chartData={chartData}
        positionFinancials={positionFinancials}
      />,
    );
    await collectToSuccess();
    // The served Total-yield ($333) is still shown — the POO-468 zeroed-override did NOT fire.
    expect(screen.getAllByText("+$333.00").length).toBeGreaterThanOrEqual(1);
    // No "$0.00" claimable override appeared (the card's Available shows the served $88.00).
    expect(screen.getAllByText("$88.00").length).toBeGreaterThanOrEqual(1);
  });

  // @rule R5: a served NULL figure renders "not available yet", never $0.
  it("[R5] renders a served NULL figure as unavailable, never $0", () => {
    renderWithProviders(
      <StrategyDetailScreen
        strategy={strategy}
        position={stalePosition}
        balance={50}
        chartData={chartData}
        positionFinancials={{ ...positionFinancials, invested: null, totalYield: null }}
      />,
    );
    // The unavailable label appears (from the common namespace) for the two null figures.
    expect(screen.getAllByText("Not available yet").length).toBeGreaterThanOrEqual(2);
  });
});
