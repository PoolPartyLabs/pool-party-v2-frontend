/**
 * @id PP-STR-LIB-008 (POO-579)
 * @name mapStrategyV2 tests
 * @implements-rules-version v1
 *
 * v2 strategy row → FE Strategy field mapping (the v2 twin of mapStrategy): chain-bound rows key by
 * the on-chain positionId (UUID fallback for pending), pool ← poolAddress, declared risk band,
 * onchain-derived TVL/APY/investors, lifecycleState → tri-state status, feeTier → bps.
 */
import { describe, expect, it } from "vitest";
import { strategySchema } from "@/lib/schemas";
import { mapStrategyV2 } from "./mapStrategyV2";
import type { StrategyV2 } from "./strategiesV2Schema";

const uuid = "9f8b9430-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

function row(overrides: Partial<StrategyV2> = {}): StrategyV2 {
  return {
    id: uuid,
    name: "ETH/USDC Steady",
    description: "A conservative ETH/USDC range strategy.",
    logoUrl: "",
    category: "",
    riskLevel: "dynamic",
    managerFee: 100,
    managerWallet: "0xBb7433F0F9EBc996Aa15269cA08a0De3cF1AFab1",
    access: "public",
    status: "live",
    lifecycleState: "live",
    chainId: 42161,
    network: "arbitrum",
    positionId: "0xposition",
    tokenId: "45678",
    poolAddress: "0xpoolPosition",
    feeTier: 3000,
    lockupDays: 14,
    protocolFeePct: 0.25,
    creationTime: "1700000000",
    currency0: { symbol: "ETH", decimals: 18, address: "0xeth", name: "Ether", imageUrl: "" },
    currency1: { symbol: "USDC", decimals: 6, address: "0xusdc", name: "USD Coin", imageUrl: "" },
    onchain: {
      refreshedAt: "t",
      blockNumber: "215000000",
      poolTvlUsd: 1234.56,
      dexPoolTvlUsd: 18_300_000,
      feesApr: 9.6,
      totalFeesInUsd: 1000,
      inRange: true,
      closed: false,
      totalInvestors: "7",
      missingOnchain: false,
    },
    ...overrides,
  };
}

