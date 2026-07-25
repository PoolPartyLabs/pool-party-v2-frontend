/**
 * @id PP-STR-MOD-010 (POO-1045)
 * @name The funding rail across the Manager Console operations
 * @implements-rules-version v1 (POO-1045 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The Manager Console half of POO-1045: move-range and close. Both gate at their Review approve,
 * AFTER the transaction is built (the POO-597 / POO-596 build-then-review handshake), so both resume
 * rather than run, and both are exposed to the ordering hazard the investor operations share: a
 * funding route that takes minutes can outlive the built transaction it is funding.
 *
 * Rules under test (POO-1045 rules v1); the investor-side three are in
 * `src/features/strategies/components/provisioningRollout.test.tsx`:
 *   [R1] move-range and close RESUME the built transaction
 *   [R2] a funding wait past the freshness window rebuilds before the send
 *   [R4] each operation's op-anchor label and cancel destination are unchanged
 *   [R5] the dismissal lock holds while the funding route executes
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BUILT_TX_AGE_MS } from "@/features/strategies/hooks/useWalletSignFlow";
import { managerPosition } from "@/mocks/data/manager";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { MoveRangeModal } from "./MoveRangeModal";
import { RemoveLiquidityModal, type RemoveLiquidityTarget } from "./RemoveLiquidityModal";

/** The frozen wall clock the built-tx freshness window is measured against. */
const T0 = Date.parse("2026-07-25T12:00:00.000Z");
/** How long a bridge kept the manager waiting: past the window, and past the server's sigDeadline. */
const AFTER_A_BRIDGE = T0 + MAX_BUILT_TX_AGE_MS + 60_000;

// The gate is dark-launched, so every test here forces its flag on.
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: (key: string) => key === "provisioning", flags: {} }),
}));

const { moveRange, closeStrategy } = vi.hoisted(() => ({
  moveRange: vi.fn(async () => ({ rangeMin: 2850, rangeMax: 3400, full: false, gasCostUsd: 0.42 })),
  closeStrategy: vi.fn(async () => undefined),
}));

vi.mock("@/lib/services", () => ({
  isMockMode: true,
  managerService: { moveRange, closeStrategy },
  // The error view renders TransactionErrorActions → useTxDiagnostics, which reads this.
  accountService: { getWalletKind: vi.fn(async () => "embedded") },
}));

// `Link` as well as `useRouter`, for the same reason as the investor-side sibling: the panel's plan
// phase mounts POO-1043 [R9]'s cost breakdown, whose buy-crypto peer option is a locale-aware Link.
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

const removeTarget: RemoveLiquidityTarget = {
  strategyId: "0xpos",
  network: "arbitrum",
  stakeUsd: 1000,
  feesUsd: 12.34,
  gasCostUsd: 0.5,
};

/**
 * Confirm the funding plan, optionally landing the wallet handoff at a later wall clock. The mock
 * rail settles in under a second either way; the clock is what the flow reads.
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
  vi.spyOn(Date, "now").mockReturnValue(T0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MoveRangeModal — the funding rail (POO-1045)", () => {
  /** Form → build → Review → the Review's approve, which is where the gate sits. */
  async function reachThePlan(onOpenChange = vi.fn()) {
    renderWithProviders(
      <MoveRangeModal
        open
        onOpenChange={onOpenChange}
        position={managerPosition}
        currentMin={2850}
        currentMax={3400}
        onMoved={vi.fn()}
      />,
    );
    const formCta = screen.getAllByRole("button", { name: "Move range" }).at(-1);
    if (!formCta) throw new Error("expected the form CTA");
    fireEvent.click(formCta);
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm & move range" }, { timeout: 3000 }),
    );
    await screen.findByRole("button", { name: "Confirm & continue" }, { timeout: 3000 });
    return onOpenChange;
  }

  it("[R1] resumes the built rebalance instead of rebuilding it", async () => {
    await reachThePlan();
    confirmPlan();

    expect(await screen.findByText(stepOf(2, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(stepOf(1, 2))).not.toBeInTheDocument();
  });

  it("[R2] rebuilds when the funding route outlived the built rebalance", async () => {
    await reachThePlan();
    confirmPlan(AFTER_A_BRIDGE);

    expect(await screen.findByText(stepOf(1, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText(stepOf(2, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("[R4] anchors the plan on the pair and cancels back to the Review", async () => {
    await reachThePlan();
    expect(screen.getByText("Move range in ETH/USDC")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeInTheDocument();
  });

  it("[R5] refuses to close while the funding route is executing", async () => {
    const onOpenChange = await reachThePlan();
    onOpenChange.mockClear();

    confirmPlan();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("RemoveLiquidityModal — the funding rail (POO-1045)", () => {
  /** Form → build → Review → the Review's approve, which is where the gate sits. */
  async function reachThePlan(onOpenChange = vi.fn()) {
    renderWithProviders(
      <RemoveLiquidityModal
        open
        onOpenChange={onOpenChange}
        target={removeTarget}
        onRemoved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await screen.findByText("Amount requested", undefined, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await screen.findByRole("button", { name: "Confirm & continue" }, { timeout: 3000 });
    return onOpenChange;
  }

  it("[R1] resumes the built withdrawal instead of rebuilding it", async () => {
    await reachThePlan();
    confirmPlan();

    expect(await screen.findByText(stepOf(2, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(stepOf(1, 2))).not.toBeInTheDocument();
  });

  it("[R2] rebuilds when the funding route outlived the built withdrawal", async () => {
    await reachThePlan();
    confirmPlan(AFTER_A_BRIDGE);

    expect(await screen.findByText(stepOf(1, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(await screen.findByText(stepOf(2, 2), undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it("[R4] anchors the plan on the position and cancels back to the Review", async () => {
    await reachThePlan();
    expect(screen.getByText(/^Close /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Amount requested")).toBeInTheDocument();
  });

  it("[R5] refuses to close while the funding route is executing", async () => {
    const onOpenChange = await reachThePlan();
    onOpenChange.mockClear();

    confirmPlan();
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
