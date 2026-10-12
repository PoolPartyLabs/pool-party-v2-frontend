/**
 * @id PP-MGR-LIB-081
 * @name mandateStepView
 * @implements-rules-version v1 (POO-2333 rules v1)
 * @analytics-events none, a pure view model; the builder shell emits the mandate events.
 *
 * The decisions behind the Figma layout of the Networks, Protocols and Pools steps, kept out of
 * the components so that they are testable without a render:
 * - R2: a network that the config does not enable is not shown. The config is the catalog's
 *   `available` flag. The API catalog does not list Solana. The V2 catalog adds it (POO-2342).
 * - R3: the protocols that the catalog marks `required` (the swap and the bridge) form the "Swap
 *   and bridge" group below the divider. Everything else is "Protocols to operate". The group
 *   starts collapsed, and its open copy speaks about the bridge only when the mandate has a spoke.
 * - R4: a click that would clear the last swap, or the bridge of a mandate with a spoke, is
 *   refused with the reason `required_protocol`, and the refusal names the locked row.
 * - R5: the "Available on" column shows the networks of the mandate that the protocol runs on.
 * - R6: Uniswap v3 has two rows, "Uniswap v3 · Swap" and "Uniswap v3 · Liquidity".
 * - R7: a protocol that the config does not enable is not shown at all, in either group.
 * - R9: the parts of a pool row: protocol, network, then fee tier.
 * - POO-2342: the "Not available" market note of the Tokens step belongs to the Solana token list only.
 */
import type { MandateCatalog, MandateNetwork, MandateProtocol } from "../mandateCatalog";
import {
  HUB_NETWORK,
  lockedProtocols,
  type MandateDraft,
  type MandatePoolRef,
  type NetworkId,
  type ProtocolId,
  type StepBlock,
} from "../mandateDraft";

/** A translator of the `manager` namespace, as `useTranslations("manager")` gives it. */
export type ManagerTranslate = (key: string, values?: Record<string, string | number>) => string;

/** R2: the spokes that the config enables, in catalog order. */
export function visibleSpokes(catalog: MandateCatalog): MandateNetwork[] {
  return catalog.networks.filter((network) => !network.isHub && network.available);
}

/**
 * POO-2342: whether the Tokens step shows the Solana market note. The note speaks about Solana
 * tokens, so it shows only when the list on screen holds one. An Arbitrum or Robinhood token list
 * (the filter, or a draft with no Solana token in view) has no note.
 */
export function showsSolanaMarketNote(
  groups: ReadonlyArray<{ networks: readonly NetworkId[] }>,
  filter: NetworkId | "all",
): boolean {
  if (filter !== "all" && filter !== "solana") return false;
  return groups.some((group) => group.networks.includes("solana"));
}

/** The two protocol groups of the Protocols step. */
export interface ProtocolSections {
  /** "Protocols to operate", above the divider. */
  operate: MandateProtocol[];
  /** "Swap and bridge", below the divider, preselected and collapsed by default. */
  swapAndBridge: MandateProtocol[];
}

/**
 * R3/R7: split the enabled protocols into the two groups.
 *
 * A real draft holds Across only with Robinhood Chain (`withNetworks`), so on the hub alone the
 * bridge row is not drawn: a row that the reducer refuses would be a control that does nothing.
 */
export function protocolSections(catalog: MandateCatalog, draft: MandateDraft): ProtocolSections {
  const enabled = catalog.protocols.filter((protocol) => protocol.available);
  return {
    operate: enabled.filter((protocol) => !protocol.required),
    swapAndBridge: enabled.filter(
      (protocol) =>
        protocol.required &&
        !(
          catalog.dataMode === "real" &&
          protocol.id === "across" &&
          !draft.networks.includes("robinhood")
        ),
    ),
  };
}

/** R3: the Swap and bridge protocols in the draft, which the collapsed head names. */
export function selectedForYou(rows: MandateProtocol[], draft: MandateDraft): ProtocolId[] {
  return rows.filter((protocol) => draft.protocols.includes(protocol.id)).map((p) => p.id);
}

/** R3: Swap and bridge is collapsed until the manager asks for its rows. */
export const SWAP_BRIDGE_DEFAULT_OPEN = false;

/** R3: what the Swap and bridge head says, and what its toggle offers. */
export interface SwapBridgeHead {
  /** `collapsed` names the selected protocols. `open` and `openHub` state the minimums. */
  copy: "collapsed" | "open" | "openHub";
  toggle: "show" | "hide";
}

