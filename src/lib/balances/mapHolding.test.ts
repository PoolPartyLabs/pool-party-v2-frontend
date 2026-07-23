/**
 * @id PP-BALANCES (POO-815)
 * @name mapHolding.test
 * @implements-rules-version v1
 * Unit tests for the backend-row → TokenBalance mapper: amount/USD from the formatted fields,
 * unpriced rows dropped, native token shown as the chain's native identity (POL / ETH).
 */
import { describe, expect, it } from "vitest";
import { mapHolding } from "./mapHolding";
import type { WalletHolding } from "./walletHoldingsSchema";

const ARBITRUM = 42161;
const POLYGON = 137;

function row(overrides: Partial<WalletHolding> = {}): WalletHolding {
  return {
    address: "0xabc",
    name: "USD Coin",
    symbol: "USDC",
    logo: "https://logo/usdc.png",
    decimals: 6,
    balance: 1200,
    formattedBalance: "1200",
    priceUSD: 1,
    formattedBalanceInUSD: "1200",
    isNative: false,
    ...overrides,
  };
}

describe("mapHolding", () => {
  it("maps amount + USD from the formatted fields and carries logo/address/isNative", () => {
    const mapped = mapHolding(
      row({ formattedBalance: "340.5", formattedBalanceInUSD: "340.5" }),
      ARBITRUM,
    );
    expect(mapped).toEqual({
      symbol: "USDC",
      name: "USD Coin",
      amount: 340.5,
      decimals: 6,
      usd: 340.5,
      chainId: ARBITRUM,
      logoUrl: "https://logo/usdc.png",
      address: "0xabc",
      isNative: false,
    });
  });

  it("drops a row with a null price", () => {
    expect(mapHolding(row({ priceUSD: null }), ARBITRUM)).toBeNull();
  });

  it("drops a row with a NaN USD value", () => {
    expect(mapHolding(row({ formattedBalanceInUSD: "NaN" }), ARBITRUM)).toBeNull();
  });

  // The backend already labels the native token per network (POL / Polygon, ETH / Ether); we pass
  // symbol + name straight through and carry isNative.
  it("passes the backend's native identity through (POL on Polygon)", () => {
    const mapped = mapHolding(
      row({
        symbol: "POL",
        name: "Polygon",
        isNative: true,
        address: "0x0000000000000000000000000000000000000000",
      }),
      POLYGON,
    );
    expect(mapped?.symbol).toBe("POL");
    expect(mapped?.name).toBe("Polygon");
    expect(mapped?.isNative).toBe(true);
  });

  it("passes native ETH through on Arbitrum/Base", () => {
    const mapped = mapHolding(row({ symbol: "ETH", name: "Ether", isNative: true }), ARBITRUM);
    expect(mapped?.symbol).toBe("ETH");
    expect(mapped?.name).toBe("Ether");
  });

  it("leaves a non-native token's symbol/name untouched", () => {
    const mapped = mapHolding(
      row({ symbol: "WBTC", name: "Wrapped Bitcoin", isNative: false }),
      ARBITRUM,
    );
    expect(mapped?.symbol).toBe("WBTC");
    expect(mapped?.name).toBe("Wrapped Bitcoin");
  });

  it("defaults logoUrl to an empty string when the backend omits the logo", () => {
    const mapped = mapHolding(row({ logo: undefined }), ARBITRUM);
    expect(mapped?.logoUrl).toBe("");
  });
});
