/**
 * @id PP-MGR-LIB-024
 * @name blockCopy
 * @implements-rules-version v1 (POO-2155 rules v1)
 * @analytics-events none, translated strings only; the Build screen (PP-MGR-SCR-002, S7) owns every
 *   event
 *
 * Every string the block registry, the menus, the palette and the panel stub print, read once from
 * the `manager.fundBuilder.canvas` tree that slice S2 landed in all 11 locales. The registry and the
 * menu models are PURE (they take a {@link BlockCopy} and return strings), so they are tested
 * without React, and the components they feed are presentational.
 *
 * Every key is a LITERAL `t()` call, as `useNetworkNames` does, so the i18n usage scan binds each
 * one and a renamed key fails `pnpm i18n:check` instead of printing its own path.
 *
 * Network names come from `fundBuilder.networkNames`; a network this build does not name (Base in a
 * reference fixture) prints its raw id rather than a key path. Lists ("Base and Robinhood Chain")
 * are joined by the locale's own conjunction (`Intl.ListFormat`), never by a literal " and ".
 */
"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import type { BlockKind } from "../plan/buildPlan";

/** A translator scoped to the `manager` namespace. */
export type ManagerTranslate = (key: string, values?: Record<string, string | number>) => string;

/** The strings of the block registry, the menus, the palette and the panel stub. */
export interface BlockCopy {
  /** The translated network name; the raw id for a network this build does not name. */
  networkName(network: string): string;
  /** "Uniswap v4", "Aave v3", "Pendle", "GMX". */
  protocolName(kind: BlockKind): string;
  /** "Liquidity position", "Supply", "Borrow", "Yield position", "Perp position". */
  blockType(kind: BlockKind): string;
  /** "Base and Robinhood Chain", in the locale's own conjunction. */
  listNames(names: readonly string[]): string;
  card: {
    poolTitle(token0: string, token1: string): string;
    poolCaption(protocol: string, fee: string): string;
    supplyTitle(symbol: string): string;
    borrowTitle(symbol: string): string;
    aaveCaption: string;
    aaveCaptionOnNetwork(network: string): string;
    emptySupply: string;
    emptyBorrow: string;
    pickPool: string;
    pickAsset: string;
    invalid: string;
    accessibleName(values: {
      title: string;
      caption: string;
      network: string;
      pct: string;
    }): string;
  };
  flow: { swapAuto: string; swap: string; collectFees: string };
  tooltip: {
    swapAuto(token: string): string;
    swapAutoSupply(token: string, asset: string): string;
    swap: string;
    collectFees: string;
  };
  menu: {
    protocolsTitle(network: string): string;
    protocolsFooter(network: string): string;
    protocolsNone(network: string): string;
    borrowDisabled: string;
    comingSoonType(type: string): string;
    linkProtocols: string;
    linkNetworks: string;
    networksTitle: string;
    networksOption: string;
    /** "{names} is / are already on the canvas.": `count` picks the number (review F2). */
    networksPlaced(names: string, count: number): string;
    networksNone: string;
    portBefore(title: string): string;
    portAfter(title: string): string;
    portBorrowOption: string;
    portFlowOption: string;
    portFooterAfterSupply: string;
    portFooter: string;
  };
  palette: {
    fromMandate: string;
    flowBlocks: string;
    comingSoon: string;
    caption: string;
    soon: string;
    soonTooltip: string;
  };
  panel: {
    nothingTitle: string;
    nothingBody: string;
    remove: string;
    typeNoPool(type: string): string;
    typeNoAsset(type: string): string;
    menuOpen(network: string): string;
    /** While the Add network menu is open (review F3, coordinator copy). */
    menuOpenNetwork: string;
    portMenuOpenSupply(title: string): string;
    portMenuOpenBefore(title: string): string;
    portMenuOpenAfter(title: string): string;
  };
  // No spoke "Remove {network}" label: the renderer (S6) builds its own from
  // `network.remove` (review F5 of PR #36 removed the unused copy here).
  toast: { removed: string; undo: string };
}

