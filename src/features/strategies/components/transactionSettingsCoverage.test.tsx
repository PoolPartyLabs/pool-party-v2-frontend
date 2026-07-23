/**
 * @id PP-STR-MOD-007 (POO-478)
 * @name Transaction-settings coverage guard
 * @implements-rules-version v1
 *
 * POO-478 [R4]: the standing rule is that EVERY modal sending an on-chain transaction exposes BOTH
 * Max slippage AND Transaction deadline in its settings gear, investor and manager alike (deadline
 * may be display-only where the build does not consume it yet, but it MUST render). This suite is the
 * regression guard: one case per transactional surface renders it, opens its gear, and asserts both
 * controls are present, so no future tx flow can ship the gear without them. Adding a new tx modal
 * without wiring both controls (or regressing an existing one) fails here.
 *
 * Covered surfaces: Invest, Withdraw, Compound, Collect (investor + manager), Move Range, Remove/Close,
 * and Create Pool (the builder's Review step). The two POO-478 fixes (manager Collect + Create Pool)
 * are the reason this guard exists.
 */
import { describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";
import { managerFeePolicy, managerPosition } from "@/mocks/data/manager";
import { uniswapPools } from "@/mocks/data/pools";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import type { MandateResult } from "../../manager/components/MandateStep";
import { MoveRangeModal } from "../../manager/components/MoveRangeModal";
import type { RemoveLiquidityTarget } from "../../manager/components/RemoveLiquidityModal";
import { RemoveLiquidityModal } from "../../manager/components/RemoveLiquidityModal";
import { ReviewStep } from "../../manager/components/ReviewStep";
import { deriveMandate } from "../../manager/lib/deriveMandate";
import { CollectModal } from "./CollectModal";
import { CompoundModal } from "./CompoundModal";
import { InvestModal } from "./InvestModal";
import { WithdrawModal } from "./WithdrawModal";

// One combined services stub for the manager surfaces (mock mode; only the gear is exercised, never a
// submit, so the mutations are never called — they exist to satisfy the module shape).
vi.mock("@/lib/services", () => ({
  isMockMode: true,
  managerService: {
    moveRange: vi.fn(async () => ({ rangeMin: 0, rangeMax: 0, gasCostUsd: 0 })),
    closeStrategy: vi.fn(async () => undefined),
    createStrategy: vi.fn(),
  },
}));
// Remove/Close renders the real-executor hook at the top; stub it (mock mode never uses it).
vi.mock("../../manager/hooks/useManagerRemoveLiquidity", () => ({
  useManagerRemoveLiquidity: () => ({ buildSteps: vi.fn(), execute: vi.fn() }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// The ReviewStep mock-create post-write refresh needs a request scope; stub it out.
vi.mock("@/lib/tx/usePostWriteRefresh", () => ({ usePostWriteRefresh: () => vi.fn() }));

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

const managedCollect = {
  strategyId: "pool-1",
  name: "ETH/USDC",
  initials: "E",
  poolLabel: "Base · 0.30%",
  availableUsd: 120,
  gasEstimateUsd: 0.4,
  note: "The manager pays gas.",
  onCollect: vi.fn().mockResolvedValue(undefined),
};

const removeTarget: RemoveLiquidityTarget = {
  strategyId: "0xpos",
  network: "arbitrum",
  stakeUsd: 1000,
  feesUsd: 12.34,
  gasCostUsd: 0.5,
};

const pool = uniswapPools[0];
function makeMandate(): MandateResult {
  if (!pool) throw new Error("expected at least one mock pool");
  return {
    selection: {
      name: "My Stable Yield",
      description: "Earns steady stablecoin yield.",
      logoUrl: null,
      network: pool.network,
      query: "",
      poolId: pool.id,
      full: false,
      activePreset: 10,
      minPrice: "0.99",
      maxPrice: "1.01",
    },
    pool,
    derived: deriveMandate(pool, 10),
    rangeWidthPct: 10,
  };
}

/**
 * Every transactional surface with the accessible name of its gear trigger, a render fn, and an
 * optional `reachGear` step to advance a multi-step modal to the phase that owns the gear. POO-570:
 * the investor + Remove/partial gears now live on the FIRST (input) step, so they need no navigation;
 * only Create Pool still advances (its gear is on the Launch confirm, POO-550).
 */
const SURFACES: Array<{
  name: string;
  gearLabel: string;
  render: () => void;
  reachGear?: () => void;
}> = [
  {
    name: "Invest",
    gearLabel: "Transaction settings",
    // POO-570 R1: the gear lives on the amount (input) step — the first screen — so no navigation.
    render: () =>
      renderWithProviders(
        <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={1000} />,
      ),
  },
  {
    name: "Withdraw",
    gearLabel: "Transaction settings",
    // POO-570 R1: the gear lives on the method (input) step — the first screen for an active
    // position — so no navigation.
    render: () =>
      renderWithProviders(
        <WithdrawModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
      ),
  },
  {
    name: "Compound",
    gearLabel: "Transaction settings",
    render: () =>
      renderWithProviders(
        <CompoundModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
      ),
  },
  {
    name: "Collect (investor)",
    gearLabel: "Transaction settings",
    render: () =>
      renderWithProviders(
        <CollectModal open onOpenChange={vi.fn()} strategy={strategy} position={position} />,
      ),
  },
  {
    name: "Collect (manager)",
    gearLabel: "Transaction settings",
    render: () =>
      renderWithProviders(<CollectModal open onOpenChange={vi.fn()} managed={managedCollect} />),
  },
  {
    name: "Move Range",
    gearLabel: "Settings",
    render: () =>
      renderWithProviders(
        <MoveRangeModal
          open
          onOpenChange={vi.fn()}
          position={managerPosition}
          currentMin={2850}
          currentMax={3400}
          onMoved={vi.fn()}
        />,
      ),
  },
  {
    name: "Remove / Close",
    gearLabel: "Transaction settings",
    // POO-570 R1: the gear lives on the form (input) step — the first screen for a partial remove —
    // so no navigation. (The close path keeps its gear on the close Review, covered by the
    // RemoveLiquidityModal suite.)
    render: () =>
      renderWithProviders(
        <RemoveLiquidityModal
          open
          onOpenChange={vi.fn()}
          target={removeTarget}
          onRemoved={vi.fn()}
        />,
      ),
  },
  {
    name: "Create Pool (Review)",
    gearLabel: "Transaction settings",
    // POO-550: the create-pool gear moved into the Launch modal; open it before opening the gear.
    reachGear: () => fireEvent.click(screen.getByRole("button", { name: "Launch strategy" })),
    render: () =>
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      ),
  },
];

describe("transaction-settings coverage guard (POO-478 R4)", () => {
  for (const surface of SURFACES) {
    // @rule POO-478 R4 — every transactional modal exposes both slippage and deadline in its gear.
    it(`${surface.name} exposes both slippage and deadline settings`, () => {
      surface.render();
      surface.reachGear?.();
      fireEvent.click(screen.getByRole("button", { name: surface.gearLabel }));
      expect(screen.getByText("Max slippage")).toBeInTheDocument();
      expect(screen.getByText("Transaction deadline")).toBeInTheDocument();
    });
  }
});
