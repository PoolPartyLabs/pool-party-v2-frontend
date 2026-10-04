/**
 * @id PP-MGR-CMP-069
 * @name PoolBlockPanel
 * @implements-rules-version v1 (POO-2189); POO-2204 rules v1
 * @analytics-events none (the panel shell emits)
 * The Uniswap v4 body: mandate pool defaults from a mount read, and a live-gated draft range.
 */
"use client";
import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useId, useState } from "react";
import { getCatalogPoolsAction } from "@/lib/api/v2/actions";
import type { V2ChainId } from "@/lib/api/v2/schemas";
import { isMockMode } from "@/lib/services";
import {
  findPanelPoolFixture,
  PANEL_MOCK_FAILURE_RATE,
  PANEL_MOCK_LATENCY_MS,
} from "@/mocks/data/buildPanelFixtures";
import { simulateDelay, simulateError } from "@/mocks/utils/simulate";
import { isPoolConfigComplete, isRangeOnGrid } from "../plan/blockConfig";
import type { PoolBlockConfig } from "../plan/buildPlan";
import { findBlock } from "../plan/planDerive";
import { FundSlippageControl } from "./FundSlippageControl";
import { PanelFieldLabel } from "./PanelFieldLabel";
import { PanelSelect } from "./PanelSelect";
import { PriceRangeField } from "./PriceRangeField";
import type {
  PanelBodyContext,
  PanelBodyDefinition,
  PanelConfiguredProviderProps,
  PanelFieldsProps,
  PanelPickModel,
} from "./panelBodies";
import {
  type PanelPoolView,
  panelPoolsFor,
  toLivePoolGrid,
  toPanelPoolView,
} from "./panelCatalogView";
import { PANEL_LINK } from "./panelStyles";
import { presetRange } from "./poolRangeMath";
import { type UsePanelPoolResult, usePanelPool } from "./usePanelPool";

const chainFor = (context: PanelBodyContext): V2ChainId =>
  context.network === "arbitrum" ? 42161 : 4663;
const PoolSnapshot = createContext<UsePanelPoolResult | null>(null);

/** One polling lifecycle and one Retry for the visible fields and their Apply permission. */
export function PoolPanelProvider({
  context,
  config,
  children,
  sharePct,
}: PanelConfiguredProviderProps<PoolBlockConfig>) {
  const live = usePanelPool(chainFor(context), sharePct === 0 ? null : config.poolId);
  return <PoolSnapshot.Provider value={live}>{children}</PoolSnapshot.Provider>;
}
function usePoolSnapshot(): UsePanelPoolResult {
  const snapshot = useContext(PoolSnapshot);
  if (!snapshot) throw new Error("Pool fields and gate require PoolPanelProvider");
  return snapshot;
}

