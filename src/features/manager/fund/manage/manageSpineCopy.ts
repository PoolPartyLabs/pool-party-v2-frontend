/**
 * @id PP-MGR-LIB-090
 * @name manageSpineCopy
 * @implements-rules-version v1 (POO-2335)
 * @analytics-events none, pure copy decisions consumed by ManageScreen and ManageCanvas.
 *
 * The spine card title and subtitle, the range tone and the strategy links.
 * Each value comes from the read model. A missing read shows "Not available", never a guess.
 */
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { truncateAddress } from "@/lib/strategies/mapStrategy";
import { type ManageModel, type ManageRead, unavailable } from "./manageModel";
import type { ManageInspectableNode } from "./manageSelection";

/** Formatters from the screen. `t` reads keys from the root "manager" namespace. */
export interface ManageSpineCopy {
  t(key: string, values?: Record<string, string>): string;
  percent(value: number): string;
  usd(value: number): string;
  amount(decimal: string): string;
}
export interface ManageSpineReads {
  // PP-INTEGRATION-POINT: the Aave health factor read is not served yet. Until then the card shows "HF Not available".
  healthFactor?: ManageRead<string>;
  // PP-INTEGRATION-POINT: the income and operating cash shares of strategy value are not served yet. Until then the cards show "Not available".
  incomeSharePct?: ManageRead<string>;
  cashSharePct?: Partial<Record<number, ManageRead<string>>>;
}

/** The percent format of the spine cards. Figma shows "42.875%", "0.245%" and "0.0075%". */
export const MANAGE_PERCENT_FORMAT = {
  style: "percent",
  maximumFractionDigits: 4,
} as const satisfies Intl.NumberFormatOptions;
export type ManageRangeTone = "success" | "destructive" | "muted";
export interface ManageSpineCard {
  title: string;
  subtitle: string;
  range: { labelKey: string; tone: ManageRangeTone } | null;
}

/** Keys that POO-2335 adds. The locale test checks each key in every locale. */
export const MANAGE_SPINE_KEYS = [
  "manageV2.spine.routeEntry",
  "manageV2.spine.routeExit",
  "manageV2.spine.routeScope",
  "manageV2.spine.strategyShare",
  "manageV2.spine.healthFactor",
  "manageV2.spine.requested",
  "manageV2.spine.reserved",
  "manageV2.spine.bridgeEntry",
  "manageV2.spine.bridgeReturn",
  "manageV2.spine.swapInput",
  "manageV2.spine.swapFees",
  "manageV2.explorer",
  "manageV2.strategyAddressUnavailable",
] as const;

/** R8: an unknown range status never uses the success tone. */
export function manageRangeTone(status: ManageRead<"in" | "out">): {
  labelKey: string;
  tone: ManageRangeTone;
} {
  if (status.status !== "available") return { labelKey: "manageV2.notAvailable", tone: "muted" };
  return status.value === "in"
    ? { labelKey: "operate.inRange", tone: "success" }
    : { labelKey: "operate.outOfRange", tone: "destructive" };
}

function percentOf(read: ManageRead<string>, copy: ManageSpineCopy): string {
  return read.status === "available"
    ? copy.percent(Number(read.value))
    : copy.t("manageV2.notAvailable");
}
function usdOf(read: ManageRead<string>, copy: ManageSpineCopy): string {
  return read.status === "available"
    ? copy.usd(Number(read.value))
    : copy.t("manageV2.notAvailable");
}

const missing = unavailable<string>("missing_share");
/** The idle share of strategy value on one chain. */
function idleShare(model: ManageModel, chainId: number): ManageRead<string> {
  return model.chains.find((item) => item.chainId === chainId)?.idleSharePct ?? missing;
}

function titleOf(node: ManageInspectableNode, model: ManageModel, copy: ManageSpineCopy): string {
  const position = node.position;
  switch (node.kind) {
    case "position":
      if (!position) return copy.t("manageV2.notAvailable");
      if (position.kind === "supply")
        return copy.t("manageV2.supplyToken", { token: position.tokens[0]?.symbol ?? "" });
      if (position.kind === "liquidity")
        return position.tokens.map((token) => token.symbol).join(" / ");
      return position.protocol;
    case "idleInput":
      return copy.t(node.chainId === model.hubChainId ? "manageV2.idleInput" : "manageV2.idle");
    case "cash":
      return copy.t("manageV2.operatingCash");
    case "idleOutput":
      return copy.t("manageV2.idleOutput");
    case "income":
      return copy.t("manageV2.income");
    case "deposit":
      return copy.t("manageV2.inspection.deposit");
    case "withdraw":
      return copy.t("manageV2.inspection.withdraw");
    case "swap":
      return copy.t("manageV2.spine.swapInput");
    case "collectFees":
      return copy.t("manageV2.inspection.collectFees");
    case "feeSwap":
      return copy.t("manageV2.spine.swapFees");
    case "bridge":
      return copy.t(
        node.direction === "outbound"
          ? "manageV2.spine.bridgeReturn"
          : "manageV2.spine.bridgeEntry",
      );
  }
}

