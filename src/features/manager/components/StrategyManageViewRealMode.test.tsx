/**
 * @id PP-MGR-SCR-004 (POO-311)
 * @name StrategyManageView real-mode collect.test
 * @implements-rules-version v4
 *
 * In real mode Collect runs useManagerCollect (build + send) with the position id + pool network,
 * then zeroes the claimable optimistically (no mock refetch). The executor is stubbed here.
 * POO-517 R3: the remove/close optimistic patches — a partial patches the reduced stake, a close
 * zeroes the claimable alongside status closed — and the snapshot guard that masks stale refetches
 * while yielding to the first differing server value.
 */
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagerStrategyDetail } from "@/lib/schemas";
import { managerStrategyDetails } from "@/mocks/data/manager";
import {
  act,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(async (_input?: unknown) => ({ hash: "0xhash" })),
  // POO-469: the real invest builder OperationsCard must wire into InvestModal in real mode, plus the
  // props each InvestModal render receives (so the test can assert the real wallet handoff).
  investBuildSteps: vi.fn(() => []),
  investProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn() } }));
// A real-mode mutation invalidates the catalog (revalidateTag throws "static generation store
// missing" in vitest); mock the action so the settle path runs.
vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/services", () => ({
  isMockMode: false,
  managerService: {
    collectFees: vi.fn(),
    getStrategyDetail: vi.fn(),
    setShowInExplore: vi.fn(),
    setDepositsPaused: vi.fn(),
    closeStrategy: vi.fn(),
  },
}));
vi.mock("../hooks/useManagerCollect", () => ({
  useManagerCollect: () => ({
    // POO-802 R0: the split handshake — the build step yields a built tx (the Review pauses on it),
    // the confirm step calls the send spy so the collect-input assertions keep their contract.
    buildSteps: (input: unknown) => [
      { key: "build", run: async () => ({ built: { tx: {} } }) },
      {
        key: "confirm:collect",
        run: async () => {
          const result = await mocks.execute(input as never);
          return result?.hash ? { txHash: result.hash } : {};
        },
      },
    ],
  }),
}));
// MoveRangeModal + RemoveLiquidityModal (rendered by OperationsCard) read isMockMode too — stub
// their hooks (now buildSteps-based, FU-001) to avoid Privy.
vi.mock("../hooks/useMoveRange", () => ({
  useMoveRange: () => ({ buildSteps: () => [], execute: vi.fn() }),
}));
vi.mock("../hooks/useManagerRemoveLiquidity", () => ({
  // A resolving build → send pair so the remove/close flow can reach its receipt (POO-517 R3).
  useManagerRemoveLiquidity: () => ({
    buildSteps: () => [
      { key: "build", run: async () => ({}) },
      { key: "confirm:removeLiquidity", run: async () => ({ txHash: "0xremovehash" }) },
    ],
    execute: vi.fn(),
  }),
}));
// OperationsCard mounts the investor InvestModal (Add liquidity), whose flow reaches wagmi in real
// mode. Capture the props it renders with (instead of mounting the real flow) so the test can assert
// the real-mode wallet handoff is wired (POO-469: buildInvestSteps present, not the mock walk).
vi.mock("@/features/strategies/components/InvestModal", () => ({
  InvestModal: (props: Record<string, unknown>) => {
    mocks.investProps.push(props);
    return null;
  },
}));
// OperationsCard now builds real invest steps in real mode (POO-469); stub useInvest so its Privy
// hooks (useWallets / useSignTypedData) don't run — real mode has no PrivyProvider in this test.
vi.mock("@/features/strategies/hooks/useInvest", () => ({
  useInvest: () => ({ buildSteps: mocks.investBuildSteps, execute: vi.fn() }),
}));
// OperationsCard reads the per-network spendable USDC (useAccountService → wagmi/Privy) for Add
// liquidity; stub it — real mode has no WagmiProvider in this test.
vi.mock("@/lib/account/useAccountService", () => ({
  useAccountService: () => ({ getUsdcBalance: vi.fn(async () => 0) }),
}));

import { revalidateStrategiesAction } from "@/lib/strategies/revalidateStrategies";
import { StrategyManageView } from "./StrategyManageView";

function fixture(id: string): ManagerStrategyDetail {
  const found = managerStrategyDetails.find((detail) => detail.id === id);
  if (!found) throw new Error(`missing fixture ${id}`);
  const clone = structuredClone(found);
  // Real mode needs the pool network slug (added on the real manage-detail).
  clone.pool = { ...clone.pool, network: "arbitrum" };
  // POO-468 R4: the real detail exposes the per-token claimable breakdown; the collect optimistic
  // patch must zero it alongside claimableFeesUsd.
  clone.claimableFeeTokens = [
    { symbol: "USDC", amount: 180.1 },
    { symbol: "DAI", amount: 132.3 },
  ];
  return clone;
}

