/**
 * @id PP-MGR-LIB-090
 * @name manageSpineCopy
 * @implements-rules-version v1 (POO-2335)
 * @analytics-events none, pure copy decisions consumed by ManageScreen, ManageCanvas and ManageBlockPanel.
 *
 * The spine card title and subtitle, the range tone, the strategy links and the action timing.
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
}
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

const SEPARATOR = " · ";

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

/** A chain share is the sum of its position shares and its idle share, when every read is available. */
function chainShare(model: ManageModel, chainId: number): ManageRead<string> {
  const chain = model.chains.find((item) => item.chainId === chainId);
  if (!chain) return unavailable("missing_chain");
  const reads = [...chain.positions.map((position) => position.allocationPct), chain.idleSharePct];
  let total = 0;
  for (const read of reads) {
    if (read.status !== "available") return unavailable("missing_chain_share");
    total += Number(read.value);
  }
  return { status: "available", value: String(total), source: "manageModel.chainShare" };
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
    // R2
    case "swap":
    case "collectFees":
    case "feeSwap":
      return copy.t("manageV2.spine.routeScope", {
        pct: position ? percentOf(position.allocationPct, copy) : na,
      });
    case "bridge":
      return copy.t("manageV2.spine.routeScope", {
        pct: percentOf(chainShare(model, node.chainId), copy),
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
        ].join(SEPARATOR);
      }
      // R8
      if (position.kind === "liquidity")
        return [value, share, copy.t(manageRangeTone(position.rangeStatus).labelKey)].join(
          SEPARATOR,
        );
      // R3: a position with no supported adapter still shows its share of strategy value.
      return copy.t("manageV2.spine.strategyShare", { pct: share });
    }
    case "cash": {
      const chain = model.chains.find((item) => item.chainId === node.chainId);
      const token = chain?.cash[0];
      if (!token) return na;
      const amount = token.amount;
      if (amount.status !== "available") return na;
      const parts = [`${copy.amount(amount.value.decimal)} ${token.symbol}`];
      if (token.valueUsd?.status === "available") parts.push(usdOf(token.valueUsd, copy));
      return parts.join(SEPARATOR);
    }
    case "idleOutput": {
      const { requested, coveragePct } = model.withdrawal;
      if (requested.status !== "available" || coveragePct.status !== "available") return na;
      return [
        copy.t("manageV2.spine.requested", { amount: copy.amount(requested.value.decimal) }),
        copy.t("manageV2.spine.reserved", { pct: percentOf(coveragePct, copy) }),
      ].join(SEPARATOR);
    }
    case "income": {
      const amount = model.income.amount;
      return amount.status === "available"
        ? `${copy.amount(amount.value.decimal)} ${model.income.symbol}`
        : na;
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
 * R5 and R6: the Explorer link and the View mandate action.
 * PP-INTEGRATION-POINT: the deployed strategy address comes from the fund read. A draft or an invalid address has no link.
 */
export function manageStrategyLinks(
  core: string,
  chainId: number,
): { explorer: ManageExplorerLink; mandate: true } {
  const href = core ? explorerAddressUrl(chainId, core) : null;
  return {
    explorer: href
      ? { status: "available", href, label: truncateAddress(core) }
      : { status: "unavailable" },
    mandate: true,
  };
}

/** R7: each liquidity action has one fixed timing. No action shows a "When to apply" selector. */
export function manageActionTiming(action: "move" | "future"): {
  applies: "now" | "newDeposits";
  timingKey: "applyNow" | "newDeposits";
  submitKey: "reviewMove" | "saveFuture";
  selector: false;
} {
  return action === "move"
    ? { applies: "now", timingKey: "applyNow", submitKey: "reviewMove", selector: false }
    : {
        applies: "newDeposits",
        timingKey: "newDeposits",
        submitKey: "saveFuture",
        selector: false,
      };
}
