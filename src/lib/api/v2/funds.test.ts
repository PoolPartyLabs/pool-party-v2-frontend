import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./client", () => ({ v2Fetch: mocks.fetch }));

import { fundHistorySchema } from "./fundSchemas";
import {
  readBalances,
  readFund,
  readFundHistory,
  readHolder,
  readPosition,
  readTransits,
} from "./funds";

const core = `0x${"1".repeat(40)}`;
describe("fund reads", () => {
  it("reads newest-first fund events with the API's opaque pagination cursor", async () => {
    const cursor = `1728000000:42161:0x${"2".repeat(64)}:4`;
    await readFundHistory(core, cursor);
    expect(mocks.fetch).toHaveBeenCalledWith(
      `/funds/${core}/history?limit=20&cursor=${encodeURIComponent(cursor)}`,
      fundHistorySchema,
    );
  });
  it("validates the deployed fund-history envelope without losing event amounts", () => {
    const event = {
      protocolVersion: "v2",
      type: "deposit",
      kind: "deposit",
      eventName: "Deposited",
      chainId: "42161",
      vault: core,
      transactionHash: `0x${"2".repeat(64)}`,
      blockNumber: "123456789",
      logIndex: 4,
      timestamp: "2026-10-04T08:00:00.000Z",
      amounts: { budget: "2000000", budgetDecimal: "2" },
      details: { usdcAmount: "2000000" },
    };
    const value = {
      protocolVersion: "v2",
      coreVault: core,
      events: [event],
      nextCursor: null,
      indexing: [],
    };
    expect(fundHistorySchema.parse(value).events[0]?.amounts?.budget).toBe("2000000");
    expect(
      fundHistorySchema.safeParse({ ...value, events: [{ ...event, chainId: "1" }] }).success,
    ).toBe(false);
    expect(
      fundHistorySchema.safeParse({
        ...value,
        events: [{ ...event, transactionHash: "not-a-hash" }],
      }).success,
    ).toBe(false);
    expect(fundHistorySchema.safeParse({ ...value, nextCursor: "bad" }).success).toBe(false);
  });
  beforeEach(() => vi.clearAllMocks());
  it("R2 routes detail, holder and history only through the v2 client", async () => {
    await readFund(core);
    await readHolder(core, core);
    await readPosition(core, 4663, `0x${"2".repeat(64)}`);
    expect(mocks.fetch.mock.calls.map(([path]) => path)).toEqual([
      `/funds/${core}`,
      `/funds/${core}/holders/${core}`,
      `/funds/${core}/positions/4663/0x${"2".repeat(64)}`,
    ]);
  });
  it("R3 reads paged transits and authoritative spoke balances", async () => {
    await readTransits(core, "cursor+value");
    await readBalances(core, 4663);
    expect(mocks.fetch.mock.calls[0]?.[0]).toContain("cursor=cursor%2Bvalue");
    expect(mocks.fetch.mock.calls[1]?.[0]).toBe(`/funds/${core}/spokes/4663/balances`);
  });
  it("R8 rejects invalid identities and unsupported chains before I/O", () => {
    expect(() => readFund("v1-strategy-id")).toThrow();
    expect(() => readBalances(core, 1)).toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
