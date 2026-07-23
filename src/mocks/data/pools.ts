/**
 * @id PP-MGR-MCK-002
 * @name Uniswap v3 pool catalog (mock)
 * @implements-rules-version v1
 *
 * Static fixtures for the Strategy Builder's pool picker (PP-MGR-SCR-002). V1 is Uniswap v3 only and
 * permissionless (any pool / any pair) — this is a representative sample across a few networks.
 * `currentPrice` is token1 per 1 token0, used to center the range presets. Pool + token addresses
 * are deterministic mock values (see {@link mockAddress}) so the builder's address search has
 * something to match. Replace with the indexer / subgraph pool list before production.
 */
import type { UniswapPool } from "@/lib/schemas";

/**
 * Deterministic mock EVM-style address (`0x` + 40 hex) derived from a seed string — stable across
 * renders/SSR (no `Math.random`). PP-INTEGRATION-POINT: replace with real on-chain addresses from
 * the indexer.
 */
function mockAddress(seed: string): string {
  let hex = "";
  for (let i = 0; i < 40; i++) {
    hex += ((seed.charCodeAt(i % seed.length) + i * 7) % 16).toString(16);
  }
  return `0x${hex}`;
}

/** A network shown in the builder's network picker. */
export interface BuilderNetwork {
  /** Network id, e.g. "base". */
  id: string;
  /** Display name, e.g. "Base". */
  name: string;
  /** Brand color for the chip's logo monogram. */
  brandColor: string;
  /** Optional logo asset. PP-INTEGRATION-POINT: real chain logos; UI falls back to a monogram. */
  logoUrl?: string;
}

/**
 * Supported networks shown in the builder's network picker (those with pools below).
 * V1 launches on Arbitrum, Base and Polygon only (POO-278 [R2], murilo 2026-06-11); Ethereum and
 * Optimism are post-V1.
 */
export const NETWORKS: BuilderNetwork[] = [
  { id: "base", name: "Base", brandColor: "#0052FF" },
  { id: "arbitrum", name: "Arbitrum", brandColor: "#28A0F0" },
  { id: "polygon", name: "Polygon", brandColor: "#8247E5" },
];

/** PP-MOCK: a representative slice of Uniswap v3 pools across the supported networks. */
export const uniswapPools: UniswapPool[] = [
  // Base
  {
    id: "base-eth-usdc-5",
    network: "base",
    networkName: "Base",
    token0: "ETH",
    token1: "USDC",
    feeBps: 5,
    tvlUsd: 42_000_000,
    aprPct: 14.2,
    currentPrice: 3050,
    address: mockAddress("base-eth-usdc-5"),
    token0Address: mockAddress("base-ETH"),
    token1Address: mockAddress("base-USDC"),
  },
  {
    id: "base-eth-usdc-30",
    network: "base",
    networkName: "Base",
    token0: "ETH",
    token1: "USDC",
    feeBps: 30,
    tvlUsd: 18_000_000,
    aprPct: 9.1,
    currentPrice: 3050,
    address: mockAddress("base-eth-usdc-30"),
    token0Address: mockAddress("base-ETH"),
    token1Address: mockAddress("base-USDC"),
  },
  {
    id: "base-cbbtc-usdc-30",
    network: "base",
    networkName: "Base",
    token0: "cbBTC",
    token1: "USDC",
    feeBps: 30,
    tvlUsd: 9_400_000,
    aprPct: 11.5,
    currentPrice: 64_000,
    address: mockAddress("base-cbbtc-usdc-30"),
    token0Address: mockAddress("base-cbBTC"),
    token1Address: mockAddress("base-USDC"),
  },
  {
    id: "base-usdc-usdt-1",
    network: "base",
    networkName: "Base",
    token0: "USDC",
    token1: "USDT",
    feeBps: 1,
    tvlUsd: 25_000_000,
    aprPct: 3.8,
    currentPrice: 1.0,
    address: mockAddress("base-usdc-usdt-1"),
    token0Address: mockAddress("base-USDC"),
    token1Address: mockAddress("base-USDT"),
  },
  // Arbitrum
  {
    id: "arb-eth-usdc-5",
    network: "arbitrum",
    networkName: "Arbitrum",
    token0: "ETH",
    token1: "USDC",
    feeBps: 5,
    tvlUsd: 38_000_000,
    aprPct: 13.6,
    currentPrice: 3050,
    address: mockAddress("arb-eth-usdc-5"),
    token0Address: mockAddress("arbitrum-ETH"),
    token1Address: mockAddress("arbitrum-USDC"),
  },
  {
    id: "arb-wbtc-usdc-30",
    network: "arbitrum",
    networkName: "Arbitrum",
    token0: "WBTC",
    token1: "USDC",
    feeBps: 30,
    tvlUsd: 12_000_000,
    aprPct: 10.8,
    currentPrice: 64_000,
    address: mockAddress("arb-wbtc-usdc-30"),
    token0Address: mockAddress("arbitrum-WBTC"),
    token1Address: mockAddress("arbitrum-USDC"),
  },
  {
    id: "arb-arb-usdc-30",
    network: "arbitrum",
    networkName: "Arbitrum",
    token0: "ARB",
    token1: "USDC",
    feeBps: 30,
    tvlUsd: 6_200_000,
    aprPct: 22.4,
    currentPrice: 0.78,
    address: mockAddress("arb-arb-usdc-30"),
    token0Address: mockAddress("arbitrum-ARB"),
    token1Address: mockAddress("arbitrum-USDC"),
  },
  {
    id: "arb-gmx-usdc-100",
    network: "arbitrum",
    networkName: "Arbitrum",
    token0: "GMX",
    token1: "USDC",
    feeBps: 100,
    tvlUsd: 2_100_000,
    aprPct: 28.0,
    currentPrice: 28.5,
    address: mockAddress("arb-gmx-usdc-100"),
    token0Address: mockAddress("arbitrum-GMX"),
    token1Address: mockAddress("arbitrum-USDC"),
  },
  // Polygon
  {
    id: "polygon-weth-usdc-5",
    network: "polygon",
    networkName: "Polygon",
    token0: "WETH",
    token1: "USDC",
    feeBps: 5,
    tvlUsd: 18_000_000,
    aprPct: 13.6,
    currentPrice: 3050,
    address: mockAddress("polygon-weth-usdc-5"),
    token0Address: mockAddress("polygon-WETH"),
    token1Address: mockAddress("polygon-USDC"),
  },
  {
    id: "polygon-wbtc-weth-30",
    network: "polygon",
    networkName: "Polygon",
    token0: "WBTC",
    token1: "WETH",
    feeBps: 30,
    tvlUsd: 6_500_000,
    aprPct: 9.1,
    currentPrice: 21.0,
    address: mockAddress("polygon-wbtc-weth-30"),
    token0Address: mockAddress("polygon-WBTC"),
    token1Address: mockAddress("polygon-WETH"),
  },
  {
    id: "polygon-wmatic-usdc-30",
    network: "polygon",
    networkName: "Polygon",
    token0: "WMATIC",
    token1: "USDC",
    feeBps: 30,
    tvlUsd: 9_200_000,
    aprPct: 19.4,
    currentPrice: 0.52,
    address: mockAddress("polygon-wmatic-usdc-30"),
    token0Address: mockAddress("polygon-WMATIC"),
    token1Address: mockAddress("polygon-USDC"),
  },
];
