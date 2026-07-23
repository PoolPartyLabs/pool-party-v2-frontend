/**
 * @id PP-STR-LIB-005 (POO-638) · PP-STR-LIB-008 (POO-579)
 * @name strategiesV2 schema tests
 * @implements-rules-version v1
 *
 * The v2 strategy read contract, modeled against the LIVE `StrategiesV2ResponseDto`: the envelope key
 * is `strategies` (NOT `items`), and `onchain.blockNumber` is a decimal STRING. The fuller catalog row
 * the `mapStrategyV2` ACL consumes is modeled tolerantly; unknown fields still pass through.
 */
import { describe, expect, it } from "vitest";
import { onchainStateSchema, strategiesV2PageSchema, strategyV2Schema } from "./strategiesV2Schema";

/** A live-shaped v2 strategy row (trimmed to the modeled fields + a couple of unknown ones). */
const liveRow = {
  id: "9f8b9430-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
  name: "ETH/USDC Steady",
  description: "A conservative ETH/USDC range strategy.",
  logoUrl: "",
  category: "",
  riskLevel: "dynamic",
  managerFee: 100,
  managerWallet: "0x10dc9E9fB8DB5F51Cb192407D30c71f02433c810",
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
  currency0: {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    imageUrl: "https://example.com/weth.png",
  },
  currency1: { address: "0xusdc", symbol: "USDC", name: "USD Coin", decimals: 6, imageUrl: "" },
  chainBoundAt: "2026-07-06T12:00:00.000Z",
  onchain: {
    refreshedAt: "2026-07-06T12:00:00.000Z",
    blockNumber: "215000000",
    poolTvlUsd: 2000.89,
    dexPoolTvlUsd: 3000000.96,
    feesApr: 12.34,
    totalFeesInUsd: 1000.01,
    inRange: true,
    closed: false,
    totalInvestors: "1234",
    missingOnchain: false,
  },
};

describe("onchainStateSchema", () => {
  it("parses the live onchain state with a STRING blockNumber", () => {
    const parsed = onchainStateSchema.parse(liveRow.onchain);
    expect(parsed.blockNumber).toBe("215000000");
    expect(parsed.poolTvlUsd).toBe(2000.89);
    expect(parsed.totalInvestors).toBe("1234");
  });

  it("tolerates a never-synced state (null block)", () => {
    const parsed = onchainStateSchema.parse({ refreshedAt: null, blockNumber: null });
    expect(parsed.blockNumber).toBeNull();
  });
});

