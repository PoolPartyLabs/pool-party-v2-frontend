/**
 * @id PP-MGR-LIB-018
 * @name mandateCatalog
 * @implements-rules-version v2 (POO-2121 rules v1, POO-2142 rules v2, POO-2143 rules v2)
 * @analytics-events none, a data catalog. The builder shell (PP-MGR-SCR-002) owns every mandate
 *   event; nothing here touches the dataLayer.
 *
 * What a mandate may name: the networks, the protocols, and the tokens that follow from them. The
 * five Mandate screens read this catalog and never build a list of their own, which is the point:
 * a hardcoded `{arbitrum, base, polygon}` map in a screen is the shadow list that already shipped a
 * lowercase "robinhood" to two manager surfaces (see `networkDisplayName` in lib/chains/config.ts).
 *
 * Availability is DATA, not a branch. Only Arbitrum (hub) and Robinhood Chain exist on the fund
 * contracts today (DEC-018), and the buildathon scope (rules v2, POO-2142) offers exactly those two,
 * both available (R16 v2, R17 v2). Base, Polygon and Unichain are commented out below rather than
 * deleted, so restoring one is uncommenting it, and its `available` entry decides whether it renders
 * disabled with "Coming soon". {@link withNetworks} refuses anything this catalog has not turned on,
 * so a disabled row cannot be reached around the UI.
 *
 * The protocols follow the same rule (R20 v2, R21 v2, POO-2143): Aave v3, Uniswap v3 and Uniswap v4
 * to operate, beside the required two. GMX and its `perps` kind are commented out, not deleted; the
 * mechanism that disables a protocol (`available`, or no network in common with step 1) stays.
 *
 * PP-NOTE: buildathon scope (2026-10-03, POO-2142, POO-2143): the locale keys of the commented-out
 * networks and protocol stay in all 11 locales, because a locale JSON cannot hold a comment:
 * `fundBuilder.networkNames.{base,polygon,unichain}` (POO-2142), and `fundBuilder.protocolNames.gmx`,
 * `fundBuilder.protocolCaptions.perps` and `fundBuilder.limits.kind.perps` (POO-2143). Nothing
 * reads them until their entries are restored; `i18n:check` ignores an unused key.
 *
 * NAMES ARE KEYS. `MandateNetwork.name` and `MandateProtocol.name` hold a translation key under the
 * `manager` namespace (`fundBuilder.networkNames.arbitrum`, …), not a display string, so a screen
 * renders `t(network.name)`. `MandateCatalogToken.name` is the exception and holds the real token
 * name, because a token's name is the contract's own `name()` and is never translated.
 *
 * PP-INTEGRATION-POINT: every list here becomes a read from the fund contracts' own registries
 * (networks and adapters per hub, the token registry per adapter, the price-source registry). The
 * shape of this module is the seam: `buildMandateCatalog` keeps its signature and the source behind
 * it changes. Tracked by wiring issue POO-2134.
 */

import type { CatalogReserve } from "@/lib/api/v2/schemas";
import { networkToChainId } from "@/lib/chains/config";
import { canonicalTokenSymbol, tokensForNetwork } from "@/lib/tokens/tokenList";
import {
  depositTokenRefFor,
  isPricedSymbol,
  NETWORK_ORDER,
  type NetworkId,
  PROTOCOL_ORDER,
  type ProtocolId,
  UNAVAILABLE_PROTOCOLS,
} from "./mandateDraft";

/** One network row on the Networks step. `name` is a translation key (see the file header). */
export interface MandateNetwork {
  id: NetworkId;
  name: string;
  /** Deposits and withdrawals happen here. Exactly one network is the hub (R15). */
  isHub: boolean;
  /** Whether the fund contracts can operate here today, and so whether the row is selectable. */
  available: boolean;
  brandColor: string;
  /** Null for a network the chain config does not carry yet. */
  chainId: number | null;
}

