import { afterEach, describe, expect, it, vi } from "vitest";
import { reportStartSchema } from "./fundSchemas";
import { fundRequest } from "./fundTransport";

const core = `0x${"1".repeat(40)}`;
describe("fund transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("R7 preserves deferred and decoded errors without exposing upstream secrets", async () => {
    vi.stubEnv("PP_API_URL", "https://api.example");
    vi.stubEnv("PP_API_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ response: { deferred: true, message: "secret RPC" } }), {
          status: 409,
        }),
      ),
    );
    await expect(fundRequest(`/funds/${core}/build`, reportStartSchema, {})).rejects.toMatchObject({
      code: "V2_DEFERRED",
      status: 409,
      message: "fund operation failed",
    });
  });
  it("R6 privileged keys are server-only and successful reports are parsed", async () => {
    vi.stubEnv("PP_API_URL", "https://api.example");
    vi.stubEnv("PP_API_KEY", "public-secret");
    vi.stubEnv("PP_API_ADMIN_KEY", "admin-secret");
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { protocolVersion: "v2", jobId: "00000000-0000-4000-8000-000000000001" },
        }),
        { headers: { "x-pool-party-protocol": "v2" } },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await fundRequest(`/funds/${core}/report`, reportStartSchema, {}, true)).toEqual({
      protocolVersion: "v2",
      jobId: "00000000-0000-4000-8000-000000000001",
    });
    expect(fetcher.mock.calls[0]?.[1].headers["x-admin-key"]).toBe("admin-secret");
  });
});
