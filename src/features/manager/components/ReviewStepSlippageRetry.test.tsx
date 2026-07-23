/**
 * @id PP-MGR-SCR-002 (POO-510)
 * @name ReviewStep slippage auto-retry.test (real mode)
 * @implements-rules-version v3
 *
 * POO-510 (POO-467 rules v3, [R10]): the manager Launch strategy flow (technical name create-pool),
 * which runs in the builder Review step's real-mode wallet-sign flow, joins the SAME slippage
 * auto-retry orchestration as the six transactional modals (POO-499). Driven end to end through the
 * REAL {@link ReviewStep} + {@link useWalletSignFlow}, this suite proves:
 *   - R2: the first slippage-classified failure auto-retries ONCE from the build step — the pending
 *     view shows the retry notice, never the failed view, and the two approvals + permit are preserved;
 *   - R3: the second slippage failure shows the slippage-specific error view AND auto-opens the
 *     settings dialog exactly once (closing it does not re-open it);
 *   - R4: a non-slippage failure is byte-identical to today (generic failed view, plain retry, no
 *     auto-open, no analytics);
 *   - R8: `tx_slippage_retry` fires exactly once per AUTOMATIC retry with { flow: "createPool" },
 *     never on the manual retry.
 *
 * The `useCreatePool` buildSteps spy returns a five-step array (approve×2 → permit → build → confirm)
 * whose build step's outcome is scripted per test, so the whole ReviewStep orchestration runs against
 * a real flow. Mirrors ReviewStepRealMode.test.tsx's module mocks (services-barrel trap: mock like the
 * neighbors do). Analytics land on window.dataLayer (asserted directly, as POO-499's modal suites do).
 *
 * POO-887 (rules v1) supersedes the run-through-to-live expectations here: the launch's slippage
 * failures happen at the BUILD step, BEFORE the Review pause was ever consumed, so every retry
 * (automatic or manual) now re-pauses at the Review with fresh figures - the send only runs after
 * the manager approves them. The one-automatic-retry / auto-open / analytics rules are unchanged.
 */
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { managerFeePolicy } from "@/mocks/data/manager";
import { uniswapPools } from "@/mocks/data/pools";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { deriveMandate } from "../lib/deriveMandate";
import type { MandateResult } from "./MandateStep";

/** A build step failure whose message classifies as slippage (POO-461 message-pattern path). */
const SLIPPAGE_MESSAGE =
  "execution reverted: slippage tolerance exceeded - minimum output amount not met";
/** A build step failure with an unmapped message (classifies as "unknown"). */
const GENERIC_MESSAGE = "execution reverted: something else";

const cfg = vi.hoisted(() => ({
  // How the build step resolves per attempt. "slippage" / "generic" throw the matching error; "ok"
  // resolves. The array is consumed left-to-right; the last entry repeats once exhausted.
  buildOutcomes: ["ok"] as Array<"ok" | "slippage" | "generic">,
  buildAttempts: 0,
  approveRuns: 0,
  permitRuns: 0,
  buildSteps: vi.fn(),
}));

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));
vi.mock("@/lib/portfolio/revalidatePositions", () => ({
  revalidatePositionsAction: vi.fn(async () => {}),
}));

// Real mode.
vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  isMockMode: false,
}));

vi.mock("../hooks/useCreatePool", () => ({
  useCreatePool: () => ({ buildSteps: cfg.buildSteps, execute: vi.fn() }),
}));
// POO-308: the metadata writer — create resolves a pending strategyId so the launch proceeds; confirm
// is a no-op here (slippage-retry orchestration is what this file exercises).
vi.mock("../hooks/useCreateStrategyMetadata", () => ({
  useCreateStrategyMetadata: () => ({
    create: vi.fn(async () => "str-test"),
    confirm: vi.fn(),
    confirmStatus: "idle",
    retryConfirm: vi.fn(),
  }),
}));

// Stub the seed card: reports valid amounts up on mount so Launch is enabled.
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
    useEffect(() => {
      onChange({
        amount0: BigInt(1000),
        amount1: BigInt(2000),
        valid: true,
        decimals0: 18,
        decimals1: 6,
      });
    }, [onChange]);
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