/** Build the copy from a `manager` translator and the active locale. Pure: no React. */
export function makeBlockCopy(t: ManagerTranslate, locale: string): BlockCopy {
  const networkNames: Record<string, string> = {
    arbitrum: t("fundBuilder.networkNames.arbitrum"),
    robinhood: t("fundBuilder.networkNames.robinhood"),
    base: t("fundBuilder.networkNames.base"),
    polygon: t("fundBuilder.networkNames.polygon"),
    unichain: t("fundBuilder.networkNames.unichain"),
  };
  const protocolNames: Record<BlockKind, string> = {
    uniswapV4Pool: t("fundBuilder.canvas.blocks.uniswapV4Pool.protocol"),
    uniswapV3Pool: t("fundBuilder.canvas.blocks.uniswapV3Pool.protocol"),
    aaveSupply: t("fundBuilder.canvas.blocks.aaveSupply.protocol"),
    aaveBorrow: t("fundBuilder.canvas.blocks.aaveBorrow.protocol"),
    pendle: t("fundBuilder.canvas.blocks.pendle.protocol"),
    gmxPerp: t("fundBuilder.canvas.blocks.gmxPerp.protocol"),
  };
  const blockTypes: Record<BlockKind, string> = {
    uniswapV4Pool: t("fundBuilder.canvas.blocks.uniswapV4Pool.type"),
    uniswapV3Pool: t("fundBuilder.canvas.blocks.uniswapV3Pool.type"),
    aaveSupply: t("fundBuilder.canvas.blocks.aaveSupply.type"),
    aaveBorrow: t("fundBuilder.canvas.blocks.aaveBorrow.type"),
    pendle: t("fundBuilder.canvas.blocks.pendle.type"),
    gmxPerp: t("fundBuilder.canvas.blocks.gmxPerp.type"),
  };
  let listFormat: Intl.ListFormat | null = null;
  try {
    listFormat = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  } catch {
    listFormat = null;
  }

  return {
    networkName: (network) => networkNames[network] ?? network,
    protocolName: (kind) => protocolNames[kind],
    blockType: (kind) => blockTypes[kind],
    listNames: (names) => (listFormat ? listFormat.format(names) : names.join(", ")),
    card: {
      poolTitle: (token0, token1) => t("fundBuilder.canvas.card.poolTitle", { token0, token1 }),
      poolCaption: (protocol, fee) => t("fundBuilder.canvas.card.poolCaption", { protocol, fee }),
      supplyTitle: (symbol) => t("fundBuilder.canvas.card.supplyTitle", { symbol }),
      borrowTitle: (symbol) => t("fundBuilder.canvas.card.borrowTitle", { symbol }),
      aaveCaption: t("fundBuilder.canvas.card.aaveCaption"),
      aaveCaptionOnNetwork: (network) =>
        t("fundBuilder.canvas.card.aaveCaptionOnNetwork", { network }),
      emptySupply: t("fundBuilder.canvas.card.emptySupply"),
      emptyBorrow: t("fundBuilder.canvas.card.emptyBorrow"),
      pickPool: t("fundBuilder.canvas.card.pickPool"),
      pickAsset: t("fundBuilder.canvas.card.pickAsset"),
      invalid: t("fundBuilder.canvas.card.invalid"),
      accessibleName: (values) => t("fundBuilder.canvas.card.accessibleName", values),
    },
    flow: {
      swapAuto: t("fundBuilder.canvas.flow.swapAuto"),
      swap: t("fundBuilder.canvas.flow.swap"),
      collectFees: t("fundBuilder.canvas.flow.collectFees"),
    },
    tooltip: {
      swapAuto: (token) => t("fundBuilder.canvas.tooltip.swapAuto", { token }),
      swapAutoSupply: (token, asset) =>
        t("fundBuilder.canvas.tooltip.swapAutoSupply", { token, asset }),
      swap: t("fundBuilder.canvas.tooltip.swap"),
      collectFees: t("fundBuilder.canvas.tooltip.collectFees"),
    },
    menu: {
      protocolsTitle: (network) => t("fundBuilder.canvas.menu.protocols.title", { network }),
      protocolsFooter: (network) => t("fundBuilder.canvas.menu.protocols.footer", { network }),
      protocolsNone: (network) => t("fundBuilder.canvas.menu.protocols.none", { network }),
      borrowDisabled: t("fundBuilder.canvas.menu.protocols.borrowDisabled"),
      comingSoonType: (type) => t("fundBuilder.canvas.menu.comingSoonType", { type }),
      linkProtocols: t("fundBuilder.canvas.menu.link.protocols"),
      linkNetworks: t("fundBuilder.canvas.menu.link.networks"),
      networksTitle: t("fundBuilder.canvas.menu.networks.title"),
      networksOption: t("fundBuilder.canvas.menu.networks.option"),
      networksPlaced: (names, count) =>
        t("fundBuilder.canvas.menu.networks.placed", { names, count }),
      networksNone: t("fundBuilder.canvas.menu.networks.none"),
      portBefore: (title) => t("fundBuilder.canvas.menu.port.before", { title }),
      portAfter: (title) => t("fundBuilder.canvas.menu.port.after", { title }),
      portBorrowOption: t("fundBuilder.canvas.menu.port.borrowOption"),
      portFlowOption: t("fundBuilder.canvas.menu.port.flowOption"),
      portFooterAfterSupply: t("fundBuilder.canvas.menu.port.footerAfterSupply"),
      portFooter: t("fundBuilder.canvas.menu.port.footer"),
    },
    palette: {
      fromMandate: t("fundBuilder.canvas.palette.fromMandate"),
      flowBlocks: t("fundBuilder.canvas.palette.flowBlocks"),
      comingSoon: t("fundBuilder.canvas.palette.comingSoon"),
      caption: t("fundBuilder.canvas.palette.caption"),
      soon: t("fundBuilder.canvas.palette.soon"),
      soonTooltip: t("fundBuilder.canvas.palette.soonTooltip"),
    },
    panel: {
      nothingTitle: t("fundBuilder.canvas.panel.nothingTitle"),
      nothingBody: t("fundBuilder.canvas.panel.nothingBody"),
      remove: t("fundBuilder.canvas.panel.remove"),
      typeNoPool: (type) => t("fundBuilder.canvas.panel.typeNoPool", { type }),
      typeNoAsset: (type) => t("fundBuilder.canvas.panel.typeNoAsset", { type }),
      menuOpen: (network) => t("fundBuilder.canvas.panel.menuOpen", { network }),
      menuOpenNetwork: t("fundBuilder.canvas.panel.menuOpenNetwork"),
      portMenuOpenSupply: (title) => t("fundBuilder.canvas.panel.portMenuOpenSupply", { title }),
      portMenuOpenBefore: (title) => t("fundBuilder.canvas.panel.portMenuOpenBefore", { title }),
      portMenuOpenAfter: (title) => t("fundBuilder.canvas.panel.portMenuOpenAfter", { title }),
    },
    toast: {
      removed: t("fundBuilder.canvas.toast.removed"),
      undo: t("fundBuilder.canvas.toast.undo"),
    },
  };
}

/** The copy in the active locale, built once per locale. */
export function useBlockCopy(): BlockCopy {
  const t = useTranslations("manager");
  const locale = useLocale();
  return useMemo(() => makeBlockCopy(t as ManagerTranslate, locale), [t, locale]);
}
