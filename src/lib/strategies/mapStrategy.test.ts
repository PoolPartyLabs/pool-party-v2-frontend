/**
 * @id PP-STR (POO-298)
 * @name mapStrategy tests
 * @implements-rules-version v1
 *
 * [R2] API pool → FE Strategy field mapping. [R3] derived risk. [R4] global min. [R5] omits.
 */
import { describe, expect, it } from "vitest";
import { strategySchema } from "@/lib/schemas";
import { mapStrategy } from "./mapStrategy";
import { type ApiPool, apiPoolSchema } from "./poolsSchema";

const pool: ApiPool = {
  positionId: "0x691593cfc196dd25215d944080863f0b55ca8cbaa2b8a07595febca7897753f3",
  name: "kaokaoakhuu3773",
  poolManager: "0xBb7433F0F9EBc996Aa15269cA08a0De3cF1AFab1",
  poolTvlUsd: 1234.56,
  feesApr: 9.6,
  totalInvestors: "7",
  closed: false,
  currency0: { symbol: "ETH" },
  currency1: { symbol: "USDC" },
  network: "arbitrum",
  pool: "0xPOOLcontract0000000000000000000000000000",
};

describe("mapStrategy", () => {
  it("[R2] maps the core fields", () => {
    const strategy = mapStrategy(pool);
    expect(strategy).toMatchObject({
      id: pool.positionId,
      name: "kaokaoakhuu3773",
      tvl: 1234.56,
      estReturn: 9.6,
      rateType: "APR",
      status: "active",
      investors: 7,
    });
  });

  it("[R2] truncates the manager address", () => {
    expect(mapStrategy(pool).manager).toBe("0xBb74…Fab1");
  });

  it("maps the manager's description from the API (stored with the name); undefined when absent/null", () => {
    expect(mapStrategy(pool).description).toBeUndefined();
    expect(mapStrategy({ ...pool, description: "Steady stablecoin yield." }).description).toBe(
      "Steady stablecoin yield.",
    );
    // The API may send null (no description) → normalized to undefined.
    expect(mapStrategy({ ...pool, description: null }).description).toBeUndefined();
  });

  it("[R3] derives riskLevel from the token pair (ETH/USDC → dynamic → 3)", () => {
    expect(mapStrategy(pool).riskLevel).toBe(3);
    expect(
      mapStrategy({ ...pool, currency0: { symbol: "USDC" }, currency1: { symbol: "USDT" } })
        .riskLevel,
    ).toBe(1);
    expect(mapStrategy({ ...pool, currency0: { symbol: "ARB" } }).riskLevel).toBe(5);
  });

  it("[R4] applies the $10 global minimum", () => {
    expect(mapStrategy(pool).minInvestment).toBe(10);
  });

  it("[R2] maps a closed pool to status closed", () => {
    expect(mapStrategy({ ...pool, closed: true }).status).toBe("closed");
  });

  it("[R2] coerces a non-numeric investor count to 0", () => {
    expect(mapStrategy({ ...pool, totalInvestors: "" }).investors).toBe(0);
    expect(mapStrategy({ ...pool, totalInvestors: "0" }).investors).toBe(0);
  });

  it("[POO-390 R4] maps the underlying Uniswap pool TVL (dexPoolTvlUsd) to a distinct field", () => {
    const strategy = mapStrategy({ ...pool, dexPoolTvlUsd: 18_300_000 });
    // Investor-facing pool TVL is its own field, sourced from the dex pool's reserve_in_usd.
    expect(strategy.uniswapPoolTvlUsd).toBe(18_300_000);
    // [R3] The managed position value (poolTvlUsd) is untouched, the two are distinct numbers.
    expect(strategy.tvl).toBe(pool.poolTvlUsd);
    expect(strategy.uniswapPoolTvlUsd).not.toBe(strategy.tvl);
  });

  it("[POO-390 R5] leaves uniswapPoolTvlUsd undefined when the API omits dexPoolTvlUsd", () => {
    // No silent fallback to poolTvlUsd; the display layer renders a dash for the missing value.
    expect(mapStrategy(pool).uniswapPoolTvlUsd).toBeUndefined();
  });

  it("[POO-516 R2] maps the poolFeeTier label to poolFeeBps (basis points)", () => {
    expect(mapStrategy({ ...pool, poolFeeTier: "0.30%" }).poolFeeBps).toBe(30);
    expect(mapStrategy({ ...pool, poolFeeTier: "0.05%" }).poolFeeBps).toBe(5);
    expect(mapStrategy({ ...pool, poolFeeTier: "1%" }).poolFeeBps).toBe(100);
  });

  it("[POO-516 R2] leaves poolFeeBps undefined when poolFeeTier is absent or garbled (never fabricated)", () => {
    expect(mapStrategy(pool).poolFeeBps).toBeUndefined();
    expect(mapStrategy({ ...pool, poolFeeTier: "abc" }).poolFeeBps).toBeUndefined();
    expect(mapStrategy({ ...pool, poolFeeTier: "0%" }).poolFeeBps).toBeUndefined();
  });

  // POO-897 R4: the v1 `/pools` row has ticks but no reserves: carry a ticks-only onchain block so
  // the Composition split degrades to range math (the v1 fallback path).
  it("[POO-897 R4] maps the ticks-only onchain block; omitted when the row has no tickCurrent", () => {
    const strategy = mapStrategy({
      ...pool,
      tickLower: -10000,
      tickUpper: 10000,
      tickCurrent: 250,
    });
    expect(strategy.onchain).toEqual({ tickLower: -10000, tickUpper: 10000, tickCurrent: 250 });
    expect(() => strategySchema.parse(strategy)).not.toThrow();
    // Lean list rows without ticks never fabricate the block.
    expect(mapStrategy(pool).onchain).toBeUndefined();
  });

  it("[R5] omits type, managerHandle, and detail (no API source — never mocked in real mode)", () => {
    const strategy = mapStrategy(pool);
    expect(strategy.type).toBeUndefined();
    expect(strategy.managerHandle).toBeUndefined();
    // Real mode must never fabricate the prospectus — `detail` stays undefined until POO-379.
    expect(strategy.detail).toBeUndefined();
  });

  it("[R2] produces a schema-valid Strategy", () => {
    expect(() => strategySchema.parse(mapStrategy(pool))).not.toThrow();
  });

  it("[POO-316] accepts a legacy row that omits `network` and fills it from the queried slug", () => {
    const legacyRow: ApiPool = { ...pool };
    delete legacyRow.network;
    // The schema must NOT reject the legacy shape (network absent) — that drop hid legacy positions.
    const parsed = apiPoolSchema.parse(legacyRow);
    expect(parsed.network).toBeUndefined();
    expect(mapStrategy(parsed, "arbitrum").network).toBe("arbitrum");
  });

  it("[POO-316] prefers the row's own `network` over the queried slug when present", () => {
    expect(mapStrategy(pool, "polygon").network).toBe("arbitrum");
  });

  // POO-771 R3: the v1 fallback maps the FLAT embedded identity with identical @handle semantics. @rule R3
  it("[R3] maps the flat embedded manager identity (managerHandle/avatar/verified) with @handle semantics", () => {
    const strategy = mapStrategy({
      ...pool,
      managerHandle: "aave-labs",
      managerDisplayName: "Aave Labs",
      managerAvatarUrl: "https://cdn.example/avatar.png",
      managerVerification: "valid",
    });
    expect(strategy.manager).toBe("@aave-labs");
    expect(strategy.managerHandle).toBe("aave-labs");
    expect(strategy.managerAvatarUrl).toBe("https://cdn.example/avatar.png");
    expect(strategy.managerVerified).toBe(true);
    expect(strategy.managerAddress).toBe(pool.poolManager);
  });

  // POO-771 R3/R1: an older `/pools` row without the flat fields degrades to wallet-only (no throw). @rule R3
  it("[R3] with no embedded identity keeps truncateAddress, handle/avatar undefined and verified false", () => {
    const strategy = mapStrategy(pool);
    expect(strategy.manager).toBe("0xBb74…Fab1");
    expect(strategy.managerHandle).toBeUndefined();
    expect(strategy.managerAvatarUrl).toBeUndefined();
    // POO-798: no flat managerVerification → not "valid" → false.
    expect(strategy.managerVerified).toBe(false);
  });

  // POO-771 R1: the raw pools schema tolerates the flat fields present, absent, and explicitly null. @rule R1
  it("[R1] apiPoolSchema parses rows with the flat identity present, absent, and null", () => {
    expect(() =>
      apiPoolSchema.parse({
        ...pool,
        managerHandle: "aave-labs",
        managerAvatarUrl: "https://cdn.example/a.png",
        managerVerification: "valid",
        managerVerified: true,
      }),
    ).not.toThrow();
    // Absent (older backend) parses.
    expect(() => apiPoolSchema.parse(pool)).not.toThrow();
    // Explicit nulls parse (drift tolerance).
    expect(() =>
      apiPoolSchema.parse({
        ...pool,
        managerHandle: null,
        managerDisplayName: null,
        managerAvatarUrl: null,
        managerVerification: null,
        managerVerified: null,
      }),
    ).not.toThrow();
  });

  // POO-798 R1/R2/R4: the v1 badge is gated on the flat `managerVerification` enum === "valid".
  describe("verified badge gating (POO-798)", () => {
    // @rule R1
    it("[R1] managerVerification 'valid' → managerVerified true", () => {
      expect(mapStrategy({ ...pool, managerVerification: "valid" }).managerVerified).toBe(true);
    });
    // @rule R1
    it.each([
      "pending",
      "none",
    ] as const)("[R1] managerVerification '%s' → managerVerified false", (status) => {
      expect(mapStrategy({ ...pool, managerVerification: status }).managerVerified).toBe(false);
    });
    // @rule R4 — absent / null degrades to not-verified, never crashes.
    it("[R4] managerVerification null → managerVerified false", () => {
      expect(mapStrategy({ ...pool, managerVerification: null }).managerVerified).toBe(false);
    });
    // @rule R4
    it("[R4] managerVerification absent → managerVerified false", () => {
      expect(mapStrategy(pool).managerVerified).toBe(false);
    });
    // @rule R2 — the legacy `managerVerified` boolean is NOT the source anymore.
    it("[R2] legacy managerVerified:true with managerVerification:'none' → managerVerified false", () => {
      expect(
        mapStrategy({ ...pool, managerVerified: true, managerVerification: "none" })
          .managerVerified,
      ).toBe(false);
    });
  });

  // POO-830 R7: the v1 mapper derives the asset tags from the pool pair. v1 currencies carry only a
  // SYMBOL (no address), so classification uses the mock-only/legacy symbol fallback.
  describe("asset tags (POO-830 R7)", () => {
    // @rule R7 — ETH/USDC → one stable + one non-stable → [ethereum], no unverified flag.
    it("[R7] derives assetTags from the pair (ETH/USDC → [ethereum])", () => {
      const strategy = mapStrategy(pool);
      expect(strategy.assetTags).toEqual(["ethereum"]);
      expect(strategy.unverifiedTokens).toBeUndefined();
    });

    // @rule R7 — both-stable pair → [stablecoins].
    it("[R7] a both-stable pair → [stablecoins]", () => {
      expect(
        mapStrategy({ ...pool, currency0: { symbol: "USDC" }, currency1: { symbol: "USDT" } })
          .assetTags,
      ).toEqual(["stablecoins"]);
    });

    // @rule R7 — an unknown token folds to altcoins and raises the unverifiedTokens flag.
    it("[R7] an unknown token → altcoins fold + unverifiedTokens true", () => {
      const strategy = mapStrategy({ ...pool, currency1: { symbol: "MYSTERYCOIN" } });
      expect(strategy.assetTags).toEqual(["ethereum", "altcoins"]);
      expect(strategy.unverifiedTokens).toBe(true);
    });
  });
});
