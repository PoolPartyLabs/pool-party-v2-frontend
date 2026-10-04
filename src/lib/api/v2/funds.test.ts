import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./client", () => ({ v2Fetch: mocks.fetch }));

import { readBalances, readFund, readHolder, readPosition, readTransits } from "./funds";

const core = `0x${"1".repeat(40)}`;
describe("fund reads", () => {
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
