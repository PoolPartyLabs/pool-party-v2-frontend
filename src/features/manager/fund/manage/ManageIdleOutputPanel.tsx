/**
 * @id PP-MGR-CMP-093 (POO-2275)
 * @name ManageIdleOutputPanel
 * @implements-rules-version v1
 * @analytics-events none, injected presenter; mounted host owns view/read/navigation events.
 * @i18n-namespace manager.manageV2.withdrawalDeadlines
 * Read-only inline withdrawal queue. No financial operation.
 */
"use client";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { apiNetworkForChain } from "@/lib/chains/config";
import { findToken } from "@/lib/tokens/tokenList";
import { cn } from "@/lib/utils/cn";
import {
  type IdleOutputAmountsView,
  type ManageIdleOutputOrigin,
  type ManageIdleOutputRead,
  projectManageIdleOutput,
} from "./manageIdleOutput";
export interface ManageIdleOutputPanelProps {
  /** Canonical core, hub and verified token metadata supplied by the authorized host. */
  origin: ManageIdleOutputOrigin;
  /** Injected presentation state only, not the unconfirmed POO-2230 API DTO. */
  read: ManageIdleOutputRead;
  /** Return to the live origin anchor; draft/focus/operation ownership remain with the host. */
  onBack(): void;
  /** Repeat the authorized queue read; never allocates reserves or signs. */
  onRetry(): void;
  /** Optional host layout styles. */
  className?: string;
}
export function ManageIdleOutputPanel({
  origin,
  read,
  onBack,
  onRetry,
  className,
}: ManageIdleOutputPanelProps) {
  const t = useTranslations("manager.manageV2.withdrawalDeadlines"),
    manage = useTranslations("manager.manageV2"),
    locale = useLocale(),
    titleId = useId();
  // PP-INTEGRATION-POINT: POO-2230 must confirm queue provenance/cohorts/statuses before the host injects real data; unavailable is the real-mode default.
  const view = projectManageIdleOutput(origin, read);
  const logo = view.token?.address
    ? findToken(apiNetworkForChain(view.token.chainId) ?? "", view.token.address)?.iconUrl
    : undefined;
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(`${value}T00:00:00Z`));
  const timestamp = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: view.timezone ?? "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: value.slice(17, 19) !== "00" || /\.\d+/.test(value) ? "2-digit" : undefined,
      hourCycle: "h23",
    }).format(new Date(value));
  const number = (value: string) => {
    const [whole = "0", fraction] = value.split(".");
    const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
      BigInt(whole),
    );
    const separator =
      new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
        ?.value ?? ".";
    return `${integer}${fraction ? `${separator}${fraction}` : ""}`;
  };
  const retry = ["error", "partial", "stale", "unknown", "unavailable"].includes(view.status);
  const message = view.status === "ready" ? null : view.status;
  const amounts = (values: IdleOutputAmountsView) => (
    <dl className="flex min-w-0 flex-col gap-2">
      {(["requested", "reserved", "stillNeeded"] as const).map((field) => (
        <div
          key={field}
          className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1 text-xs"
        >
          <dt className="min-w-0 break-words text-muted-foreground">
            {manage(field === "requested" ? "withdrawalRequests" : field)}
          </dt>
          <dd
            className={cn(
              "max-w-full break-all text-right tabular-nums",
              field === "reserved"
                ? "text-success"
                : field === "stillNeeded"
                  ? "text-primary"
                  : "text-foreground",
            )}
          >
            {values[field] !== null
              ? `${number(values[field])} ${view.token?.symbol ?? ""}`
              : manage("notAvailable")}
          </dd>
        </div>
      ))}
    </dl>
  );
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-5",
        className,
      )}
    >
      <h2 id={titleId} className="font-semibold text-base">
        {manage("manageBlock")}
      </h2>
      <div className="flex min-w-0 items-center gap-2">
        {logo ? (
          // biome-ignore lint/performance/noImgElement: reuse the existing identity-keyed token-list asset.
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className="size-5 shrink-0 rounded-full object-contain"
          />
        ) : view.token ? (
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-raised text-xs"
          >
            {view.token.symbol.charAt(0)}
          </span>
        ) : null}
        <h3 className="min-w-0 break-words font-semibold text-sm">{manage("idleOutput")}</h3>
        {view.token ? (
          <span className="min-w-0 break-words text-muted-foreground text-xs">
            {view.token.symbol}
          </span>
        ) : null}
      </div>
      <h3 className="font-semibold text-sm">{t("title")}</h3>
      <div
        aria-busy={view.status === "loading"}
        aria-live="polite"
        className="flex min-w-0 flex-col gap-3"
      >
        {message ? (
          <p
            role={view.status === "error" ? "alert" : "status"}
            className="break-words text-foreground text-sm"
          >
            {t(message)}
          </p>
        ) : null}
        {view.status === "loading" ? <Skeleton height={88} className="w-full" /> : null}
        {view.reason === "metadata" ? (
          <p className="text-muted-foreground text-xs">{t("metadataUnavailable")}</p>
        ) : null}
        {view.status === "error" ? (
          <p className="text-muted-foreground text-xs">{t("recovery")}</p>
        ) : null}
        {view.summary ? (
          <div data-idle-summary="" className="flex min-w-0 flex-col gap-2">
            <p className="font-semibold text-xs">
              {t(view.summaryIsSubtotal ? "subtotal" : "total")}
            </p>
            <p className="break-all text-muted-foreground text-xs">
              {t("cohort", { cohort: view.summary.cohortId })}
            </p>
            {amounts(view.summary)}
            {view.summary.barPercentage !== null ? (
              <div
                aria-hidden="true"
                className="h-1.5 overflow-clip rounded-full bg-surface-raised"
              >
                <div
                  className="h-full rounded-full bg-success"
                  style={{ width: `${view.summary.barPercentage}%` }}
                />
              </div>
            ) : null}
            <p className="break-all text-muted-foreground text-xs tabular-nums">
              {view.summary.coverage !== null
                ? t("coverage", { percentage: number(view.summary.coverage) })
                : t("coverageUnavailable")}
            </p>
          </div>
        ) : null}
        {view.buckets.map((bucket) => (
          <article
            key={bucket.id}
            data-idle-bucket={bucket.id}
            className="flex min-w-0 flex-col gap-2 rounded-xl border border-border p-3"
          >
            <h4 className="break-words font-semibold text-sm">
              {t(bucket.relation)}
              {bucket.date ? ` · ${date(bucket.date)}` : ""}
            </h4>
            {!bucket.date ? (
              <p className="text-muted-foreground text-xs">{t("dateUnavailable")}</p>
            ) : null}
            {[...new Set(bucket.deadlines)].map((deadline) => (
              <p key={deadline} className="break-words text-muted-foreground text-xs tabular-nums">
                {t("reserveBy", { deadline: timestamp(deadline) })}
              </p>
            ))}
            {bucket.requestStates.length ? (
              <ul className="flex flex-wrap gap-2 text-muted-foreground text-xs">
                {[...new Set(bucket.requestStates)].map((state) => (
                  <li key={state}>{t(state)}</li>
                ))}
              </ul>
            ) : null}
            <p className="break-all text-muted-foreground text-xs">
              {t("cohort", { cohort: bucket.amounts.cohortId })}
            </p>
            {amounts(bucket.amounts)}
          </article>
        ))}
        {view.timezone ? (
          <p className="break-words text-muted-foreground text-xs">
            {t("timezone", { timezone: view.timezone })}
          </p>
        ) : null}
        {view.asOf ? (
          <p className="break-words text-muted-foreground text-xs tabular-nums">
            {t("asOf", { asOf: timestamp(view.asOf) })}
          </p>
        ) : null}
      </div>
      {retry ? (
        <Button
          variant="secondary"
          onClick={onRetry}
          className="h-auto min-h-11 w-full whitespace-normal"
        >
          {manage("retry")}
        </Button>
      ) : null}
      {/* PP-INTEGRATION-POINT: selection host owns Back focus and preserved drafts/journal; this callback changes no money. */}
      <Button
        variant="secondary"
        onClick={onBack}
        className="h-auto min-h-11 w-full whitespace-normal"
      >
        {t("back")}
      </Button>
    </section>
  );
}
