/**
 * @id PP-MGR-CMP-086
 * @name ManageBlockPanel
 * @implements-rules-version v1 (POO-2227)
 * @analytics-events strategy_move_range_started, tx_flow_abandoned, app_cta_blocked, app_error_shown
 * Inline V2 states of PP-MGR-CMP-001/002; no wallet call is exposed without a verified preview.
 */
"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useReducer, useRef, useState } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { Button } from "@/components/ui/Button";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import type { FundView } from "@/lib/api/v2/fundSchemas";
import { reviewManageMoveRangeAction } from "@/lib/api/v2/manageActions";
import type { ManageMoveRangeReview } from "@/lib/api/v2/manageSchemas";
import { BlockMark } from "../build/blocks/BlockMark";
import { FundSlippageControl } from "../build/panel/FundSlippageControl";
import { PriceRangeField } from "../build/panel/PriceRangeField";
import { type PanelPoolView, toLivePoolGrid } from "../build/panel/panelCatalogView";
import { displayBounds, type PoolRange } from "../build/panel/poolRangeMath";
import { usePanelPool } from "../build/panel/usePanelPool";
import { ManageTokenRow, ManageUsd } from "./ManageCanvas";
import {
  createManageDraft,
  manageDraftReducer,
  rangeChanged,
  rangeFingerprint,
  validManageRange,
} from "./manageDraft";
import { type ManagePosition, manageProtocolMark } from "./manageModel";
import { useManagePosition } from "./useManagePosition";