function subtitleOf(
  node: ManageInspectableNode,
  model: ManageModel,
  copy: ManageSpineCopy,
  reads: ManageSpineReads,
): string {
  const na = copy.t("manageV2.notAvailable");
  const position = node.position;
  switch (node.kind) {
    // R1
    case "deposit":
      return copy.t("manageV2.spine.routeEntry");
    case "withdraw":
      return copy.t("manageV2.spine.routeExit");
    // R2: each route card takes its scope from the field that Figma describes.
    case "swap":
      // Swap input: the spoke idle share.
      return copy.t("manageV2.spine.routeScope", {
        pct: percentOf(idleShare(model, node.chainId), copy),
      });
    case "collectFees":
      // Collect fees: the share of the linked position.
      return copy.t("manageV2.spine.routeScope", {
        pct: position ? percentOf(position.allocationPct, copy) : na,
      });
    case "feeSwap":
      // Swap fees: the income share of strategy value.
      return copy.t("manageV2.spine.routeScope", {
        pct: percentOf(reads.incomeSharePct ?? missing, copy),
      });
    case "bridge":
      // Bridge entry: the spoke idle share.
      // PP-INTEGRATION-POINT: no read gives the Bridge return scope yet. Until then the card shows "Not available".
      return copy.t("manageV2.spine.routeScope", {
        pct: node.direction === "outbound" ? na : percentOf(idleShare(model, node.chainId), copy),
      });
    // R3
    case "idleInput": {
      const chain = model.chains.find((item) => item.chainId === node.chainId);
      return copy.t("manageV2.spine.strategyShare", {
        pct: chain ? percentOf(chain.idleSharePct, copy) : na,
      });
    }
    case "position": {
      if (!position) return na;
      const value = usdOf(position.valueUsd, copy);
      const share = percentOf(position.allocationPct, copy);
      // R4
      if (position.kind === "supply") {
        const hf = reads.healthFactor ?? unavailable<string>("missing_health_factor");
        return [
          value,
          share,
          copy.t("manageV2.spine.healthFactor", {
            value: hf.status === "available" ? hf.value : na,
          }),
        ].join(" · ");
      }
      // R8
      if (position.kind === "liquidity")
        return [value, share, copy.t(manageRangeTone(position.rangeStatus).labelKey)].join(" · ");
      // R3: a position with no supported adapter still shows its share of strategy value.
      return copy.t("manageV2.spine.strategyShare", { pct: share });
    }
    case "cash": {
      const chain = model.chains.find((item) => item.chainId === node.chainId);
      const token = chain?.cash[0];
      if (!token) return na;
      const amount = token.amount;
      if (amount.status !== "available") return na;
      return [
        `${copy.amount(amount.value.decimal)} ${token.symbol}`,
        usdOf(token.valueUsd ?? missing, copy),
        percentOf(reads.cashSharePct?.[node.chainId] ?? missing, copy),
      ].join(" · ");
    }
    case "idleOutput": {
      const { requested, coveragePct } = model.withdrawal;
      if (requested.status !== "available" || coveragePct.status !== "available") return na;
      return [
        copy.t("manageV2.spine.requested", {
          amount: `${copy.amount(requested.value.decimal)} ${requested.value.symbol}`,
        }),
        copy.t("manageV2.spine.reserved", { pct: percentOf(coveragePct, copy) }),
      ].join(" · ");
    }
    case "income": {
      const amount = model.income.amount;
      if (amount.status !== "available") return na;
      return [
        `${copy.amount(amount.value.decimal)} ${amount.value.symbol || model.income.symbol}`,
        percentOf(reads.incomeSharePct ?? missing, copy),
      ].join(" · ");
    }
  }
}

/** R1 to R4 and R8: the title and subtitle of one spine card. */
export function manageSpineCard(
  node: ManageInspectableNode,
  model: ManageModel,
  copy: ManageSpineCopy,
  reads: ManageSpineReads = {},
): ManageSpineCard {
  const range =
    node.kind === "position" && node.position?.kind === "liquidity"
      ? manageRangeTone(node.position.rangeStatus)
      : null;
  return {
    title: titleOf(node, model, copy),
    subtitle: subtitleOf(node, model, copy, reads),
    range,
  };
}

export type ManageExplorerLink =
  | { status: "available"; href: string; label: string }
  | { status: "unavailable" };

/**
 * R5: the Explorer link. View mandate (R6) always shows below it.
 * PP-INTEGRATION-POINT: the deployed strategy address comes from the fund read. A draft or an invalid address has no link.
 */
export function manageStrategyLinks(
  core: string,
  chainId: number,
): { explorer: ManageExplorerLink } {
  const href = core ? explorerAddressUrl(chainId, core) : null;
  return {
    explorer: href
      ? { status: "available", href, label: truncateAddress(core) }
      : { status: "unavailable" },
  };
}
