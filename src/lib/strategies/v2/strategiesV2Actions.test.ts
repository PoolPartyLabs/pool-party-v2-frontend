/**
 * @id PP-STR-LIB-005 (POO-638) · PP-STR-LIB-006 (POO-308)
 * @name strategiesV2Actions tests
 * @implements-rules-version v1
 *
 * POO-638: the observe-only onchain-block read the convergence poll calls (maps each id to its indexed
 * block, null when never refreshed, swallows a failed read to null — never throws).
 *
 * POO-308 (POO-868 rules-v2): the v2 strategy WRITE bridge — the pre-tx metadata create (R1/R4)
 * posts the plain metadata with the server-read SIWE session Bearer (never a client-supplied header)
 * and busts the v2 catalog cache on success; a create that returns no id degrades to null (R5). The
 * post-mine confirm (R3) posts a PLAIN `{txHash, network}` body with NO client identity at all (the
 * mint tx was already signed on-chain); a confirm error propagates so the caller can retry.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { StrategyMetadataInput, StrategyTxRefBody } from "./strategyMetadataSchema";

const V2_CACHE_TAG = "strategies-v2";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  revalidateTag: vi.fn(),
  fetchStrategyV2ById: vi.fn(),
  getAuthHeader: vi.fn(),
}));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});
vi.mock("next/cache", () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock("@/lib/auth/session", () => ({
  getAuthHeader: (...args: unknown[]) => mocks.getAuthHeader(...args),
}));
vi.mock("./fetchStrategiesV2", () => ({
  fetchStrategyV2ById: (...args: unknown[]) => mocks.fetchStrategyV2ById(...args),
  STRATEGIES_V2_CACHE_TAG: "strategies-v2",
}));

import {
  confirmStrategyOnchainAction,
  createStrategyMetadataAction,
  readStrategyOnchainBlocksAction,
} from "./strategiesV2Actions";

describe("readStrategyOnchainBlocksAction", () => {
  beforeEach(() => mocks.fetchStrategyV2ById.mockReset());

  it("Number()-parses each strategy's STRING onchain block (live contract) into a comparable number", async () => {
    // The live v2 read serializes blockNumber as a decimal STRING; the poll compares it numerically.
    mocks.fetchStrategyV2ById.mockImplementation(async (id: string) => ({
      id,
      onchain: { blockNumber: id === "a" ? "215000010" : "215000020", refreshedAt: "t" },
    }));

    const blocks = await readStrategyOnchainBlocksAction(["a", "b"]);
    expect(blocks).toEqual({ a: 215000010, b: 215000020 });
  });

  it("maps a garbled / non-numeric block string to null (never NaN into the comparator)", async () => {
    mocks.fetchStrategyV2ById.mockResolvedValueOnce({ id: "a", onchain: { blockNumber: "" } });
    mocks.fetchStrategyV2ById.mockResolvedValueOnce({ id: "b", onchain: { blockNumber: "abc" } });
    const blocks = await readStrategyOnchainBlocksAction(["a", "b"]);
    expect(blocks).toEqual({ a: null, b: null });
  });

  it("maps a never-refreshed / missing strategy to null", async () => {
    mocks.fetchStrategyV2ById.mockResolvedValueOnce({ id: "a", onchain: null }); // pending_onchain
    mocks.fetchStrategyV2ById.mockResolvedValueOnce(null); // 404
    const blocks = await readStrategyOnchainBlocksAction(["a", "b"]);
    expect(blocks).toEqual({ a: null, b: null });
  });

  it("swallows a failed read to null so the poll observes instead of throwing", async () => {
    mocks.fetchStrategyV2ById.mockRejectedValueOnce(new Error("network"));
    const blocks = await readStrategyOnchainBlocksAction(["a"]);
    expect(blocks).toEqual({ a: null });
  });

  it("returns an empty map for no ids", async () => {
    expect(await readStrategyOnchainBlocksAction([])).toEqual({});
    expect(mocks.fetchStrategyV2ById).not.toHaveBeenCalled();
  });

  it("caps the fan-out at 10 ids so a large input cannot drain the API throttle bucket", async () => {
    // Throttle safety: one upstream GET per id, so an oversized list must be trimmed to the first 10.
    mocks.fetchStrategyV2ById.mockImplementation(async (id: string) => ({
      id,
      onchain: { blockNumber: 1, refreshedAt: "t" },
    }));
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`);

    const blocks = await readStrategyOnchainBlocksAction(ids);

    expect(mocks.fetchStrategyV2ById).toHaveBeenCalledTimes(10);
    expect(Object.keys(blocks)).toHaveLength(10);
    expect(blocks).toHaveProperty("s0");
    expect(blocks).toHaveProperty("s9");
    // The 11th id onward is dropped rather than fanned out against the shared bucket.
    expect(blocks).not.toHaveProperty("s10");
  });
});

// --- POO-308 write bridge -------------------------------------------------------------------------

/** The session Bearer the mocked `getAuthHeader` resolves (server-read, POO-868). */
const authHeader = { Authorization: "Bearer session-jwt" };

