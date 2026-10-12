/**
 * @id PP-MGR-CMP-105
 * @name BorrowBlockPanel
 * @implements-rules-version v1 (POO-2334 rules v1)
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8189-2337
 * @analytics-events none, the panel shell emits configuration, Apply, Discard and blocked intent
 *
 * Aave v3 Borrow body for the Build panel (R1 to R8). The shell owns the head, the status row,
 * Apply changes, Remove block and its confirm. A Borrow takes no share of its own: it borrows
 * against the Supply directly above it, so the shell hands it no Allocation field.
 *
 * Order, as frame 8189:2337 draws it: Collateral (read only, the Supply above, with a lock), Asset
 * (a select with the borrow APY of each option, then the Borrow APY row), Borrow amount (a slider
 * from 0 to the Aave limit in the Allocation slider's steps, the track beyond the limit dimmed), the
 * risk rows (Health factor, Liquidation price and the drop sentence, the one polite live region),
 * then the Lending risk block. The share is read within the limit (`readBorrowPct`), so the slider,
 * the risk rows and Apply use the same value, and each change the panel writes carries it
 * (`borrowConfigWith`).
 *
 * The decisions are pure and tested in `lendingPanelMath.ts` (PP-MGR-LIB-080).
 *
 * PP-INTEGRATION-POINT: every market figure (borrow APY, max LTV, liquidation threshold, USD
 * price) and the fund capital come from `borrowMarketFixtures` (PP-MGR-MCK-006) in mock mode. The
 * v2 catalog serves no borrow data yet; in real mode the panel reads none and says "Unavailable".
 * There is no contract base for a Borrow (Figma note 8193:2380), so no launch wiring is done here.
 */
"use client";

import { Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import { isMockMode } from "@/lib/services";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatTokenAmount, formatUsdPrecise } from "@/lib/utils/format";
import { BORROW_MARKET_FIXTURES, MOCK_FUND_CAPITAL_USD } from "@/mocks/data/borrowMarketFixtures";
import { ManageLendingRiskSection } from "../../manage/ManageLendingRiskSection";
import type { LendingRiskRead } from "../../manage/manageLendingRisk";
import { tokenKey } from "../../mandateDraft";
import type { AaveBlockConfig } from "../plan/buildPlan";
import { AllocationSlider } from "./AllocationSlider";
import {
  BORROW_DEFAULT_PCT,
  type BorrowApplyBlocker,
  type BorrowMarket,
  borrowAmount,
  borrowApplyBlocker,
  borrowCollateral,
  borrowConfigWith,
  borrowOptions,
  borrowRisk,
  type HealthTone,
  readBorrowPct,
} from "./lendingPanelMath";
import { PanelFieldLabel } from "./PanelFieldLabel";
import { PanelSelect, TokenLogos } from "./PanelSelect";
import type { PanelBodyContext, PanelBodyDefinition, PanelFieldsProps } from "./panelBodies";
import { usePanelCopy } from "./panelCopy";
import { NUMERIC_BODY } from "./panelStyles";

/** PP-INTEGRATION-POINT: the Aave v3 borrow market; mock mode only until the catalog serves it. */
const MARKET: BorrowMarket = isMockMode ? BORROW_MARKET_FIXTURES : {};

/** PP-INTEGRATION-POINT: the fund capital a 100% share stands for; mock mode only. */
const CAPITAL_USD = isMockMode ? MOCK_FUND_CAPITAL_USD : 0;

/** No account exists while the fund is built: the Lending risk block says "Not available". */
const RISK_UNAVAILABLE: LendingRiskRead = { status: "unavailable", snapshot: null };

const TONE_CLASS: Record<HealthTone, string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

/** The collateral, the options and the risk of the selected block, from one pure model. */
function useBorrowModel(context: PanelBodyContext, config: AaveBlockConfig | null) {
  const t = useTranslations("manager.fundBuilder.build.borrowPanel");
  const collateral = borrowCollateral(
    context.plan,
    context.draft,
    context.blockId,
    MARKET,
    CAPITAL_USD,
  );
  const rows = borrowOptions(
    context.draft.tokens,
    context.network,
    collateral?.assetKey ?? null,
    MARKET,
  ).map((option) => ({
    ...option,
    apy: option.apyPct === null ? t("unavailable") : formatPercent(option.apyPct),
    disabledReason: !collateral
      ? t("needSupply")
      : option.apyPct === null
        ? t("unavailable")
        : undefined,
  }));
  const selected = config ? rows.find((row) => row.assetKey === config.assetKey) : undefined;
  const borrowPct = readBorrowPct(config?.borrowPct, collateral?.market ?? null);
  const risk = borrowRisk(collateral?.market ?? null, borrowPct);
  return { collateral, rows, selected, borrowPct, risk };
}

