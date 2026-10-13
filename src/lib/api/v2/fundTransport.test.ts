import { afterEach, describe, expect, it, vi } from "vitest";
import { reportStartSchema } from "./fundSchemas";
import { FundRequestError, fundRequest } from "./fundTransport";

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
  describe("POO-2262 report waits keep the API's stable code and retry hint", () => {
    const jobId = "6f1c1a52-5d55-4c4e-9a43-0f3ad1b9d9a1";
    function refuse(status: number, body: unknown, headers: Record<string, string> = {}) {
      vi.stubEnv("PP_API_URL", "https://api.example");
      vi.stubEnv("PP_API_KEY", "secret");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers })),
      );
      return fundRequest(`/funds/${core}/build`, reportStartSchema, {}).catch((error) => error);
    }
    it("surfaces SOLANA_REPORT_REFRESHING with jobId and retryAfterSeconds, never the message", async () => {
      const error = await refuse(409, {
        statusCode: 409,
        code: "SOLANA_REPORT_REFRESHING",
        message: "Solana report expires before landing: rpc https://secret.example",
        response: { jobId, retryAfterSeconds: 15, message: "upstream detail" },
        error: { code: "SOLANA_REPORT_REFRESHING", message: "x", correlationId: "c" },
      });
      expect(error).toBeInstanceOf(FundRequestError);
      expect(error).toMatchObject({
        status: 409,
        code: "SOLANA_REPORT_REFRESHING",
        message: "fund operation failed",
        detail: { retryAfterSeconds: 15, jobId },
      });
      expect(JSON.stringify(error.detail)).not.toContain("secret");
    });
    it("prefers the report wait over the simulation revert name, and drops a non-uuid jobId", async () => {
      const error = await refuse(409, {
        code: "SPOKE_REPORT_STALE",
        response: {
          error: "StaleSpokeReport",
          spokeIndex: 0,
          chainId: "4663",
          jobId: "not-a-job",
          retryAfterSeconds: 60,
        },
      });
      expect(error).toMatchObject({
        code: "SPOKE_REPORT_STALE",
        detail: { retryAfterSeconds: 60 },
      });
      expect(error.detail.jobId).toBeUndefined();
    });
    it("keeps contract revert names, allow-lists stable codes and reads Retry-After", async () => {
      expect(
        await refuse(400, { code: "BAD_REQUEST", response: { error: "FundNotOpen" } }),
      ).toMatchObject({ code: "FundNotOpen" });
      expect(
        await refuse(429, { code: "SYSTEM_RATE_LIMITED" }, { "retry-after": "12" }),
      ).toMatchObject({
        code: "SYSTEM_RATE_LIMITED",
        detail: { retryAfterSeconds: 12 },
      });
      expect(await refuse(400, { code: "lower case <script>", response: {} })).toMatchObject({
        code: "V2_INVALID_RESPONSE",
      });
      expect(await refuse(503, {})).toMatchObject({ code: "V2_UNAVAILABLE" });
    });
  });
});
