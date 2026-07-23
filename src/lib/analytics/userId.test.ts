/**
 * @id PP-CORE-LIB-010
 * @name userId.test
 * Behavior (POO-164): the module store holds/clears the pseudonymous id; `fetchAnalyticsUserId`
 * resolves the hash from the server seam and degrades to null on missing secret, HTTP errors,
 * malformed payloads and network failures (identified analytics is best-effort).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAnalyticsUserId, getAnalyticsUserId, setAnalyticsUserId } from "./userId";

const HASH = "a".repeat(64);

afterEach(() => {
  setAnalyticsUserId(null);
  vi.unstubAllGlobals();
});

describe("analytics user-id store", () => {
  it("holds and clears the id", () => {
    expect(getAnalyticsUserId()).toBeNull();
    setAnalyticsUserId(HASH);
    expect(getAnalyticsUserId()).toBe(HASH);
    setAnalyticsUserId(null);
    expect(getAnalyticsUserId()).toBeNull();
  });
});

describe("fetchAnalyticsUserId", () => {
  it("posts the address to the server seam and returns the hash", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ userId: HASH }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAnalyticsUserId(`0x${"1".repeat(40)}`)).resolves.toBe(HASH);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analytics/user-id",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null when the secret is unset server-side (userId: null)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: null }), { status: 200 })),
    );
    await expect(fetchAnalyticsUserId(`0x${"1".repeat(40)}`)).resolves.toBeNull();
  });

  it("returns null on HTTP errors, malformed payloads and network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 400 })));
    await expect(fetchAnalyticsUserId(`0x${"1".repeat(40)}`)).resolves.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ other: 1 }), { status: 200 })),
    );
    await expect(fetchAnalyticsUserId(`0x${"1".repeat(40)}`)).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchAnalyticsUserId(`0x${"1".repeat(40)}`)).resolves.toBeNull();
  });
});
