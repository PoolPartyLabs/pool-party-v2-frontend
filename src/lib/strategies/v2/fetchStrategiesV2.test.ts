/**
 * @id PP-STR-LIB-005 (POO-638)
 * @name fetchStrategiesV2 tests
 * @implements-rules-version v1
 *
 * Server-side reads of the v2 strategy endpoints via apiFetch(apiVersion:"v2"): a single strategy by
 * id (fresh, no cache — the convergence poll must observe the latest indexed block) and the paginated
 * list. A per-id 404 -> null.
 *
 * POO-778/POO-776: `fetchStrategyV2ById` shape-routes the request. `GET /api/v2/strategies/:id` is
 * UUID-only (`ParseUUIDPipe`, 400s a positionId); a chain-bound positionId (`0x` + 64 hex) resolves via
 * the dedicated case-insensitive `GET /api/v2/strategies/by-position/:positionId`. Both return the same
 * `{data: StrategyV2}` envelope, so parsing and 404->null are identical on either route.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

async function importFetch() {
  vi.resetModules();
  return import("./fetchStrategiesV2");
}

describe("fetchStrategyV2ById", () => {
  beforeEach(() => apiFetch.mockReset());

  // A canonical UUID (owned/pending row) and a chain-bound positionId (0x + 64 hex).
  const UUID = "9f8b9430-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  const POSITION_ID = "0x691593cfc196dd25215d944080863f0b55ca8cbaa2b8a07595febca7897753f3";

  it("reads GET /api/v2/strategies/:id (v2 prefix, no cache) and returns the parsed row", async () => {
    apiFetch.mockResolvedValueOnce({
      id: "0xabc",
      onchain: { refreshedAt: "t", blockNumber: "215000042" },
    });

    const { fetchStrategyV2ById } = await importFetch();
    const strategy = await fetchStrategyV2ById("0xabc");

    expect(apiFetch).toHaveBeenCalledWith("strategies/0xabc", {
      schema: expect.anything(),
      apiVersion: "v2",
    });
    // The live contract serializes blockNumber as a STRING.
    expect(strategy?.onchain?.blockNumber).toBe("215000042");
  });

  // @rule R1 (POO-778/POO-776): an owned UUID routes to the UUID-only `/:id` (ParseUUIDPipe).
  it("[POO-778] routes a UUID to GET /api/v2/strategies/:id", async () => {
    apiFetch.mockResolvedValueOnce({ id: UUID, onchain: { refreshedAt: "t", blockNumber: "1" } });
    const { fetchStrategyV2ById } = await importFetch();
    await fetchStrategyV2ById(UUID);
    expect(apiFetch).toHaveBeenCalledWith(`strategies/${UUID}`, {
      schema: expect.anything(),
      apiVersion: "v2",
    });
  });

  // @rule R1 (POO-778/POO-776): a chain-bound positionId (0x + 64 hex) routes to the dedicated
  // case-insensitive by-position route (the `/:id` route is UUID-only and would 400/404 it).
  it("[POO-778] routes a chain-bound positionId to GET /api/v2/strategies/by-position/:positionId", async () => {
    apiFetch.mockResolvedValueOnce({
      id: POSITION_ID,
      onchain: { refreshedAt: "t", blockNumber: "1" },
    });
    const { fetchStrategyV2ById } = await importFetch();
    await fetchStrategyV2ById(POSITION_ID);
    expect(apiFetch).toHaveBeenCalledWith(`strategies/by-position/${POSITION_ID}`, {
      schema: expect.anything(),
      apiVersion: "v2",
    });
  });

  // Case-insensitivity is a backend property (PR #79); the FE forwards the id verbatim on the same
  // by-position route regardless of hex case.
  it("[POO-778] forwards a mixed-case positionId verbatim on the by-position route", async () => {
    const mixedCase = `0x${"A".repeat(40)}${"b".repeat(24)}`; // 0x + 64 hex, mixed case
    apiFetch.mockResolvedValueOnce({
      id: mixedCase,
      onchain: { refreshedAt: "t", blockNumber: "1" },
    });
    const { fetchStrategyV2ById } = await importFetch();
    await fetchStrategyV2ById(mixedCase);
    expect(apiFetch).toHaveBeenCalledWith(
      `strategies/by-position/${mixedCase}`,
      expect.objectContaining({ apiVersion: "v2" }),
    );
  });

  // Security guard (review, POO-778): the non-positionId fallback must percent-encode the id before
  // interpolating it into the `/api/v2/**` path, so a crafted traversal deep link cannot reshape the
  // x-api-key-bearing request to another endpoint. A `../`-bearing id must reach apiFetch with `%2F`
  // (an opaque unknown segment, so backend 404 -> null, the intended R3 behavior), never a literal `/`.
  it("[POO-778 security] percent-encodes a traversal id into an opaque path segment", async () => {
    apiFetch.mockResolvedValueOnce({ id: "x", onchain: { refreshedAt: "t", blockNumber: "1" } });
    const { fetchStrategyV2ById } = await importFetch();
    await fetchStrategyV2ById("../users/0xVICTIM");

    // The `/` in the id becomes `%2F`: no literal slash escapes the fixed `strategies/` segment.
    expect(apiFetch).toHaveBeenCalledWith("strategies/..%2Fusers%2F0xVICTIM", {
      schema: expect.anything(),
      apiVersion: "v2",
    });
    const calledPath = String(apiFetch.mock.calls[0]?.[0] ?? "");
    expect(calledPath).toContain("%2F");
    // The only literal `/` is the fixed `strategies/` prefix, the id contributes none.
    expect(calledPath.slice("strategies/".length)).not.toContain("/");
  });

  it("returns null on a 404 (unknown strategy)", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "no strategy"));
    const { fetchStrategyV2ById } = await importFetch();
    expect(await fetchStrategyV2ById(UUID)).toBeNull();
  });

  // @rule R3: a valid-shape but unknown positionId 404s on the by-position route -> null.
  it("[POO-778 R3] returns null on a 404 for an unknown positionId (by-position route)", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "no strategy"));
    const { fetchStrategyV2ById } = await importFetch();
    expect(await fetchStrategyV2ById(POSITION_ID)).toBeNull();
    expect(apiFetch).toHaveBeenCalledWith(
      `strategies/by-position/${POSITION_ID}`,
      expect.objectContaining({ apiVersion: "v2" }),
    );
  });

  it("propagates a non-404 error", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(500, "SYSTEM_INTERNAL", "boom"));
    const { fetchStrategyV2ById } = await importFetch();
    await expect(fetchStrategyV2ById(UUID)).rejects.toBeInstanceOf(ApiError);
  });
});

describe("fetchStrategiesV2", () => {
  beforeEach(() => apiFetch.mockReset());

  it("reads GET /api/v2/strategies with page/limit and returns the `strategies`-keyed page", async () => {
    apiFetch.mockResolvedValueOnce({
      strategies: [{ id: "0xabc", onchain: { blockNumber: "10", refreshedAt: "t" } }],
      totalItems: 1,
    });

    const { fetchStrategiesV2 } = await importFetch();
    const page = await fetchStrategiesV2({ page: 2, limit: 20 });

    expect(apiFetch).toHaveBeenCalledWith(
      "strategies?page=2&limit=20",
      expect.objectContaining({ apiVersion: "v2", schema: expect.anything() }),
    );
    expect(page?.strategies).toHaveLength(1);
    expect(page?.totalItems).toBe(1);
  });

  it("appends the paging/filter/sort params, omitting the ones not given", async () => {
    apiFetch.mockResolvedValueOnce({ strategies: [], totalItems: 0 });
    const { fetchStrategiesV2 } = await importFetch();
    await fetchStrategiesV2({
      page: 0,
      limit: 12,
      riskProfile: "steady",
      search: "eth",
      sorting: "feesApr:desc",
    });
    expect(apiFetch).toHaveBeenCalledWith(
      "strategies?page=0&limit=12&riskProfile=steady&search=eth&sorting=feesApr%3Adesc",
      expect.objectContaining({ apiVersion: "v2", schema: expect.anything() }),
    );
  });

  it("omits query params when none are given", async () => {
    apiFetch.mockResolvedValueOnce({ strategies: [], totalItems: 0 });
    const { fetchStrategiesV2 } = await importFetch();
    await fetchStrategiesV2();
    expect(apiFetch).toHaveBeenCalledWith(
      "strategies",
      expect.objectContaining({ apiVersion: "v2", schema: expect.anything() }),
    );
  });

  it("[POO-667] appends lifecycle=live for the discovery filter", async () => {
    apiFetch.mockResolvedValueOnce({ strategies: [], totalItems: 0 });
    const { fetchStrategiesV2 } = await importFetch();
    await fetchStrategiesV2({ page: 0, limit: 5, lifecycle: "live" });
    expect(apiFetch).toHaveBeenCalledWith(
      "strategies?page=0&limit=5&lifecycle=live",
      expect.objectContaining({ apiVersion: "v2", schema: expect.anything() }),
    );
  });

  // @rule R4 (POO-779): the managerWallet filter narrows the list to one manager's strategies, the
  // server-side primitive backing the manager-console list (POO-777). No lifecycle coupling, so it
  // returns the manager's closed strategies too.
  it("[POO-779 R4] appends managerWallet without an implied lifecycle", async () => {
    apiFetch.mockResolvedValueOnce({ strategies: [], totalItems: 0 });
    const { fetchStrategiesV2 } = await importFetch();
    await fetchStrategiesV2({ page: 0, limit: 100, managerWallet: "0xManagerWallet" });
    expect(apiFetch).toHaveBeenCalledWith(
      "strategies?page=0&limit=100&managerWallet=0xManagerWallet",
      expect.objectContaining({ apiVersion: "v2", schema: expect.anything() }),
    );
  });
});