/** What a protocol does, which picks its caption (`fundBuilder.protocolCaptions.<kind>`). */
type MandateProtocolKind =
  // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
  // "perps" |
  "swap" | "bridge" | "lending" | "dex";

/** One protocol row on the Protocols step. `name` and `captionKey` are both translation keys. */
export interface MandateProtocol {
  id: ProtocolId;
  name: string;
  kind: MandateProtocolKind;
  /** Always in the mandate, shown locked with "Always included" (R19). */
  required: boolean;
  /** The networks this protocol runs on. The step shows the intersection with step 1 as dots. */
  availableOn: NetworkId[];
  available: boolean;
  captionKey: string;
}

/** One token the catalog offers. `name` is the real token name, never a key. */
export interface MandateCatalogToken {
  address: string;
  symbol: string;
  name: string;
  network: NetworkId;
  logoUrl: string | null;
  /** Whether the hub price source can price it (R28). An unpriced token cannot be added. */
  priced: boolean;
}

/** The whole catalog. It reads no feature flag (rules v2, POO-2142). */
export interface MandateCatalog {
  validateDraft?: (draft: import("./mandateDraft").MandateDraft) => boolean;
  dataMode?: "real";
  loading?: boolean;
  error?: boolean;
  retry?: () => void;
  reserves?: CatalogReserve[];
  networks: MandateNetwork[];
  protocols: MandateProtocol[];
  /** Every token available on these networks, minus each network's deposit token, sorted by symbol. */
  tokensFor(networks: NetworkId[], protocols: ProtocolId[]): MandateCatalogToken[];
  /** The deposit token for a network, or null when the chain config has no stable for it (R18). */
  depositTokenFor(network: NetworkId): MandateCatalogToken | null;
}

/**
 * Brand colours, taken from the builder's own network catalog (`src/mocks/data/pools.ts` NETWORKS)
 * so the fund builder's dots match the V1 builder's. Both offered networks have a row there. The
 * commented-out Unichain entry below has none and would carry its brand pink once restored.
 */
const BRAND_COLORS: Record<NetworkId, string> = {
  arbitrum: "#28A0F0",
  robinhood: "#00C805",
  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // base: "#0052FF",
  // polygon: "#8247E5",
  // unichain: "#F50DB4",
};

/**
 * R16 v2 / R17 v2: which networks the fund contracts can operate on.
 *
 * Only the hub and Robinhood Chain exist on chain (DEC-018), and both are always available. The fund
 * builder no longer reads the `robinhoodChain` flag (rules v2, POO-2142); that flag keeps gating the
 * V1 surfaces only. Base, Polygon and Unichain used to be listed and disabled, which is the whole
 * reason the list is data; they are commented out for the buildathon scope.
 */
function buildNetworks(): MandateNetwork[] {
  const available: Record<NetworkId, boolean> = {
    arbitrum: true,
    robinhood: true,
    // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
    // base: false,
    // polygon: false,
    // unichain: false,
  };
  return NETWORK_ORDER.map((id) => ({
    id,
    name: `fundBuilder.networkNames.${id}`,
    isHub: id === "arbitrum",
    available: available[id],
    brandColor: BRAND_COLORS[id],
    chainId: networkToChainId(id) ?? null,
  }));
}

/** The translation-key suffix per protocol id (COMMON section 4 fixes these camelCase names). */
const PROTOCOL_NAME_KEYS: Record<ProtocolId, string> = {
  "uniswap-v3-swap": "uniswapV3Swap",
  across: "across",
  "aave-v3": "aaveV3",
  "uniswap-v3": "uniswapV3",
  "uniswap-v4": "uniswapV4",
  // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
  // gmx: "gmx",
};

const ALL_NETWORKS: readonly NetworkId[] = NETWORK_ORDER;