function Harness({
  initial,
  onConsoleRefresh,
  onDetail,
  serveRef,
}: {
  initial: ManagerStrategyDetail;
  onConsoleRefresh?: () => void;
  /** Optional spy on every detail bubble-up (observes the optimistic patch payload). */
  onDetail?: (detail: ManagerStrategyDetail) => void;
  /** Exposes the detail setter so a test can SERVE a fresh/stale server payload (POO-517 R3). */
  serveRef?: { current: ((next: ManagerStrategyDetail) => void) | null };
}) {
  const [detail, setDetail] = useState(initial);
  if (serveRef) serveRef.current = setDetail;
  return (
    <StrategyManageView
      detail={detail}
      onBack={vi.fn()}
      onDetailChange={(next) => {
        onDetail?.(next);
        setDetail(next);
      }}
      onConsoleRefresh={onConsoleRefresh}
    />
  );
}

describe("StrategyManageView (real mode)", () => {
  beforeEach(() => {
    mocks.execute.mockClear();
    mocks.investBuildSteps.mockClear();
    mocks.investProps.length = 0;
    vi.mocked(revalidateStrategiesAction).mockClear();
  });

  // POO-469 regression: in real mode the manager Add-liquidity (invest-more into their own strategy)
  // must hand off to the real on-chain invest builder (approve → Permit2 → build → send), never the
  // InvestModal mock walk. Before the fix OperationsCard mounted InvestModal WITHOUT buildInvestSteps,
  // so InvestModal fell back to mockInvestSteps() even in real mode and fabricated a fake tx hash.
  it("hands manager Add-liquidity to the real invest builder in real mode (no mock walk)", async () => {
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);

    await waitFor(() => expect(mocks.investProps.length).toBeGreaterThan(0));
    const props = mocks.investProps.at(-1);
    // Real mode must pass a builder; undefined would make InvestModal run mockInvestSteps() (the bug).
    expect(typeof props?.buildInvestSteps).toBe("function");

    // The builder delegates to useInvest().buildSteps with the detail adapted to the invest Strategy
    // shape (toInvestStrategy), on the strategy's own network, with the entered amount + slippage.
    (props?.buildInvestSteps as (amountUsd: number, slippage: number) => unknown)(250, 0.5);
    expect(mocks.investBuildSteps).toHaveBeenCalledWith(
      expect.objectContaining({ id: "stable-yield", network: "arbitrum" }),
      250,
      0.5,
    );
  });

  it("collects on-chain and zeroes the claimable", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);

    // POO-615: the CTA starts the mock build → a Review pause → approve → the real send.
    await user.click(screen.getByRole("button", { name: "Collect fees" }));
    await user.click(screen.getByRole("button", { name: "Collect $312.40" }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Collect $312.40" }));

    // Success view is the feedback; the real send ran during "pending". POO-802 R8: the balance
    // body copy is gone — the receipt's Amount Received carries the figure.
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    expect(screen.getByText("Amount Received")).toBeInTheDocument();
    expect(screen.getByText("$312.40")).toBeInTheDocument();
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.objectContaining({ network: "arbitrum", positionId: "stable-yield" }),
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    // Claimable now zero → Collect disables.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Collect fees" })).toBeDisabled(),
    );
  });

  // @rule POO-468 R4: the real-mode collect optimistic patch zeroes the per-token claimable
  // breakdown alongside claimableFeesUsd, so the receive-as pair rows can't offer fees that were
  // just collected.
  it("[POO-468 R4] the collect patch zeroes claimableFeeTokens alongside claimableFeesUsd", async () => {
    const user = userEvent.setup();
    const onDetail = vi.fn();
    renderWithProviders(<Harness initial={fixture("stable-yield")} onDetail={onDetail} />);

    await user.click(screen.getByRole("button", { name: "Collect fees" }));
    await user.click(screen.getByRole("button", { name: "Collect $312.40" }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Collect $312.40" }));
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });

    await waitFor(() => expect(onDetail).toHaveBeenCalled());
    const patched = onDetail.mock.calls.at(-1)?.[0] as ManagerStrategyDetail;
    expect(patched.claimableFeesUsd).toBe(0);
    expect(patched.claimableFeeTokens).toEqual([
      { symbol: "USDC", amount: 0 },
      { symbol: "DAI", amount: 0 },
    ]);
  });

  // @rule POO-517 R3: a real-mode PARTIAL remove patches the reduced stake optimistically (the
  // console refetch lags the indexer), instead of leaving the stale stake until the next load.
  it("[POO-517 R3] a partial remove patches the reduced stake optimistically", async () => {
    const user = userEvent.setup();
    const onDetail = vi.fn();
    renderWithProviders(<Harness initial={fixture("stable-yield")} onDetail={onDetail} />);

    // Open the remove dialog (rail "Withdraw"), keep the default 25%, pass the Review, sign, Done.
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    await user.click(await screen.findByRole("button", { name: "Withdraw" })); // form → review
    await user.click(screen.getByRole("button", { name: "Withdraw" })); // review → signing
    await user.click(await screen.findByRole("button", { name: "Done" }));

    // 25% off the $1,420.50 stake → $1,065.37 remains; status untouched.
    // POO-548 R2: the $ seed round2's the removed amount, so the reduced stake is the sub-cent-shifted value.
    await waitFor(() => expect(onDetail).toHaveBeenCalled());
    const patched = onDetail.mock.calls.at(-1)?.[0] as ManagerStrategyDetail;
    expect(patched.managerStakeUsd).toBeCloseTo(1065.37, 6);
    expect(patched.status).toBe("active");
  });

  // @rule POO-517 R3: a real-mode close zeroes the claimable (USD + per-token) ALONGSIDE status
  // closed — the close collects the accrued fees, so leaving them offered would double-collect.
  it("[POO-517 R3] a close zeroes the claimable alongside status closed", async () => {
    const user = userEvent.setup();
    const onDetail = vi.fn();
    renderWithProviders(<Harness initial={fixture("stable-yield")} onDetail={onDetail} />);

    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    await user.click(screen.getByRole("button", { name: "Continue" })); // warning → close Review (POO-804 R3 labels)
    const modal = await screen.findByRole("dialog");
    await user.click(within(modal).getByRole("button", { name: "Close strategy" }));
    await user.click(await within(modal).findByRole("button", { name: "Done" }));

    await waitFor(() => expect(onDetail).toHaveBeenCalled());
    const patched = onDetail.mock.calls.at(-1)?.[0] as ManagerStrategyDetail;
    expect(patched.status).toBe("closed");
    expect(patched.claimableFeesUsd).toBe(0);
    expect(patched.claimableFeeTokens).toEqual([
      { symbol: "USDC", amount: 0 },
      { symbol: "DAI", amount: 0 },
    ]);
  });

  // @rule POO-517 R3: the patch is SNAPSHOT-GUARDED (the POO-468 precedent) — a refetch still equal
  // to the pre-write value is masked (the stale stake never resurrects), and the guard yields to the
  // FIRST server value that differs from the snapshot.
  it("[POO-517 R3] the stake patch masks a stale refetch and yields to the first differing server value", async () => {
    const user = userEvent.setup();
    const serveRef: { current: ((next: ManagerStrategyDetail) => void) | null } = { current: null };
    renderWithProviders(<Harness initial={fixture("stable-yield")} serveRef={serveRef} />);

    // Reveal the masked manager values, then run the 25% partial remove through Review + receipt.
    await user.click(screen.getByRole("button", { name: "Hide values" }));
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    await user.click(await screen.findByRole("button", { name: "Withdraw" }));
    await user.click(screen.getByRole("button", { name: "Withdraw" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));
    // "Your allocation" shows the optimistically reduced stake.
    // POO-548 R2: the $ seed round2's the removed amount, so the reduced stake is the sub-cent-shifted value.
    expect(await screen.findByText("$1,065.37")).toBeInTheDocument();

    // A STALE server refetch (still the pre-write $1,420.50) must not resurrect the old figure.
    act(() => serveRef.current?.(fixture("stable-yield")));
    expect(screen.getByText("$1,065.37")).toBeInTheDocument();
    expect(screen.queryByText("$1,420.50")).toBeNull();

    // The FIRST differing server value wins — the guard yields and the served figure renders.
    const fresh = fixture("stable-yield");
    fresh.managerStakeUsd = 900;
    act(() => serveRef.current?.(fresh));
    expect(await screen.findByText("$900.00")).toBeInTheDocument();
    expect(screen.queryByText("$1,065.37")).toBeNull();
  });

  it("invalidates the catalog + refreshes the console after an on-chain collect", async () => {
    const user = userEvent.setup();
    const onConsoleRefresh = vi.fn();
    renderWithProviders(
      <Harness initial={fixture("stable-yield")} onConsoleRefresh={onConsoleRefresh} />,
    );

    await user.click(screen.getByRole("button", { name: "Collect fees" }));
    await user.click(screen.getByRole("button", { name: "Collect $312.40" }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Collect $312.40" }));
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });

    await waitFor(() => expect(revalidateStrategiesAction).toHaveBeenCalled());
    expect(onConsoleRefresh).toHaveBeenCalled();
  });
});
