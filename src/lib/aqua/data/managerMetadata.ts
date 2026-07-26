/**
 * @id PP-AQUA-LIB-010 (POO-1067)
 * @name Active Reserve settled purchases
 * @implements-rules-version v2
 *
 * The one thing on the Active Reserve page that is NOT read from chain.
 *
 * ## What this is, and what it is not
 *
 * Every VALUE on that page is live: NAV, the Aave carry, the hot buffer, the deposit cap, which
 * strategies are active, how much USDC each band has committed, how much WETH it has acquired, the
 * Chainlink price, and the investor's own position. So is the band GEOMETRY: the mandate name, the
 * band edges and the spot they were built against are decoded from the Aqua registry's own
 * `Shipped` log by `api/backfill.ts`, not stored here.
 *
 * v1 of this file held that geometry as a fixture, on the belief it was not recoverable from chain.
 * It was. The decode landed, the fixture was wrong by about $25 on spot, and the chain won. What
 * remains is only the settled-purchase list.
 *
 * ## Why the fills are still a list
 *
 * Decoding a settlement means matching logs across the router and the vault and attributing them to
 * a band. That indexer is real work and is named as NOT BUILT in
 * `docs/_hackathon_aqua/03_PRE_EXISTING_VS_NEW.md`, rather than quietly skipped.
 *
 * These rows are not invented. Every one is a real Arbitrum transaction, the hashes resolve on
 * Arbiscan, and they are cross-checked against `docs/FILLS.md` in the contracts repo
 * (https://github.com/0xmvercosa/pool-party-aqua). They are also
 * SELF-DIRECTED: executed by the project's own taker against its own strategy, so they prove the
 * machine settles, not that there was organic demand. The page says exactly that above the list
 * (`COPY.fills.selfDirected`) before showing a single row.
 *
 * ## Removing this
 *
 * When the fill indexer lands, delete `FILLS` and have `readFills` read it. `FillView` does not
 * change shape, so nothing downstream moves.
 */
import "server-only";

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
 * there was organic demand. `docs/FILLS.md` in the contracts repo says the same at length, and the
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

/** Fills for a vault's active strategies, newest first. Unknown hashes contribute nothing. */
export function fillsFor(strategyHashes: readonly string[], limit = 25): readonly FillMetadata[] {
  const wanted = new Set(strategyHashes.map((hash) => hash.toLowerCase()));
  return FILLS.filter((fill) => wanted.has(fill.strategyHash.toLowerCase())).slice(0, limit);
}
