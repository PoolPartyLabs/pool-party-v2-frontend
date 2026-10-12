/**
 * @id PP-MGR-LIB-081
 * @name mandateStepView
 * @implements-rules-version v1 (POO-2333 rules v1)
 * @analytics-events none, a pure view model; the builder shell emits the mandate events.
 *
 * The decisions behind the Figma layout of the Networks, Protocols and Pools steps, kept out of
 * the components so that they are testable without a render:
 * - R2: a network that the config does not enable is not shown. The config is the catalog's
 *   `available` flag. Solana is out of the default catalog and only the Solana preview runtime
 *   adds it.
 * - R3: the protocols that the catalog marks `required` (the swap and the bridge) form the "Swap
 *   and bridge" group below the divider. Everything else is "Protocols to operate". The group
 *   starts collapsed, and its open copy speaks about the bridge only when the mandate has a spoke.
 * - R4: a click that would clear the last swap, or the bridge of a mandate with a spoke, is
 *   refused, and the refusal names the locked row.
 * - R7: a protocol that the config does not enable is not shown at all, in either group.
 * - R9: the order of the parts of a pool row: protocol, network, then fee tier.
 */
import type { MandateCatalog, MandateNetwork, MandateProtocol } from "../mandateCatalog";
import { HUB_NETWORK, lockedProtocols, type MandateDraft, type ProtocolId } from "../mandateDraft";

/** R2: the spokes that the config enables, in catalog order. */
export function visibleSpokes(catalog: MandateCatalog): MandateNetwork[] {
  return catalog.networks.filter((network) => !network.isHub && network.available);
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

/** R4: the kind of the locked row a refused click came from, or null for any other row. */
export function lockedRowKind(
  catalog: MandateCatalog,
  draft: MandateDraft,
  rowId: string | undefined,
): "swap" | "bridge" | null {
  const protocol = catalog.protocols.find((p) => p.id === rowId);
  if (!protocol || protocolClick(draft, protocol.id) !== "locked") return null;
  return protocol.kind === "swap" || protocol.kind === "bridge" ? protocol.kind : null;
}

/** R9: the parts of a pool row, in reading order. The network icon comes before the fee tier. */
const POOL_META_ORDER = ["protocol", "network", "feeTier"] as const;

/** One part of a pool row. */
export type PoolMetaPart = (typeof POOL_META_ORDER)[number];

/** R9: the parts of a pool row in reading order, so no caller can draw the fee tier first. */
export function orderPoolMeta<T>(parts: Record<PoolMetaPart, T>): T[] {
  return POOL_META_ORDER.map((part) => parts[part]);
}
