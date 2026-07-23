/**
 * @id PP-MGR-SCR-002 (POO-309)
 * @name ReviewStep real-mode.test
 * @implements-rules-version v1
 *
 * Behavior in real mode (POO-309): the seed-liquidity card gates Launch (disabled until both seed
 * amounts are valid), "Save as draft" is hidden, and Launch drives the multistep wallet-sign runner
 * (FU-001) with the on-chain create-pool steps built from the mapped pool + seed + featureSettings,
 * then shows the on-chain live copy. The SeedLiquidityCard is stubbed here (its own on-chain reads are
 * tested separately); useCreatePool is mocked to a buildSteps spy returning a resolving step list.
 *
 * POO-893 rules v1: the post-build Review must mount with NO tooltip open and focus on the dialog
 * container ([R1]/[R2]); the fee (i) trigger stays keyboard-accessible ([R3]). The fee-value
 * assertion is exact-one ([R5]) so a mount-focus auto-opened breakdown tooltip can never hide again.
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
  within,
} from "../../../../tests/utils/renderWithProviders";
import { deriveMandate } from "../lib/deriveMandate";
import type { MandateResult } from "./MandateStep";

const cfg = vi.hoisted(() => ({
  seedValid: true,
  amount0: BigInt(1000) as bigint | null,
  amount1: BigInt(2000) as bigint | null,
  buildSteps: vi.fn(),
  // POO-496 R1: the exact SeedState the stubbed card reports up on mount. When null, the stub falls
  // back to a legacy amounts-only report (no decimals) so the existing full-range tests are unchanged.
  seedReport: null as {
    amount0: bigint | null;
    amount1: bigint | null;
    valid: boolean;
    decimals0: number | null;
    decimals1: number | null;
  } | null,
  // POO-496 R1: every tick pair the card is rendered with, so a test can assert they resolved.
  tickProps: [] as Array<{ tickLower: number | null; tickUpper: number | null }>,
  // POO-496 R1 edge: when set, the stub re-emits its identical report to exercise the drop guard.
  reportTwice: false,
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
// is a no-op here (its own convergence/badge behavior is covered in ReviewStepMetadata.test.tsx).
vi.mock("../hooks/useCreateStrategyMetadata", () => ({
  useCreateStrategyMetadata: () => ({
    create: vi.fn(async () => "str-test"),
    confirm: vi.fn(),
    confirmStatus: "idle",
    retryConfirm: vi.fn(),
  }),
}));

// Stub the seed card: reports the configured amounts/validity up on mount and records the tick props
// it receives so a test can assert the parent resolved them from the reported decimals (POO-496 R1).
vi.mock("./SeedLiquidityCard", () => ({
  SeedLiquidityCard: ({
    tickLower,
    tickUpper,
    onChange,
  }: {
    tickLower: number | null;
    tickUpper: number | null;
    onChange: (s: {
      amount0: bigint | null;
      amount1: bigint | null;
      valid: boolean;
      decimals0?: number | null;
      decimals1?: number | null;
    }) => void;
  }) => {
    cfg.tickProps.push({ tickLower, tickUpper });
    useEffect(() => {
      const report = cfg.seedReport ?? {
        amount0: cfg.amount0,
        amount1: cfg.amount1,
        valid: cfg.seedValid,
      };
      onChange(report);
      // POO-496 R1 edge: re-emit the identical report to exercise handleSeedChange's drop guard.
      if (cfg.reportTwice) onChange({ ...report });
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

/** A concentrated (non-full) mandate, so the Review step's range ticks depend on the reported
 *  decimals (POO-496 R1): min/max in token1-per-token0 around the mock pool's 1700 price. */
function makeRangedMandate(): MandateResult {
  const base = makeMandate();
  return {
    ...base,
    selection: {
      ...base.selection,
      full: false,
      activePreset: null,
      minPrice: "1500",
      maxPrice: "1900",
    },
  };
}

/** A mandate on a pool with NO market price (the Number.MIN_VALUE sentinel). POO-497 R3: such a pool
 *  is filtered out of the picker, but if it slips through Launch must stay blocked (defensive guard). */
function makeNoPriceMandate(): MandateResult {
  const base = makeMandate();
  return { ...base, pool: { ...base.pool, currentPrice: Number.MIN_VALUE } };
}

/** A mandate whose pool carries the dex-pools per-token USD prices, so the POO-524 confirm/receipt
 *  rows can value the seed (ETH at $3,000, USDC at $1). */
