/** @id PP-MGR-LIB-065 @name manageCollectFees tests @implements-rules-version v1 (POO-2276) */
import { describe, expect, it } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  type ManageCollectDetail,
  type ManageCollectRead,
  projectManageCollectFees,
} from "./manageCollectFees";
import { normalizeManageModel } from "./manageModel";

const normalized = normalizeManageModel(mockFund).positions.find(
  (item) => item.kind === "liquidity",
);
if (!normalized) throw new Error("liquidity fixture missing");
const origin = {
  ...normalized,
  tokens: normalized.tokens.map((token, index) => ({
    ...token,
    address: `0x${String(index + 5).repeat(40)}`,
  })),
};
const version = { protocolVersion: "v2" as const };
const amount = (raw: string, decimal: string) => ({ ...version, raw, decimal });
function detail(): ManageCollectDetail {
  return {
    chainId: "4663",
    positionKey: origin.positionKey,
    status: "open",
    adapterKind: "uniswap-v4",
    tokens: origin.tokens.map(({ address, symbol, decimals }) => ({
      ...version,
      address: address ?? "",
      symbol,
      decimals,
    })),
    uniswap: {
      ...version,
      poolKey: {
        ...version,
        currency0: origin.tokens[0]?.address ?? "",
        currency1: origin.tokens[1]?.address ?? "",
        fee: 3000,
        tickSpacing: 60,
        hooks: `0x${"0".repeat(40)}`,
      },
      tickLower: -120,
      tickUpper: 120,
      currentTick: 0,
      tickSpacing: 60,
      fee: 3000,
      liquidity: "1",
      sqrtPriceX96: "1",
      inRange: true,
      lowerPrice: { ...version, token1PerToken0: "1", token0PerToken1: "1" },
      upperPrice: { ...version, token1PerToken0: "2", token0PerToken1: "0.5" },
      currentPrice: { ...version, token1PerToken0: "1", token0PerToken1: "1" },
    },
    uncollectedIncome: {
      amount0: amount("650000000", "650"),
      amount1: amount("200000000000000000", "0.2"),
    },
  };
}
function read(position: ManageCollectDetail | null = detail()): ManageCollectRead {
  return { identity: origin.id, status: "ready", position, error: null, freshness: "fresh" };
}

