/**
 * @id PP-MGR-CMP-101
 * @name SolanaBuilderPanelBodies
 * @implements-rules-version v1 (POO-2301); POO-2343 rules v1 (R7 pool of the Raydium block, R9 source text)
 * @analytics-events none, traditional BlockPanel owns bounded intent events.
 *
 * POO-2343 R7: the Raydium block chooses one of the Raydium pools of the mandate, or the default
 * SOL/USDC pool when the mandate has none (`raydiumBlockPool.ts`). The config keeps `poolAddress`
 * and the pair label. R9: for Raydium, the panel names DEX Screener as the source of the pool data.
 *
 * POO-2351 R1: the EVM kinds no longer have an "unavailable" body here; the shared bodies serve them.
 * R3: a Raydium row shows the two pair logos, the pair as title and the short address as subtitle.
 * R4/R6: the Kamino panel has a token select (USDC, plus SOL when the mandate has it) and never
 * shows "Not available".
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
import type { SolanaLocalBlockConfig } from "../build/plan/buildPlan";
import {
  type KaminoToken,
  kaminoConfigFor,
  kaminoTokenLogo,
  kaminoTokenOf,
  kaminoTokenOptions,
} from "./kaminoToken";
import {
  raydiumBlockConfig,
  raydiumBlockPools,
  raydiumPairLogos,
  raydiumPickRow,
  shortPoolAddress,
} from "./raydiumBlockPool";
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
  const raydium = context.kind === "solanaRaydiumPool";
  const labelId = useId();
  const nativeLogo = {
    symbol: holding ? "WSOL" : "SOL",
    network: "solana",
    logoUrl: "/protocols/solana-preview/solana.svg",
  };
  const stableLogo = { symbol: "USDC", network: "solana" };
  // R7: the pools of the mandate, plus the pool the block holds now when the mandate dropped it.
  const raydiumPools = raydium ? raydiumBlockPools(context.draft) : [];
  if (
    raydium &&
    config.poolAddress &&
    !raydiumPools.some((pool) => pool.poolAddress === config.poolAddress)
  )
    raydiumPools.push({ poolAddress: config.poolAddress, pair: config.pair });
  const selectOptions = raydium
    ? raydiumPools.map((pool) => ({
        id: pool.poolAddress,
        label: `${pool.pair} ${shortPoolAddress(pool.poolAddress)}`,
        logos: raydiumPairLogos(pool.pair),
      }))
    : [
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
      ];
  // R4: USDC always, SOL when the mandate has it, and the token the block holds now.
  const kaminoToken = kaminoTokenOf(config);
  const kaminoTokens: KaminoToken[] = kaminoTokenOptions(context.draft);
  if (!kaminoTokens.includes(kaminoToken)) kaminoTokens.push(kaminoToken);
  const kaminoSelectOptions = kaminoTokens.map((token) => ({
    id: token,
    label: token,
    logos: [kaminoTokenLogo(token)],
  }));
  // PP-INTEGRATION-POINT: POO-2261/2262 own independent Solana market/reserve/balance reads;
  // descriptor intent grants no canonical origin, range, balance, quote or execution authority.
  return (
    <div className="space-y-4">
      {context.kind === "solanaKaminoSupply" ? (
        <>
          <div className="flex flex-col gap-2">
            <span id={labelId} className="text-foreground text-sm">
              {t("solanaPreview.holding.token")}
            </span>
            <PanelSelect
              labelId={labelId}
              options={kaminoSelectOptions}
              value={kaminoToken}
              idComparison="exact"
              onChange={(id) => {
                if (id === "USDC" || id === "SOL") onConfigChange(kaminoConfigFor(id));
              }}
            />
          </div>
          <SolanaKaminoReadSection
            mode="configure"
            origin={null}
            read={null}
            allocation={allocation}
            token={kaminoToken}
          />
        </>
      ) : (
        <>
          {allocation}
          <div className="flex flex-col gap-2">
            <span id={labelId} className="text-foreground text-sm">
              {t(
                holding
                  ? "solanaPreview.holding.token"
                  : raydium
                    ? "solanaPreview.pool"
                    : "solanaPreview.pair",
              )}
            </span>
            <PanelSelect
              labelId={labelId}
              options={selectOptions}
              value={raydium ? (config.poolAddress ?? "") : config.pair}
              idComparison="exact"
              onChange={(id) => {
                if (raydium) {
                  const pool = raydiumPools.find((entry) => entry.poolAddress === id);
                  if (pool) onConfigChange(raydiumBlockConfig(pool));
                  return;
                }
                if (id === "SOL / USDC" || id === "USDC / SOL")
                  onConfigChange({ ...config, pair: id });
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
                {t(raydium ? "solanaPreview.raydiumSource" : "solanaPreview.marketUnavailable")}
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
    const raydium = context.kind === "solanaRaydiumPool";
    const names = {
      solanaHolding: t("solanaPreview.holding.title"),
      solanaOrcaPool: t("solanaPreview.protocols.orca"),
      solanaRaydiumPool: t("solanaPreview.protocols.raydium"),
      solanaKaminoSupply: t("solanaPreview.protocols.kamino"),
    };
    const name = names[context.kind as keyof typeof names] ?? t("solanaPreview.marketUnavailable");
    // R7: one row for each Raydium pool of the mandate, or the default pool. R9: DEX Screener is the source.
    // R3: the row shows the pair logos and the short address. R4/R6: one row for each Kamino token.
    const kamino = context.kind === "solanaKaminoSupply";
    const rows = raydium
      ? raydiumBlockPools(context.draft).map((pool) => raydiumPickRow(pool, name))
      : kamino
        ? kaminoTokenOptions(context.draft).map((token) => ({
            id: token,
            title: token,
            subtitle: name,
            logos: [kaminoTokenLogo(token)],
            searchText: `${name} ${token}`,
            config: kaminoConfigFor(token),
          }))
        : [
            {
              id: config?.catalogId ?? context.kind,
              title: name,
              subtitle: t("solanaPreview.marketUnavailable"),
              logos: [],
              searchText: name,
              config,
            },
          ];
    const caption = t(
      raydium
        ? "solanaPreview.raydiumSource"
        : kamino
          ? "solanaPreview.drawingChoice"
          : "solanaPreview.marketUnavailable",
    );
    return {
      heading: name,
      count: rows.length,
      filterPlaceholder: kamino
        ? t("fundBuilder.build.supplyPanel.filter")
        : t("solanaPreview.pair"),
      rows,
      caption,
      link: { prompt: "", label: t("fundBuilder.canvas.menu.link.protocols"), step: "protocols" },
      noMatch: kamino
        ? {
            title: (typed) => t("fundBuilder.build.supplyPanel.noMatch", { typed }),
            caption: t("fundBuilder.build.supplyPanel.noMatchCaption"),
          }
        : { title: () => t("solanaPreview.marketUnavailable"), caption },
      emptyTitle: kamino ? name : t("solanaPreview.marketUnavailable"),
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
