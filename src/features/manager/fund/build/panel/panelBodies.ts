/**
 * @id PP-MGR-CMP-061
 * @name panelBodies
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a registry of types and components; the shell (BlockPanel) reports what
 *   a body does through the panel's draft.
 *
 * The kind to body registry of the configuration panel (POO-2187). Rides on PP-MGR-CMP-061
 * (BlockPanel) and has no id of its own.
 *
 * The SHELL owns what every block shares: the head, the modes, the Use of Mode 2 (the kind's
 * defaults, share 0%, decision DP1), the Allocation field with its ceiling (P8), the status row,
 * Apply changes, Remove block and its confirm, the leave guard, and the notice of a refused Use or
 * Apply. A BODY owns what only its kind knows, in three parts:
 *
 * - `usePick` (Modes 2 and 3): the rows the mandate offers this block on its network, each with the
 *   config `Use` writes (the kind's defaults; null while it cannot be built yet, which disables that
 *   row's Use; a `disabledReason` disables it and says why, for a reserve that is not usable), and
 *   the copy around them (heading, filter placeholder, caption, link row, no-match box). It is a
 *   hook, called by a component the shell keys on the block, so a body may read live data (P13)
 *   through its own hooks.
 * - `Fields` (Mode 4): everything between the head and the status row, in the kind's own order
 *   (the Pool, then the Allocation, then the Price range, then Max slippage, for a pool). It edits
 *   the DRAFT only (P3) through `onConfigChange`, and places the ready Allocation field the shell
 *   hands it (`allocation`, null when this block takes no share of its own) where its kind wants it.
 * - `useApplyGate` (optional, P13): whether Apply changes may run for the draft config, and the
 *   sentence that says why not (a live read loading or failed, a bound still being typed). The
 *   shell holds Apply disabled and shows the sentence in the status row. A hook, called in a
 *   component the shell keys on the block.
 *
 * IDS (review M3 of PR #54). A config a body writes, and the ids it keys its select options by,
 * are the mandate rows' CANONICAL keys, the ones the reducer stores (`setBlockConfig`, PA1):
 * `panelPoolId(pool)` (`poolRefKey`: the bare lowercase v4 PoolId of a real row, never its row id
 * `<chainId>:<poolId>`; a mock row's id) for `poolId`, and `panelAssetKey(token)` (`tokenKey`:
 * "network:address", lowercase) for `assetKey`, both re-exported here from `panelIds.ts`. A range
 * sits on `pool.poolKey.tickSpacing` (`isRangeOnGrid`), and Full is `fullRangeTicks(spacing)`:
 * anything else is refused with `unknown_target`. The shell ENFORCES the ids: every config a body
 * hands to Use or to `onConfigChange` goes through `canonicalPanelConfig` first, so a row id or
 * another casing still lands as the canonical key, and the draft never reads a casing change as
 * an edit.
 *
 * The next slices register here: the Uniswap v4 pool body (`uniswapV4Pool`) and the Aave v3 Supply
 * body (`aaveSupply`), each one line in {@link PANEL_BODIES}. A kind with no body shows the head
 * and Remove block, as the canvas batch's stub did.
 */
import type { ComponentType, ReactNode } from "react";
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft, NetworkId } from "../../mandateDraft";
import type { MandateEditStep } from "../blocks/useBuildCanvas";
import type { BlockConfigByKind, BlockKind, BuildPlan } from "../plan/buildPlan";
import type { PanelPickItem } from "./PanelPickList";
import { poolBlockPanel } from "./PoolBlockPanel";
import { supplyBlockBody } from "./SupplyBlockPanel";

export { canonicalPanelConfig, panelAssetKey, panelPoolId } from "./panelIds";

/** What a body knows about the block it configures. */
export interface PanelBodyContext {
  blockId: string;
  kind: BlockKind;
  /** Where the block sits (C5): every list is already this network's (P1, P2). */
  network: NetworkId;
  /** The translated network name. */
  networkName: string;
  /** The mandate the plan is built against (pools, tokens, caps). */
  draft: MandateDraft;
  catalog: MandateCatalog;
  /** The applied plan. */
  plan: BuildPlan;
  /** Follow an Edit mandate link, through the leave guard; Build comes back with this block. */
  onEditMandate(step: MandateEditStep): void;
}

/** One row of Mode 2, with the config `Use` writes. */
export interface PanelPickRow<C> extends PanelPickItem {
  /** The applied config after Use, with the kind's defaults; null disables Use (not ready yet). */
  config: C | null;
}

/** Modes 2 and 3 of one kind: the rows and the copy around them. */
export interface PanelPickModel<C> {
  /** "Pools in your mandate". */
  heading: string;
  /** Every item of the mandate on this network. */
  count: number;
  /** "Filter by token or address". */
  filterPlaceholder: string;
  rows: ReadonlyArray<PanelPickRow<C>>;
  /** "Only the Uniswap v4 pools on <Network> that you chose in the mandate (step 4). ..." */
  caption: string;
  /** "Need another pool?" + "Edit mandate · Pools", and the step it opens. */
  link: { prompt: string; label: string; step: MandateEditStep };
  /** Mode 3: "No pool in your mandate has <typed text>", and its caption. */
  noMatch: { title(typed: string): string; caption: string };
  /** The mandate holds nothing for this block here: "No pool of your mandate is on <Network>". */
  emptyTitle: string;
  /** P13: the body's live read. */
  status?: "ready" | "loading" | "error";
  onRetry?(): void;
}

/** What Mode 4's fields receive. */
export interface PanelFieldsProps<C> {
  context: PanelBodyContext;
  /** What the plan holds for the block (the canvas shows this). */
  applied: C;
  /** The panel's draft (P3): what the fields show and edit. */
  config: C;
  /** Write the draft. Nothing reaches the canvas before Apply changes. */
  onConfigChange(next: C): void;
  /** The Allocation field, ready to place; null when this block takes no share of its own (P8). */
  allocation: ReactNode | null;
}

/** P13: whether Apply changes may run, and the translated sentence that says why not. */
export interface PanelApplyGate {
  ok: boolean;
  /** Shown in the status row while `ok` is false: "Waiting for the pool price." */
  reason?: string;
}

/** A configured body's provider shares live data between fields and the Apply gate. */
export interface PanelConfiguredProviderProps<C> {
  context: PanelBodyContext;
  config: C;
  children: ReactNode;
}

/** One kind's body. */
export interface PanelBodyDefinition<C> {
  /** Optional shared live snapshot, mounted above both Fields and useApplyGate. */
  Provider?: ComponentType<PanelConfiguredProviderProps<C>>;
  /** Modes 2 and 3. A hook: the shell calls it in a component keyed on the block. */
  usePick(context: PanelBodyContext): PanelPickModel<C>;
  /** Mode 4: the fields between the head and the status row. */
  Fields: ComponentType<PanelFieldsProps<C>>;
  /**
   * P13 (review M1 of PR #54), optional: whether Apply changes may run for the draft `config`. A
   * hook, called on every render of Mode 4 in a component keyed on the block. Omitted: always ok.
   */
  useApplyGate?(context: PanelBodyContext, config: C): PanelApplyGate;
}

/** The registry: a body per kind, typed by the config that kind carries. */
export type PanelBodies = {
  readonly [K in BlockKind]?: PanelBodyDefinition<BlockConfigByKind[K]>;
};

/**
 * The bodies of the app. Each kind registers independently; the shell owns shared behavior.
 */
export const PANEL_BODIES: PanelBodies = {
  uniswapV4Pool: poolBlockPanel,
  aaveSupply: supplyBlockBody,
};
