/**
 * @id PP-CORE-LIB-115 (POO-2133)
 * @name v2CatalogActionTests
 * @implements-rules-version v1
 * The browser receives typed data or sanitized app errors, never upstream messages.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../errors";
import {
  getCatalogPoolAction,
  getCatalogPoolsAction,
  getCatalogReservesAction,
  getCatalogTokensAction,
  getFundAction,
  getFundLimitsAction,
  getFundsAction,
} from "./actions";
import { V2DiscoveryPendingError } from "./discovery";

const reads = vi.hoisted(() => ({
  tokens: vi.fn(),
  pools: vi.fn(),
  pool: vi.fn(),
  reserves: vi.fn(),
  funds: vi.fn(),
  fund: vi.fn(),
  limits: vi.fn(),
}));
vi.mock("./catalog", () => ({
  getCatalogTokens: reads.tokens,
  getCatalogPools: reads.pools,
  getCatalogPool: reads.pool,
  getCatalogReserves: reads.reserves,
  getFunds: reads.funds,
  getFund: reads.fund,
  getFundLimits: reads.limits,
}));
const core = `0x${"11".repeat(20)}`;
describe("v2 server actions", () => {
  it("preserves safe discovery backoff on catalog reads", async () => {
    reads.pool.mockRejectedValue(
      new V2DiscoveryPendingError(409, 2, { cursor: "10", target: "20" }),
    );
    await expect(getCatalogPoolAction(42161, core)).resolves.toEqual({
      ok: false,
      error: {
        status: 409,
        code: "V2_DISCOVERY_PENDING",
        retryAfterSeconds: 2,
        progress: { cursor: "10", target: "20" },
      },
    });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    for (const read of Object.values(reads)) read.mockResolvedValue({ protocolVersion: "v2" });
  });
  // @rule R1
  it("returns catalog/fund data through every server-only read boundary", async () => {
    const result = { ok: true, data: { protocolVersion: "v2" } };
    await expect(getCatalogTokensAction(42161)).resolves.toEqual(result);
    await expect(getCatalogPoolsAction(4663)).resolves.toEqual(result);
    await expect(getCatalogPoolAction(42161, `0x${"ab".repeat(32)}`)).resolves.toEqual(result);
    await expect(getCatalogReservesAction()).resolves.toEqual(result);
    await expect(getFundsAction()).resolves.toEqual(result);
    await expect(getFundAction(core)).resolves.toEqual(result);
    await expect(getFundLimitsAction(core)).resolves.toEqual(result);
    expect(reads.tokens).toHaveBeenCalledWith(42161);
    expect(reads.pools).toHaveBeenCalledWith(4663, {});
  });
  // @rule R2
  it("serializes status/code but not the upstream message or credentials", async () => {
    reads.tokens.mockRejectedValue(
      new ApiError(503, "V2_UNAVAILABLE", "private provider URL and API key"),
    );
    await expect(getCatalogTokensAction(42161)).resolves.toEqual({
      ok: false,
      error: { status: 503, code: "V2_UNAVAILABLE" },
    });
    reads.funds.mockRejectedValue(new Error("private provider URL"));
    await expect(getFundsAction()).resolves.toEqual({
      ok: false,
      error: { status: 502, code: "V2_INVALID_RESPONSE" },
    });
  });
});
