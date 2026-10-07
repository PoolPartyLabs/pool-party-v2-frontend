/**
 * @id PP-MGR-CMP-086
 * @name ManageBlockPanel
 * @implements-rules-version v2 (POO-2246; extends POO-2227), v2 (POO-2274), v1 (POO-2284)
 * @analytics-events strategy_move_range_started, tx_flow_abandoned, app_cta_blocked, app_error_shown
 * Inline V2 states of PP-MGR-CMP-001/002; no wallet call is exposed without a verified preview.
 */
"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import type { FundView } from "@/lib/api/v2/fundSchemas";
import { reviewManageMoveRangeAction } from "@/lib/api/v2/manageActions";
import type { ManageMoveRangeReview } from "@/lib/api/v2/manageSchemas";
import { FundSlippageControl } from "../build/panel/FundSlippageControl";
import { PriceRangeField } from "../build/panel/PriceRangeField";
import { type PanelPoolView, toLivePoolGrid } from "../build/panel/panelCatalogView";
import { displayBounds, type PoolRange, usableTickBounds } from "../build/panel/poolRangeMath";
import { usePanelPool } from "../build/panel/usePanelPool";
import { ManageBlockHeader } from "./ManageBlockHeader";
import { ManageTokenRow, ManageUsd } from "./ManageCanvas";
import { ManageCollectFeesPanel } from "./ManageCollectFeesPanel";
import {
  createManageDraft,
  manageDraftReducer,
  rangeChanged,
  rangeFingerprint,
  validManageRange,
} from "./manageDraft";
import type { ManagePosition } from "./manageModel";
import { managePositionIdentity } from "./manageModel";
import { type ManageInspectableNode, manageInspectionLabelKey } from "./manageSelection";
import { MANAGE_READ_TIMEOUT_MS, useManagePosition } from "./useManagePosition";

