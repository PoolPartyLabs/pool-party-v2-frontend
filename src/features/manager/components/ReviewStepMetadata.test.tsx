/**
 * @id PP-MGR-SCR-002 (POO-308)
 * @name ReviewStep metadata wiring.test
 * @implements-rules-version v1
 *
 * POO-308 real-mode wiring: the Launch flow POSTs the strategy metadata (logo/category/fees/access)
 * BEFORE the tx and returns a pending strategyId ([R1]/[R7]); the build-tx flow runs unchanged ([R2]);
 * on the send's success it confirms with the mined txHash + receipt block ([R3]) and renders the
 * strategy immediately with a PENDING badge that clears to live via convergence ([R6]). A pre-tx write
 * failure aborts with a non-blocking inline retry ([R5]); a post-mine confirm failure keeps the live
 * view + a non-blocking re-confirm retry ([R5]). useCreatePool + the seed card are stubbed (their own
 * behavior is tested elsewhere); the metadata writer is a spy driven by `cfg`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { managerFeePolicy } from "@/mocks/data/manager";
import { uniswapPools } from "@/mocks/data/pools";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { deriveMandate } from "../lib/deriveMandate";
import type { MandateResult } from "./MandateStep";

const cfg = vi.hoisted(() => ({
  buildSteps: vi.fn(),
  create: vi.fn(),
  confirm: vi.fn(),
  retryConfirm: vi.fn(),
  confirmStatus: "idle" as "idle" | "pending" | "live" | "error",
}));

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));
vi.mock("../hooks/useCreatePool", () => ({
  useCreatePool: () => ({ buildSteps: cfg.buildSteps, execute: vi.fn() }),
}));
vi.mock("../hooks/useCreateStrategyMetadata", () => ({
  useCreateStrategyMetadata: () => ({
    create: cfg.create,
    confirm: cfg.confirm,
    confirmStatus: cfg.confirmStatus,
    retryConfirm: cfg.retryConfirm,
  }),
}));
vi.mock("./SeedLiquidityCard", () => ({
  SeedLiquidityCard: ({
    onChange,
  }: {
    onChange: (s: {
      amount0: bigint | null;
      amount1: bigint | null;
      valid: boolean;
      decimals0: number | null;
      decimals1: number | null;
    }) => void;
  }) => {
    // Report valid seed amounts + decimals on mount so Launch is enabled.
    onChange({
      amount0: BigInt(1000),
      amount1: BigInt(2000),
      valid: true,
      decimals0: 18,
      decimals1: 6,
    });
    return <div data-testid="seed-card" />;
  },
}));

import { ReviewStep } from "./ReviewStep";

const pool = uniswapPools[0];

function makeMandate(): MandateResult {
  if (!pool) throw new Error("expected at least one mock pool");
  return {
    selection: {
      name: "On-chain Strat",
      description: "Real strategy.",
      logoUrl: null,
      network: pool.network,
      query: "",
      poolId: pool.id,
      full: true,
      activePreset: "full",
      minPrice: "",
      maxPrice: "",
    },
    pool,
    derived: deriveMandate(pool, null),
    rangeWidthPct: null,
  };
}

/** Drive the confirm modal → its confirm button (submit runs the pre-tx metadata POST + the flow). */
async function launch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Launch strategy" }));
  expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
  const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
  if (!confirm) throw new Error("expected the modal confirm button");
  await user.click(confirm);
}

/** Continue past the post-build Review pause into the send (the flow settles to success). */
async function approveReview(user: ReturnType<typeof userEvent.setup>) {
  expect(await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Launch strategy" }));
}

beforeEach(() => {
  cfg.confirmStatus = "idle";
  cfg.create.mockReset().mockResolvedValue("str-test");
  cfg.confirm.mockReset();
  cfg.retryConfirm.mockReset();
  // A resolving 5-step sequence whose send returns the mined hash + receipt block (POO-638 input).
  cfg.buildSteps.mockReset().mockReturnValue([
    { key: "approve:token0", run: async () => ({ skipped: true }) },
    { key: "approve:token1", run: async () => ({ skipped: true }) },
    { key: "permit", run: async () => ({}) },
    {
      key: "build",
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {};
      },
    },
    { key: "confirm:addLiquidity", run: async () => ({ txHash: "0xabc", blockNumber: 123 }) },
  ]);
});