describe("POO-2276 ordered Collect fee projection", () => {
  // @rule R2/R3: only ordered uncollectedIncome quantities, never principal or USD totals.
  it("projects token0/1 in authoritative order using 6/18 decimals", () => {
    const view = projectManageCollectFees(origin, read());
    expect(view.status).toBe("ready");
    expect(view.rows.map((row) => row.symbol)).toEqual(["USDC", "WETH"]);
    expect(view.rows.map((row) => row.amount)).toEqual([
      expect.objectContaining({
        status: "available",
        value: expect.objectContaining({ raw: "650000000", decimal: "650" }),
      }),
      expect.objectContaining({
        status: "available",
        value: expect.objectContaining({ raw: "200000000000000000", decimal: "0.2" }),
      }),
    ]);
    expect(view).not.toHaveProperty("valueUsd");
    expect(JSON.stringify(view)).not.toContain('"decimal":"200000"');
  });
  // @rule R3: precision survives beyond IEEE-754 and one wei never becomes zero.
  it("preserves large raw quantities and exact one-wei fees", () => {
    const source = detail();
    source.uncollectedIncome = {
      amount0: amount("9007199254740993123456", "9007199254740993.123456"),
      amount1: amount("1", "0.000000000000000001"),
    };
    expect(projectManageCollectFees(origin, read(source)).rows.map((row) => row.amount)).toEqual([
      expect.objectContaining({
        value: expect.objectContaining({ decimal: "9007199254740993.123456" }),
      }),
      expect.objectContaining({
        value: expect.objectContaining({ decimal: "0.000000000000000001" }),
      }),
    ]);
  });
  // @rule R4: zero is confirmed only with both authoritative zero amounts.
  it("distinguishes both zero fees from a zero token paired with missing fees", () => {
    const source = detail();
    source.uncollectedIncome = { amount0: amount("0", "0"), amount1: amount("0", "0.0") };
    expect(projectManageCollectFees(origin, read(source)).status).toBe("zero");
    source.uncollectedIncome.amount1 = null;
    const partial = projectManageCollectFees(origin, read(source));
    expect(partial.status).toBe("partial");
    expect(partial.rows[0]?.amount.status).toBe("available");
    expect(partial.rows[1]?.amount.status).toBe("unavailable");
    expect(
      projectManageCollectFees(origin, read({ ...source, uncollectedIncome: null })),
    ).toMatchObject({ status: "unavailable", reason: "missing" });
  });
  // @rule R1/R4: late/foreign core, chain and key results must not leak.
  it.each(["identity", "chainId", "positionKey"] as const)("rejects mismatched %s", (field) => {
    const response = read();
    if (field === "identity") response.identity = `0x${"9".repeat(40)}:4663:${origin.positionKey}`;
    else if (response.position && field === "chainId") response.position.chainId = "42161";
    else if (response.position) response.position.positionKey = `0x${"9".repeat(64)}`;
    expect(projectManageCollectFees(origin, response)).toMatchObject({
      status: "unavailable",
      reason: "identity",
      rows: [],
    });
  });
  // @rule R4: refresh states do not present an old read as current fees.
  it.each(["loading", "error"] as const)("withholds old quantities during %s", (status) => {
    expect(
      projectManageCollectFees(origin, { ...read(), status, error: "secret upstream error" }),
    ).toEqual({ status, rows: [] });
  });
  // @rule R4: no invented TTL or inferred freshness.
  it("withholds fees only as stale when freshness is explicitly stale", () => {
    expect(projectManageCollectFees(origin, { ...read(), freshness: "stale" })).toMatchObject({
      status: "unavailable",
      reason: "stale",
      rows: [],
    });
  });
  // @rule POO-2276 R4: a completed read does not prove either freshness or staleness.
  it("keeps unknown freshness generically unavailable without claiming stale fees (POO-2276)", () => {
    expect(projectManageCollectFees(origin, { ...read(), freshness: "unknown" })).toEqual({
      status: "unavailable",
      rows: [],
    });
  });
  // @rule R4: closed and unsupported positions never gain LP fee capability.
  it.each(["closed", "pending"] as const)("rejects a %s position", (status) => {
    expect(projectManageCollectFees(origin, read({ ...detail(), status }))).toMatchObject({
      status: "unavailable",
      reason: "closed",
      rows: [],
    });
  });
  it("rejects Supply as an LP fee source", () => {
    expect(projectManageCollectFees({ ...origin, kind: "supply" }, read())).toMatchObject({
      status: "unavailable",
      reason: "unsupported",
      rows: [],
    });
  });
  it("rejects a contradictory canonical origin identity and invalid decimal metadata", () => {
    expect(
      projectManageCollectFees({ ...origin, core: `0x${"9".repeat(40)}` }, read()),
    ).toMatchObject({ status: "unavailable", reason: "identity", rows: [] });
    for (const decimals of [-1, 37, 6.5]) {
      const changed = {
        ...origin,
        tokens: origin.tokens.map((token, index) => (index === 0 ? { ...token, decimals } : token)),
      };
      const source = detail();
      if (source.tokens[0]) source.tokens[0].decimals = decimals;
      expect(projectManageCollectFees(changed, read(source))).toMatchObject({
        status: "unavailable",
        reason: "metadata",
        rows: [],
      });
    }
  });
  // @rule R1/R4/R6: invalid core/key metadata cannot become an authorized-looking read.
  it("rejects malformed core/key origins even when their envelope identity matches", () => {
    for (const changed of [
      { ...origin, core: "unknown", id: `unknown:4663:${origin.positionKey}` },
      { ...origin, positionKey: "unknown", id: `${origin.core}:4663:unknown` },
    ]) {
      expect(projectManageCollectFees(changed, { ...read(), identity: changed.id })).toMatchObject({
        status: "unavailable",
        reason: "identity",
        rows: [],
      });
    }
  });
  it("rejects an origin network label that contradicts its chain identity", () => {
    expect(projectManageCollectFees({ ...origin, network: "arbitrum" }, read())).toMatchObject({
      status: "unavailable",
      reason: "metadata",
      rows: [],
    });
  });
  // @rule R2/R3/R4: ordered identity and decimals must agree with currencies.
  it.each([
    "address",
    "symbol",
    "decimals",
    "currency",
    "adapter",
    "order",
  ] as const)("rejects inconsistent %s metadata", (field) => {
    const source = detail();
    const token = source.tokens[0];
    if (!token || !source.uniswap) throw new Error("metadata fixture");
    if (field === "address") token.address = `0x${"9".repeat(40)}`;
    if (field === "symbol") token.symbol = "USDG";
    if (field === "decimals") token.decimals = 18;
    if (field === "currency") source.uniswap.poolKey.currency0 = `0x${"9".repeat(40)}`;
    if (field === "adapter") source.adapterKind = "aave-v3";
    if (field === "order") source.tokens.reverse();
    expect(projectManageCollectFees(origin, read(source))).toMatchObject({
      status: "unavailable",
      reason: "metadata",
      rows: [],
    });
  });
  // @rule R3/R4: malformed/mismatched amounts stay unavailable instead of becoming zero.
  it.each([
    "-1",
    "1e6",
    "9".repeat(79),
    (BigInt(2) ** BigInt(256)).toString(),
    "650000001",
  ])("rejects invalid or contradictory raw %s", (raw) => {
    const source = detail();
    source.uncollectedIncome = {
      amount0: amount(raw, "650"),
      amount1: amount("1", "0.000000000000000001"),
    };
    const view = projectManageCollectFees(origin, read(source));
    expect(view.status).toBe("partial");
    expect(view.rows[0]?.amount.status).toBe("unavailable");
    expect(view.rows[1]?.amount.status).toBe("available");
  });
  it.each([
    "-650",
    "6.5e2",
    "Infinity",
    "650.000001",
    "9".repeat(121),
  ])("rejects malformed or contradictory decimal %s", (decimal) => {
    const source = detail();
    source.uncollectedIncome = {
      amount0: amount("650000000", decimal),
      amount1: amount("1", "0.000000000000000001"),
    };
    expect(projectManageCollectFees(origin, read(source))).toMatchObject({ status: "partial" });
  });
});
