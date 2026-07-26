/**
 * @id PP-AQUA-LIB-010 (POO-1067)
 * @name Active Reserve manager metadata
 * @implements-rules-version v1
 *
 * The strategy metadata a MANAGER writes, hardcoded for the one live reserve.
 *
 * ## Why this is a fixture, and why that is honest
 *
 * Everything an Active Reserve is *worth* is on-chain and is read live: NAV, the Aave carry, the
 * hot buffer, the deposit cap, which strategies are active, how much USDC each band has committed,
 * how much WETH it has acquired, and the Chainlink price. None of that is in this file, and none of
 * it could be — it changes every block.
 *
 * What is NOT on-chain is the *descriptive* layer a manager fills in when they launch: which
 * mandate they chose, and therefore what the band means in words. On the Uniswap side of this
 * product that layer is entered in the Pool Party manager console and served by the pool-party-api,
 * exactly the way `logo_url`, `name` and `riskProfile` reach a normal strategy card.
 *
 * This hackathon entry is built **exclusively in the open-source repo**, with no write path to that
 * private API, so the manager-console round trip was out of scope. Rather than invent a second
 * metadata service nobody would keep, the descriptive layer for this ONE live, on-chain strategy is
 * pinned here — the same values a manager would have typed into the console. No rule is bent: the
 * money is real and verifiable on Arbiscan; only the labels are local.
 *
 * ## Provenance of these values
 *
 * The band edges are not invented. Each mandate declares its offsets in `api/compiler/mandates.ts`
 * (production -15%/-5%, demo -0.3%/-0.1%), and a taker fills at the TOP of a band, so the observed
 * fill price pins the band's high and therefore the spot it was shipped against:
 *
 *   0x0291f117…  production  fill $1,759.40 = high = spot x 0.95   -> spot $1,852.00
 *   0x24b288c7…  demo        fill $1,858.55 = high = spot x 0.999  -> spot $1,860.41
 *
 * The demo band's second fill, $1,856.70, lands inside the derived range, which is the cross-check.
 * Every fill below is a real Arbitrum transaction; the hashes are in `pool-party-aqua/docs/FILLS.md`
 * and resolve on Arbiscan.
 *
 * ## Removing this
 *
 * When the manager console learns to write Aqua metadata, delete this file and read the same fields
 * from `apiFetch`. `BandView` and `FillView` do not change shape, so nothing downstream moves.
 */
import "server-only";

/** Prices are E8 (8 decimals), matching Chainlink and the compiler's band arithmetic. */
export interface ShipMetadata {
  /** Which mandate the manager picked. Drives the band copy and the percentage rendering. */
  mandate: string;
  /** Absolute band floor, E8. */
  bandLowE8: string;
  /** Absolute band ceiling, E8. A taker can never fill above this. */
  bandHighE8: string;
  /** Chainlink spot at the moment of shipping, E8. The band is expressed relative to it. */
  spotAtShipE8: string;
  /** The vault's Nth ship. Identity only; the on-chain salt is the real epoch key. */
  epoch: number;
  /** Unix seconds. The program stops quoting after this. */
  deadline: string;
  /** The ship transaction, when one was recorded. Null renders no explorer link, never a fake one. */
  shipTxHash: string | null;
}

/**
 * Keyed by `strategyHash`, lowercased.
 *
 * A hash absent from this map is NOT an error: `readBands` still renders the band with its live
 * committed money and simply omits the edges (FE-R7). That is the same degradation the database
 * path had for an un-backfilled ship, so an unlabelled new launch behaves identically.
 */