function makePricedMandate(): MandateResult {
  const base = makeMandate();
  return { ...base, pool: { ...base.pool, token0PriceUsd: 3000, token1PriceUsd: 1 } };
}

beforeEach(() => {
  cfg.seedValid = true;
  cfg.seedReport = null;
  cfg.tickProps = [];
  cfg.reportTwice = false;
  // A resolving 5-step sequence (approve ×2 → permit → build → send); the build step holds briefly so
  // the wallet-signing modal is observably up before the flow settles to success.
  cfg.buildSteps.mockReset().mockReturnValue([
    { key: "approve:token0", run: async () => ({ skipped: true }) },
    { key: "approve:token1", run: async () => ({ skipped: true }) },
    { key: "permit", run: async () => ({}) },
    {
      key: "build",
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {};
      },
    },
    { key: "confirm:addLiquidity", run: async () => ({ txHash: "0xabc" }) },
  ]);
});

describe("ReviewStep (real mode)", () => {
  // POO-496 R1: a decimals-only report (amounts null, valid false) must reach Review state so a
  // non-full range's ticks resolve before any amount is typed. Before the fix handleSeedChange drops
  // it (amount0/amount1/valid unchanged), decimalsReady stays false, and the card keeps null ticks.
  it("stores a decimals-only seed report so the range ticks resolve before any amount is typed (POO-496 R1)", async () => {
    cfg.seedReport = {
      amount0: null,
      amount1: null,
      valid: false,
      decimals0: 18,
      decimals1: 6,
    };
    renderWithProviders(
      <ReviewStep mandate={makeRangedMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    // After the decimals-only report lands, the parent re-renders the card with resolved (non-null)
    // ticks for the 1500–1900 range; before the fix the last render still carries null ticks.
    await vi.waitFor(() => {
      const last = cfg.tickProps.at(-1);
      expect(last?.tickLower).not.toBeNull();
      expect(last?.tickUpper).not.toBeNull();
    });
  });

  // POO-496 R1 edge: a fully identical report (same amounts, validity AND decimals) is still dropped,
  // so a card that re-reports the exact same SeedState causes no extra state churn / re-render.
  it("keeps dropping a fully identical seed report (no state churn)", async () => {
    cfg.reportTwice = true; // the stub emits the SAME report twice on mount
    cfg.seedReport = {
      amount0: BigInt(1000),
      amount1: BigInt(2000),
      valid: true,
      decimals0: 18,
      decimals1: 6,
    };
    renderWithProviders(
      <ReviewStep mandate={makeRangedMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    // The ticks resolve from the first report's decimals; the identical second report returns the
    // same state reference (prev), so it never triggers a further re-render.
    await vi.waitFor(() => expect(cfg.tickProps.at(-1)?.tickLower).not.toBeNull());
    const settled = cfg.tickProps.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cfg.tickProps.length).toBe(settled);
  });

  it("hides Save as draft and renders the seed card", () => {
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    expect(screen.getByTestId("seed-card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save as draft" })).not.toBeInTheDocument();
  });

  it("disables Launch until the seed is valid", () => {
    cfg.seedValid = false;
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Launch strategy" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  // @rule R3 (POO-497): the create flow never builds a position on a pool without a defined market
  // price. No-price pools are filtered out of the picker (R1); this is the defensive backstop — even
  // with a valid seed + name, a no-price pool keeps Launch blocked so the flow cannot proceed.
  it("keeps Launch blocked on a no-price pool even when the seed is valid (POO-497 R3)", () => {
    cfg.seedValid = true;
    renderWithProviders(
      <ReviewStep mandate={makeNoPriceMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Launch strategy" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("[POO-315] disables Launch + shows an error for a name shorter than 10 chars", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    const nameInput = screen.getByLabelText("Strategy name");
    await user.clear(nameInput);
    await user.type(nameInput, "Short");
    expect(screen.getByText("Name must be 10–50 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch strategy" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("launches on-chain via the wallet-sign runner and shows the on-chain live copy", async () => {
    const user = userEvent.setup();
    if (!pool) throw new Error("expected a pool");
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );

    const launch = screen.getByRole("button", { name: "Launch strategy" });
    expect(launch).not.toHaveAttribute("aria-disabled");
    await user.click(launch);

    // Confirm modal, then its confirm button.
    expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
    if (!confirm) throw new Error("expected the modal confirm button");
    await user.click(confirm);

    // The steps are built from the mapped pool + seed + featureSettings.
    expect(cfg.buildSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        network: pool.network,
        feeBps: pool.feeBps,
        token0: pool.token0Address,
        token1: pool.token1Address,
        amount0: cfg.amount0,
        amount1: cfg.amount1,
        featureSettings: expect.objectContaining({
          name: "On-chain Strat",
          poolManagerFee: 20,
        }),
      }),
    );
    // The multistep wallet-signing modal shows while the on-chain steps run.
    expect(await screen.findByText("Continue in your wallet")).toBeInTheDocument();
    // POO-599: after the build settles, the flow pauses on the built-figures Review; approving sends.
    expect(
      await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Launch strategy" }));
    expect(
      await screen.findByText(/live on-chain/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  // @rule POO-478 R3 — Create Pool's Review step gains the standard settings gear. It opens the shared
  // TransactionSettingsDialog with Max slippage + Transaction deadline (30, display-only).
  // @rule POO-525 R1 — the gear seeds the create-pool default 2%.
  // @rule POO-547 R1 — the custom slippage cap is now the uniform 100% (the old manager/create-pool 5%
  // ceiling is gone), so a value above 100 clamps to 100.
  it("[POO-547 R1] renders the settings gear with slippage (2% default, capped 100) and deadline", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    // POO-550: the gear now lives in the Launch modal, so open the launch confirm first.
    await user.click(screen.getByRole("button", { name: "Launch strategy" }));
    await user.click(screen.getByRole("button", { name: "Transaction settings" }));
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    expect(screen.getByText("Transaction deadline")).toBeInTheDocument();
    // The default seeds the 2% PRESET as selected, so the custom field starts empty; the custom cap
    // is now the uniform 100, so a larger custom value is clamped to 100.
    const custom = screen.getByLabelText("Custom");
    expect(custom).toHaveValue("");
    await user.type(custom, "150");
    expect(custom).toHaveValue("100");
  });

  // @rule POO-478 R3 — the chosen slippage flows into buildCreatePoolTxAction (via createPoolInput,
  // asserted on the buildSteps spy).
  // @rule POO-525 R1 — default (no gear change) threads CREATE_POOL_DEFAULT_SLIPPAGE_PCT (2).
  it("[POO-525 R1] threads the default create-pool slippage (2) into the build input", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Launch strategy" }));
    expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
    const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
    if (!confirm) throw new Error("expected the modal confirm button");
    await user.click(confirm);
    expect(cfg.buildSteps).toHaveBeenCalledWith(expect.objectContaining({ slippageTolerance: 2 }));
  });

  // @rule POO-478 R3 — a slippage the manager picks in the gear reaches the build input verbatim.
  it("[POO-478 R3] threads the manager-chosen slippage into the create-pool build input", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    // POO-550: open the Launch modal (which now hosts the gear), pick the 1% preset, then confirm.
    await user.click(screen.getByRole("button", { name: "Launch strategy" }));
    expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Transaction settings" }));
    await user.click(screen.getByRole("button", { name: "1%" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
    if (!confirm) throw new Error("expected the modal confirm button");
    await user.click(confirm);
    expect(cfg.buildSteps).toHaveBeenCalledWith(expect.objectContaining({ slippageTolerance: 1 }));
  });

  // POO-524 (rules v1): the launch confirm shows the per-token seed amounts (logo row + USD) and
  // ONE consolidated Fee row; the "Your strategy is live" success view gains a receipt with the
  // seeded amounts + USD snapshotted at tx time and the mined transaction hash + explorer link.
  describe("launch confirm seed rows + success receipt (POO-524)", () => {
    beforeEach(() => {
      // 0.5 ETH (18 decimals) + 1,000 USDC (6 decimals) — a realistic priced seed.
      cfg.seedReport = {
        amount0: BigInt("500000000000000000"),
        amount1: BigInt("1000000000"),
        valid: true,
        decimals0: 18,
        decimals1: 6,
      };
    });

    // @rule POO-524 R1 — per-token seed amounts (TokenAmountRow: amount + USD) render on the confirm;
    // the Fee row renders the pending placeholder in real mode (no gas figure exists before the
    // flow's build step returns estimatedGasInUsd; never a fabricated number).
    it("shows per-token seed amounts + USD and a pending Fee row in the launch confirm (R1)", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makePricedMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.getByText("Seed liquidity")).toBeInTheDocument();
      expect(dialog.getByText("0.5 ETH")).toBeInTheDocument();
      expect(dialog.getByText("($1,500.00)")).toBeInTheDocument();
      expect(dialog.getByText("1,000 USDC")).toBeInTheDocument();
      expect(dialog.getByText("($1,000.00)")).toBeInTheDocument();
      // Real mode pre-build: the Fee row shows the placeholder, not a number (no-fake-data rule).
      expect(dialog.getByText("Fee")).toBeInTheDocument();
      expect(dialog.getByText("Estimated at signing")).toBeInTheDocument();
    });

    // @rule POO-524 R2 — the success view's receipt: seeded per-token amounts + USD captured at tx
    // time (transaction display rule) and the Transaction row with the mined flow.txHash + the
    // explorer link (getExplorerTxUrl; base → Basescan).
    it("shows the seeded amounts + mined tx hash + explorer link on the live view (R2)", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makePricedMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
      const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
      if (!confirm) throw new Error("expected the modal confirm button");
      await user.click(confirm);

      // POO-599: approve on the built-figures Review to send; the receipt snapshots on success.
      expect(
        await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));

      expect(
        await screen.findByText(/live on-chain/, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      // Per-token amounts + USD, snapshotted when the tx settled.
      expect(screen.getByText("0.5 ETH")).toBeInTheDocument();
      expect(screen.getByText("($1,500.00)")).toBeInTheDocument();
      expect(screen.getByText("1,000 USDC")).toBeInTheDocument();
      expect(screen.getByText("($1,000.00)")).toBeInTheDocument();
      // The mined hash (from the confirm:addLiquidity step) + its explorer link.
      expect(screen.getByText("Transaction")).toBeInTheDocument();
      expect(screen.getByText("0xabc")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View on explorer" })).toHaveAttribute(
        "href",
        "https://basescan.org/tx/0xabc",
      );
    });
  });

  // POO-599: the build→review→sign handshake — the launch now pauses on a built-figures Review (with
  // the 10s re-quote countdown) before the final send, mirroring the shipped op-modals.
  describe("POO-599 build→review→sign handshake", () => {
    it("pauses on the Review before the send and fires strategy_launch_submitted once (on the flow-start)", async () => {
      window.dataLayer = [];
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
      if (!confirm) throw new Error("expected the modal confirm button");
      await user.click(confirm);
      // The build settles → the flow PAUSES on the Review (the re-quote countdown is unique to it),
      // it has NOT sent yet.
      expect(
        await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      // R3: the submit event already fired ONCE, on the flow-start (before the Review approve).
      const submitted = () =>
        (window.dataLayer ?? []).filter(
          (e) => (e as { event?: string }).event === "strategy_launch_submitted",
        );
      expect(submitted()).toHaveLength(1);
      expect(submitted()[0]).toMatchObject({ strategy_id: pool?.id });
      // Approving on the Review resumes into the send → live on-chain.
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      expect(
        await screen.findByText(/live on-chain/, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      // Still exactly one submit event — the Review approve must NOT re-fire it.
      expect(submitted()).toHaveLength(1);
    });

    it("[R2] the Review fee shows the built network gas ($2.50), not the pending placeholder", async () => {
      cfg.buildSteps.mockReset().mockReturnValue([
        { key: "approve:token0", run: async () => ({ skipped: true }) },
        { key: "approve:token1", run: async () => ({ skipped: true }) },
        { key: "permit", run: async () => ({}) },
        {
          key: "build",
          run: async () => ({ built: { tx: { to: "0x0", data: "0x" }, estimatedGasInUsd: 2.5 } }),
        },
        { key: "confirm:addLiquidity", run: async () => ({ txHash: "0xabc" }) },
      ]);
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
      if (!confirm) throw new Error("expected the modal confirm button");
      await user.click(confirm);
      expect(
        await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      // The built gas drives the Review fee; the pre-build "Estimated at signing" placeholder is
      // gone. POO-893 [R5]/[R1]: EXACTLY ONE $2.50 text node (the row value) and no open tooltip.
      // A second $2.50 means the breakdown tooltip auto-opened on the dialog's mount focus.
      expect(screen.getAllByText("$2.50")).toHaveLength(1);
      expect(screen.queryByRole("tooltip")).toBeNull();
      expect(screen.queryByText("Estimated at signing")).toBeNull();
    });

    // POO-893 rules v1: a fresh-mount <Dialog open> (signing -> review) must not let Radix's
    // open-autofocus land on the fee (i) trigger and auto-open the breakdown tooltip.
    it("[R1][R2][R3] the Review mounts with no tooltip open, focus on the dialog container, and the (i) trigger still opens on keyboard focus", async () => {
      cfg.buildSteps.mockReset().mockReturnValue([
        { key: "approve:token0", run: async () => ({ skipped: true }) },
        { key: "approve:token1", run: async () => ({ skipped: true }) },
        { key: "permit", run: async () => ({}) },
        {
          key: "build",
          run: async () => ({ built: { tx: { to: "0x0", data: "0x" }, estimatedGasInUsd: 2.5 } }),
        },
        { key: "confirm:addLiquidity", run: async () => ({ txHash: "0xabc" }) },
      ]);
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
      if (!confirm) throw new Error("expected the modal confirm button");
      await user.click(confirm);
      expect(
        await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      // [R1] no tooltip is open at mount; [R2] initial focus sits on the dialog CONTAINER (not the
      // (i) trigger, and deliberately not the Launch button: Enter-to-confirm in a money flow).
      expect(screen.queryByRole("tooltip")).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole("dialog"));
      // [R3] the (i) trigger stays keyboard-accessible and FIRST in the tab order: one Tab focuses
      // it and user-initiated keyboard focus opens the tooltip (POO-840 tap-to-open untouched).
      await user.tab();
      const infoTrigger = screen.getByRole("button", { name: /network fee/i });
      expect(document.activeElement).toBe(infoTrigger);
      expect(await screen.findByRole("tooltip")).toBeInTheDocument();
      expect(screen.getAllByText("$2.50").length).toBeGreaterThan(1);
      // [R3] blur (tabbing on to Launch) closes it again.
      await user.tab();
      expect(screen.queryByRole("tooltip")).toBeNull();
      expect(screen.getAllByText("$2.50")).toHaveLength(1);
    });

    it("[R2] a degenerate $0 built gas (e.g. the CoinGecko price fetch failed) keeps the honest placeholder, not $0.00", async () => {
      // The backend computes estimatedGasInUsd = nativeUsd * gasInEth, so a failed price fetch yields
      // exactly 0. The Review must NOT show a misleading "$0.00" gas — it falls back to the placeholder.
      cfg.buildSteps.mockReset().mockReturnValue([
        { key: "approve:token0", run: async () => ({ skipped: true }) },
        { key: "approve:token1", run: async () => ({ skipped: true }) },
        { key: "permit", run: async () => ({}) },
        {
          key: "build",
          run: async () => ({ built: { tx: { to: "0x0", data: "0x" }, estimatedGasInUsd: 0 } }),
        },
        { key: "confirm:addLiquidity", run: async () => ({ txHash: "0xabc" }) },
      ]);
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
      if (!confirm) throw new Error("expected the modal confirm button");
      await user.click(confirm);
      expect(
        await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(screen.getByText("Estimated at signing")).toBeInTheDocument();
      expect(screen.queryByText("$0.00")).toBeNull();
    });

    it("[R1] the Review re-quotes (rebuilds) after the 10s countdown lapses without approval", async () => {
      vi.useFakeTimers();
      try {
        const buildRun = vi.fn(async () => ({}));
        cfg.buildSteps.mockReset().mockReturnValue([
          { key: "approve:token0", run: async () => ({ skipped: true }) },
          { key: "approve:token1", run: async () => ({ skipped: true }) },
          { key: "permit", run: async () => ({}) },
          { key: "build", run: buildRun },
          { key: "confirm:addLiquidity", run: async () => ({ txHash: "0xabc" }) },
        ]);
        renderWithProviders(
          <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
        );
        // Flush the stubbed seed report so Launch is enabled.
        await vi.advanceTimersByTimeAsync(0);
        fireEvent.click(screen.getByRole("button", { name: "Launch strategy" }));
        const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
        if (!confirm) throw new Error("expected the modal confirm button");
        fireEvent.click(confirm);
        // Flush approve → permit → build (all instant) into the awaiting pause → Review.
        await vi.advanceTimersByTimeAsync(0);
        expect(screen.getByText(/Refreshes in/)).toBeInTheDocument();
        expect(buildRun).toHaveBeenCalledTimes(1);
        // At 0 the Review re-quotes (flow.rebuild re-runs ONLY the build); still on the Review. The
        // window mirrors ReviewStep's REVIEW_REFRESH_SECS (10s).
        await vi.advanceTimersByTimeAsync(10_000);
        expect(screen.getByText(/Refreshes in/)).toBeInTheDocument();
        expect(buildRun.mock.calls.length).toBeGreaterThanOrEqual(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
