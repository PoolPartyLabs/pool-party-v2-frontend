/**
 * @id PP-MGR-CMP-061
 * @name panelCopy
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, translated strings only; the Build screen (PP-MGR-SCR-002) owns every
 *   event
 *
 * Every string the configuration panel shell and its shared controls print (POO-2187), read once
 * from `manager.fundBuilder.canvas.panel` in all 11 locales. Rides on PP-MGR-CMP-061 (BlockPanel)
 * and has no id of its own. The keys the canvas batch already landed are reused (finding 22):
 * `overline` stays the frame's (BuildPanelSlot), `nothingTitle`, `nothingBody`, `remove`, the menu
 * sentences and the head's " · no pool yet" come through `blockCopy`.
 *
 * Every key is a LITERAL `t()` call, so the i18n usage scan binds each one and a renamed key fails
 * `pnpm i18n:check` instead of printing its own path. The block bodies of the next slices (the
 * Uniswap pool and the Aave Supply panels) bring their own field copy.
 */
"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { ManagerTranslate } from "../blocks/blockCopy";

/** The Mandate steps an "Edit mandate" link of the panel can open. */
export type PanelLinkStep = "tokens" | "pools" | "limits";

/** The strings of the panel shell and its shared controls. */
export interface PanelCopy {
  /** "This block is on {network}. ..." (P2, C5). */
  networkTooltip(network: string): string;
  /** The (i) button's name: "More about {label}". */
  moreAbout(label: string): string;
  use: string;
  /** The Use button's name for one row: "Use WETH / USDC". */
  pickRowLabel(title: string): string;
  apply: string;
  status: { pending: string; applied: string; discard: string };
  leave: { title: string; body: string; discard: string };
  confirm: {
    title(title: string): string;
    titleEmpty: string;
    share(pct: string): string;
    /** "{steps} is / are removed with it.": `count` picks the number. */
    removedWith(steps: string, count: number): string;
    swapAuto: string;
    swap: string;
    collectFees: string;
    block(title: string): string;
    cancel: string;
  };
  allocation: {
    label: string;
    help: string;
    helpCap(protocol: string, pct: string): string;
    capProtocol(protocol: string, pct: string): string;
    capNetwork(network: string, pct: string): string;
    room(pct: string): string;
    needMore: string;
  };
  slippage: {
    label: string;
    help: string;
    custom: string;
    customLabel: string;
    max(pct: string): string;
  };
  link: Record<PanelLinkStep, string>;
  /** The live-read treatment of the Mandate stack (P13): "Loading", "unavailable", "Retry". */
  read: { loading: string; error: string; retry: string };
}

/** Build the panel copy from a `manager` translator. Pure: no React. */
export function makePanelCopy(t: ManagerTranslate): PanelCopy {
  return {
    networkTooltip: (network) => t("fundBuilder.canvas.panel.networkTooltip", { network }),
    moreAbout: (label) => t("fundBuilder.canvas.panel.moreAbout", { label }),
    use: t("fundBuilder.canvas.panel.use"),
    pickRowLabel: (title) => t("fundBuilder.canvas.panel.useItem", { title }),
    apply: t("fundBuilder.canvas.panel.apply"),
    status: {
      pending: t("fundBuilder.canvas.panel.status.pending"),
      applied: t("fundBuilder.canvas.panel.status.applied"),
      discard: t("fundBuilder.canvas.panel.status.discard"),
    },
    leave: {
      title: t("fundBuilder.canvas.panel.leave.title"),
      body: t("fundBuilder.canvas.panel.leave.body"),
      discard: t("fundBuilder.canvas.panel.leave.discard"),
    },
    confirm: {
      title: (title) => t("fundBuilder.canvas.panel.confirm.title", { title }),
      titleEmpty: t("fundBuilder.canvas.panel.confirm.titleEmpty"),
      share: (pct) => t("fundBuilder.canvas.panel.confirm.share", { pct }),
      removedWith: (steps, count) =>
        t("fundBuilder.canvas.panel.confirm.removedWith", { steps, count }),
      swapAuto: t("fundBuilder.canvas.panel.confirm.swapAuto"),
      swap: t("fundBuilder.canvas.panel.confirm.swap"),
      collectFees: t("fundBuilder.canvas.panel.confirm.collectFees"),
      block: (title) => t("fundBuilder.canvas.panel.confirm.block", { title }),
      cancel: t("fundBuilder.canvas.panel.confirm.cancel"),
    },
    allocation: {
      label: t("fundBuilder.canvas.panel.allocation.label"),
      help: t("fundBuilder.canvas.panel.allocation.help"),
      helpCap: (protocol, pct) =>
        t("fundBuilder.canvas.panel.allocation.helpCap", { protocol, pct }),
      capProtocol: (protocol, pct) =>
        t("fundBuilder.canvas.panel.allocation.capProtocol", { protocol, pct }),
      capNetwork: (network, pct) =>
        t("fundBuilder.canvas.panel.allocation.capNetwork", { network, pct }),
      room: (pct) => t("fundBuilder.canvas.panel.allocation.room", { pct }),
      needMore: t("fundBuilder.canvas.panel.allocation.needMore"),
    },
    slippage: {
      label: t("fundBuilder.canvas.panel.slippage.label"),
      help: t("fundBuilder.canvas.panel.slippage.help"),
      custom: t("fundBuilder.canvas.panel.slippage.custom"),
      customLabel: t("fundBuilder.canvas.panel.slippage.customLabel"),
      max: (pct) => t("fundBuilder.canvas.panel.slippage.max", { pct }),
    },
    link: {
      tokens: t("fundBuilder.canvas.panel.link.tokens"),
      pools: t("fundBuilder.canvas.panel.link.pools"),
      limits: t("fundBuilder.canvas.panel.link.limits"),
    },
    read: {
      loading: t("fundBuilder.real.loading"),
      error: t("fundBuilder.real.error"),
      retry: t("fundBuilder.real.retry"),
    },
  };
}

/** The panel copy in the active locale, built once per locale. */
export function usePanelCopy(): PanelCopy {
  const t = useTranslations("manager");
  return useMemo(() => makePanelCopy(t as ManagerTranslate), [t]);
}