const metadataBody: StrategyMetadataInput = {
  name: "Blue Chip ETH",
  description: "thesis",
  logoUrl: "https://cdn/logo.png",
  category: "blueChip",
  objectiveTags: ["income"],
  riskLevel: "dynamic",
  managerFee: 2000,
  access: "public",
};

/** POO-868: the confirm posts a plain tx-reference body — no signed envelope. */
const confirmBody: StrategyTxRefBody = { txHash: "0xhash", network: "arbitrum" };

describe("createStrategyMetadataAction", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.revalidateTag.mockReset();
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockResolvedValue(authHeader);
  });

  it("POSTs the metadata to v2 with the server-read session Bearer (POO-868)", async () => {
    // @rule R1 @rule R6
    mocks.apiFetch.mockResolvedValue({ strategyId: "str-123" });

    const id = await createStrategyMetadataAction(metadataBody);

    expect(id).toBe("str-123");
    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("strategies");
    expect(options).toMatchObject({ method: "POST", apiVersion: "v2", body: metadataBody });
    // The identity is the session Bearer read from the httpOnly cookie — never a client header.
    expect(options.headers).toEqual(authHeader);
  });

  it("reads the id from the `id` key when `strategyId` is absent", async () => {
    // @rule R1
    mocks.apiFetch.mockResolvedValue({ id: "str-abc" });
    expect(await createStrategyMetadataAction(metadataBody)).toBe("str-abc");
  });

  it("busts the v2 catalog cache on a successful create", async () => {
    mocks.apiFetch.mockResolvedValue({ strategyId: "str-123" });
    await createStrategyMetadataAction(metadataBody);
    expect(mocks.revalidateTag).toHaveBeenCalledWith(V2_CACHE_TAG);
  });

  it("returns null (no cache bust) when the response carries no id", async () => {
    // @rule R5 — a shapeless response degrades to null rather than throwing into the launch flow.
    mocks.apiFetch.mockResolvedValue({});
    expect(await createStrategyMetadataAction(metadataBody)).toBeNull();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});

describe("confirmStrategyOnchainAction", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.revalidateTag.mockReset();
  });

  it("POSTs the plain txHash body to the confirm route with NO signed-write headers (POO-868)", async () => {
    // @rule R3
    mocks.apiFetch.mockResolvedValue(null);

    await confirmStrategyOnchainAction("str-123", confirmBody);

    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("strategies/str-123/confirm");
    expect(options).toMatchObject({
      method: "POST",
      apiVersion: "v2",
      body: { txHash: "0xhash", network: "arbitrum" },
    });
    // POO-868: no client-asserted identity rides the request.
    expect(options.headers).toBeUndefined();
    expect(mocks.revalidateTag).toHaveBeenCalledWith(V2_CACHE_TAG);
  });

  it("propagates an upstream error so the caller can surface a non-blocking retry", async () => {
    // @rule R5 — the on-chain pool already exists; the caller retries the confirm.
    mocks.apiFetch.mockRejectedValue(new ApiError(502, "BAD_GATEWAY", "upstream"));
    await expect(confirmStrategyOnchainAction("str-123", confirmBody)).rejects.toThrow("upstream");
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});