/** Drive the Review step from the form to the running wallet-sign flow (Launch → confirm modal). */
async function launch(user: ReturnType<typeof userEvent.setup>) {
  const launchCta = screen.getByRole("button", { name: "Launch strategy" });
  await user.click(launchCta);
  expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
  const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
  if (!confirm) throw new Error("expected the modal confirm button");
  await user.click(confirm);
}

function retryEvents() {
  return (window.dataLayer ?? []).filter(
    (e) => (e as { event?: string }).event === "tx_slippage_retry",
  );
}

beforeEach(() => {
  cfg.buildOutcomes = ["ok"];
  cfg.buildAttempts = 0;
  cfg.approveRuns = 0;
  cfg.permitRuns = 0;
  window.dataLayer = [];
  // A resolving 5-step sequence (approve ×2 → permit → build → confirm). The build step consults
  // cfg.buildOutcomes[attempt] so a test scripts slippage / generic / ok per attempt; the two
  // approvals + permit count their runs so a test can assert they were not re-run on a retry.
  cfg.buildSteps.mockReset().mockReturnValue([
    {
      key: "approve:token0",
      run: async () => {
        cfg.approveRuns += 1;
        return { skipped: true };
      },
    },
    {
      key: "approve:token1",
      run: async () => {
        cfg.approveRuns += 1;
        return { skipped: true };
      },
    },
    {
      key: "permit",
      run: async () => {
        cfg.permitRuns += 1;
        return {};
      },
    },
    {
      key: "build",
      run: async () => {
        const outcome = cfg.buildOutcomes[cfg.buildAttempts] ?? cfg.buildOutcomes.at(-1) ?? "ok";
        cfg.buildAttempts += 1;
        // Hold briefly so the re-run's pending view (with the retry notice) is observably up before the
        // build settles — the auto-retried build resolves too fast otherwise for findBy to catch it.
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (outcome === "slippage") {
          throw Object.assign(new Error(SLIPPAGE_MESSAGE), { code: "-32603" });
        }
        if (outcome === "generic") {
          throw Object.assign(new Error(GENERIC_MESSAGE), { code: "-32603" });
        }
        return {};
      },
    },
    { key: "confirm:addLiquidity", run: async () => ({ txHash: "0xabc" }) },
  ]);
});

