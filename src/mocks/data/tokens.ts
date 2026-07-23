/**
 * @id PP-CORE-MCK-003
 * @name token mock data
 * @implements-rules-version v1
 *
 * Static, in-memory list of plausible Base mainnet (chainId 8453) tokens used by the investor app
 * mocks. Validated against `tokenSchema` from the domain schemas so the fixtures stay in sync with
 * the single source of truth. Addresses use real public Base contract addresses where known.
 */
import type { Token } from "@/lib/schemas";

/**
 * PP-MOCK: plausible Base mainnet tokens. Addresses are real public Base (chainId 8453) contract
 * addresses; decimals follow each token's on-chain configuration (USDC and USDbC use 6, the rest
 * use 18). Replace with live on-chain / API data before production.
 */
export const tokens: Token[] = [
  {
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
    chainId: 8453,
  },
  {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/2518/large/weth.png",
    chainId: 8453,
  },
  {
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    symbol: "cbETH",
    name: "Coinbase Wrapped Staked ETH",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/27008/large/cbeth.png",
    chainId: 8453,
  },
  {
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    symbol: "DAI",
    name: "Dai Stablecoin",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
    chainId: 8453,
  },
  {
    address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    symbol: "USDbC",
    name: "USD Base Coin",
    decimals: 6,
    logoUrl: "https://assets.coingecko.com/coins/images/31164/large/baseusdc.jpg",
    chainId: 8453,
  },
  {
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    symbol: "AERO",
    name: "Aerodrome Finance",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/31745/large/token.png",
    chainId: 8453,
  },
];
