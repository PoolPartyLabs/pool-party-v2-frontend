/**
 * @id PP-CP-CMP-004
 * @name CashPlusDetails
 * @i18n-namespace cashPlus
 * @implements-rules-version v1
 * Pool activity, underlying composition and disclosure with verified receipt references.
 */
"use client";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  Clock3,
  ExternalLink,
  Landmark,
  Terminal,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { formatUnits } from "viem";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils/cn";
import { formatTxHash } from "@/lib/utils/format";
import type { CashPlusSnapshotProps } from "./CashPlusDashboard";
import { CashPlusRow, cashPlusMoney } from "./CashPlusPresentation";

const summaryClass =
  "flex cursor-pointer list-none items-center justify-between gap-3 rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden";

export function CashPlusActivity({
  snapshot,
  className,
  onLoadEarlier,
}: CashPlusSnapshotProps & {
  /** Requests one additional bounded history window, when the controller supports it. */
  onLoadEarlier?: () => Promise<void>;
}) {
  const t = useTranslations("cashPlus");
  const format = useFormatter();
  const labels = {
    deposit: t("activity.deposit"),
    redeem: t("activity.redeem"),
    proportional: t("activity.proportional"),
    conversion: t("activity.conversion"),
    park: t("activity.park"),
    unpark: t("activity.unpark"),
  };
  return (
    <Card className={cn("rounded-xl p-5 sm:p-6", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-base">{t("activity.title")}</h2>
        <span className="text-muted-foreground text-xs">{snapshot.activity.length}</span>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">{t("activity.subtitle")}</p>
      {snapshot.activity.length ? (
        <ol className="mt-4 divide-y divide-border">
          {snapshot.activity.map((event) => {
            const Icon =
              event.kind === "conversion"
                ? ArrowLeftRight
                : event.kind === "park" || event.kind === "unpark"
                  ? Landmark
                  : event.kind === "deposit"
                    ? ArrowDownLeft
                    : ArrowUpRight;
            return (
              <li key={event.id} className="py-3.5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised">
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <p className="font-medium text-xs">{labels[event.kind]}</p>
                      <p className="font-medium text-xs tabular-nums">
                        <MaskableValue>
                          {event.amountAssets !== null
                            ? cashPlusMoney(event.amountAssets, t("unavailable"))
                            : event.tokenSymbol}
                        </MaskableValue>
                      </p>
                    </div>
                    <p className="mt-1 text-muted-foreground text-[10px]">
                      {format.dateTime(new Date(event.timestamp * 1000), {
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                        timeZoneName: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {event.transactionHash ? (
                      <details className="group mt-2">
                        <summary
                          className={cn(
                            summaryClass,
                            "justify-start text-muted-foreground text-[10px]",
                          )}
                        >
                          {t("activity.receipt")}
                          <ChevronDown
                            className="size-3 transition-transform group-open:rotate-180"
                            aria-hidden="true"
                          />
                        </summary>
                        <div className="mt-2 space-y-2 rounded-lg bg-background p-3 text-[10px]">
                          <p className="break-all font-mono">{event.transactionHash}</p>
                          <p className="text-muted-foreground">
                            {t("activity.block", { block: event.blockNumber.toString() })}
                          </p>
                          {snapshot.explorerUrl ? (
                            <a
                              className="inline-flex items-center gap-1 rounded text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              href={`${snapshot.explorerUrl}/tx/${event.transactionHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t("transaction.receipt")}
                              <ExternalLink className="size-3" aria-hidden="true" />
                            </a>
                          ) : (
                            <p className="text-muted-foreground">{t("activity.localReceipt")}</p>
                          )}
                        </div>
                      </details>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-muted-foreground text-xs">
          <Clock3 className="size-6" strokeWidth={1.5} aria-hidden="true" />
          <p>{t("activity.empty")}</p>
        </div>
      )}
      {snapshot.historyPartial ? (
        <div className="mt-3 space-y-3">
          <p className="text-warning text-xs">{t("activity.partial")}</p>
          {onLoadEarlier ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void onLoadEarlier();
              }}
            >
              {t("activity.loadEarlier")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function CashPlusComposition({ snapshot, className }: CashPlusSnapshotProps) {
  const t = useTranslations("cashPlus");
  return (
    <Card className={cn("rounded-xl p-5 sm:p-6", className)}>
      <h2 className="font-semibold text-base">{t("details.composition")}</h2>
      <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
        {t("details.compositionHint")}
      </p>
      <div className="my-5 flex h-2 overflow-hidden rounded-full bg-background" aria-hidden="true">
        {snapshot.composition.map((asset, index) => (
          <div
            key={asset.token}
            className={index === 0 ? "bg-primary" : "bg-primary/35"}
            style={{ width: `${(asset.weightBps ?? 0) / 100}%` }}
          />
        ))}
      </div>
      <div className="space-y-4">
        {snapshot.composition.map((asset, index) => (
          <details key={asset.token} className="group">
            <summary className={summaryClass}>
              <span className="inline-flex items-center gap-2">
                <TokenLogo symbol={asset.symbol} className="size-6" />
                <span className="font-medium text-xs">{asset.symbol}</span>
              </span>
              <span className="ml-auto inline-flex items-center gap-2 font-medium text-xs tabular-nums">
                <span className={index === 0 ? "text-primary" : "text-muted-foreground"}>
                  {asset.weightBps === null
                    ? t("unavailable")
                    : `${(asset.weightBps / 100).toFixed(1)}%`}
                </span>
                <ChevronDown
                  className="size-3 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </span>
            </summary>
            <div className="mt-3 space-y-2 rounded-lg bg-background p-3">
              <CashPlusRow label={t("details.wallet")}>
                {formatUnits(asset.walletRaw, asset.decimals)} {asset.symbol}
              </CashPlusRow>
              <CashPlusRow label={t("details.lending")}>
                {formatUnits(asset.lendingRaw, asset.decimals)} {asset.symbol}
              </CashPlusRow>
              <p className="break-all font-mono text-muted-foreground text-[10px]">{asset.token}</p>
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}

export function CashPlusDetails({ snapshot, className }: CashPlusSnapshotProps) {
  const t = useTranslations("cashPlus");
  const disclosures = [
    { title: t("details.fees"), body: t("details.feesBody") },
    { title: t("details.liquidity"), body: t("details.liquidityBody") },
    { title: t("details.risk"), body: t("details.riskBody") },
  ];
  return (
    <Card className={cn("rounded-xl p-5 sm:p-6", className)}>
      <h2 className="mb-2 flex items-center gap-2 font-semibold text-base">
        <CircleHelp className="size-4 text-muted-foreground" aria-hidden="true" />
        {t("details.title")}
      </h2>
      <div className="divide-y divide-border">
        {disclosures.map((item) => (
          <details key={item.title} className="group py-4">
            <summary className={summaryClass}>
              {item.title}
              <ChevronDown
                className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <p className="mt-3 text-muted-foreground text-xs leading-relaxed">{item.body}</p>
          </details>
        ))}
        {snapshot.mode !== "preview" ? (
          <details className="group py-4">
            <summary className={summaryClass}>
              {t("details.contracts")}
              <ChevronDown
                className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-4 space-y-3">
              <CashPlusRow label={t("details.network")}>{snapshot.networkName}</CashPlusRow>
              <CashPlusRow label={t("details.policy")}>
                {snapshot.policyVersion.toString()}
              </CashPlusRow>
              <CashPlusRow label={t("details.oracle")}>
                {snapshot.oracleHealthy ? t("details.healthy") : t("details.unhealthy")}
              </CashPlusRow>
              <CashPlusRow label={t("details.run")}>{snapshot.runId}</CashPlusRow>
              <div className="text-xs">
                <p className="text-muted-foreground">{t("details.vault")}</p>
                <p className="mt-1 break-all font-mono text-[10px]">
                  {snapshot.vault ?? t("unavailable")}
                </p>
              </div>
            </div>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

export function CashPlusDemoPanel({ snapshot }: CashPlusSnapshotProps) {
  const t = useTranslations("cashPlus");
  if (snapshot.mode !== "fork") return null;
  return (
    <details className="group rounded-xl border border-border p-5">
      <summary className={cn(summaryClass, "text-muted-foreground")}>
        <span className="inline-flex items-center gap-2">
          <Terminal className="size-4" aria-hidden="true" />
          {t("demo.title")}
        </span>
        <ChevronDown
          className="size-4 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-4 space-y-3 text-muted-foreground text-xs leading-relaxed">
        <p>{t("demo.body")}</p>
        <CashPlusRow label={t("demo.block")}>{snapshot.blockNumber.toString()}</CashPlusRow>
        <CashPlusRow label={t("details.run")}>{snapshot.runId}</CashPlusRow>
        {snapshot.activity.find((event) => event.transactionHash)?.transactionHash ? (
          <CashPlusRow label={t("transaction.hash")}>
            {formatTxHash(
              snapshot.activity.find((event) => event.transactionHash)?.transactionHash ?? "",
            )}
          </CashPlusRow>
        ) : null}
        <p>{t("demo.next")}</p>
        <p>{t("demo.time")}</p>
      </div>
    </details>
  );
}
