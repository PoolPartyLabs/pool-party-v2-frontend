/**
 * @id PP-STR-MOD-010 (POO-1045)
 * @name The funding rail across the investor operations
 * @implements-rules-version v1 (POO-1045 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * POO-1043 shipped the rail through invest. This is the same rail through the operations that are
 * NOT invest, and they are not a copy of it: invest gates BEFORE its transaction is built, while
 * withdraw, collect, move-range and close gate AFTER (the POO-574 build-then-review handshake), so
 * they resume a transaction that already exists instead of starting one.
 *
 * Rules under test (POO-1045 rules v1) for the three investor-side modals; the two Manager Console
 * ones are in `src/features/manager/components/provisioningRollout.test.tsx`:
 *   [R1] withdraw and collect RESUME (their tx is built); compound RUNS (it has no build to resume)
 *   [R2] the ordering hazard: a funding wait longer than the built-tx freshness window must rebuild
 *        before the send, because a bridge takes minutes and the server's sigDeadline is 5
 *   [R3] the manager/managed collect is no longer exempt from the gate
 *   [R4] each operation's op-anchor label and cancel destination are unchanged
 *   [R5] the dismissal lock holds while the funding route executes
 *
 * Everything here runs in mock mode, which is where the gate's demo scenario lives: the fixture puts
 * every operation on the gas-only branch (one `swap-gas` step, no USDC spend), which is exactly the
 * shape five of the six operations have in production.
 *
 * `Date.now` is frozen so [R2] can move it. The freshness window is real wall-clock in
 * `useWalletSignFlow`, and a test that actually waited four minutes would not be a test.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { MAX_BUILT_TX_AGE_MS } from "../hooks/useWalletSignFlow";
import { CollectModal } from "./CollectModal";
import { CompoundModal } from "./CompoundModal";
import { WithdrawModal } from "./WithdrawModal";

/** The frozen wall clock the built-tx freshness window is measured against. */
const T0 = Date.parse("2026-07-25T12:00:00.000Z");
/** How long a bridge kept the user waiting: past the window, and past the server's sigDeadline. */
const AFTER_A_BRIDGE = T0 + MAX_BUILT_TX_AGE_MS + 60_000;

// The gate is dark-launched, so every test here forces its flag on. Nothing else is faked: the gate,
// the panel, the plan seam, the phase machines and the flow runner are all the shipped code.
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: (key: string) => key === "provisioning", flags: {} }),
}));

vi.mock("./settle", () => {
  const settleOutcome = vi.fn(() => "success");
  return {
    settleOutcome,
    settleOutcomeForSlippage: vi.fn(() => settleOutcome()),
    settleTxError: vi.fn(() => ({ code: "-32603", message: "execution reverted: mock" })),
    settleTxHash: vi.fn(() => "0xMOCK00000000000000000000000000000000MOCK"),
    settlePerformanceFeeUsd: vi.fn(() => 0),
    settleSwapInfo: vi.fn(() => ({
      priceImpactPercentage: 0.25,
      protocolFee: 0.2,
      minAmountInStable: 100,
    })),
    MOCK_BUILT_TX: { to: "0x0000000000000000000000000000000000000000", data: "0x" },
  };
});

// The success paths invalidate server caches and refresh the router; neither works under vitest.
vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: vi.fn(async () => {}),
}));
// `Link` as well as `useRouter`: the panel's plan phase mounts POO-1043 [R9]'s cost breakdown, whose
// buy-crypto peer option is a locale-aware Link, and POO-1044 [R3]'s blocked state renders one too. A
// factory mock replaces the module wholesale, so an absent export is a hard error rather than a
// fallback: a stub that omits it throws inside the component the moment the plan lands, which is
// every test here. Stubbed to a plain anchor, the repository's standing convention for it.
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

/** A manager-side collect source: a pool's accrued fees, with no {@link Strategy} anywhere. */
const managed = {
  strategyId: "pool-1",
  name: "ETH/USDC",
  initials: "E",
  poolLabel: "Base · 0.30%",
  network: "base",
  availableUsd: 120,
  gasEstimateUsd: 0.4,
  // Takes a beat, like the console mutation it stands in for. Resolving synchronously would settle
  // the whole flow inside one React batch and the wallet handoff would never render.
  onCollect: vi.fn(
    async () => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 50)),
  ),
};

/**
 * Confirm the funding plan, optionally landing the wallet handoff at a later wall clock.
 *
 * How long the route took is the only thing that decides whether the built transaction survived it.
 * The mock rail settles in under a second either way; the clock is what the flow reads.
 */
function confirmPlan(settlesAt = T0): void {
  fireEvent.click(screen.getByRole("button", { name: "Confirm & continue" }));
  vi.spyOn(Date, "now").mockReturnValue(settlesAt);
}

/** The stepper's active-step line, which is how the pending view says what it is doing. */
function stepOf(current: number, total: number): string {
  return `Step ${current} of ${total}`;
}