export const SHIP_METADATA: Readonly<Record<string, ShipMetadata>> = {
  // Vault 0x081cAaD3…8e13, band 1 of 2.
  "0x0291f117930fd2ca249e82020fc92aa9fd58f1fdce53bee145006f17544546a6": {
    mandate: "production",
    bandLowE8: "157420000000", // $1,574.20  = spot x 0.85
    bandHighE8: "175940000000", // $1,759.40  = spot x 0.95, and the observed fill
    spotAtShipE8: "185200000000", // $1,852.00
    epoch: 1,
    deadline: "1785110400", // 2026-07-27T00:00:00Z
    shipTxHash: null,
  },
  // Vault 0x081cAaD3…8e13, band 2 of 2. The tight band, which is why it fills near spot.
  "0x24b288c71c8c41100e72c250eb199067c120c9441a97ba4b834da9ce7ee919d1": {
    mandate: "demo",
    bandLowE8: "185483000000", // $1,854.83  = spot x 0.997
    bandHighE8: "185855000000", // $1,858.55  = spot x 0.999, and the observed fill
    spotAtShipE8: "186041000000", // $1,860.41
    epoch: 2,
    deadline: "1785110400", // 2026-07-27T00:00:00Z
    shipTxHash: null,
  },
};

/** A settled fill. Same shape the indexer produced, so `FillView` is unchanged. */
export interface FillMetadata {
  txHash: string;
  /** ISO 8601, UTC. */
  when: string;
  strategyHash: string;
  /** Base units of the token the taker sold (WETH, 18dp). */
  amountIn: string;
  /** Base units of the token the vault paid (USDC, 6dp). */
  amountOut: string;
  /** True when settlement withdrew from Aave mid-transaction: the JIT path. */
  jitUnparked: boolean;
}

/**
 * Real settled fills against the live vault, newest first.
 *
 * Every row is an Arbitrum mainnet transaction. These are self-directed settlement proofs, executed
 * by the project's own taker against its own strategy: they prove the machine settles, not that
 * there was organic demand. `pool-party-aqua/docs/FILLS.md` says the same thing at length, and the
 * page's own copy must not claim more.
 */
export const FILLS: readonly FillMetadata[] = [
  {
    txHash: "0x44f351a98621a3aee2d3db119d42cfeca662dced825f2e9c8abd9cf9d7362cb6",
    when: "2026-07-26T02:13:16.000Z",
    strategyHash: "0x0291f117930fd2ca249e82020fc92aa9fd58f1fdce53bee145006f17544546a6",
    amountIn: "20000000000000", // 0.00002 WETH
    amountOut: "35188", // 0.035188 USDC -> $1,759.40 implied
    jitUnparked: true,
  },
  {
    txHash: "0x948556f4d223463338a6852f85f3a07335f189ba586a2b27be8f3f358cb39734",
    when: "2026-07-26T02:12:12.000Z",
    strategyHash: "0x24b288c71c8c41100e72c250eb199067c120c9441a97ba4b834da9ce7ee919d1",
    amountIn: "20000000000000", // 0.00002 WETH
    amountOut: "37134", // 0.037134 USDC -> $1,856.70 implied
    jitUnparked: true,
  },
  {
    txHash: "0xce4929c13fddb344d1c1d6efac2c276ca6745f2808c1078df0654280f3e1fdab",
    when: "2026-07-26T02:11:37.000Z",
    strategyHash: "0x24b288c71c8c41100e72c250eb199067c120c9441a97ba4b834da9ce7ee919d1",
    amountIn: "300000000000000", // 0.0003 WETH
    amountOut: "557565", // 0.557565 USDC -> $1,858.55 implied
    jitUnparked: true,
  },
];

/** Metadata for one strategy, or null when the manager has not labelled it. */
export function shipMetadataFor(strategyHash: string): ShipMetadata | null {
  return SHIP_METADATA[strategyHash.toLowerCase()] ?? null;
}

/** Fills for a vault's active strategies, newest first. Unknown hashes contribute nothing. */
export function fillsFor(strategyHashes: readonly string[], limit = 25): readonly FillMetadata[] {
  const wanted = new Set(strategyHashes.map((hash) => hash.toLowerCase()));
  return FILLS.filter((fill) => wanted.has(fill.strategyHash.toLowerCase())).slice(0, limit);
}