function defaultConfig(pool: PanelPoolView, poolId: string): PoolBlockConfig | null {
  if (!pool.eligible || !pool.hasActiveLiquidity) return null;
  const range = presetRange(toLivePoolGrid(pool), 10);
  return range ? { poolId, ...range, slippagePct: 2 } : null;
}
/** One network catalog read per mounted body; cancellation prevents a previous network landing. */
function usePoolOptions(context: PanelBodyContext, deferred = false) {
  const t = useTranslations("manager.fundBuilder.canvas.panel");
  const chainId = chainFor(context);
  const rows = panelPoolsFor(context.draft, chainId);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    chainId: V2ChainId;
    status: "loading" | "ready" | "error";
    views: Map<string, PanelPoolView>;
  }>({ chainId, status: "loading", views: new Map() });
  // Mock rows have slugs; the initial snapshot only supplies those keys to their fixture reads.
  const [initialRows] = useState(rows);
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision deliberately restarts a failed batch read.
  useEffect(() => {
    if (deferred) return;
    let active = true;
    setState({ chainId, status: "loading", views: new Map() });
    const read = async () => {
      try {
        const views = new Map<string, PanelPoolView>();
        if (isMockMode) {
          // PP-INTEGRATION-POINT: MCK-005 supplies the same live-price shape as the v2 network catalog.
          // PP-MOCK: latency and rare failure apply to the batch, matching the single-pool live read.
          await simulateDelay(PANEL_MOCK_LATENCY_MS[0], PANEL_MOCK_LATENCY_MS[1]);
          simulateError(PANEL_MOCK_FAILURE_RATE);
          for (const row of initialRows) {
            const raw = findPanelPoolFixture(chainId, row.poolId);
            if (raw) views.set(row.poolId, toPanelPoolView(raw));
          }
        } else {
          // PP-INTEGRATION-POINT: GET /api/v2/catalog/uniswap-v4/pools?chainId= supplies complete defaults.
          const result = await getCatalogPoolsAction(chainId);
          if (!result.ok) throw new Error(result.error.code);
          for (const raw of result.data.pools) {
            try {
              const view = toPanelPoolView(raw);
              if (view.chainId === chainId) views.set(view.poolId, view);
            } catch {
              /* A malformed row is unreadable and disabled, without hiding the rest. */
            }
          }
        }
        if (active) setState({ chainId, status: "ready", views });
      } catch {
        if (active) setState({ chainId, status: "error", views: new Map() });
      }
    };
    void read();
    return () => {
      active = false;
    };
  }, [chainId, revision, initialRows, deferred]);
  const status = deferred ? "ready" : state.chainId === chainId ? state.status : "loading";
  return {
    rows,
    status,
    retry: () => setRevision((value) => value + 1),
    options: rows.map((row) => {
      const view = status === "ready" ? state.views.get(row.poolId) : undefined;
      const config = deferred
        ? { poolId: row.poolId, slippagePct: 2 }
        : view
          ? defaultConfig(view, row.poolId)
          : null;
      const reason = deferred
        ? undefined
        : status === "loading"
          ? t("pool.loading")
          : status === "error"
            ? t("pool.failed")
            : !view
              ? t("pool.unread")
              : !view.eligible
                ? t("pool.ineligible")
                : !view.hasActiveLiquidity
                  ? t("pool.noLiquidity")
                  : !config
                    ? t("pool.unread")
                    : undefined;
      return { row, view, config, reason };
    }),
  };
}
function usePoolPick(context: PanelBodyContext): PanelPickModel<PoolBlockConfig> {
  const t = useTranslations("manager.fundBuilder.canvas.panel");
  const deferred = findBlock(context.plan, context.blockId)?.chain.sharePct === 0;
  const data = usePoolOptions(context, deferred);
  return {
    heading: t("pool.heading"),
    count: data.rows.length,
    filterPlaceholder: t("pool.filter"),
    rows: data.options.map(({ row, config, reason }) => ({
      id: row.poolId,
      title: row.pairLabel,
      subtitle: `${row.feePct}%`,
      logos: [
        { symbol: row.token0.symbol, network: context.network },
        { symbol: row.token1.symbol, network: context.network },
      ],
      searchText: `${row.pairLabel} ${row.token0.address} ${row.token1.address} ${row.poolId}`,
      config,
      disabledReason: reason,
    })),
    caption: t("pool.caption", { network: context.networkName }),
    link: { prompt: t("pool.needAnother"), label: t("link.pools"), step: "pools" },
    noMatch: { title: (typed) => t("pool.noMatch", { typed }), caption: t("pool.noMatchCaption") },
    emptyTitle: t("pool.empty", { network: context.networkName }),
    status: data.status,
    onRetry: data.retry,
  };
}
function usePoolApplyGate(
  _context: PanelBodyContext,
  config: PoolBlockConfig,
  sharePct?: number | null,
) {
  const t = useTranslations("manager.fundBuilder.canvas.panel");
  const live = usePoolSnapshot();
  if (sharePct === 0) return { ok: true };
  const valid =
    live.pool &&
    isPoolConfigComplete(config) &&
    isRangeOnGrid(config, live.pool.tickSpacing) &&
    config.tickUpper - config.tickLower >= 2 * live.pool.tickSpacing;
  return {
    ok: live.applicable && !!valid,
    reason: !live.applicable
      ? live.status === "error"
        ? t("pool.failed")
        : live.status === "loading"
          ? t("pool.loading")
          : t("pool.ineligible")
      : !valid
        ? t("pool.incomplete")
        : undefined,
  };
}
export function PoolBlockPanel({
  context,
  config,
  onConfigChange,
  allocation,
  sharePct,
}: PanelFieldsProps<PoolBlockConfig>) {
  const t = useTranslations("manager.fundBuilder.canvas.panel");
  const labelId = useId();
  const data = usePoolOptions(context, sharePct === 0);
  const live = usePoolSnapshot();
  // A pool selected while deferred has no range. Initialize only missing fields
  // from the first applicable positive snapshot; preserve saved/custom ranges.
  useEffect(() => {
    if (sharePct === 0 || !live.applicable || !live.pool) return;
    const missingRange =
      config.tickLower === undefined ||
      config.tickUpper === undefined ||
      config.fullRange === undefined ||
      config.displayInverted === undefined;
    if (!missingRange) return;
    const defaults = defaultConfig(live.pool, config.poolId);
    if (!defaults) return;
    onConfigChange({
      ...defaults,
      ...config,
      tickLower: config.tickLower ?? defaults.tickLower,
      tickUpper: config.tickUpper ?? defaults.tickUpper,
      fullRange: config.fullRange ?? defaults.fullRange,
      displayInverted: config.displayInverted ?? defaults.displayInverted,
    });
  }, [sharePct, live.applicable, live.pool, config, onConfigChange]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <PanelFieldLabel
          label={t("pool.label")}
          help={t("pool.help", { network: context.networkName })}
          helpLabel={t("moreAbout", { label: t("pool.label") })}
          labelId={labelId}
        />
        <PanelSelect
          labelId={labelId}
          value={config.poolId}
          options={data.options.map(({ row, reason }) => ({
            id: row.poolId,
            label: `${row.pairLabel} · ${row.feePct}%`,
            logos: [
              { symbol: row.token0.symbol, network: context.network },
              { symbol: row.token1.symbol, network: context.network },
            ],
            disabledReason: reason,
          }))}
          onChange={(id) => {
            const next = data.options.find((option) => option.row.poolId === id)?.config;
            if (next) onConfigChange({ ...next, slippagePct: config.slippagePct ?? 2 });
          }}
          footer={{
            prompt: t("pool.needAnother"),
            label: t("link.pools"),
            onClick: () => context.onEditMandate("pools"),
          }}
        />
      </div>
      {allocation}
      {sharePct === 0 ? null : live.pool && isPoolConfigComplete(config) ? (
        <PriceRangeField
          pool={live.pool}
          range={config}
          onChange={(range) => onConfigChange({ ...config, ...range })}
        />
      ) : live.status === "loading" ? (
        <div
          role="status"
          className="h-40 animate-pulse rounded-xl bg-surface-raised"
          aria-label={t("pool.loading")}
        />
      ) : (
        <p role="status" className="text-muted-foreground text-xs">
          {live.status === "error"
            ? t("pool.failed")
            : !live.pool?.eligible
              ? t("pool.ineligible")
              : !live.pool.hasActiveLiquidity
                ? t("pool.noLiquidity")
                : t("pool.incomplete")}
        </p>
      )}
      {sharePct !== 0 && live.status === "error" ? (
        <div role="alert" className="text-muted-foreground text-xs">
          {t("pool.failed")}{" "}
          <button type="button" className={PANEL_LINK} onClick={live.retry}>
            {t("pool.retry")}
          </button>
        </div>
      ) : null}
      <FundSlippageControl
        value={config.slippagePct ?? 2}
        onChange={(slippagePct) => onConfigChange({ ...config, slippagePct })}
        copy={{
          label: t("slippage.label"),
          help: t("slippage.help"),
          helpLabel: t("moreAbout", { label: t("slippage.label") }),
          custom: t("slippage.custom"),
          customLabel: t("slippage.customLabel"),
          max: (pct) => t("slippage.max", { pct }),
        }}
      />
    </div>
  );
}
export const poolBlockPanel: PanelBodyDefinition<PoolBlockConfig> = {
  Provider: PoolPanelProvider,
  usePick: usePoolPick,
  Fields: PoolBlockPanel,
  useApplyGate: usePoolApplyGate,
};