export function ManageBlockPanel({
  fund,
  position,
  active,
  inspection,
  onBack,
}: {
  fund: FundView;
  position: ManagePosition | null;
  active: boolean;
  inspection?: ManageInspectableNode | null;
  onBack?: () => void;
}) {
  const t = useTranslations("manager.manageV2");
  const inspectingFlow = inspection != null && inspection.kind !== "position";
  const sameOrigin =
    position != null &&
    position.id ===
      managePositionIdentity(fund.coreVault, position.chainId, position.positionKey) &&
    inspection?.position?.id === position.id &&
    inspection.chainId === position.chainId &&
    inspection.position.core.toLowerCase() === fund.coreVault.toLowerCase() &&
    inspection.position.positionKey.toLowerCase() === position.positionKey.toLowerCase();
  const collecting = inspectingFlow && inspection?.kind === "collectFees";
  const collectVisited = useRef(false);
  if (active && collecting && sameOrigin && position?.kind === "liquidity")
    collectVisited.current = true;
  return (
    <>
      <div hidden={inspectingFlow}>
        <section
          className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-5"
          aria-label={t("manageBlock")}
        >
          <h2 className="font-semibold text-sm">{t("manageBlock")}</h2>
          {position ? (
            <>
              <ManageBlockHeader position={position} />
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
                <LiquiditySettings
                  key={`${fund.coreVault.toLowerCase()}:${position.chainId}:${position.positionKey.toLowerCase()}`}
                  fund={fund}
                  position={position}
                  active={active && !inspectingFlow}
                />
              ) : position.kind === "supply" ? (
                <SupplySettings active={active && !inspectingFlow} />
              ) : (
                <p role="status">{t("notAvailable")}</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{t("noSelection")}</p>
          )}
        </section>
      </div>
      {position ? (
        <>
          {position.kind === "liquidity" && (collectVisited.current || collecting) ? (
            <div hidden={!collecting}>
              <CollectInspector
                key={`${fund.coreVault.toLowerCase()}:${position.id}`}
                position={position}
                active={active && collecting && sameOrigin}
                sameOrigin={sameOrigin}
                onBack={onBack ?? (() => {})}
              />
            </div>
          ) : null}
          {inspectingFlow && (!collecting || position.kind !== "liquidity") ? (
            <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
              <h2 className="font-semibold text-sm">{t("manageBlock")}</h2>
              <ManageBlockHeader position={position} />
              <h3 className="font-semibold text-sm">
                {inspection.kind !== "position"
                  ? t(manageInspectionLabelKey[inspection.kind])
                  : t("notAvailable")}
              </h3>
              <p role="status" className="text-muted-foreground text-sm">
                {t("notAvailable")}
              </p>
              <Button variant="secondary" className="min-h-11 w-full" onClick={onBack}>
                {t("inspection.backToBlocks")}
              </Button>
            </section>
          ) : null}
        </>
      ) : null}
    </>
  );
}
/** Selected-origin read lifetime is independent from the visible position editor. */
function CollectInspector({
  position,
  active,
  sameOrigin,
  onBack,
}: {
  position: ManagePosition;
  active: boolean;
  sameOrigin: boolean;
  onBack(): void;
}) {
  const activated = useRef(false);
  if (active) activated.current = true;
  const detail = useManagePosition(
    position.core,
    position.chainId,
    position.positionKey,
    activated.current,
  );
  const { track } = useAnalytics();
  useEffect(() => {
    if (active && detail.status === "error")
      track("app_error_shown", {
        family: "v2",
        surface: "manager",
        error_code: detail.error ?? "SYSTEM_UNAVAILABLE",
        error_origin: "upstream",
      });
  }, [active, detail.status, detail.error, track]);
  return (
    <ManageCollectFeesPanel
      position={position}
      read={{
        identity: sameOrigin
          ? managePositionIdentity(position.core, position.chainId, position.positionKey)
          : "unmatched-origin",
        status: detail.status,
        position: sameOrigin ? detail.position : null,
        error: detail.error,
        // PP-INTEGRATION-POINT: POO-2276/2277 requires authoritative source freshness. A completed current DTO does not prove it.
        freshness: "unknown",
      }}
      onRetry={detail.retry}
      onBack={onBack}
    />
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
  // Visibility starts reads once for this origin; hiding never cancels or renews them.
  const activated = useRef(false);
  if (active) activated.current = true;
  const detail = useManagePosition(
    fund.coreVault,
    position.chainId,
    position.positionKey,
    activated.current,
  );
  const lastPosition = useRef(detail.position);
  if (detail.position?.uniswap) lastPosition.current = detail.position;
  const readPosition = detail.position?.uniswap ? detail.position : lastPosition.current;
  const chain = position.chainId === 4663 ? 4663 : 42161;
  const live = usePanelPool(
    chain,
    activated.current && readPosition?.uniswap ? readPosition.poolId : null,
  );
  const lastPool = useRef<{ id: string; pool: PanelPoolView } | null>(null);
  if (live.pool) lastPool.current = { id: position.id, pool: live.pool };
  const pool = live.pool ?? (lastPool.current?.id === position.id ? lastPool.current.pool : null);
  // Retained metadata keeps the draft mounted; only a current, valid read enables review.
  const metadata = readPosition?.uniswap;
  const readable =
    detail.status === "ready" &&
    detail.position?.status === "open" &&
    detail.position.uniswap !== null &&
    detail.position.uniswap?.liquidity !== "0" &&
    fund.state === "Open" &&
    live.applicable;
  const initialized = useRef(false);
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
  if (!initialized.current && !readable)
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t("notAvailable")}
      </p>
    );
  initialized.current = true;
  const limits = usableTickBounds(pool.tickSpacing);
  return (
    <RangeSettings
      fund={fund}
      position={position}
      pool={pool}
      original={{
        tickLower: metadata.tickLower,
        tickUpper: metadata.tickUpper,
        displayInverted: false,
        fullRange: metadata.tickLower === limits.minTick && metadata.tickUpper === limits.maxTick,
      }}
      active={active}
      readable={readable}
      snapshotKey={JSON.stringify([
        fund.state,
        detail.position,
        readPosition,
        pool.chainId,
        pool.poolId,
        pool.currentTick,
        pool.price,
        pool.tickSpacing,
        pool.feeTier,
        pool.token0.address,
        pool.token0.decimals,
        pool.token1.address,
        pool.token1.decimals,
      ])}
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
  snapshotKey,
  onRefresh,
}: {
  fund: FundView;
  position: ManagePosition;
  pool: PanelPoolView;
  original: PoolRange;
  active: boolean;
  readable: boolean;
  snapshotKey: string;
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
  const invalidationKey = `${fingerprint}:${draft.action}:${readable}:${snapshotKey}`;
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
    const timer = setTimeout(() => {
      if (run.current !== current) return;
      run.current += 1;
      setError(true);
      setStage("edit");
      track("app_error_shown", {
        family: "v2",
        surface: "manager",
        error_code: "MANAGE_READ_TIMEOUT",
        error_origin: "upstream",
      });
    }, MANAGE_READ_TIMEOUT_MS);
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
        setReview({ key: invalidationKey, value: result.data });
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
    } finally {
      clearTimeout(timer);
    }
  };
  const rangeText = (range: PoolRange) => {
    const bounds = displayBounds(
      { ...range, displayInverted: draft.range.displayInverted },
      toLivePoolGrid(pool),
    );
    return `${fmt.number(bounds.min, { maximumSignificantDigits: 6 })} - ${fmt.number(bounds.max, { maximumSignificantDigits: 6 })}`;
  };
  if (stage === "review" && review?.key === invalidationKey)
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
