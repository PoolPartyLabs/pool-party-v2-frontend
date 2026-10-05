/**
 * @id PP-MGR-LIB-021
 * @name buildPlan
 * @implements-rules-version v1 (POO-2151 rules v1); POO-2237 rules v1
 * @analytics-events none, a pure domain module. A refusal returns a {@link PlanBlock} and the Build
 *   screen (PP-MGR-SCR-002, slice S7) turns it into `builder_build_blocked`. Nothing here touches
 *   the dataLayer.
 *
 * The plan the Build canvas draws, as data (handoff v1.2, "Plan model"): the hub chains and the
 * spokes, left to right, each chain a top-to-bottom list of steps. A step is a position block (a
 * card: where capital sits) or a flow block (a pill: what moves or converts it). Everything the
 * canvas shows beyond this is DERIVED and never stored: positions and sizes, the Bridge of a spoke,
 * the Income (fees) block, the return lines, the ports, a block's network (C5), a card's title and
 * caption (from `kind` and `config`, HU2).
 *
 * `config` is the single source of "configured" (HU2). Null means the block is EMPTY: it was added
 * and nobody picked its pool or asset yet. The canvas-facing minimum (coordinator default D14) is
 * `{ poolId }` for a pool and `{ assetKey }` for an Aave block; the configuration panel batch
 * extends these interfaces and never renames them.
 *
 * Availability is DATA (C22): {@link BLOCK_KIND_STATUS} says which kinds a manager can place and
 * which are drawn but "coming soon". Enabling one later is a one-line change here. The Aave v3
 * Borrow entry is coordinator default D29 (enabled, as handoff v1.2 C22 says, against contracts
 * that are supply only): the product owner can overturn it, and the tests that depend on it set it
 * explicitly rather than reading this table.
 *
 * Imports are TYPES ONLY, from the draft and the catalog. `mandateDraft.ts` imports the plan types
 * back, so a runtime import in either direction would be a module cycle.
 */
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft, NetworkId, ProtocolId } from "../../mandateDraft";

/** The stored plan's version. A stored plan of any other version is unreadable (planStorage). */
export const BUILD_PLAN_VERSION = 1 as const;

/** Every position block kind. The last three are coming soon (C22) and are never created. */
export type BlockKind =
  | "uniswapV4Pool"
  | "aaveSupply"
  | "aaveBorrow"
  | "uniswapV3Pool"
  | "pendle"
  | "gmxPerp";

/** The two pool kinds: a Uniswap v3 position uses the same card and panel as a v4 one (C22). */
export type PoolBlockKind = "uniswapV4Pool" | "uniswapV3Pool";

/** The flow blocks the plan stores. The Bridge is derived from a spoke and never stored (C4). */
export type FlowKind = "swap" | "collectFees";

/**
 * A pool block's configuration (D14, extended by the panel contract of POO-2184, confirmed by the
 * launch owner on 2026-10-04; checks and helpers in `blockConfig.ts`, PP-MGR-LIB-026).
 *
 * `poolId` is the BARE Uniswap v4 PoolId (`MandatePoolRef.poolId`, bytes32) of a real pool, and the
 * row id of a mock pool, which has no PoolId: readers match `pool.poolId ?? pool.id` within the
 * block's network (`findMandatePool`), never the real row id `<chainId>:<poolId>`. The other fields
 * are what Apply writes and the launch adapter reads (`launch/plan.ts`). Each is optional, so a
 * pool picked but not yet ranged is still a stored plan; `isPoolConfigComplete` says when it is done.
 */
export interface PoolBlockConfig {
  poolId: string;
  /** Canonical lower tick (token1 per token0), on the pool's own tick spacing. */
  tickLower?: number;
  /** Canonical upper tick, above `tickLower`, on the same spacing. */
  tickUpper?: number;
  /** Full range: the ticks are then the finite aligned extremes (`fullRangeTicks`). */
  fullRange?: boolean;
  /** The panel shows the quote inverted. Display only: the ticks stay canonical. */
  displayInverted?: boolean;
  /** Max slippage of the Swap · auto and the mint, 0.1 to 5 (the launch's 10 to 500 bps). */
  slippagePct?: number;
}

/** An Aave block's configuration: `tokenKey(MandateTokenRef)`, "network:address" (D14). */
export interface AaveBlockConfig {
  assetKey: string;
  /** Only when the app swaps into the asset first (C13): that swap's max slippage, 0.1 to 5. */
  slippagePct?: number;
}

/** Which configuration each kind carries. Pendle and GMX are not drawn yet, so they carry none. */
export interface BlockConfigByKind {
  uniswapV4Pool: PoolBlockConfig;
  uniswapV3Pool: PoolBlockConfig;
  aaveSupply: AaveBlockConfig;
  aaveBorrow: AaveBlockConfig;
  pendle: never;
  gmxPerp: never;
}

/** A card. `config` null is an empty block (HU2). */
export type PositionBlock = {
  [K in BlockKind]: {
    id: string;
    family: "position";
    kind: K;
    config: BlockConfigByKind[K] | null;
  };
}[BlockKind];

/** A pill. `auto` blocks are owned by the app: they come and go with the block that needs them. */
export interface FlowBlock {
  id: string;
  family: "flow";
  kind: FlowKind;
  auto: boolean;
  /** Manual Swap only (POO-2237). A saved instruction, never an executable route. */
  config?: ManualSwapConfig;
}

