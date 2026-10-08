/**
 * @id PP-MGR-CMP-099 (POO-2291)
 * @name SolanaKaminoReadSection
 * @implements-rules-version v1
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8677-271
 * @i18n-namespace manager.solanaPreview, manager.manageV2.lendingRisk
 * @analytics-events none, read-only injected section; parent owns view/edit/blocked/error intents
 * PP-INTEGRATION-POINT: POO-2240/2261 provide independent verified metadata, amounts, rates and full-account risk; no catalog or fixture supplies production reads.
 */
"use client";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils/cn";
import {
  ManageLendingRiskSection,
  type ManageLendingRiskSectionProps,
} from "../manage/ManageLendingRiskSection";
import {
  formatKaminoUsd,
  inspectKaminoOrigin,
  inspectKaminoRead,
  type KaminoMetric,
  type KaminoReadIdentity,
  type KaminoReadSnapshot,
} from "./solanaKaminoReadModel";
import { type SolanaReadState, type SolanaSource, solanaAmountToDecimal } from "./solanaSchemas";
export interface SolanaKaminoReadSectionProps {
  /** Configure renders metadata/allocation/market metrics; Manage renders account amounts and risk. */
  mode: "configure" | "manage";
  /** Independent selected canonical origin, not a drawing token label or inferred reserve. */
  origin: KaminoReadIdentity | null;
  /** Declared source-preserving read, null until separately integrated. */
  read: KaminoReadSnapshot | null;
  /** Configure slot places the parent's local allocation input after Market/Reserve. */
  allocation?: ReactNode;
  /** Separate full-account Current/After risk; absence remains unavailable. */
  risk?: Pick<ManageLendingRiskSectionProps, "origin" | "current" | "after">;
  /** Host layout override. */
  className?: string;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-foreground text-xs">{label}</dt>
      <dd className="min-w-0 break-all text-right text-sm tabular-nums">{children}</dd>
    </div>
  );
}
function Source({ source }: { source: SolanaSource | null }) {
  const t = useTranslations("manager.solanaPreview.holding");
  if (!source) return null;
  return (
    <dl className="mt-2 grid min-w-0 gap-1 text-xs">
      <Row label={t("source")}>
        {source.kind === "fixture" ? (
          <>
            <span>{t("fixture")}</span>: {source.fixtureId}
          </>
        ) : (
          source.source
        )}
      </Row>
      <Row label={t("asOf")}>{source.sourceAsOf}</Row>
      {source.kind === "observed" ? (
        <>
          <Row label={t("slot")}>{source.slot}</Row>
          <Row label={t("commitment")}>{source.commitment}</Row>
        </>
      ) : null}
    </dl>
  );
}
function ReadValue<T>({
  read,
  children,
}: {
  read: SolanaReadState<T> | null;
  children(value: T): ReactNode;
}) {
  const t = useTranslations("manager.solanaPreview"),
    h = useTranslations("manager.solanaPreview.holding");
  return (
    <>
      <span>
        {read && (read.status === "available" || read.status === "confirmed-zero")
          ? children(read.value)
          : read?.status === "stale"
            ? h("stale")
            : read?.status === "not-applicable"
              ? t("notApplicable")
              : t("marketUnavailable")}
      </span>
      {read?.status === "confirmed-zero" ? <span className="ml-2 text-xs">{h("zero")}</span> : null}
      <Source source={read?.source ?? null} />
    </>
  );
}
function Metric({ label, metric }: { label: string; metric: KaminoMetric | null }) {
  const locale = useLocale(),
    h = useTranslations("manager.solanaPreview.holding");
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  return (
    <div className="min-w-0">
      <dl>
        <Row label={label}>
          <ReadValue read={metric?.quantity ?? null}>
            {(amount) =>
              `${solanaAmountToDecimal(amount).replace(".", separator)} ${amount.token.symbol}`
            }
          </ReadValue>
        </Row>
        <Row label={h("valueUsd")}>
          <ReadValue read={metric?.valueUsd ?? null}>
            {(value) => formatKaminoUsd(value.usd)}
          </ReadValue>
        </Row>
      </dl>
    </div>
  );
}
/** The host passes null in production. Structural validation never attests source freshness/authority. */
export function SolanaKaminoReadSection({
  mode,
  origin,
  read,
  allocation,
  risk,
  className,
}: SolanaKaminoReadSectionProps) {
  const t = useTranslations("manager.solanaPreview"),
    h = useTranslations("manager.solanaPreview.holding"),
    l = useTranslations("manager.solanaPreview.localManage"),
    r = useTranslations("manager.manageV2.lendingRisk"),
    titleId = useId(),
    locale = useLocale();
  const canonicalOrigin = inspectKaminoOrigin(origin),
    value = inspectKaminoRead(canonicalOrigin, read),
    metadata = value?.metadata ?? null;
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  const unavailableRisk = {
    origin: { identity: null, preview: null },
    current: { status: "unavailable", snapshot: null },
    after: { status: "unavailable", snapshot: null },
  } as const;
  const riskIdentity = risk?.origin.identity;
  const matchingRisk =
    canonicalOrigin &&
    riskIdentity?.protocol === "kamino-lend" &&
    riskIdentity.cluster === canonicalOrigin.cluster &&
    riskIdentity.program === canonicalOrigin.program &&
    riskIdentity.market === canonicalOrigin.market &&
    riskIdentity.obligation === canonicalOrigin.obligation;
  return (
    <section
      aria-labelledby={titleId}
      aria-live="polite"
      className={cn("min-w-0 space-y-4", className)}
    >
      <h3 id={titleId} className="font-medium text-sm">
        {t("supplyUsdc")}
      </h3>
      <dl className="grid min-w-0 gap-3">
        <Row label={h("program")}>
          <ReadValue read={metadata}>{(data) => data.program}</ReadValue>
        </Row>
        <Row label={t("market")}>
          <ReadValue read={metadata}>{(data) => data.market}</ReadValue>
        </Row>
        <Row label={t("reserve")}>
          <ReadValue read={metadata}>{(data) => data.reserve}</ReadValue>
        </Row>
        {mode === "manage" ? (
          <>
            <Row label={h("position")}>
              <ReadValue read={metadata}>
                {(data) => data.positionId ?? t("marketUnavailable")}
              </ReadValue>
            </Row>
            <Row label={r("obligation")}>
              <ReadValue read={metadata}>
                {(data) => data.obligation ?? t("marketUnavailable")}
              </ReadValue>
            </Row>
          </>
        ) : null}
      </dl>
      {mode === "configure" ? (
        allocation
      ) : (
        <div className="grid min-w-0 gap-4">
          <Metric label={t("kaminoRead.supplied")} metric={value?.supplied ?? null} />
          <Metric label={l("principal")} metric={value?.principal ?? null} />
          <Metric label={l("interest")} metric={value?.interest ?? null} />
          {value?.rewards ? (
            value.rewards.map((metric, index) => (
              <Metric
                key={
                  metric.quantity && "value" in metric.quantity
                    ? `${metric.quantity.value.token.kind}:${metric.quantity.value.token.symbol}:${index}`
                    : index
                }
                label={l("rewards")}
                metric={metric}
              />
            ))
          ) : (
            <Metric label={l("rewards")} metric={null} />
          )}
        </div>
      )}
      <dl>
        <Row label={t("supplyApy")}>
          <ReadValue read={value?.supplyApy ?? null}>
            {(data) => `${data.percent.replace(".", separator)}%`}
          </ReadValue>
        </Row>
      </dl>
      {mode === "configure" ? (
        <>
          <Metric label={t("availableLiquidity")} metric={value?.availableLiquidity ?? null} />
          <Metric label={t("depositCapacity")} metric={value?.depositCapacity ?? null} />
        </>
      ) : (
        <>
          <Metric
            label={t("kaminoRead.availableToWithdraw")}
            metric={value?.availableToWithdraw ?? null}
          />
          <ManageLendingRiskSection {...(matchingRisk && risk ? risk : unavailableRisk)} />
        </>
      )}
    </section>
  );
}
