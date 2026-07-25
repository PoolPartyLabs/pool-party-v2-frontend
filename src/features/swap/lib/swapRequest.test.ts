/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name swapRequest — tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The pure half of the standalone swap/bridge screen: the amount the user typed, what is already at
 * the destination, which holdings may fund a move there, and the {@link ProvisioningNeedInput} that
 * the SHIPPED planner is asked with ([R2], [R3]).
 */
import { describe, expect, it } from "vitest";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import {
  buildSwapInput,
  MOCK_SWAP_WALLET_USDC_USD,
  parseSwapAmountUsd,
  swapFundingSources,
  usdcAtDestinationUsd,
} from "./swapRequest";

const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

/** USDC addresses as `src/lib/chains/config.ts` holds them (checksummed there, lowercased here). */
const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function source(overrides: Partial<FundingSource> & Pick<FundingSource, "chainId">): FundingSource {
  return {
    address: "0x4200000000000000000000000000000000000006",
    symbol: "WETH",
    decimals: 18,
    amount: "1000000000000000000",
    usd: 3000,
    reachableChainIds: [BASE, ARBITRUM, POLYGON],
    isNative: false,
    logoUrl: "",
    ...overrides,
  };
}

function context(overrides: Partial<ProvisioningGateContext> = {}): ProvisioningGateContext {
  return {
    targetChainId: ARBITRUM,
    sources: [],
    gasByChain: {},
    balancesByChain: {
      [BASE]: { nativeUsd: 4, tokenUsd: 3000 },
      [ARBITRUM]: { nativeUsd: 0.9, tokenUsd: 25 },
    },
    gasEstimateUsd: 0.42,
    ...overrides,
  };
}

describe("parseSwapAmountUsd", () => {
  it("reads a plain decimal amount", () => {
    expect(parseSwapAmountUsd("125")).toBe(125);
    expect(parseSwapAmountUsd("12.34")).toBe(12.34);
    expect(parseSwapAmountUsd("0.50")).toBe(0.5);
  });

  it("rejects anything that is not a positive amount", () => {
    for (const input of ["", "   ", "0", "-5", "abc", "1.2.3", "1e3", "Infinity", "NaN"]) {
      expect(parseSwapAmountUsd(input)).toBeNull();
    }
  });

  it("caps the cents, so a typed sub-cent figure cannot become a requirement nobody can read", () => {
    // Display-grade USD: the screen shows `formatUsd`, so an amount with more precision than the
    // display would let the user approve a figure that is not the one on screen.
    expect(parseSwapAmountUsd("10.005")).toBe(10.01);
    expect(parseSwapAmountUsd("10.004")).toBe(10);
  });
});

describe("usdcAtDestinationUsd", () => {
  it("sums only the destination chain's USDC", () => {
    const ctx = context({
      sources: [
        source({ chainId: ARBITRUM, address: ARBITRUM_USDC, symbol: "USDC", decimals: 6, usd: 25 }),
        source({ chainId: BASE, address: BASE_USDC, symbol: "USDC", decimals: 6, usd: 900 }),
        source({ chainId: ARBITRUM, usd: 3000 }),
      ],
    });
    expect(usdcAtDestinationUsd(ctx)).toBe(25);
  });

  it("is zero when the wallet holds no USDC there, and for no context at all", () => {
    expect(usdcAtDestinationUsd(context({ sources: [source({ chainId: ARBITRUM })] }))).toBe(0);
    expect(usdcAtDestinationUsd(null)).toBe(0);
  });
});

describe("swapFundingSources", () => {
  it("[R2] drops the destination chain's own USDC — moving it there is a no-op", () => {
    const destinationUsdc = source({
      chainId: ARBITRUM,
      address: ARBITRUM_USDC,
      symbol: "USDC",
      decimals: 6,
      usd: 25,
    });
    const baseUsdc = source({
      chainId: BASE,
      address: BASE_USDC,
      symbol: "USDC",
      decimals: 6,
      usd: 900,
    });
    const ctx = context({ sources: [destinationUsdc, baseUsdc] });

    expect(swapFundingSources(ctx).map((entry) => entry.chainId)).toEqual([BASE]);
  });

  it("keeps every other holding on the destination chain (a same-chain swap is a real route)", () => {
    const weth = source({ chainId: ARBITRUM });
    const ctx = context({ sources: [weth] });
    expect(swapFundingSources(ctx)).toEqual([weth]);
  });

  it("matches the USDC address case-insensitively", () => {
    const ctx = context({
      sources: [
        source({
          chainId: ARBITRUM,
          address: ARBITRUM_USDC.toLowerCase(),
          symbol: "USDC",
          decimals: 6,
        }),
      ],
    });
    expect(swapFundingSources(ctx)).toEqual([]);
  });

  it("returns nothing for no context", () => {
    expect(swapFundingSources(null)).toEqual([]);
  });
});

describe("buildSwapInput", () => {
  it("[R2] asks the planner for the amount, on the destination chain, from the live wallet", () => {
    const ctx = context();
    const input = buildSwapInput({ context: ctx, destinationChainId: ARBITRUM, amountUsd: 120 });

    expect(input.targetChainId).toBe(ARBITRUM);
    expect(input.opRequiredUsdc).toBe(120);
    expect(input.balancesByChain).toBe(ctx.balancesByChain);
    // [R3] Quoted, never the `0.5` the codebase still hardcodes elsewhere.
    expect(input.gasEstimateUsd).toBe(0.42);
  });

  it("rides the settings gear's max slippage through, and omits it when unset", () => {
    const ctx = context();
    expect(
      buildSwapInput({ context: ctx, destinationChainId: ARBITRUM, amountUsd: 10, slippagePct: 3 })
        .slippagePct,
    ).toBe(3);
    expect(
      buildSwapInput({ context: ctx, destinationChainId: ARBITRUM, amountUsd: 10 }),
    ).not.toHaveProperty("slippagePct");
  });

  it("targets the chain the USER picked, not whichever chain the context was read for", () => {
    // The screen re-reads the context per destination, but a stale one must never silently move
    // the money somewhere else.
    const input = buildSwapInput({
      context: context({ targetChainId: BASE }),
      destinationChainId: POLYGON,
      amountUsd: 40,
    });
    expect(input.targetChainId).toBe(POLYGON);
  });

  it("PP-MOCK: with no context it still produces a demoable requirement on the chosen chain", () => {
    // Mock mode has no session, no key and no wallet read, and it is the repo default. A screen
    // that renders nothing there would be undemoable offline.
    const input = buildSwapInput({ context: null, destinationChainId: POLYGON, amountUsd: 75 });

    expect(input.targetChainId).toBe(POLYGON);
    expect(input.opRequiredUsdc).toBe(75);
    expect(input.usdcBalanceUsd).toBe(MOCK_SWAP_WALLET_USDC_USD);
    expect(input.balancesByChain).toBeUndefined();
  });
});