export function ManageBlockPanel({
  fund,
  position,
  active,
}: {
  fund: FundView;
  position: ManagePosition | null;
  active: boolean;
}) {
  const t = useTranslations("manager.manageV2");
  return (
    <section
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-5"
      aria-label={t("manageBlock")}
    >
      <h2 className="font-semibold text-sm">{t("manageBlock")}</h2>
      {position ? (
        <>
          <header className="flex items-center gap-3">
            <BlockMark
              logo="protocol"
              markId={manageProtocolMark(position.source.adapterKind)}
              name={position.protocol}
              size={24}
            />
            <div>
              <p className="font-medium text-sm">{position.protocol}</p>
              <p className="text-muted-foreground text-xs">
                {t(
                  position.kind === "supply"
                    ? "supplyType"
                    : position.kind === "liquidity"
                      ? "liquidityType"
                      : "notAvailable",
                )}
              </p>
            </div>
          </header>
          <div className="flex items-center gap-2 text-xs">
            <NetworkLogo network={position.network} name={position.network} className="size-4" />
            {position.network === "arbitrum"
              ? "Arbitrum"
              : position.network === "robinhood"
                ? "Robinhood"
                : position.network}
          </div>
          <div>
            <p className="mb-1 text-muted-foreground text-xs">{t("positionValue")}</p>
            <ManageUsd read={position.valueUsd} />
          </div>
          <div className="flex flex-col gap-2">
            {position.tokens.map((token) => (
              <ManageTokenRow
                key={`${token.chainId}:${token.address}:${token.symbol}`}
                token={token}
              />
            ))}
          </div>
          <Allocation position={position} />
          {position.kind === "liquidity" ? (
            <LiquiditySettings key={position.id} fund={fund} position={position} active={active} />
          ) : position.kind === "supply" ? (
            <SupplySettings active={active} />
          ) : (
            <p role="status">{t("notAvailable")}</p>
          )}
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{t("noSelection")}</p>
      )}
    </section>
  );
}
function Allocation({ position }: { position: ManagePosition }) {
  const t = useTranslations("manager.manageV2");
  const fmt = useFormatter();
  const pct =
    position.allocationPct.status === "available" ? Number(position.allocationPct.value) : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex justify-between text-xs">
        <span>{t("allocation")}</span>
        <span className="tabular-nums">
          {pct === null
            ? t("notAvailable")
            : fmt.number(pct / 100, { style: "percent", maximumFractionDigits: 2 })}
        </span>
      </p>
      {pct !== null ? (
        <progress
          aria-label={t("allocation")}
          value={Math.min(100, Math.max(0, pct))}
          max={100}
          className="h-1 w-full accent-primary"
        />
      ) : null}
      <p className="text-muted-foreground text-xs">{t("allocationUnavailable")}</p>
    </div>
  );
}
function SupplySettings({ active }: { active: boolean }) {
  const t = useTranslations("manager.manageV2");
  const { track } = useAnalytics();
  const timingName = useId();
  const [timing, setTiming] = useState<"now" | "future">("future");
  useEffect(() => {
    if (active)
      track("app_cta_blocked", {
        family: "v2",
        surface: "manager",
        reason: "allocation_policy_unavailable",
      });
  }, [active, track]);
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm">{t("whenToApply")}</legend>
        {(["now", "future"] as const).map((value) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border border-border p-3"
          >
            <input
              type="radio"
              name={timingName}
              className="mt-1"
              checked={timing === value}
              onChange={() => setTiming(value)}
            />
            <span className="text-sm">
              {t(value === "now" ? "applyNow" : "newDeposits")}
              <span className="mt-1 block text-muted-foreground text-xs">
                {t(value === "now" ? "moveExisting" : "keepCurrent")}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p role="status" className="text-muted-foreground text-xs">
        {t("notAvailable")}
      </p>
      <Button disabled className="min-h-11 w-full">
        {t(timing === "future" ? "saveFuture" : "applyNow")}
      </Button>
      <Button variant="secondary" className="min-h-11 w-full" onClick={() => setTiming("future")}>
        {t("discard")}
      </Button>
    </div>
  );
}
function LiquiditySettings({
  fund,
  position,
  active,
}: {
  fund: FundView;
  position: ManagePosition;
  active: boolean;
}) {
  const t = useTranslations("manager.manageV2");
  const { track } = useAnalytics();
  const detail = useManagePosition(fund.coreVault, position.chainId, position.positionKey, active);
  const chain = position.chainId === 4663 ? 4663 : 42161;
  const live = usePanelPool(
    chain,
    active && detail.position?.uniswap ? detail.position.poolId : null,
  );
  const lastPool = useRef<{ id: string; pool: PanelPoolView } | null>(null);
  if (live.pool) lastPool.current = { id: position.id, pool: live.pool };
  const pool = live.pool ?? (lastPool.current?.id === position.id ? lastPool.current.pool : null);
  const metadata = detail.position?.uniswap;
  useEffect(() => {
    if (active && detail.status === "error")
      track("app_error_shown", {
        family: "v2",
        surface: "manager",
        error_code: detail.error ?? "SYSTEM_UNAVAILABLE",
        error_origin: "upstream",
      });
  }, [active, detail.status, detail.error, track]);
  if (!metadata || !pool)
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="text-muted-foreground text-sm">
          {detail.status === "loading" || live.status === "loading"
            ? t("loading")
            : t("notAvailable")}
        </p>
        {detail.status === "error" || live.status === "error" ? (
          <Button
            variant="secondary"
            onClick={() => {
              detail.retry();
              live.retry();
            }}
          >
            {t("retry")}
          </Button>
        ) : null}
      </div>
    );
  if (metadata.liquidity === "0" || detail.position?.status !== "open" || fund.state !== "Open")
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t("notAvailable")}
      </p>
    );
  return (
    <RangeSettings
      fund={fund}
      position={position}
      pool={pool}
      original={{
        tickLower: metadata.tickLower,
        tickUpper: metadata.tickUpper,
        displayInverted: false,
        fullRange: false,
      }}
      active={active}
      readable={detail.status === "ready" && live.applicable}
      onRefresh={() => {
        detail.retry();
        live.retry();
      }}
    />
  );
}
function RangeSettings({
  fund,
  position,
  pool,
  original,
  active,
  readable,
  onRefresh,
}: {
  fund: FundView;
  position: ManagePosition;
  pool: PanelPoolView;
  original: PoolRange;
  active: boolean;
  readable: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("manager.manageV2");
  const field = useTranslations("manager.fundBuilder.canvas.panel");
  const fmt = useFormatter();
  const { track } = useAnalytics();
  const [draft, dispatch] = useReducer(manageDraftReducer, undefined, () =>
    createManageDraft(position.id, original),
  );
  const [stage, setStage] = useState<"edit" | "building" | "review">("edit");
  const [review, setReview] = useState<{ key: string; value: ManageMoveRangeReview } | null>(null);
  const [error, setError] = useState(false);
  const run = useRef(0);
  const started = useRef(false);
  const phaseHeading = useRef<HTMLHeadingElement>(null);
  const fingerprint = rangeFingerprint(draft);
  const snapshotChanged =
    original.tickLower !== draft.original.tickLower ||
    original.tickUpper !== draft.original.tickUpper;
  const valid = readable && !snapshotChanged && validManageRange(draft.range, pool.tickSpacing);
  const invalidationKey = `${fingerprint}:${active}:${readable}:${pool.poolId}:${pool.currentTick}:${original.tickLower}:${original.tickUpper}`;
  const lastReviewContext = useRef(invalidationKey);
  useEffect(() => {
    if (lastReviewContext.current === invalidationKey) return;
    lastReviewContext.current = invalidationKey;
    run.current += 1;
    setReview(null);
    setStage("edit");
    setError(false);
  }, [invalidationKey]);
  useEffect(() => {
    if (active && stage === "review") phaseHeading.current?.focus();
  }, [active, stage]);
  useEffect(
    () => () => {
      run.current += 1;
      if (started.current) {
        track("tx_flow_abandoned", {
          family: "v2",
          surface: "manager",
          flow: "moveRange",
          reason: "manage_panel_left",
        });
        started.current = false;
      }
    },
    [track],
  );
  useEffect(() => {
    if (!active && started.current) {
      track("tx_flow_abandoned", {
        family: "v2",
        surface: "manager",
        flow: "moveRange",
        reason: "position_changed",
      });
      started.current = false;
    }
  }, [active, track]);
  const back = () => {
    run.current += 1;
    setStage("edit");
    setReview(null);
  };
  const choose = (action: "move" | "future") => {
    back();
    dispatch({ type: "choose", action });
    if (action === "move" && !started.current) {
      started.current = true;
      track("strategy_move_range_started", {
        family: "v2",
        surface: "manager",
        flow: "moveRange",
        chain_id: position.chainId,
      });
    }
    if (action === "future")
      track("app_cta_blocked", {
        family: "v2",
        surface: "manager",
        reason: "future_deposit_policy_unavailable",
      });
  };
  const build = async () => {
    if (!valid || stage === "building") return;
    const current = ++run.current;
    setStage("building");
    setError(false);
    try {
      // PP-INTEGRATION-POINT: re-read exact identity and supported preview fields; no client-built calldata.
      const result = await reviewManageMoveRangeAction(fund.coreVault, {
        chainId: position.chainId,
        positionKey: position.positionKey,
        tickLower: draft.range.tickLower,
        tickUpper: draft.range.tickUpper,
        slippageBps: draft.slippageBps,
      });
      if (run.current !== current) return;
      if (result.ok) {
        const fresh = result.data.position;
        if (
          fresh.positionKey.toLowerCase() !== position.positionKey.toLowerCase() ||
          fresh.chainId !== String(position.chainId) ||
          fresh.uniswap?.tickLower !== draft.original.tickLower ||
          fresh.uniswap?.tickUpper !== draft.original.tickUpper
        ) {
          setError(true);
          setStage("edit");
          onRefresh();
          return;
        }
        setReview({ key: fingerprint, value: result.data });
        setStage("review");
        track("app_cta_blocked", {
          family: "v2",
          surface: "manager",
          flow: "moveRange",
          reason: "move_preview_unavailable",
        });
      } else {
        setError(true);
        setStage("edit");
        track("app_error_shown", {
          family: "v2",
          surface: "manager",
          error_code: result.error.code,
          error_origin: "upstream",
        });
      }
    } catch {
      if (run.current === current) {
        setError(true);
        setStage("edit");
        track("app_error_shown", {
          family: "v2",
          surface: "manager",
          error_code: "SYSTEM_UNAVAILABLE",
          error_origin: "upstream",
        });
      }
    }
  };
  const rangeText = (range: PoolRange) => {
    const bounds = displayBounds(
      { ...range, displayInverted: draft.range.displayInverted },
      toLivePoolGrid(pool),
    );
    return `${fmt.number(bounds.min, { maximumSignificantDigits: 6 })} - ${fmt.number(bounds.max, { maximumSignificantDigits: 6 })}`;
  };
  if (stage === "review" && review?.key === fingerprint)
    return (
      <div className="flex flex-col gap-4">
        <h3 ref={phaseHeading} tabIndex={-1} className="font-semibold text-sm outline-none">
          {t("reviewMove")}
        </h3>
        <dl className="grid grid-cols-1 gap-2 text-xs">
          <dt className="text-muted-foreground">{t("currentRange")}</dt>
          <dd className="tabular-nums">{rangeText(draft.original)}</dd>
          <dt className="text-muted-foreground">{t("newRange")}</dt>
          <dd className="tabular-nums">{rangeText(draft.range)}</dd>
          <dd>
            {field("range.quote", {
              quote: (draft.range.displayInverted ? pool.token0 : pool.token1).symbol,
              base: (draft.range.displayInverted ? pool.token1 : pool.token0).symbol,
            })}
          </dd>
          {(["estimatedBalance", "moveFee", "networkFee", "priceImpact"] as const).map((key) => (
            <div key={key} className="flex justify-between gap-2">
              <dt>{t(key)}</dt>
              <dd>{t("notAvailable")}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-xs">{t("moveCurrent")}</p>
        <p
          role="status"
          className="rounded-xl border border-border p-3 text-muted-foreground text-xs"
        >
          {t("previewUnavailable")}
        </p>
        <Button disabled className="min-h-11 w-full">
          {t("confirmMove")}
        </Button>
        <Button variant="secondary" className="min-h-11 w-full" onClick={back}>
          {t("backSettings")}
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {!readable && active ? (
        <div role="status" className="flex flex-col gap-2 text-muted-foreground text-xs">
          <p>{t("notAvailable")}</p>
          <Button variant="secondary" onClick={onRefresh}>
            {t("retry")}
          </Button>
        </div>
      ) : null}
      <fieldset disabled={!readable || stage === "building"} className="min-w-0 border-0 p-0">
        <PriceRangeField
          pool={pool}
          touchTargets
          range={draft.range}
          onChange={(range) => dispatch({ type: "range", range })}
        />
      </fieldset>
      {snapshotChanged ? (
        <p role="status" className="text-warning text-xs">
          {t("positionChanged")}
        </p>
      ) : null}
      {draft.action === "move" ? (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground text-xs">{t("selectedOperation")}</p>
            <div className="rounded-xl border border-border p-3">
              <h3 className="font-medium text-sm">{t("moveRange")}</h3>
              <p className="mt-1 text-muted-foreground text-xs">{t("reposition")}</p>
            </div>
          </div>
          <FundSlippageControl
            value={draft.slippageBps / 100}
            onChange={(pct) => dispatch({ type: "slippage", bps: Math.round(pct * 100) })}
            copy={{
              label: field("slippage.label"),
              help: field("slippage.help"),
              helpLabel: field("moreAbout", { label: field("slippage.label") }),
              custom: field("slippage.custom"),
              customLabel: field("slippage.customLabel"),
              max: (pct) => field("slippage.max", { pct }),
            }}
          />
          <p className="text-muted-foreground text-xs">{t("reviewCosts")}</p>
          {error ? (
            <p role="alert" className="text-warning text-xs">
              {t("notAvailable")}
            </p>
          ) : null}
          <Button
            className="min-h-11 w-full"
            disabled={!valid || stage === "building"}
            onClick={() => void build()}
          >
            {t(stage === "building" ? "preparing" : "reviewMove")}
          </Button>
          <Button
            variant="secondary"
            className="min-h-11 w-full"
            onClick={() => {
              back();
              dispatch({ type: "back" });
            }}
          >
            {t("backActions")}
          </Button>
        </>
      ) : draft.action === "future" ? (
        <>
          <p className="text-muted-foreground text-xs">{t("selectedOperation")}</p>
          <div className="rounded-xl border border-border p-3">
            <h3 className="font-medium text-sm">{t("createPosition")}</h3>
            <p className="mt-1 text-muted-foreground text-xs">{t("newDeposits")}</p>
          </div>
          <p className="text-muted-foreground text-xs">{t("saveSettings")}</p>
          <p role="status" className="text-muted-foreground text-xs">
            {t("notAvailable")}
          </p>
          <Button disabled className="min-h-11 w-full">
            {t("saveFuture")}
          </Button>
          <Button
            variant="secondary"
            className="min-h-11 w-full"
            onClick={() => {
              back();
              dispatch({ type: "back" });
            }}
          >
            {t("backActions")}
          </Button>
        </>
      ) : (
        <>
          {rangeChanged(draft) ? (
            <>
              <div>
                <Button
                  className="min-h-11 w-full"
                  disabled={!valid}
                  onClick={() => choose("move")}
                >
                  {t("moveRange")}
                </Button>
                <p className="mt-2 text-center text-muted-foreground text-xs">{t("applyNow")}</p>
              </div>
              <div>
                <Button
                  variant="secondary"
                  className="min-h-11 w-full"
                  disabled={!valid}
                  onClick={() => choose("future")}
                >
                  {t("createPosition")}
                </Button>
                <p className="mt-2 text-center text-muted-foreground text-xs">{t("newDeposits")}</p>
              </div>
            </>
          ) : null}
          <Button
            variant="secondary"
            className="min-h-11 w-full"
            onClick={() => {
              back();
              dispatch({ type: "reset", range: original });
              onRefresh();
            }}
          >
            {t("discard")}
          </Button>
        </>
      )}
    </div>
  );
}