describe("mapStrategyV2", () => {
  it("maps the core fields (id = on-chain positionId, pool = poolAddress, onchain-derived tvl/apy/investors)", () => {
    expect(mapStrategyV2(row())).toMatchObject({
      // Chain-bound: id is the on-chain positionId (the join key), NOT the owned UUID.
      id: "0xposition",
      pool: "0xpoolPosition",
      name: "ETH/USDC Steady",
      tvl: 1234.56,
      uniswapPoolTvlUsd: 18_300_000,
      estReturn: 9.6,
      rateType: "APR",
      status: "active",
      investors: 7,
      network: "arbitrum",
    });
  });

  // POO-750 R2: the Uniswap NFT token id rides the v2 metadata onto Strategy.nftPositionId.
  it("maps the Uniswap NFT token id to nftPositionId (null/absent → undefined)", () => {
    expect(mapStrategyV2(row()).nftPositionId).toBe("45678");
    expect(mapStrategyV2(row({ tokenId: null })).nftPositionId).toBeUndefined();
  });

  it("keys by the on-chain positionId so it joins the portfolio/analytics/invest id space", () => {
    // A chain-bound row's id is the positionId, matching position.strategyId + the analytics pool key.
    expect(mapStrategyV2(row({ positionId: "0xdeadbeef" })).id).toBe("0xdeadbeef");
    // A pending row (no positionId yet) keeps its owned UUID so it still routes to the v2 :id read.
    expect(mapStrategyV2(row({ positionId: null, lifecycleState: "pending" })).id).toBe(uuid);
  });

  it("maps pool from poolAddress and omits it while pending (no chain identity)", () => {
    expect(mapStrategyV2(row({ poolAddress: "0xabc" })).pool).toBe("0xabc");
    // Pending / not-yet-bound: no poolAddress → pool undefined (invest guards on it).
    expect(mapStrategyV2(row({ poolAddress: null })).pool).toBeUndefined();
  });

  it("truncates the manager wallet and keeps the full address", () => {
    const strategy = mapStrategyV2(row());
    expect(strategy.manager).toBe("0xBb74…Fab1");
    expect(strategy.managerAddress).toBe("0xBb7433F0F9EBc996Aa15269cA08a0De3cF1AFab1");
  });

  it("maps the declared risk band steady/dynamic/wild → 1/3/5", () => {
    expect(mapStrategyV2(row({ riskLevel: "steady" })).riskLevel).toBe(1);
    expect(mapStrategyV2(row({ riskLevel: "dynamic" })).riskLevel).toBe(3);
    expect(mapStrategyV2(row({ riskLevel: "wild" })).riskLevel).toBe(5);
  });

  it("falls back to the pair classifier when the declared risk is absent", () => {
    // ETH/USDC → dynamic → 3 via getRiskLevel.
    expect(mapStrategyV2(row({ riskLevel: undefined })).riskLevel).toBe(3);
    // No currencies either → conservative `wild` band (5).
    expect(
      mapStrategyV2(row({ riskLevel: undefined, currency0: null, currency1: null })).riskLevel,
    ).toBe(5);
  });

  it("collapses lifecycleState to the FE tri-state (only live is investable)", () => {
    expect(mapStrategyV2(row({ lifecycleState: "live" })).status).toBe("active");
    expect(mapStrategyV2(row({ lifecycleState: "pending" })).status).toBe("closed");
    expect(mapStrategyV2(row({ lifecycleState: "missing" })).status).toBe("closed");
    expect(mapStrategyV2(row({ lifecycleState: "closed" })).status).toBe("closed");
  });

  it("falls back to the owned status when lifecycleState is absent", () => {
    expect(mapStrategyV2(row({ lifecycleState: undefined, status: "live" })).status).toBe("active");
    expect(mapStrategyV2(row({ lifecycleState: undefined, status: "closed" })).status).toBe(
      "closed",
    );
  });

  it("applies the platform minimum and maps feeTier (hundredths of a bip) to bps", () => {
    expect(mapStrategyV2(row()).minInvestment).toBe(10);
    expect(mapStrategyV2(row({ feeTier: 3000 })).poolFeeBps).toBe(30);
    expect(mapStrategyV2(row({ feeTier: 500 })).poolFeeBps).toBe(5);
    expect(mapStrategyV2(row({ feeTier: 10000 })).poolFeeBps).toBe(100);
    expect(mapStrategyV2(row({ feeTier: null })).poolFeeBps).toBeUndefined();
  });

  // POO-902 [R2]: the v2 `managerFee` (basis points) is carried top-level in PERCENT (bps / 100),
  // feeding the Strategy Detail "Performance fee" tile. Genuinely zero stays 0 (renders "0%").
  it("[POO-902 R2] maps managerFee basis points to performanceFeePct percent (1000 → 10, 0 → 0)", () => {
    expect(mapStrategyV2(row({ managerFee: 1000 })).performanceFeePct).toBe(10);
    expect(mapStrategyV2(row({ managerFee: 1250 })).performanceFeePct).toBe(12.5);
    expect(mapStrategyV2(row({ managerFee: 0 })).performanceFeePct).toBe(0);
    // The fixture default (100 bps) → 1%.
    expect(mapStrategyV2(row()).performanceFeePct).toBe(1);
  });

  // POO-902 [R3]: an absent/invalid fee is NEVER fabricated — undefined omits the tile entirely.
  it("[POO-902 R3] leaves performanceFeePct undefined for a null/absent/negative managerFee", () => {
    expect(mapStrategyV2(row({ managerFee: null })).performanceFeePct).toBeUndefined();
    expect(mapStrategyV2(row({ managerFee: undefined })).performanceFeePct).toBeUndefined();
    expect(mapStrategyV2(row({ managerFee: -100 })).performanceFeePct).toBeUndefined();
  });

  it("normalizes description and defaults the onchain-derived fields for a pending row", () => {
    const pending = mapStrategyV2(
      row({
        description: "",
        lifecycleState: "pending",
        onchain: null,
        currency0: null,
        currency1: null,
      }),
    );
    expect(pending.description).toBeUndefined();
    expect(pending.tvl).toBe(0);
    expect(pending.uniswapPoolTvlUsd).toBeUndefined();
    expect(pending.estReturn).toBe(0);
    expect(pending.investors).toBe(0);
    expect(pending.poolPair).toBeUndefined();
  });

  it("omits prospectus fields with no v2 source (never fabricated)", () => {
    const strategy = mapStrategyV2(row());
    expect(strategy.type).toBeUndefined();
    expect(strategy.managerHandle).toBeUndefined();
    expect(strategy.detail).toBeUndefined();
  });

  it("produces a schema-valid Strategy", () => {
    expect(() => strategySchema.parse(mapStrategyV2(row()))).not.toThrow();
    // Pending row is also schema-valid.
    expect(() =>
      strategySchema.parse(mapStrategyV2(row({ onchain: null, lifecycleState: "pending" }))),
    ).not.toThrow();
  });

  it("maps poolPair from the currency symbols", () => {
    expect(mapStrategyV2(row()).poolPair).toEqual({ token0: "ETH", token1: "USDC" });
  });

  // POO-905 R2: the API-served protocol fee RATE (percent) rides onto Strategy.protocolFeePct so the
  // Invest Review can estimate the protocol fee pre-build. Null/absent → undefined (no line, R4).
  it("[POO-905 R2] carries the top-level protocolFeePct (absent/null → undefined, never fabricated)", () => {
    expect(mapStrategyV2(row({ protocolFeePct: 0.25 })).protocolFeePct).toBe(0.25);
    expect(mapStrategyV2(row({ protocolFeePct: undefined })).protocolFeePct).toBeUndefined();
    expect(mapStrategyV2(row({ protocolFeePct: null })).protocolFeePct).toBeUndefined();
  });

  // POO-819 R3: the real lock-up rides the top-level `lockupDays` (no fabricated `detail`), so the
  // Invest Review + Strategy Detail render the real term instead of always "None". @rule R3
  it("[R3] carries the top-level lockupDays (0 preserved, absent → undefined, never fabricates detail)", () => {
    expect(mapStrategyV2(row({ lockupDays: 14 })).lockupDays).toBe(14);
    // 0 (no lock-up) is preserved as 0, distinct from absent.
    expect(mapStrategyV2(row({ lockupDays: 0 })).lockupDays).toBe(0);
    // Absent / null on a lean or older row → undefined (never fabricated).
    expect(mapStrategyV2(row({ lockupDays: undefined })).lockupDays).toBeUndefined();
    expect(mapStrategyV2(row({ lockupDays: null })).lockupDays).toBeUndefined();
    // The prospectus `detail` object is still never synthesized (no-mock-in-real).
    expect(mapStrategyV2(row({ lockupDays: 14 })).detail).toBeUndefined();
  });

  // POO-897 R2/R4: the raw onchain reserves + ticks (already on the wire, previously dropped) ride
  // onto the optional `Strategy.onchain` block, with the currency decimals the value split needs.
  it("[POO-897 R2] maps onchain reserves + ticks + currency decimals onto strategy.onchain", () => {
    const strategy = mapStrategyV2(
      row({
        onchain: {
          ...row().onchain,
          totalSupply0: "1000000000000000000",
          totalSupply1: "3000000000",
          tickLower: -10000,
          tickUpper: 10000,
          tickCurrent: 250,
        },
      }),
    );
    expect(strategy.onchain).toEqual({
      totalSupply0: "1000000000000000000",
      totalSupply1: "3000000000",
      tickLower: -10000,
      tickUpper: 10000,
      tickCurrent: 250,
      decimals0: 18,
      decimals1: 6,
    });
    // The block stays schema-valid on the FE Strategy contract.
    expect(() => strategySchema.parse(strategy)).not.toThrow();
  });

  // POO-897 R4: no usable current tick (both split paths need it) → no block, never fabricated.
  it("[POO-897 R4] omits strategy.onchain when the row has no onchain block or no tickCurrent", () => {
    expect(mapStrategyV2(row({ onchain: null })).onchain).toBeUndefined();
    // The base fixture's onchain block predates the tick/reserve fields → undefined.
    expect(mapStrategyV2(row()).onchain).toBeUndefined();
  });

  it("carries the manager-uploaded logoUrl, normalizing empty/null to undefined (POO-713/POO-715)", () => {
    expect(mapStrategyV2(row({ logoUrl: "https://cdn.example/logo.png" })).logoUrl).toBe(
      "https://cdn.example/logo.png",
    );
    // Empty string (the base fixture) and null both collapse to undefined so the avatar shows initials.
    expect(mapStrategyV2(row({ logoUrl: "" })).logoUrl).toBeUndefined();
    expect(mapStrategyV2(row({ logoUrl: null })).logoUrl).toBeUndefined();
  });

  // POO-771 R3: maps the backend-embedded `manager` identity object (handle/avatar/verified) into the
  // FE fields. @rule R3
  it("[R3] maps embedded manager {handle, displayName, avatarUrl, verified} → @handle + fields", () => {
    const strategy = mapStrategyV2(
      row({
        manager: {
          handle: "aave-labs",
          displayName: "Aave Labs",
          avatarUrl: "https://cdn.example/avatar.png",
          managerVerification: "valid",
        },
      }),
    );
    // Attribution text is the @handle (never the display name, POO-757 R1).
    expect(strategy.manager).toBe("@aave-labs");
    expect(strategy.managerHandle).toBe("aave-labs");
    expect(strategy.managerAvatarUrl).toBe("https://cdn.example/avatar.png");
    expect(strategy.managerVerified).toBe(true);
    // The full wallet is still kept so the /m/<handle> link and address fallback both work.
    expect(strategy.managerAddress).toBe("0xBb7433F0F9EBc996Aa15269cA08a0De3cF1AFab1");
  });

  // POO-771 R3: no profile row → manager object null → wallet-only, no fabricated identity. @rule R3
  it("[R3] with manager: null keeps truncateAddress, handle/avatar undefined and verified false", () => {
    const strategy = mapStrategyV2(row({ manager: null }));
    expect(strategy.manager).toBe("0xBb74…Fab1");
    expect(strategy.managerHandle).toBeUndefined();
    expect(strategy.managerAvatarUrl).toBeUndefined();
    // POO-798: no manager object → not "valid" → false (badge sites read `=== true`).
    expect(strategy.managerVerified).toBe(false);
  });

  // POO-771 R3: a handleless manager that still has an avatar keeps the truncated-address text but
  // carries the avatar (e.g. the dev manager once media persists). @rule R3
  it("[R3] with handle null but avatarUrl set keeps the truncated address text and carries the avatar", () => {
    const strategy = mapStrategyV2(
      row({
        manager: {
          handle: null,
          avatarUrl: "https://cdn.example/a.png",
          managerVerification: "none",
        },
      }),
    );
    expect(strategy.manager).toBe("0xBb74…Fab1");
    expect(strategy.managerHandle).toBeUndefined();
    expect(strategy.managerAvatarUrl).toBe("https://cdn.example/a.png");
    expect(strategy.managerVerified).toBe(false);
  });

  // POO-798 R1/R2/R4: the verified badge is gated on the embedded `managerVerification` enum === "valid".
  describe("verified badge gating (POO-798)", () => {
    // @rule R1
    it("[R1] managerVerification 'valid' → managerVerified true", () => {
      expect(
        mapStrategyV2(row({ manager: { managerVerification: "valid" } })).managerVerified,
      ).toBe(true);
    });
    // @rule R1
    it.each([
      "pending",
      "none",
    ] as const)("[R1] managerVerification '%s' → managerVerified false", (status) => {
      expect(mapStrategyV2(row({ manager: { managerVerification: status } })).managerVerified).toBe(
        false,
      );
    });
    // @rule R4 — absent / null (older backend) degrades to not-verified, never crashes.
    it("[R4] managerVerification null → managerVerified false", () => {
      expect(mapStrategyV2(row({ manager: { managerVerification: null } })).managerVerified).toBe(
        false,
      );
    });
    // @rule R4
    it("[R4] managerVerification absent → managerVerified false", () => {
      expect(mapStrategyV2(row({ manager: { handle: "x" } })).managerVerified).toBe(false);
    });
    // @rule R2 — the legacy `verified` boolean is NOT the source anymore.
    it("[R2] legacy verified:true with managerVerification:'none' → managerVerified false", () => {
      expect(
        mapStrategyV2(row({ manager: { verified: true, managerVerification: "none" } }))
          .managerVerified,
      ).toBe(false);
    });
  });

  // POO-830 R7: the v2 mapper derives the asset tags from the pool pair, preferring the token ADDRESS
  // (the production-trusted source) over the spoofable symbol.
  describe("asset tags (POO-830 R7)", () => {
    // @rule R7 — real WETH/USDC addresses classify via the address registry → [ethereum].
    it("[R7] derives assetTags from real addresses (WETH/USDC Arbitrum → [ethereum])", () => {
      const strategy = mapStrategyV2(
        row({
          chainId: 42161,
          currency0: {
            symbol: "WETH",
            address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
          },
          currency1: {
            symbol: "USDC",
            address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          },
        }),
      );
      expect(strategy.assetTags).toEqual(["ethereum"]);
      expect(strategy.unverifiedTokens).toBeUndefined();
    });

    // @rule R7 — an unknown/placeholder address is NOT upgraded via its symbol (anti-spoofing): it
    // folds to altcoins and raises the flag, even though the symbol claims "ETH"/"USDC".
    it("[R7] placeholder addresses stay unverified (address-trusted, symbol ignored)", () => {
      // The base fixture uses fake addresses "0xeth"/"0xusdc" under chainId 42161.
      const strategy = mapStrategyV2(row());
      expect(strategy.assetTags).toEqual(["altcoins"]);
      expect(strategy.unverifiedTokens).toBe(true);
    });

    // @rule R7 — when a currency carries no address, the mock-only symbol fallback classifies it.
    it("[R7] falls back to the symbol when the currency has no address", () => {
      const strategy = mapStrategyV2(
        row({
          currency0: { symbol: "WETH", address: null },
          currency1: { symbol: "USDC", address: null },
        }),
      );
      expect(strategy.assetTags).toEqual(["ethereum"]);
      expect(strategy.unverifiedTokens).toBeUndefined();
    });

    // @rule R7 — a pending row with no currency pair carries no assetTags (never fabricated).
    it("[R7] omits assetTags when the row has no pair (pending)", () => {
      const strategy = mapStrategyV2(row({ currency0: null, currency1: null }));
      expect(strategy.assetTags).toBeUndefined();
      expect(strategy.unverifiedTokens).toBeUndefined();
    });
  });
});
