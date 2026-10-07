/**
 * @id PP-MGR-CMP-094 (POO-2290)
 * @name ManageLendingRiskSection
 * @implements-rules-version v1
 * @linear https://linear.app/yeildbay/issue/POO-2290
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8682-3708
 * @analytics-events none, read-only risk presenter; mounted hosts own read/blocked/error events.
 * @i18n-namespace manager.manageV2.lendingRisk
 * Shared inline full-account risk, with independently supplied Current and After.
 */
"use client";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { cn } from "@/lib/utils/cn";
import {
  type LendingRiskColumnView,
  type LendingRiskRead,
  type LendingRiskToken,
  lendingRiskAmountDecimal,
  type ManageLendingRiskOrigin,
  projectManageLendingRisk,
} from "./manageLendingRisk";
export interface ManageLendingRiskSectionProps {
  /** Full verified account identity; null when the host has no authorized account read. */
  origin: ManageLendingRiskOrigin;
  /** Independent current account snapshot, never a selected Supply-row risk value. */
  current: LendingRiskRead;
  /** Successful scenario keyed by the host's draft and base snapshot, or unavailable. */
  after: LendingRiskRead;
  className?: string;
}
export function ManageLendingRiskSection({
  origin,
  current,
  after,
  className,
}: ManageLendingRiskSectionProps) {
  const t = useTranslations("manager.manageV2.lendingRisk"),
    locale = useLocale(),
    titleId = useId();
  // PP-INTEGRATION-POINT: POO-2290 real full-account read/projection must supply validated provenance and host preview identity; no API DTO or protocol formula is inferred here.
  const view = projectManageLendingRisk(origin, current, after);
  const columns = [
    { name: "current" as const, value: view.current },
    { name: "after" as const, value: view.after },
  ];
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
  const tokenAddress = (token: LendingRiskToken) =>
    token.network === "evm" ? token.address : token.kind === "spl" ? token.mint : "SOL";
  const tokenKey = (token: LendingRiskToken) =>
    token.network === "evm"
      ? `${token.chainId}:${token.address}`
      : `${token.cluster}:${token.kind}:${tokenAddress(token)}`;
  const fact = (label: string, value: string) => (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground">{t(label)}</dt>
      <dd className="min-w-0 break-all text-foreground tabular-nums">{value}</dd>
    </div>
  );
  const metric = (field: "healthFactor" | "liquidationPrice") => (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="break-words font-normal text-xs text-muted-foreground">{t(field)}</h3>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        {columns.map((column) => (
          <span key={column.name} className="min-w-0 break-words text-muted-foreground">
            {t(column.name)}
          </span>
        ))}
      </div>
      <div data-lending-risk-values={field} className="grid min-w-0 grid-cols-2 gap-3">
        {columns.map(({ name, value }) => (
          <p key={name} className="min-w-0 break-words text-foreground tabular-nums">
            {value.status === "noDebt"
              ? t("notApplicable")
              : field === "healthFactor"
                ? value.healthFactor !== null
                  ? number(value.healthFactor)
                  : t("notAvailable")
                : value.liquidationPrice
                  ? `${number(value.liquidationPrice.decimal)} USD / ${value.liquidationPrice.asset.symbol}`
                  : t("notAvailable")}
          </p>
        ))}
      </div>
    </div>
  );
  const details = (name: "current" | "after", column: LendingRiskColumnView) =>
    column.source ? (
      <article key={name} className="flex min-w-0 flex-col gap-2 border-t border-border pt-2">
        <h3 className="font-medium text-xs">
          {t(name)} · {t("source")}
        </h3>
        <dl className="grid min-w-0 grid-cols-2 gap-3">
          {fact("source", column.source.reference)}
          {fact("asOf", column.source.asOf)}
          {column.source.blockOrSlot !== null
            ? fact(
                view.identity?.protocol === "kamino-lend" ? "slot" : "block",
                column.source.blockOrSlot,
              )
            : null}
          {column.scenarioId ? fact("scenario", column.scenarioId) : null}
        </dl>
        {column.source.kind === "fixture" ? (
          <p className="break-words text-muted-foreground">{t("fixture")}</p>
        ) : null}
        {column.context ? (
          <>
            <p className="break-words text-muted-foreground">
              {t("method")}: {column.context.method}
            </p>
            <h4 className="font-medium text-xs">{t("assumptions")}</h4>
            <ul className="flex min-w-0 flex-col gap-1 text-muted-foreground">
              {[...new Set(column.context.assumptions)].map((value) => (
                <li key={value} className="break-words">
                  {value}
                </li>
              ))}
            </ul>
            {(["collateral", "debt"] as const).map((group) => (
              <div key={group} className="flex min-w-0 flex-col gap-1">
                <h4 className="font-medium text-xs">{t(group)}</h4>
                {column.context?.[group].map((amount) => (
                  <div key={tokenKey(amount.token)} className="flex min-w-0 flex-col gap-1">
                    <p className="break-all tabular-nums">
                      {number(lendingRiskAmountDecimal(amount))} {amount.token.symbol}
                    </p>
                    <p className="break-all text-muted-foreground">
                      {t("tokenMetadata")}: {tokenAddress(amount.token)} · {amount.token.decimals}
                    </p>
                  </div>
                ))}
              </div>
            ))}
            {column.context.oracles.map((oracle) => (
              <div
                key={tokenKey(oracle.token)}
                className="flex min-w-0 flex-col gap-1 text-muted-foreground"
              >
                <p className="break-words">
                  {t("oracle")}: {oracle.provider} · {number(oracle.decimal)} USD /{" "}
                  {oracle.token.symbol}
                </p>
                <p className="break-all">
                  {oracle.source.reference} · {oracle.source.asOf}
                  {oracle.source.blockOrSlot !== null ? ` · ${oracle.source.blockOrSlot}` : ""}
                </p>
              </div>
            ))}
            {column.context.parameters.map((parameter) => (
              <div
                key={tokenKey(parameter.token)}
                className="flex min-w-0 flex-col gap-1 text-muted-foreground"
              >
                {parameter.liquidationThresholdRatio !== null ? (
                  <p className="break-words">
                    {t("collateralThreshold")}: {parameter.token.symbol} ·{" "}
                    {number(parameter.liquidationThresholdRatio)}
                  </p>
                ) : null}
                {parameter.borrowFactorRatio !== null ? (
                  <p className="break-words">
                    {t("borrowFactor")}: {parameter.token.symbol} ·{" "}
                    {number(parameter.borrowFactorRatio)}
                  </p>
                ) : null}
              </div>
            ))}
          </>
        ) : null}
      </article>
    ) : null;
  const identity = view.identity;
  const accountUnavailable = columns.every(
    (column) => column.value.reason === "accountUnavailable",
  );
  return (
    <section
      aria-labelledby={titleId}
      aria-live="polite"
      aria-busy={current.status === "loading" || after.status === "loading"}
      className={cn("flex min-w-0 flex-col gap-2 text-xs", className)}
    >
      <h2 id={titleId} className="sr-only">
        {t("title")}
      </h2>
      {metric("healthFactor")}
      {metric("liquidationPrice")}
      {accountUnavailable ? (
        <p className="break-words text-muted-foreground">{t("accountUnavailable")}</p>
      ) : (
        columns.map(({ name, value }) =>
          value.status === "noDebt" ? (
            <p key={name} className="break-words text-muted-foreground">
              {t(name)} · {t("noDebt")}
            </p>
          ) : value.reason && !value.noPositiveRoot ? (
            <p
              key={name}
              className="break-words text-muted-foreground"
              role={value.reason === "readError" ? "alert" : undefined}
            >
              {t(name)} · {t(value.reason)}
            </p>
          ) : null,
        )
      )}
      {columns.map(({ name, value }) =>
        value.noPositiveRoot ? (
          <p key={name} className="break-words text-muted-foreground">
            {t(name)} · {t("noPositiveRoot")}
          </p>
        ) : null,
      )}
      {identity ? (
        <>
          <p className="break-words text-muted-foreground">{t("fullAccount")}</p>
          <dl className="grid min-w-0 grid-cols-2 gap-3 border-t border-border pt-2">
            {fact("account", identity.account)}
            {fact("market", identity.market)}
            {identity.protocol === "aave-v3" ? (
              <>
                {fact("core", identity.core)}
                {fact("network", String(identity.chainId))}
              </>
            ) : (
              <>
                {fact("program", identity.program)}
                {fact("obligation", identity.obligation)}
                {fact("network", identity.cluster)}
              </>
            )}
          </dl>
        </>
      ) : null}
      {columns.map(({ name, value }) => details(name, value))}
    </section>
  );
}