/** R3: the head of the Swap and bridge group. A hub-only mandate needs no bridge, so says none. */
export function swapBridgeHead(open: boolean, draft: MandateDraft): SwapBridgeHead {
  if (!open) return { copy: "collapsed", toggle: "show" };
  const spoke = draft.networks.some((network) => network !== HUB_NETWORK);
  return { copy: spoke ? "open" : "openHub", toggle: "hide" };
}

/** R4: a click on a protocol row either toggles it, or is refused because the row is locked. */
export function protocolClick(draft: MandateDraft, id: ProtocolId): "toggle" | "locked" {
  return draft.protocols.includes(id) && lockedProtocols(draft).has(id) ? "locked" : "toggle";
}

/** R4: the refusal of a click on a locked row, or null when the click can toggle the row. */
export function refusedProtocolClick(draft: MandateDraft, id: ProtocolId): StepBlock | null {
  if (protocolClick(draft, id) !== "locked") return null;
  return { step: "protocols", reason: "required_protocol", rowId: id };
}

/**
 * R5: the networks of the "Available on" column, in the order of the mandate. These are the
 * networks of the mandate that the protocol runs on. An empty list means that the row has no column.
 */
export function availableOnColumn(
  protocol: Pick<MandateProtocol, "availableOn">,
  draft: MandateDraft,
): NetworkId[] {
  return draft.networks.filter((network) => protocol.availableOn.includes(network));
}

/**
 * R6: the name of each protocol row. Uniswap v3 has two rows, so each name says what the row does.
 *
 * The keys are literal: `MandateProtocol.name` holds a translation key, and `t(p.name)` would be a
 * dynamic key that the i18n usage scan cannot see.
 */
export function protocolRowNames(t: ManagerTranslate): Record<ProtocolId, string> {
  return {
    "uniswap-v3-swap": t("fundBuilder.protocols.rowNames.uniswapV3Swap"),
    across: t("fundBuilder.protocolNames.across"),
    "aave-v3": t("fundBuilder.protocolNames.aaveV3"),
    "uniswap-v3": t("fundBuilder.protocols.rowNames.uniswapV3Liquidity"),
    "uniswap-v4": t("fundBuilder.protocolNames.uniswapV4"),
    gmx: t("fundBuilder.protocolNames.gmx"),
    pendle: t("fundBuilder.protocolNames.pendle"),
    kamino: t("solanaPreview.protocols.kamino"),
    jupiter: t("solanaPreview.protocols.jupiter"),
    raydium: t("solanaPreview.protocols.raydium"),
    orca: t("solanaPreview.protocols.orca"),
  };
}

/**
 * R3: the text of the Swap and bridge head. The collapsed text names each selected protocol once,
 * without the role of its row (Figma 8010:1638 reads "Uniswap v3 · Across · selected for you").
 */
export function swapBridgeHeadText(
  t: ManagerTranslate,
  head: SwapBridgeHead,
  selected: ProtocolId[],
): string {
  if (head.copy === "open") return t("fundBuilder.protocols.swapBridgeOpen");
  if (head.copy === "openHub") return t("fundBuilder.protocols.swapBridgeOpenHub");
  const rows = protocolRowNames(t);
  const heads: Partial<Record<ProtocolId, string>> = {
    "uniswap-v3-swap": t("fundBuilder.protocolNames.uniswapV3Swap"),
  };
  const names = selected.map((id) => heads[id] ?? rows[id]).join(" · ");
  return t("fundBuilder.protocols.swapBridgeCollapsed", { names });
}

/** R9: one part of the line under the pair of a pool row. */
export type PoolMetaPart =
  | { part: "protocol"; protocol: MandatePoolRef["protocol"] }
  | { part: "network"; network: NetworkId }
  | { part: "feeTier"; fee: string };

/** R8: a fee in basis points as the pool rows print it. `30` gives `0.30%`. A null fee has no label. */
export function poolFeeLabel(bps: number | null): string | null {
  return bps === null ? null : `${(bps / 100).toFixed(2)}%`;
}

/** R9: the parts of a pool row in reading order. The network icon comes before the fee tier. */
export function poolMeta(
  pool: Pick<MandatePoolRef, "protocol" | "network" | "feeBps">,
): PoolMetaPart[] {
  const fee = poolFeeLabel(pool.feeBps);
  return [
    { part: "protocol", protocol: pool.protocol },
    { part: "network", network: pool.network },
    ...(fee === null ? [] : [{ part: "feeTier", fee } as const]),
  ];
}