describe("ReviewStep metadata wiring (POO-308)", () => {
  it("POSTs the metadata before the tx, then confirms with the mined hash + block", async () => {
    // @rule R1 @rule R3 @rule R7
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );

    await launch(user);

    // [R1]/[R7]: metadata POSTs with logo/category/fee/access BEFORE the on-chain steps build, shaped
    // to the deployed DTO (POO-579): top-level integer `managerFee` bps, RiskProfile-enum `riskLevel`,
    // and NO nested `fees` object (it would be whitelist-stripped and persist the fee as 0).
    expect(cfg.create).toHaveBeenCalledTimes(1);
    // POO-868: create takes the plain metadata only (session-authenticated; no network-for-signing).
    const [metadata] = cfg.create.mock.calls[0] as [Record<string, unknown>];
    expect(metadata).toMatchObject({ name: "On-chain Strat", access: "public", managerFee: 2000 });
    expect(Number.isInteger(metadata.managerFee)).toBe(true);
    expect(metadata).not.toHaveProperty("fees");
    // [R7] riskLevel persists as the RiskProfile enum the DTO validates, never a 1-5 band.
    expect(["steady", "dynamic", "wild"]).toContain(metadata.riskLevel);
    // [R7] category persists as the STABLE enum (localized at render), never a locale-variant label.
    expect(["stable", "blueChip", "volatile"]).toContain(metadata.category);
    expect(cfg.buildSteps).toHaveBeenCalled();

    await approveReview(user);
    expect(
      await screen.findByText(/live on-chain/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    // [R3]/[R6]: confirm fires once with the pending id + mined hash + receipt block.
    expect(cfg.confirm).toHaveBeenCalledTimes(1);
    expect(cfg.confirm).toHaveBeenCalledWith({
      strategyId: "str-test",
      txHash: "0xabc",
      blockNumber: 123,
      network: pool?.network,
    });
  });

  it("aborts the launch with an inline retry when the pre-tx metadata write fails", async () => {
    // @rule R5 — nothing is on-chain yet, so no wallet flow starts.
    cfg.create.mockResolvedValue(null);
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );

    await launch(user);

    expect(
      await screen.findByText("We couldn't save your strategy details. Please try again."),
    ).toBeInTheDocument();
    // The on-chain flow never starts (no wallet-signing modal) and confirm never fires.
    expect(screen.queryByText("Continue in your wallet")).not.toBeInTheDocument();
    expect(cfg.confirm).not.toHaveBeenCalled();
  });

  it("shows the pending badge on the live view until convergence clears it", async () => {
    // @rule R6
    cfg.confirmStatus = "pending";
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );

    await launch(user);
    await approveReview(user);

    expect(await screen.findByTestId("launch-pending-badge")).toBeInTheDocument();
    expect(screen.getByText("Pending confirmation")).toBeInTheDocument();
  });

  it("surfaces a non-blocking re-confirm retry when the confirm write failed", async () => {
    // @rule R5 — the pool is on-chain; the live view stands and offers a retry.
    cfg.confirmStatus = "error";
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );

    await launch(user);
    await approveReview(user);

    // The live view stands (the pool is on-chain) and offers a non-blocking re-confirm retry.
    const retry = await screen.findByRole(
      "button",
      { name: "Retry saving details" },
      { timeout: 3000 },
    );
    expect(
      screen.getByText("Your pool is live on-chain, but saving its details failed."),
    ).toBeInTheDocument();
    await user.click(retry);
    expect(cfg.retryConfirm).toHaveBeenCalledTimes(1);
  });
});
