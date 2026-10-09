/**
 * @id PP-MGR-CMP-101
 * @name SolanaBuilderPanelBodies
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, traditional BlockPanel owns bounded intent events.
 */
"use client";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { PanelSelect } from "../build/panel/PanelSelect";
import type {
  PanelBodies,
  PanelBodyDefinition,
  PanelFieldsProps,
} from "../build/panel/panelBodies";
import type { PositionConfig, SolanaLocalBlockConfig } from "../build/plan/buildPlan";
import { SolanaHoldingPresenter } from "./SolanaHoldingPresenter";
import { SolanaKaminoReadSection } from "./SolanaKaminoReadSection";
import { SolanaRangePresenter } from "./SolanaRangePresenter";
import { SOLANA_LOCAL_CONFIGS } from "./solanaBuilderRuntime";

function Fields({
  context,
  config,
  onConfigChange,
  allocation,
  sharePct,
}: PanelFieldsProps<SolanaLocalBlockConfig>) {
  const t = useTranslations("manager");
  const holding = context.kind === "solanaHolding";
  const labelId = useId();
  const nativeLogo = {
    symbol: holding ? "WSOL" : "SOL",
    network: "solana",
    logoUrl: "/protocols/solana-preview/solana.svg",
  };
  const stableLogo = { symbol: "USDC", network: "solana" };
  // PP-INTEGRATION-POINT: POO-2261/2262 own independent Solana market/reserve/balance reads;
  // descriptor intent grants no canonical origin, range, balance, quote or execution authority.
  return (
    <div className="space-y-4">
      {context.kind === "solanaKaminoSupply" ? (
        <SolanaKaminoReadSection
          mode="configure"
          origin={null}
          read={null}
          allocation={allocation}
        />
      ) : (
        <>
          {allocation}
          <div className="flex flex-col gap-2">
            <span id={labelId} className="text-foreground text-sm">
              {t(holding ? "solanaPreview.holding.token" : "solanaPreview.pair")}
            </span>
            <PanelSelect
              labelId={labelId}
              options={[
                {
                  id: "SOL / USDC",
                  label: holding ? "WSOL" : "SOL / USDC",
                  logos: holding ? [nativeLogo] : [nativeLogo, stableLogo],
                },
                {
                  id: "USDC / SOL",
                  label: holding ? "USDC" : "USDC / SOL",
                  logos: holding ? [stableLogo] : [stableLogo, nativeLogo],
                },
              ]}
              value={config.pair}
              idComparison="exact"
              onChange={(pair) => {
                if (pair === "SOL / USDC" || pair === "USDC / SOL")
                  onConfigChange({ ...config, pair });
              }}
            />
          </div>
          {holding ? (
            <SolanaHoldingPresenter
              origin={null}
              read={null}
              intent={null}
              quote={null}
              clock={{ now: null, blockHeight: null }}
              mode="choice"
              onMode={() => {}}
            />
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t("solanaPreview.marketUnavailable")}
              </p>
              {(sharePct ?? 0) > 0 ? (
                <SolanaRangePresenter
                  context={null}
                  range={null}
                  onChange={() => {}}
                  onInvalid={() => {}}
                  readOnly
                />
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
const body: PanelBodyDefinition<SolanaLocalBlockConfig> = {
  usePick(context) {
    const t = useTranslations("manager");
    const config = SOLANA_LOCAL_CONFIGS[context.kind] ?? null;
    const names = {
      solanaHolding: t("solanaPreview.holding.title"),
      solanaOrcaPool: t("solanaPreview.protocols.orca"),
      solanaRaydiumPool: t("solanaPreview.protocols.raydium"),
      solanaKaminoSupply: t("solanaPreview.protocols.kamino"),
    };
    const name = names[context.kind as keyof typeof names] ?? t("solanaPreview.marketUnavailable");
    return {
      heading: name,
      count: 1,
      filterPlaceholder: t("solanaPreview.pair"),
      rows: [
        {
          id: config?.catalogId ?? context.kind,
          title: name,
          subtitle: t("solanaPreview.marketUnavailable"),
          logos: [],
          searchText: name,
          config,
        },
      ],
      caption: t("solanaPreview.marketUnavailable"),
      link: { prompt: "", label: t("fundBuilder.canvas.menu.link.protocols"), step: "protocols" },
      noMatch: {
        title: () => t("solanaPreview.marketUnavailable"),
        caption: t("solanaPreview.marketUnavailable"),
      },
      emptyTitle: t("solanaPreview.marketUnavailable"),
    };
  },
  Fields,
};
export const SOLANA_PANEL_BODIES: PanelBodies = {
  solanaOrcaPool: body,
  solanaRaydiumPool: body,
  solanaKaminoSupply: body,
  solanaHolding: body,
};

/** The shared EVM palette remains visible, but local mode never mounts a live EVM provider. */
function unavailableBody<C extends PositionConfig>(): PanelBodyDefinition<C> {
  return {
    usePick() {
      const t = useTranslations("manager");
      const unavailable = t("solanaPreview.marketUnavailable");
      return {
        heading: unavailable,
        count: 0,
        filterPlaceholder: unavailable,
        rows: [],
        caption: unavailable,
        link: {
          prompt: "",
          label: t("fundBuilder.canvas.menu.link.protocols"),
          step: "protocols",
        },
        noMatch: { title: () => unavailable, caption: unavailable },
        emptyTitle: unavailable,
      };
    },
    Fields: function UnavailableFields() {
      const t = useTranslations("manager");
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {t("solanaPreview.marketUnavailable")}
        </p>
      );
    },
  };
}
export const LOCAL_PANEL_BODIES: PanelBodies = {
  ...SOLANA_PANEL_BODIES,
  uniswapV4Pool: unavailableBody(),
  uniswapV3Pool: unavailableBody(),
  aaveSupply: unavailableBody(),
  aaveBorrow: unavailableBody(),
  pendle: unavailableBody(),
  gmxPerp: unavailableBody(),
};
