/**
 * @id PP-MGR-MCK-006
 * @name borrowMarketFixtures
 * @implements-rules-version v1 (POO-2334 rules v1)
 * @analytics-events none (data hooks): a data fixture, nothing here is rendered or tracked.
 *
 * PP-MOCK. The Aave v3 market data the Build Borrow panel (PP-MGR-CMP-105) reads in MOCK mode: per
 * asset, the USD price, the variable borrow APY, the max LTV and the liquidation threshold as a
 * collateral, and the capital of the fund that turns a block's share into a USD value (R1, R6).
 *
 * The v2 catalog has no borrow data yet (`catalogReserveSchema` is `mode: "supply"`, with no borrow
 * APY and no LTV), and the Build plan holds shares, not amounts. The numbers follow the Figma frame
 * 8189:2337 and the order of size of Aave v3 on Arbitrum One: WETH at about 3,050 USD (the price
 * of `buildPanelFixtures`, PP-MGR-MCK-005), max LTV 80% and liquidation at 82.5%; USDC borrowed at
 * 5.6% and WBTC at 1.2%. Keyed by the uppercase token symbol, network-agnostic.
 *
 * PP-INTEGRATION-POINT: replace with the Aave v3 reserve data of the catalog (borrow APY, max LTV,
 * liquidation threshold, oracle price per asset) and the fund's real capital, when the API serves
 * them. In real mode the Borrow panel reads no figure from here and shows "Not available".
 */
import type { BorrowMarket } from "@/features/manager/fund/build/panel/lendingPanelMath";

/** PP-MOCK: the fund capital that a 100% share stands for, in USD. */
export const MOCK_FUND_CAPITAL_USD = 100_000;

/** PP-MOCK: the Aave v3 market per uppercase symbol. `borrowApyPct` null: not borrowable. */
export const BORROW_MARKET_FIXTURES: BorrowMarket = {
  WETH: {
    symbol: "WETH",
    priceUsd: 3050.4127,
    borrowApyPct: 2.1,
    maxLtvPct: 80,
    liquidationThresholdPct: 82.5,
  },
  USDC: {
    symbol: "USDC",
    priceUsd: 1,
    borrowApyPct: 5.6,
    maxLtvPct: 75,
    liquidationThresholdPct: 78,
  },
  WBTC: {
    symbol: "WBTC",
    priceUsd: 97_250,
    borrowApyPct: 1.2,
    maxLtvPct: 73,
    liquidationThresholdPct: 78,
  },
  USDT: {
    symbol: "USDT",
    priceUsd: 1,
    borrowApyPct: 5.1,
    maxLtvPct: 75,
    liquidationThresholdPct: 78,
  },
  ARB: {
    symbol: "ARB",
    priceUsd: 0.42,
    borrowApyPct: null,
    maxLtvPct: 58,
    liquidationThresholdPct: 63,
  },
};
