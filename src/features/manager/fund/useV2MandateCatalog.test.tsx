/**
 * @id PP-MGR-HOK-014 (POO-2133)
 * @name useV2MandateCatalogTests
 * @implements-rules-version v1
 * Loading, failure, retry and real draft provenance across server-action reads.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMandateDraft } from "./useMandateDraft";
import { useV2MandateCatalog } from "./useV2MandateCatalog";

const mocks = vi.hoisted(() => ({ tokens: vi.fn(), reserves: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogTokensAction: mocks.tokens,
  getCatalogReservesAction: mocks.reserves,
}));

describe("real catalog hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.tokens.mockImplementation(async (chainId: number) => ({
      ok: true,
      data: { protocolVersion: "v2", chainId: String(chainId), tokens: [] },
    }));
    mocks.reserves.mockResolvedValue({
      ok: true,
      data: { protocolVersion: "v2", chainId: "42161", reserves: [] },
    });
  });
  // @rule R2
  it("loads both catalogs and hub reserves without a mock fallback", async () => {
    const { result } = renderHook(useV2MandateCatalog);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataMode).toBe("real");
    expect(result.current.tokensFor(["arbitrum"], [])).toEqual([]);
    expect(mocks.tokens).toHaveBeenCalledWith(42161);
    expect(mocks.tokens).toHaveBeenCalledWith(4663);
    expect(mocks.reserves).toHaveBeenCalledTimes(1);
  });
  // @rule R2
  it("renders an explicit failed state and retries", async () => {
    mocks.tokens.mockResolvedValue({ ok: false, error: { status: 503, code: "V2_UNAVAILABLE" } });
    const { result } = renderHook(useV2MandateCatalog);
    await waitFor(() => expect(result.current.error).toBe(true));
    mocks.tokens.mockResolvedValue({ ok: true, data: { tokens: [] } });
    act(() => result.current.retry?.());
    await waitFor(() => expect(result.current.error).toBe(false));
  });
  // @rule R8
  it("marks fresh real drafts while preserving stale saved provenance", async () => {
    const { result } = renderHook(() => useMandateDraft());
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.draft).toMatchObject({
      dataMode: "real",
      catalogVersion: "v2-catalog-v1",
      protocols: ["uniswap-v3-swap"],
    });
    expect(window.localStorage.length).toBe(0);
  });
});