describe("strategyV2Schema", () => {
  it("parses a live-shaped catalog row (all modeled fields)", () => {
    const parsed = strategyV2Schema.parse(liveRow);
    expect(parsed.id).toBe(liveRow.id);
    expect(parsed.name).toBe("ETH/USDC Steady");
    expect(parsed.riskLevel).toBe("dynamic");
    expect(parsed.managerFee).toBe(100);
    expect(parsed.managerWallet).toBe(liveRow.managerWallet);
    expect(parsed.lifecycleState).toBe("live");
    expect(parsed.feeTier).toBe(3000);
    // The PP-managed position address the mapper maps onto `Strategy.pool` (invest spender).
    expect(parsed.poolAddress).toBe("0xpoolPosition");
    // POO-819: the top-level lock-up (in days) the backend already exposes.
    expect(parsed.lockupDays).toBe(14);
    expect(parsed.currency0?.symbol).toBe("WETH");
    expect(parsed.currency1?.decimals).toBe(6);
    expect(parsed.onchain?.blockNumber).toBe("215000000");
  });

  it("passes unknown fields through (contract may add keys before the schema hardens)", () => {
    const parsed = strategyV2Schema.parse(liveRow) as Record<string, unknown>;
    expect(parsed.chainBoundAt).toBe("2026-07-06T12:00:00.000Z");
  });

  it("tolerates a pending row: null onchain + null chain identity", () => {
    const parsed = strategyV2Schema.parse({
      id: "uuid",
      name: "Pending",
      lifecycleState: "pending",
      status: "pending_onchain",
      chainId: null,
      network: null,
      positionId: null,
      currency0: null,
      currency1: null,
      onchain: null,
    });
    expect(parsed.onchain).toBeNull();
    expect(parsed.positionId).toBeNull();
  });

  it("accepts the contracted riskLevel / lifecycleState unions", () => {
    const parsed = strategyV2Schema.parse({
      id: "uuid",
      riskLevel: "steady",
      lifecycleState: "pending",
    });
    expect(parsed.riskLevel).toBe("steady");
    expect(parsed.lifecycleState).toBe("pending");
  });

  it("rejects an out-of-contract riskLevel / lifecycleState (the catalog then falls back to v1)", () => {
    // Strict unions: a surprise enum value fails the row parse; the catalog's try/catch degrades to v1
    // rather than silently mislabeling risk/lifecycle.
    expect(() => strategyV2Schema.parse({ id: "uuid", riskLevel: "spicy" })).toThrow();
    expect(() => strategyV2Schema.parse({ id: "uuid", lifecycleState: "??" })).toThrow();
  });

  it("rejects a row without an id", () => {
    expect(() => strategyV2Schema.parse({ name: "no id" })).toThrow();
  });

  // POO-819 R1: the top-level `lockupDays` (already on the live v2 DTO) is parsed when present and is
  // tolerant of absence (older payloads that predate the field). @rule R1
  it("[R1] parses the top-level lockupDays, tolerating absence and zero", () => {
    expect(strategyV2Schema.parse({ id: "uuid", lockupDays: 30 }).lockupDays).toBe(30);
    // 0 (no lock-up) survives as 0, distinct from absent (undefined) — the consumer renders "None" for both.
    expect(strategyV2Schema.parse({ id: "uuid", lockupDays: 0 }).lockupDays).toBe(0);
    // Absent on an older backend payload: never fails the row, resolves undefined.
    expect(strategyV2Schema.parse({ id: "uuid" }).lockupDays).toBeUndefined();
    // A stray null must not blank a working row.
    expect(() => strategyV2Schema.parse({ id: "uuid", lockupDays: null })).not.toThrow();
  });

  // POO-905 R2: the protocol fee RATE (percent) the backend serves on v2 rows, parsed when present
  // and tolerant of absence (older backend that predates the field). @rule R2
  it("[POO-905 R2] parses the top-level protocolFeePct, tolerating absence and null", () => {
    expect(strategyV2Schema.parse({ id: "uuid", protocolFeePct: 0.25 }).protocolFeePct).toBe(0.25);
    // Absent on an older backend payload: never fails the row, resolves undefined (no fee line, R4).
    expect(strategyV2Schema.parse({ id: "uuid" }).protocolFeePct).toBeUndefined();
    // A stray null must not blank a working row.
    expect(() => strategyV2Schema.parse({ id: "uuid", protocolFeePct: null })).not.toThrow();
  });

  // POO-771 R1: the embedded manager identity is tolerated present, absent (older backend) and null
  // (no registry profile), and the identity survives the parse. @rule R1
  it("[R1] parses the embedded manager identity present, absent, and null (drift-tolerant)", () => {
    const withManager = strategyV2Schema.parse({
      id: "uuid",
      manager: {
        handle: "aave-labs",
        displayName: "Aave Labs",
        avatarUrl: "https://cdn.example/a.png",
        verified: true,
      },
    });
    expect(withManager.manager).toMatchObject({ handle: "aave-labs", verified: true });
    // Absent (older backend that has not embedded it yet) must not fail the whole row.
    expect(() => strategyV2Schema.parse({ id: "uuid" })).not.toThrow();
    // Explicit null (no matching registry profile) must not fail.
    expect(() => strategyV2Schema.parse({ id: "uuid", manager: null })).not.toThrow();
    // A partial object (a field missing) must still parse — never blank a working row.
    expect(() => strategyV2Schema.parse({ id: "uuid", manager: { handle: "x" } })).not.toThrow();
  });
});

describe("strategiesV2PageSchema", () => {
  it("parses the live envelope keyed by `strategies` (not `items`) with networks sync-health", () => {
    const parsed = strategiesV2PageSchema.parse({
      strategies: [liveRow],
      page: 0,
      limit: 100,
      totalItems: 177,
      networks: [{ network: "arbitrum", lastBlockNumber: "215000000" }],
    });
    expect(parsed.strategies).toHaveLength(1);
    expect(parsed.totalItems).toBe(177);
  });

  it("parses an empty page", () => {
    const parsed = strategiesV2PageSchema.parse({ strategies: [], totalItems: 0 });
    expect(parsed.strategies).toEqual([]);
  });

  it("requires `strategies` (a list endpoint returns a list; 204/empty is the fetcher's null)", () => {
    expect(() => strategiesV2PageSchema.parse({ totalItems: 0 })).toThrow();
    // The old `items` key is no longer accepted as the list.
    expect(() => strategiesV2PageSchema.parse({ items: [], totalItems: 0 })).toThrow();
  });
});
