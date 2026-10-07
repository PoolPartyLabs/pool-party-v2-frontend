/**
 * @id PP-MGR-CMP-092 (POO-2276)
 * @name ManageCollectFeesPanel
 * @implements-rules-version v1
 * @analytics-events none, injected presenter; the mounted host owns view/read/blocked intent events.
 * @i18n-namespace manager.manageV2
 * Selected-origin fees with manual collection unavailable until its verified executor exists.
 */
"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { findToken } from "@/lib/tokens/tokenList";
import { cn } from "@/lib/utils/cn";
import { ManageBlockHeader } from "./ManageBlockHeader";
import { type ManageCollectRead, projectManageCollectFees } from "./manageCollectFees";
import type { ManagePosition } from "./manageModel";

export interface ManageCollectFeesPanelProps {
  /** Canonical position already resolved by the authorized host. */
  position: ManagePosition;
  /** Authorized detail state, with explicit freshness supplied by the host. */
  read: ManageCollectRead;
  /** Restore the same origin's action view, preserving its draft and operation owner. */
  onBack(): void;
  /** Retry the existing authorized position read; never starts collection. */
  onRetry(): void;
  /** Optional host styling. */
  className?: string;
}

export function ManageCollectFeesPanel({
  position,
  read,
  onBack,
  onRetry,
  className,
}: ManageCollectFeesPanelProps) {
  const t = useTranslations("manager.manageV2.collectFeesPanel");
  const manage = useTranslations("manager.manageV2");
  const titleId = useId();
  const unavailableId = useId();
  // PP-INTEGRATION-POINT: host injects its authorized loadManagePositionAction read and proven freshness; this presenter never starts a read or operation.
  const view = projectManageCollectFees(position, read);
  const message =
    view.status === "loading"
      ? "loading"
      : view.status === "error"
        ? "readError"
        : view.status === "partial"
          ? "partial"
          : view.status === "zero"
            ? "zero"
            : view.status === "unavailable"
              ? view.reason === "stale"
                ? "stale"
                : "unavailable"
              : null;
  const pair = position.tokens.map((token) => token.symbol).join(" / ");
  const retry =
    view.status === "error" || view.status === "partial" || view.status === "unavailable";
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-5",
        className,
      )}
    >
      <h2 id={titleId} className="font-semibold text-sm">
        {manage("manageBlock")}
      </h2>
      <ManageBlockHeader position={position} subtitle={pair} />
      <h3 className="font-semibold text-sm">{t("title")}</h3>
      <div
        aria-busy={view.status === "loading"}
        aria-live="polite"
        className="flex min-w-0 flex-col gap-3"
      >
        <p className="text-muted-foreground text-xs">{t("uncollectedFees")}</p>
        {message ? (
          <p
            role={view.status === "error" ? "alert" : "status"}
            className="break-words text-foreground text-sm"
          >
            {t(message)}
          </p>
        ) : null}
        <dl className="flex min-w-0 flex-col gap-3">
          {view.rows.map((row) => {
            const logo = findToken(position.network, row.address)?.iconUrl;
            return (
              <div
                key={`${row.chainId}:${row.address}`}
                data-manage-collect-token={row.address}
                className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1"
              >
                <dt className="flex min-w-0 items-center gap-2 text-sm">
                  {logo ? (
                    // biome-ignore lint/performance/noImgElement: existing identity-keyed token-list asset, matching the shared token row convention.
                    <img
                      src={logo}
                      alt=""
                      aria-hidden="true"
                      className="size-5 shrink-0 rounded-full object-contain"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs"
                    >
                      {row.symbol.charAt(0)}
                    </span>
                  )}
                  <span className="min-w-0 break-words">{row.symbol}</span>
                </dt>
                <dd
                  className="max-w-full break-all text-right font-semibold text-foreground text-sm tabular-nums"
                  title={
                    row.amount.status === "available"
                      ? `${row.amount.value.decimal} ${row.symbol}`
                      : undefined
                  }
                >
                  {row.amount.status === "available"
                    ? row.amount.value.decimal
                    : manage("notAvailable")}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      {position.chainId !== 42161 ? (
        <p className="break-words text-muted-foreground text-xs">{t("routeDescription")}</p>
      ) : null}
      {retry ? (
        <Button
          variant="secondary"
          className="h-auto min-h-11 w-full whitespace-normal"
          onClick={onRetry}
        >
          {manage("retry")}
        </Button>
      ) : null}
      <p id={unavailableId} className="text-muted-foreground text-xs">
        {t("executionUnavailable")}
      </p>
      {/* PP-INTEGRATION-POINT: POO-2277/2278 own dedicated Collect preview, signing and recovery; this manual action is unavailable for every read state. */}
      <Button
        disabled
        aria-describedby={unavailableId}
        className="h-auto min-h-11 w-full whitespace-normal"
      >
        {t("collect")}
      </Button>
      <Button
        variant="secondary"
        className="h-auto min-h-11 w-full whitespace-normal"
        onClick={onBack}
      >
        {t("back")}
      </Button>
    </section>
  );
}
