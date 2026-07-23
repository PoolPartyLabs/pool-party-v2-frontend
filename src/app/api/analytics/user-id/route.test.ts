/**
 * @id PP-CORE-LIB-010
 * @name analytics user-id endpoint.test
 * Behavior (POO-164): valid address + secret → 64-hex HMAC user id (stable per address, never the
 * raw address); secret unset → `{ userId: null }` without crashing; invalid/malformed/oversized
 * bodies are rejected.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function request(body: string): NextRequest {
  return new NextRequest("http://localhost/api/analytics/user-id", { method: "POST", body });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/analytics/user-id", () => {
  it("returns a stable 64-hex hash that is not the raw address when the secret is set", async () => {
    vi.stubEnv("PP_ANALYTICS_USER_ID_SECRET", "test-secret-at-least-32-bytes-long!!");
    const first = await POST(request(JSON.stringify({ address: ADDRESS })));
    const second = await POST(request(JSON.stringify({ address: ADDRESS })));
    expect(first.status).toBe(200);
    const { userId } = (await first.json()) as { userId: string };
    expect(userId).toMatch(/^[0-9a-f]{64}$/);
    expect(userId).not.toContain(ADDRESS.slice(2));
    expect(((await second.json()) as { userId: string }).userId).toBe(userId);
  });

  it("degrades to userId null when the secret is unset (no crash)", async () => {
    vi.stubEnv("PP_ANALYTICS_USER_ID_SECRET", undefined);
    const response = await POST(request(JSON.stringify({ address: ADDRESS })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: null });
  });

  it("rejects invalid addresses, malformed JSON and oversized bodies", async () => {
    vi.stubEnv("PP_ANALYTICS_USER_ID_SECRET", "test-secret-at-least-32-bytes-long!!");
    expect((await POST(request(JSON.stringify({ address: "not-an-address" })))).status).toBe(400);
    expect((await POST(request(JSON.stringify({ address: `${ADDRESS}ff` })))).status).toBe(400);
    expect((await POST(request("{not json"))).status).toBe(400);
    expect((await POST(request(`{"address":"${"x".repeat(2000)}"}`))).status).toBe(413);
  });

  // POO-352: block cross-site browser abuse of the hash oracle via Sec-Fetch-Site.
  it("rejects a cross-site request (403) but allows same-origin and header-less callers", async () => {
    vi.stubEnv("PP_ANALYTICS_USER_ID_SECRET", "test-secret-at-least-32-bytes-long!!");
    const withSite = (site: string) =>
      new NextRequest("http://localhost/api/analytics/user-id", {
        method: "POST",
        body: JSON.stringify({ address: ADDRESS }),
        headers: { "sec-fetch-site": site },
      });
    expect((await POST(withSite("cross-site"))).status).toBe(403);
    expect((await POST(withSite("same-site"))).status).toBe(403);
    expect((await POST(withSite("same-origin"))).status).toBe(200);
    // No Sec-Fetch-Site header (non-browser/legacy) falls through to normal handling.
    expect((await POST(request(JSON.stringify({ address: ADDRESS })))).status).toBe(200);
  });
});
