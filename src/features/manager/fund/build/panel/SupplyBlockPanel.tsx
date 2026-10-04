/**
 * @id PP-MGR-CMP-072
 * @name SupplyBlockPanel
 * @implements-rules-version v1 (POO-2194)
 * @analytics-events none, the panel shell emits configuration, Apply, Discard and blocked intent
 *
 * Aave v3 Supply body for the Build panel. The shell owns allocation and atomic Apply/Discard.
 * The current executable route is USDC on Arbitrum, arriving as USDC, without an automatic swap.
 * Rates and reserve eligibility are the catalog's snapshot; this body starts no polling policy.
 *
 * PP-INTEGRATION-POINT: usePanelReserves selects the shell's GET /api/v2/catalog/aave-v3/reserves
 * data, intersected with the mandate. Loading, error and unusable reserves hold both Use and Apply.
 */
"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatPercent } from "@/lib/utils/format";
import { depositTokenRefFor, tokenKey } from "../../mandateDraft";
import type { AaveBlockConfig } from "../plan/buildPlan";
import { PanelFieldLabel } from "./PanelFieldLabel";
import { PanelSelect } from "./PanelSelect";
import type { PanelBodyContext, PanelBodyDefinition, PanelFieldsProps } from "./panelBodies";
import { usePanelCopy } from "./panelCopy";
import { NUMERIC_BODY, OUTLINE_PILL } from "./panelStyles";
import { usePanelReserves } from "./usePanelReserves";

/** One catalog read shared by the shell; deriving a view adds no requests. */
function useSupplyRows(context: PanelBodyContext) {
  const t = useTranslations("manager.fundBuilder.build.supplyPanel");
  const copy = usePanelCopy();
  const source = usePanelReserves(
    context.network === "arbitrum" ? 42161 : 4663,
    context.draft,
    context.catalog,
  );
  const deposit = depositTokenRefFor("arbitrum");
  const supportedKey = deposit ? tokenKey(deposit) : null;
  const readReason = source.loading
    ? copy.read.loading
    : source.error
      ? copy.read.error
      : undefined;
  return {
    ...source,
    readReason,
    rows: source.reserves.map((reserve) => {
      const disabledReason =
        readReason ??
        (!reserve.usable
          ? t(reserve.reason ?? "unavailable")
          : context.network !== "arbitrum" || reserve.assetKey !== supportedKey
            ? t("unsupported")
            : undefined);
      const rate = Number(reserve.supplyApy);
      return {
        ...reserve,
        disabledReason,
        apy:
          reserve.supplyApy.trim() !== "" && Number.isFinite(rate) && rate >= 0
            ? formatPercent(rate)
            : t("unavailable"),
      };
    }),
  };
}

/** Asset selector and the rate below it, followed by the shell's Allocation. */
export function SupplyBlockPanel({
  context,
  config,
  onConfigChange,
  allocation,
}: PanelFieldsProps<AaveBlockConfig>) {
  const t = useTranslations("manager.fundBuilder.build.supplyPanel");
  const copy = usePanelCopy();
  const labelId = useId();
  const { rows, loading, error, retry } = useSupplyRows(context);
  const selected = rows.find((row) => row.assetKey === config.assetKey);
  const fallback = context.draft.tokens.find((token) => tokenKey(token) === config.assetKey);
  const options = rows.map((row) => ({
    id: row.assetKey,
    label: row.token.symbol,
    logos: [{ symbol: row.token.symbol, network: context.network }],
    metric: { label: t("apy"), value: row.apy, tone: "success" as const },
    disabledReason: row.disabledReason,
  }));
  if (!selected)
    options.unshift({
      id: config.assetKey,
      label: fallback?.symbol ?? t("unavailable"),
      logos: fallback ? [{ symbol: fallback.symbol, network: context.network }] : [],
      metric: { label: t("apy"), value: t("unavailable"), tone: "success" },
      disabledReason: t("unavailable"),
    });
  return (
    <>
      <div className="flex flex-col gap-2" aria-busy={loading}>
        <PanelFieldLabel
          label={t("asset")}
          help={t("help", { network: context.networkName })}
          helpLabel={copy.moreAbout(t("asset"))}
          labelId={labelId}
        />
        <PanelSelect
          labelId={labelId}
          options={options}
          value={config.assetKey}
          onChange={(assetKey) => {
            if (rows.some((row) => row.assetKey === assetKey && !row.disabledReason))
              onConfigChange({ assetKey });
          }}
          footer={{
            prompt: t("needAsset"),
            label: copy.link.tokens,
            onClick: () => context.onEditMandate("tokens"),
          }}
        />
        <div className="flex items-center justify-between gap-2 text-xs" aria-live="polite">
          <span className="text-muted-foreground">{t("apy")}</span>
          {loading ? (
            <Skeleton width={48} height={16} />
          ) : (
            <span
              className={`${NUMERIC_BODY} ${selected && !error ? "text-success" : "text-muted-foreground"}`}
            >
              {error ? t("unavailable") : (selected?.apy ?? t("unavailable"))}
            </span>
          )}
        </div>
        {error ? (
          <div role="alert" className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{copy.read.error}</span>
            <button type="button" onClick={retry} className={OUTLINE_PILL}>
              {copy.read.retry}
            </button>
          </div>
        ) : null}
      </div>
      {allocation}
    </>
  );
}

/** The shell calls the hooks only inside components keyed on the selected block. */
export const supplyBlockBody: PanelBodyDefinition<AaveBlockConfig> = {
  usePick(context) {
    const t = useTranslations("manager.fundBuilder.build.supplyPanel");
    const copy = usePanelCopy();
    const { rows, loading, error, retry } = useSupplyRows(context);
    return {
      heading: t("heading"),
      count: rows.length,
      filterPlaceholder: t("filter"),
      rows: rows.map((row) => ({
        id: row.assetKey,
        title: row.token.symbol,
        subtitle: row.token.name,
        logos: [{ symbol: row.token.symbol, network: context.network }],
        metric: { label: t("apy"), value: row.apy, tone: "success" },
        searchText: `${row.token.name} ${row.token.address}`,
        disabledReason: row.disabledReason,
        config: row.disabledReason ? null : { assetKey: row.assetKey },
      })),
      caption: t("caption", { network: context.networkName }),
      link: { prompt: t("needAsset"), label: copy.link.tokens, step: "tokens" },
      noMatch: { title: (typed) => t("noMatch", { typed }), caption: t("noMatchCaption") },
      emptyTitle: t("empty", { network: context.networkName }),
      status: loading ? "loading" : error ? "error" : "ready",
      onRetry: retry,
    };
  },
  Fields: SupplyBlockPanel,
  useApplyGate(context, config) {
    const t = useTranslations("manager.fundBuilder.build.supplyPanel");
    const { rows, readReason } = useSupplyRows(context);
    const selected = rows.find((row) => row.assetKey === config.assetKey);
    const reason =
      readReason ?? selected?.disabledReason ?? (!selected ? t("unavailable") : undefined);
    return { ok: !reason, reason };
  },
};