/**
 * R20 v2 / R21 v2: the protocols, and where each one runs.
 *
 * On chain today: Uniswap v4 positions and Aave v3 supply (hub only), with Uniswap v3 present as
 * the swap adapter. The buildathon scope operates Aave v3 (Arbitrum only), Uniswap v3 and Uniswap v4
 * (Arbitrum, Robinhood Chain); GMX is commented out (POO-2143). Each is scoped so the Protocols step
 * can show honest network dots. Copy never says "via Across" outside that row (R22), and nothing
 * here promises a per-protocol guarantee the contracts do not make.
 */
function buildProtocols(): MandateProtocol[] {
  const unavailable = new Set<string>(UNAVAILABLE_PROTOCOLS);
  const spec: Record<ProtocolId, { kind: MandateProtocol["kind"]; availableOn: NetworkId[] }> = {
    "uniswap-v3-swap": { kind: "swap", availableOn: [...ALL_NETWORKS] },
    across: { kind: "bridge", availableOn: [...ALL_NETWORKS] },
    "aave-v3": { kind: "lending", availableOn: ["arbitrum"] },
    "uniswap-v3": {
      kind: "dex",
      availableOn: [
        "arbitrum",
        "robinhood",
        // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
        // "base",
        // "polygon",
      ],
    },
    "uniswap-v4": { kind: "dex", availableOn: ["arbitrum", "robinhood"] },
    // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
    // gmx: { kind: "perps", availableOn: [] },
  };
  return PROTOCOL_ORDER.map((id) => ({
    id,
    name: `fundBuilder.protocolNames.${PROTOCOL_NAME_KEYS[id]}`,
    kind: spec[id].kind,
    required: id === "uniswap-v3-swap" || id === "across",
    availableOn: spec[id].availableOn,
    available: !unavailable.has(id),
    captionKey: `fundBuilder.protocolCaptions.${spec[id].kind}`,
  }));
}

/** R18: the deposit token as a catalog row, derived from the one place the draft also reads. */
function depositTokenFor(network: NetworkId): MandateCatalogToken | null {
  const ref = depositTokenRefFor(network);
  if (!ref) return null;
  return {
    address: ref.address,
    symbol: ref.symbol,
    name: ref.name,
    network: ref.network,
    logoUrl: ref.logoUrl,
    priced: true,
  };
}

/**
 * R25: the tokens a mandate may hold, per network.
 *
 * Source is the bundled static list per chain (`tokensForNetwork`), with the deposit token removed
 * because it is already in the mandate as a locked row. The wrapped-ether entry keeps the app-wide
 * canonical "ETH" symbol, so a manager who sees ETH in the wallet sees ETH here.
 *
 * PP-NOTE: R25, protocol filtering waits for a token registry per adapter. The protocols are part
 * of the signature because the real source is keyed by them, and narrowing by protocol today would
 * mean inventing which tokens each adapter supports. A network with no bundled list contributes
 * nothing rather than an invented list; both offered networks have one today, and Unichain, the
 * network that had none, is commented out of the buildathon scope (POO-2142).
 */
function tokensFor(networks: NetworkId[], _protocols: ProtocolId[]): MandateCatalogToken[] {
  const out: MandateCatalogToken[] = [];
  for (const network of networks) {
    const deposit = depositTokenRefFor(network)?.address.toLowerCase();
    for (const token of tokensForNetwork(network)) {
      const address = token.address.toLowerCase();
      if (address === deposit) continue;
      const symbol = canonicalTokenSymbol(address, token.symbol);
      out.push({
        address,
        symbol,
        name: token.name,
        network,
        logoUrl: token.iconUrl ?? null,
        priced: isPricedSymbol(symbol),
      });
    }
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Build the catalog.
 *
 * Takes no flags since rules v2 (POO-2142): Robinhood Chain is always available in the fund
 * builder (R17 v2), and the `robinhoodChain` flag keeps gating the V1 surfaces only. Every call
 * returns the same lists, so a caller that needs a stable identity memoises it once.
 */
export function buildMandateCatalog(): MandateCatalog {
  return {
    networks: buildNetworks(),
    protocols: buildProtocols(),
    tokensFor,
    depositTokenFor,
  };
}
