/**
 * @id PP-CORE-MCK-005
 * @name tokenBalances (mock)
 * @implements-rules-version v1
 * Realistic mock of the connected wallet's token holdings across the supported networks
 * (Arbitrum, Base, Polygon). Multi-token, multi-chain: USDC on more than one network, a native
 * ETH holding, a few volatile tokens, and two sub-$1 "dust" rows (one USDC, one not) so the
 * modal's group/divider/hide-<$1 rules (POO-814) are exercised. Amounts and USD values are
 * plausible; the total (~$1,695, incl. the hidden dust) is believable.
 *
 * PP-MOCK: static fixtures. PP-INTEGRATION-POINT (POO-239 / POO-815): real balances come from
 * pool-party-api `GET /wallet/{address}` (Alchemy-priced), replacing this mock branch.
 */
import type { TokenBalance } from "@/lib/balances/types";

/** CoinGecko CDN logos (fallback; committed art is preferred via resolveTokenLogo where available). */
const LOGO = {
  usdc: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  eth: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  wbtc: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  arb: "https://assets.coingecko.com/coins/images/16547/large/arb.jpg",
  dai: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
  aero: "https://assets.coingecko.com/coins/images/31745/large/token.png",
  pepe: "https://assets.coingecko.com/coins/images/29850/large/pepe-token.jpeg",
} as const;

/** Connected-wallet holdings across chains. Grouping/sorting happens at the surface (POO-814). */
export const tokenBalances: TokenBalance[] = [
  // USDC across two networks (the top group) + one sub-$1 USDC dust row on a third.
  {
    symbol: "USDC",
    name: "USD Coin",
    amount: 1200,
    decimals: 6,
    usd: 1200,
    chainId: 8453, // Base
    logoUrl: LOGO.usdc,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    amount: 340.5,
    decimals: 6,
    usd: 340.5,
    chainId: 42161, // Arbitrum
    logoUrl: LOGO.usdc,
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    amount: 0.42,
    decimals: 6,
    usd: 0.42,
    chainId: 137, // Polygon — dust (< $1), hidden from the list but counted in the total
    logoUrl: LOGO.usdc,
  },
  // Volatile holdings (the second group), sorted by USD at the surface.
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    amount: 0.0008,
    decimals: 8,
    usd: 52,
    chainId: 42161, // Arbitrum
    logoUrl: LOGO.wbtc,
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    amount: 0.02,
    decimals: 18,
    usd: 50,
    chainId: 8453, // Base
    logoUrl: LOGO.eth,
  },
  {
    symbol: "DAI",
    name: "Dai",
    amount: 30,
    decimals: 18,
    usd: 30,
    chainId: 137, // Polygon
    logoUrl: LOGO.dai,
  },
  {
    symbol: "ARB",
    name: "Arbitrum",
    amount: 15,
    decimals: 18,
    usd: 12,
    chainId: 42161, // Arbitrum
    logoUrl: LOGO.arb,
  },
  {
    symbol: "AERO",
    name: "Aerodrome",
    amount: 12,
    decimals: 18,
    usd: 10,
    chainId: 8453, // Base
    logoUrl: LOGO.aero,
  },
  {
    symbol: "PEPE",
    name: "Pepe",
    amount: 5_000_000,
    decimals: 18,
    usd: 0.35,
    chainId: 8453, // Base — dust (< $1), hidden from the list but counted in the total
    logoUrl: LOGO.pepe,
  },
];