/** Collateral, Asset, Borrow amount and the risk rows (frame 8189:2337). */
export function BorrowBlockPanel({
  context,
  config,
  onConfigChange,
}: PanelFieldsProps<AaveBlockConfig>) {
  const t = useTranslations("manager.fundBuilder.build.borrowPanel");
  const copy = usePanelCopy();
  const locale = useLocale();
  const collateralId = useId();
  const assetId = useId();
  const { collateral, rows, selected, borrowPct, risk } = useBorrowModel(context, config);
  const fallback = context.draft.tokens.find((token) => tokenKey(token) === config.assetKey);
  const symbol = collateral?.symbol ?? "";
  const ceiling = risk?.ceilingPct ?? 0;

  const options = rows.map((row) => ({
    id: row.assetKey,
    label: row.symbol,
    logos: [{ symbol: row.symbol, network: context.network }],
    metric: { label: t("apy"), value: row.apy, tone: "foreground" as const },
    disabledReason: row.disabledReason,
  }));
  if (!selected)
    options.unshift({
      id: config.assetKey,
      label: fallback?.symbol ?? t("unavailable"),
      logos: fallback ? [{ symbol: fallback.symbol, network: context.network }] : [],
      metric: { label: t("apy"), value: t("unavailable"), tone: "foreground" },
      disabledReason: t("unavailable"),
    });

  const amount = selected
    ? borrowAmount(collateral?.usd ?? 0, borrowPct, selected.priceUsd ?? 0)
    : null;

  return (
    <>
      {/* R1: the Supply above, read only. */}
      <div className="flex flex-col gap-2">
        <PanelFieldLabel
          label={t("collateral")}
          help={t("collateralHelp")}
          helpLabel={copy.moreAbout(t("collateral"))}
          labelId={collateralId}
        />
        {/* biome-ignore lint/a11y/useSemanticElements: a read-only value row, not a form section; a fieldset brings a legend and form styles the Figma row does not have. */}
        <div
          role="group"
          aria-labelledby={collateralId}
          data-borrow-collateral=""
          className="flex h-[43px] w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-input px-3"
        >
          {collateral ? (
            <TokenLogos
              logos={[{ symbol, network: context.network }]}
              size={20}
              ringClass="ring-input"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm">
            {collateral ? (
              <>
                <span className="text-foreground">{symbol}</span>
                <span className="text-muted-foreground">{` · ${t("supplyAbove")}`}</span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("needSupply")}</span>
            )}
          </span>
          <Lock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </div>
        {collateral ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{t("collateralValue")}</span>
            <span className={cn(NUMERIC_BODY, "text-foreground")}>
              {collateral.amount === null
                ? formatUsdPrecise(collateral.usd, 0)
                : `${formatTokenAmount(collateral.amount, symbol, 4)} · ${formatUsdPrecise(collateral.usd, 0)}`}
            </span>
          </div>
        ) : null}
      </div>

      {/* R2: the asset to borrow, each option with its borrow APY. */}
      <div className="flex flex-col gap-2">
        <PanelFieldLabel
          label={t("asset")}
          help={t("help", { network: context.networkName })}
          helpLabel={copy.moreAbout(t("asset"))}
          labelId={assetId}
        />
        <PanelSelect
          labelId={assetId}
          options={options}
          value={config.assetKey}
          onChange={(assetKey) => {
            if (rows.some((row) => row.assetKey === assetKey && !row.disabledReason))
              onConfigChange(borrowConfigWith(config, { assetKey }, collateral?.market ?? null));
          }}
          footer={{
            prompt: t("needAsset"),
            label: copy.link.tokens,
            onClick: () => context.onEditMandate("tokens"),
          }}
        />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t("apy")}</span>
          <span className={cn(NUMERIC_BODY, "text-foreground")}>
            {selected?.apy ?? t("unavailable")}
          </span>
        </div>
      </div>

      {/* R3: the borrowed share of the collateral value, 0 to the Aave limit. */}
      {risk ? (
        <div className="flex flex-col gap-2">
          <AllocationSlider
            value={borrowPct}
            ceiling={ceiling}
            onChange={(next) =>
              onConfigChange(
                borrowConfigWith(config, { borrowPct: next }, collateral?.market ?? null),
              )
            }
            copy={{
              label: t("amount"),
              help: t("amountHelp"),
              helpLabel: copy.moreAbout(t("amount")),
            }}
            ceilingSentence={t("atLimit", { limit: ceiling, symbol })}
            ceilingLink={null}
          />
          {!risk.atLimit ? (
            <p className="text-muted-foreground text-xs">
              {t("amountCaption", { limit: ceiling, symbol })}
            </p>
          ) : null}
          {amount && selected ? (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{t("amountValue")}</span>
              <span className={cn(NUMERIC_BODY, "text-foreground")}>
                {amount.amount === null
                  ? formatUsdPrecise(amount.usd, 0)
                  : `${formatTokenAmount(amount.amount, selected.symbol, 4)} · ${formatUsdPrecise(amount.usd, 0)}`}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">{t("amount")}</span>
          <span className={cn(NUMERIC_BODY, "text-muted-foreground")}>{t("unavailable")}</span>
        </div>
      )}

      {/* R4, R5: the health factor and the liquidation price of this block alone. */}
      <div className="flex flex-col gap-2 text-xs" aria-live="polite" data-borrow-risk="">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t("healthFactor")}</span>
          <span
            className={cn(NUMERIC_BODY, risk ? TONE_CLASS[risk.tone] : "text-muted-foreground")}
            data-tone={risk?.tone}
          >
            {!risk
              ? t("unavailable")
              : risk.healthFactor === null
                ? t("noDebt")
                : new Intl.NumberFormat(locale, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(risk.healthFactor)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t("liquidationPrice")}</span>
          <span className={cn(NUMERIC_BODY, "text-foreground")}>
            {risk?.liquidationPriceUsd != null
              ? formatUsdPrecise(risk.liquidationPriceUsd, 0)
              : t("unavailable")}
          </span>
        </div>
        {risk && collateral?.market && risk.dropPct !== null ? (
          <p className={risk.tone === "destructive" ? "text-destructive" : "text-muted-foreground"}>
            {t("liquidationSentence", {
              symbol,
              price: formatUsdPrecise(collateral.market.priceUsd, 0),
              drop: Math.max(0, Math.round(risk.dropPct)),
            })}
          </p>
        ) : null}
      </div>

      <ManageLendingRiskSection
        origin={{ identity: null, preview: null }}
        current={RISK_UNAVAILABLE}
        after={RISK_UNAVAILABLE}
      />
    </>
  );
}

/** The shell calls the hooks only inside components keyed on the selected block. */
export const borrowBlockBody: PanelBodyDefinition<AaveBlockConfig> = {
  usePick(context) {
    const t = useTranslations("manager.fundBuilder.build.borrowPanel");
    const copy = usePanelCopy();
    const { rows, collateral } = useBorrowModel(context, null);
    const defaultPct = readBorrowPct(BORROW_DEFAULT_PCT, collateral?.market ?? null);
    return {
      heading: t("heading"),
      count: rows.length,
      filterPlaceholder: t("filter"),
      rows: rows.map((row) => ({
        id: row.assetKey,
        title: row.symbol,
        subtitle:
          context.draft.tokens.find((token) => tokenKey(token) === row.assetKey)?.name ??
          row.symbol,
        logos: [{ symbol: row.symbol, network: context.network }],
        metric: { label: t("apy"), value: row.apy, tone: "foreground" },
        searchText: row.assetKey,
        disabledReason: row.disabledReason,
        config: row.disabledReason ? null : { assetKey: row.assetKey, borrowPct: defaultPct },
      })),
      caption: t("caption", { network: context.networkName }),
      link: { prompt: t("needAsset"), label: copy.link.tokens, step: "tokens" },
      noMatch: { title: (typed) => t("noMatch", { typed }), caption: t("noMatchCaption") },
      emptyTitle: t("empty", { network: context.networkName }),
      status: "ready",
    };
  },
  Fields: BorrowBlockPanel,
  useApplyGate(context, config) {
    const t = useTranslations("manager.fundBuilder.build.borrowPanel");
    const { collateral, selected, borrowPct, risk } = useBorrowModel(context, config);
    const blocker = borrowApplyBlocker({
      collateral: collateral !== null,
      option: selected ?? null,
      borrowPct,
      ceilingPct: risk?.ceilingPct ?? 0,
    });
    const reasons: Record<BorrowApplyBlocker, string> = {
      needSupply: t("blocked.needSupply"),
      unavailable: t("blocked.unavailable"),
      needAmount: t("blocked.needAmount"),
      overLimit: t("blocked.overLimit"),
    };
    return { ok: blocker === null, reason: blocker ? reasons[blocker] : undefined };
  },
};