export interface ManualSwapConfig {
  tokenInKey: string;
  tokenOutKey: string;
  slippagePct: number;
}

/** Panel-only discriminator. The spoke stores its share, not this value. */
export interface SpokePanelConfig {
  spoke: true;
}
export type PanelConfig = PoolBlockConfig | AaveBlockConfig | ManualSwapConfig | SpokePanelConfig;

export type Step = PositionBlock | FlowBlock;

/** A vertical sequence of blocks hanging from a row. `sharePct` is a % of the strategy (C8). */
export interface Chain {
  id: string;
  sharePct: number;
  /** Top to bottom. */
  steps: Step[];
}

/** A network other than the hub. Its Bridge is derived (C4); `sharePct` sits above that Bridge. */
export interface Spoke {
  network: NetworkId;
  sharePct: number;
  chains: Chain[];
}

/** The whole plan. Hub chains and spokes are left to right; spokes in the order they were added. */
export interface BuildPlan {
  version: 1;
  hub: { chains: Chain[] };
  spokes: Spoke[];
}

/** The phase of the builder a draft was last in (coordinator default D16). */
export type BuilderPhase = "mandate" | "build" | "review";

export type BlockKindStatus = "enabled" | "comingSoon";

/**
 * C22: which kinds a manager can place. DATA, not a branch: enabling a kind is changing its value.
 *
 * NOT the mandate catalog's `available` flag (`MandateProtocol.available`, mandateCatalog.ts). That
 * one says whether a PROTOCOL can be named in the mandate at all (Uniswap v3 positions cannot, R20
 * v3), and a protocol it turns off never reaches `draft.protocols`. This table says whether a BLOCK
 * KIND can be placed on the canvas. `kindAvailability` reads this table first, then whether the
 * kind's protocol is in `draft.protocols`, then the catalog's `availableOn`. The two tables agree on
 * Uniswap v3 today by decision, not by derivation: each one is flipped on its own.
 *
 * PP-NOTE: `aaveBorrow` is coordinator default D29 (handoff v1.2 C22 enables it; the fund contracts
 * are supply only). Moving it to "comingSoon" is this one line; see the file header.
 */
export const BLOCK_KIND_STATUS: Readonly<Record<BlockKind, BlockKindStatus>> = {
  uniswapV4Pool: "enabled",
  aaveSupply: "enabled",
  aaveBorrow: "enabled",
  uniswapV3Pool: "comingSoon",
  pendle: "comingSoon",
  gmxPerp: "comingSoon",
};

/**
 * The mandate protocol a kind needs (INV2). Pendle and GMX map to null: neither is a `ProtocolId`
 * (POO-2143 removed GMX from the mandate), so neither can ever be "in the mandate".
 */
export const BLOCK_KIND_PROTOCOL: Readonly<Record<BlockKind, ProtocolId | null>> = {
  uniswapV4Pool: "uniswap-v4",
  uniswapV3Pool: "uniswap-v3",
  aaveSupply: "aave-v3",
  aaveBorrow: "aave-v3",
  pendle: null,
  gmxPerp: null,
};

/**
 * What every reducer reads. `newId` is the only source of ids: reducers read no clock and no
 * randomness, so the same input always gives the same plan.
 */
export interface PlanContext {
  draft: MandateDraft;
  catalog: MandateCatalog;
  newId: () => string;
}

/** Why the canvas said no. The Build screen reports it as `builder_build_blocked` (S7). */
export type PlanBlockReason =
  /** A kind, network, pool or asset outside the mandate (C6, INV1, INV2). */
  | "not_in_mandate"
  /** C22. */
  | "coming_soon"
  /** C14: a Borrow only exists directly under a Supply of the same chain. */
  | "borrow_needs_supply"
  /** I2, open point 4: the Add network box with no mandate network left to add. */
  | "no_network_left"
  /** INV1: a network appears at most once. */
  | "network_on_canvas"
  /** INV5, I4: nothing of that kind fits that slot. */
  | "slot_not_allowed"
  /** INV3: what hangs below never adds up to more than the node above. */
  | "share_exceeds_parent"
  /** INV6: an `auto` block cannot be added or removed on its own. */
  | "auto_owned"
  /** I7 (coordinator default D5): only a spoke with no chain can be removed. */
  | "spoke_not_empty"
  /** The block, chain, spoke or row named does not exist, or the input is not what it names. */
  | "unknown_target";

/** A refusal. `targetId` names the block, chain or network it is about, when there is one. */
export interface PlanBlock {
  reason: PlanBlockReason;
  targetId: string | null;
}

/** What every plan reducer returns. */
export type PlanReducerResult = BuildPlan | { blocked: PlanBlock };

/** Whether a plan reducer refused. The one narrowing every caller uses. */
export function isPlanBlocked(result: unknown): result is { blocked: PlanBlock } {
  return typeof result === "object" && result !== null && "blocked" in result;
}

/** A plan with no chain and no spoke: the empty canvas. A new object on every call. */
export function createEmptyPlan(): BuildPlan {
  return { version: BUILD_PLAN_VERSION, hub: { chains: [] }, spokes: [] };
}

/** The draft's plan, or the empty plan when it has none (a draft that never reached Build). */
export function planOf(draft: MandateDraft): BuildPlan {
  return draft.plan ?? createEmptyPlan();
}