describe("ReviewStep launch slippage auto-retry (real mode, POO-510)", () => {
  // @rule R10/R2 (regression from the original incident): a slippage failure then the ONE automatic
  // retry then success — the manager never sees the failed view.
  it("[R2] auto-retries once from build on a slippage failure and reaches live with no failed view", async () => {
    const user = userEvent.setup();
    // First build fails as slippage; the auto-retried build succeeds.
    cfg.buildOutcomes = ["slippage", "ok"];
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await launch(user);

    // The pending notice appears (auto-retry in flight); the failed view never shows.
    expect(
      await screen.findByText(/Retrying at the current price/i, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    // POO-887 R1: the first build failed BEFORE the Review pause was ever consumed, so the
    // auto-retried build re-pauses at the Review (fresh figures + countdown) instead of
    // auto-signing the send.
    expect(
      await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Verification failed")).toBeNull();

    // build was attempted twice; the two approvals + permit ran once (never re-run on the auto-retry).
    expect(cfg.buildAttempts).toBe(2);
    expect(cfg.approveRuns).toBe(2);
    expect(cfg.permitRuns).toBe(1);

    // The manager approves the fresh figures - only now does the send run and the strategy go live.
    const reviewLaunch = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
    if (!reviewLaunch) throw new Error("expected the review launch button");
    await user.click(reviewLaunch);
    expect(
      await screen.findByText(/live on-chain/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();

    // R8 — exactly one tx_slippage_retry, tagged with the createPool flow.
    const retries = retryEvents();
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({ flow: "createPool" });
    // The raw error message must NEVER reach analytics.
    expect(JSON.stringify(window.dataLayer)).not.toContain("slippage tolerance exceeded");
  });

  // @rule R10/R3: two slippage failures show the slippage-specific error view AND open the settings
  // dialog exactly once.
  it("[R3] two slippage failures show the slippage error view and auto-open settings once", async () => {
    const user = userEvent.setup();
    cfg.buildOutcomes = ["slippage", "slippage"];
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await launch(user);

    // The slippage-specific error title + body (shared strategies copy) replace the generic failed view.
    expect(
      await screen.findByText("Price moved too much", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/moved beyond your max slippage.*again/i)).toBeInTheDocument();
    expect(screen.queryByText("Verification failed")).toBeNull();
    // The settings dialog auto-opened (its slippage section is visible).
    expect(screen.getByText("Max slippage")).toBeInTheDocument();

    // Exactly one automatic retry event (never on the second failure).
    expect(retryEvents()).toHaveLength(1);
  });

  // @rule R10/R3: closing the auto-opened settings dialog does not re-open it (auto-open is one-shot).
  it("[R3] closing the auto-opened settings dialog does not re-open it", async () => {
    const user = userEvent.setup();
    cfg.buildOutcomes = ["slippage", "slippage"];
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await launch(user);

    // Settings auto-opened; close it via Done.
    expect(
      await screen.findByText("Max slippage", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    // It stays closed (not re-opened by a subsequent render).
    await Promise.resolve();
    expect(screen.queryByText("Max slippage")).toBeNull();
  });

  // @rule R10/R3: after raising slippage, Try again re-runs from the build step with the new value.
  it("[R3] Try again after a slippage error re-runs from the build step (approvals/permit preserved)", async () => {
    const user = userEvent.setup();
    // Two slippage failures, then the manual retry's build succeeds.
    cfg.buildOutcomes = ["slippage", "slippage", "ok"];
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await launch(user);

    // The slippage error view is up; close the auto-opened settings, then Try again.
    expect(
      await screen.findByText("Price moved too much", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));

    const attemptsBefore = cfg.buildAttempts;
    const approvesBefore = cfg.approveRuns;
    const permitsBefore = cfg.permitRuns;
    await user.click(screen.getByRole("button", { name: "Back to review" }));

    // POO-887 R1: the manual retry re-runs the build (a third attempt) and re-pauses at the Review
    // (the pause was never consumed) - approvals + permit untouched.
    expect(
      await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(cfg.buildAttempts).toBe(attemptsBefore + 1);
    expect(cfg.approveRuns).toBe(approvesBefore);
    expect(cfg.permitRuns).toBe(permitsBefore);
    // Approving the fresh figures runs the send → live.
    const reviewLaunch = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
    if (!reviewLaunch) throw new Error("expected the review launch button");
    await user.click(reviewLaunch);
    expect(
      await screen.findByText(/live on-chain/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    // The manual retry never fires the automatic-retry event (still exactly one from the auto-retry).
    expect(retryEvents()).toHaveLength(1);
  });

  // @rule R10/R4: a non-slippage failure is byte-identical to today — the generic failed view, a plain
  // retry, no settings auto-open, no analytics.
  it("[R4] a non-slippage failure shows the generic failed view with no auto-retry or auto-open", async () => {
    const user = userEvent.setup();
    cfg.buildOutcomes = ["generic"];
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await launch(user);

    // The generic failed view (unchanged manager copy).
    expect(
      await screen.findByText("Verification failed", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Price moved too much")).toBeNull();
    // The settings dialog did NOT auto-open.
    expect(screen.queryByText("Max slippage")).toBeNull();
    // No auto-retry event and build attempted exactly once.
    expect(retryEvents()).toHaveLength(0);
    expect(cfg.buildAttempts).toBe(1);
  });

  // @rule R10/R4: the generic retry resumes from the failed step (today's semantics), not from build.
  it("[R4] the generic failed view's retry resumes from the failed step", async () => {
    const user = userEvent.setup();
    // Generic failure, then the resumed build succeeds.
    cfg.buildOutcomes = ["generic", "ok"];
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await launch(user);
    expect(
      await screen.findByText("Verification failed", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();

    // Retry resumes from the failed (build) step: build runs again, approvals + permit are not
    // re-run. POO-887 R1: the pause was never consumed, so it re-pauses at the Review first.
    fireEvent.click(screen.getByRole("button", { name: "Back to review" }));
    expect(
      await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(cfg.approveRuns).toBe(2);
    expect(cfg.permitRuns).toBe(1);
    // Approving the fresh figures runs the send → live.
    const reviewLaunch = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
    if (!reviewLaunch) throw new Error("expected the review launch button");
    fireEvent.click(reviewLaunch);
    expect(
      await screen.findByText(/live on-chain/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(retryEvents()).toHaveLength(0);
  });
});
