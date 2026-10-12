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
 *   and bridge" group below the divider. Everything else is "Protocols to operate".
 * - R7: a protocol that the config does not enable is not shown at all, in either group.
 * - R9: the order of the parts of a pool row: protocol, network, then fee tier.
 */
import type { MandateCatalog, MandateNetwork, MandateProtocol } from "../mandateCatalog";
import type { MandateDraft, ProtocolId } from "../mandateDraft";

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

/** R9: the parts of a pool row, in reading order. The network icon comes before the fee tier. */
export const POOL_META_ORDER = ["protocol", "network", "feeTier"] as const;

/** One part of a pool row. */
export type PoolMetaPart = (typeof POOL_META_ORDER)[number];