beforeEach(() => {
  window.dataLayer = [];
  vi.spyOn(Date, "now").mockReturnValue(T0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WithdrawModal — the funding rail (POO-1045)", () => {
  /** Amount step → build → Review → the Review's approve, which is where the gate sits. */
  async function reachThePlan() {
    renderWithProviders(
      <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Review", undefined, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findByRole("button", { name: "Confirm & continue" }, { timeout: 3000 });
  }

  it("[R1] resumes the built transaction instead of rebuilding it", async () => {
    await reachThePlan();
    confirmPlan();

    // Straight to the wallet send. The build is step 1 of 2 and it is already done: re-running it
    // would throw away the figures the user just approved on the Review.
    expect(await screen.findByText(stepOf(2, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(stepOf(1, 2))).not.toBeInTheDocument();
  });

  it("[R2] rebuilds when the funding route outlived the built transaction", async () => {
    await reachThePlan();
    confirmPlan(AFTER_A_BRIDGE);

    // The build runs AGAIN before anything is signed. Past the server's 5-minute sigDeadline the
    // transaction the user approved is a guaranteed revert, and a bridge easily takes that long.
    expect(await screen.findByText(stepOf(1, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText(stepOf(2, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("[R4] anchors the plan on the withdraw and cancels back to the Review", async () => {
    await reachThePlan();
    expect(screen.getByText("Withdraw from Stable Yield")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Confirm withdrawal" })).toBeInTheDocument();
  });

  it("[R5] refuses to close while the funding route is executing", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <WithdrawModal open onOpenChange={onOpenChange} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Review", undefined, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
    await screen.findByRole("button", { name: "Confirm & continue" }, { timeout: 3000 });
    onOpenChange.mockClear();

    confirmPlan();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("CollectModal — the funding rail (POO-1045)", () => {
  /** Confirm → build → Review → the Review's approve, which is where the gate sits. */
  async function reachThePlan(props: Record<string, unknown>) {
    renderWithProviders(<CollectModal open onOpenChange={vi.fn()} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /^Collect \$/ }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: /^Collect \$/ }));
    await screen.findByRole("button", { name: "Confirm & continue" }, { timeout: 3000 });
  }

  it("[R1] resumes the built transaction instead of rebuilding it", async () => {
    await reachThePlan({ strategy, position });
    confirmPlan();

    expect(await screen.findByText(stepOf(2, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(stepOf(1, 2))).not.toBeInTheDocument();
  });

  it("[R2] rebuilds when the funding route outlived the built transaction", async () => {
    await reachThePlan({ strategy, position });
    confirmPlan(AFTER_A_BRIDGE);

    expect(await screen.findByText(stepOf(1, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText(stepOf(2, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  // The gap this issue closes. A manager collecting pool fees needs gas on that chain exactly as an
  // investor does, and had no Strategy object, so the gate was skipped for them and the failure
  // arrived as an opaque wallet error instead of a route that fixes it.
  it("[R3] gates the manager's collect, which has no Strategy of its own", async () => {
    await reachThePlan({ managed });
    expect(screen.getByText("Collect from ETH/USDC")).toBeInTheDocument();
  });

  it("[R3] the manager's collect resumes its built transaction too", async () => {
    await reachThePlan({ managed });
    confirmPlan();

    expect(await screen.findByText(stepOf(2, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(stepOf(1, 2))).not.toBeInTheDocument();
  });

  it("[R4] anchors the plan on the collect and cancels back to the Review", async () => {
    await reachThePlan({ strategy, position });
    expect(screen.getByText("Collect from Stable Yield")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/Refreshes in/)).toBeInTheDocument();
  });

  it("[R5] refuses to close while the funding route is executing", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <CollectModal open onOpenChange={onOpenChange} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Collect \$/ }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: /^Collect \$/ }));
    await screen.findByRole("button", { name: "Confirm & continue" }, { timeout: 3000 });
    onOpenChange.mockClear();

    confirmPlan();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("CompoundModal — the funding rail (POO-1045)", () => {
  /** Compound folds its build into the single confirm step, so the gate sits on the confirm CTA. */
  async function reachThePlan() {
    renderWithProviders(
      <CompoundModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Compound \$/ }));
    await screen.findByRole("button", { name: "Confirm & continue" }, { timeout: 3000 });
  }

  it("[R1] runs the compound from the start, because it has no build to resume", async () => {
    await reachThePlan();
    confirmPlan();

    // One step, and it is the wallet itself: there is no built transaction to go stale, which is
    // why compound is the operation that uses `run()` rather than `resume()`.
    expect(await screen.findByText(stepOf(1, 1), undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("[R2] a long funding route still reaches the wallet, with nothing stale to reuse", async () => {
    await reachThePlan();
    confirmPlan(AFTER_A_BRIDGE);

    expect(await screen.findByText(stepOf(1, 1), undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("[R4] anchors the plan on the compound and cancels back to the confirm", async () => {
    await reachThePlan();
    expect(screen.getByText("Compound in Stable Yield")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: /^Compound \$/ })).toBeInTheDocument();
  });

  it("[R5] refuses to close while the funding route is executing", async () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <CompoundModal open onOpenChange={onOpenChange} strategy={strategy} position={position} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Compound \$/ }));
    await screen.findByRole("button", { name: "Confirm & continue" }, { timeout: 3000 });
    onOpenChange.mockClear();

    confirmPlan();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
