import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { launchFetch } from "./launch";

const fetchMock = vi.fn();
const schema = z.object({ protocolVersion: z.literal("v2"), value: z.string() });
describe("server-only launch transport [R8]", () => {
  it.each([409, 425])("waits two seconds for uncoded HTTP%s without metadata", async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status }));
    await expect(launchFetch("/funds", "GET", schema)).rejects.toMatchObject({
      code: "V2_DISCOVERY_PENDING",
      retryAfterSeconds: 2,
    });
  });
  it("honors an HTTP-date Retry-After for a pending unavailable response", async () => {
    const retryDate = new Date(Math.ceil(Date.now() / 1000) * 1000 + 3000).toUTCString();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 503, headers: { "retry-after": retryDate } }),
    );
    await expect(launchFetch("/funds", "GET", schema)).rejects.toMatchObject({
      code: "V2_DISCOVERY_PENDING",
      retryAfterSeconds: expect.any(Number),
    });
  });
  it("honors numeric Retry-After metadata on a pending HTTP425", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 425, headers: { "retry-after": "2" } }),
    );
    await expect(launchFetch("/funds", "GET", schema)).rejects.toMatchObject({
      code: "V2_DISCOVERY_PENDING",
      retryAfterSeconds: 2,
    });
  });
  it("does not turn a real coded conflict into waiting merely because retry metadata exists", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "FUND_LIMIT_EXCEEDED", retryAfterSeconds: 2 }), {
        status: 409,
      }),
    );
    await expect(launchFetch("/funds", "GET", schema)).rejects.toMatchObject({
      code: "V2_CONFLICT",
    });
  });
  it.each([409, 425, 503])("preserves discovery retry metadata for HTTP %s", async (status) => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          response: {
            code: "V2_DISCOVERY_PENDING",
            retryAfterSeconds: 2,
            progress: { cursor: "10", target: "20" },
            message: "server-only",
          },
        }),
        { status },
      ),
    );
    await expect(launchFetch("/funds", "GET", schema)).rejects.toMatchObject({
      status,
      code: "V2_DISCOVERY_PENDING",
      retryAfterSeconds: 2,
      progress: { cursor: "10", target: "20" },
      message: "v2 request failed",
    });
  });
  it.each([
    409, 425, 503,
  ])("recognizes retry metadata without a typed code for HTTP %s", async (status) => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ retryAfterSeconds: 3 }), { status }),
    );
    await expect(launchFetch("/funds", "GET", schema)).rejects.toMatchObject({
      code: "V2_DISCOVERY_PENDING",
      retryAfterSeconds: 3,
    });
  });
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PP_API_URL", "https://api.test");
    vi.stubEnv("PP_API_KEY", "server-only");
    vi.stubEnv("PP_API_ADMIN_KEY", "admin-only");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("rejects arbitrary paths before fetching", async () => {
    await expect(launchFetch("/funds/../../secrets", "GET", schema)).rejects.toMatchObject({
      status: 400,
    });
  });
  it("fails closed without API or admin configuration", async () => {
    vi.stubEnv("PP_API_KEY", "");
    await expect(launchFetch("/funds", "GET", schema)).rejects.toMatchObject({ status: 503 });
    vi.stubEnv("PP_API_KEY", "present");
    vi.stubEnv("PP_API_ADMIN_KEY", "");
    await expect(
      launchFetch("/funds/core/report", "POST", schema, undefined, true),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("redacts transport failures, wrong protocol and malformed payloads", async () => {
    fetchMock.mockRejectedValueOnce(new Error("secret"));
    await expect(launchFetch("/funds", "GET", schema)).rejects.toMatchObject({
      message: "v2 unavailable",
    });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { value: "bad" } })));
    await expect(launchFetch("/funds", "GET", schema)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: {} }), { headers: { "x-pool-party-protocol": "v2" } }),
    );
    await expect(launchFetch("/funds", "GET", schema)).rejects.toThrow();
  });
  it.each([429, 409, 500])("sanitizes HTTP %s", async (status) => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "admin-only" }), { status }),
    );
    await expect(launchFetch("/funds", "GET", schema)).rejects.toMatchObject({
      status,
      message: "v2 request failed",
    });
  });
  it("preserves explicit deferred responses but not arbitrary 503 errors", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ response: { deferred: true, message: "secret" } }), {
        status: 503,
      }),
    );
    await expect(launchFetch("/funds/core", "GET", schema)).rejects.toMatchObject({
      status: 503,
      code: "V2_DEFERRED",
      message: "v2 request failed",
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "secret" }), { status: 503 }),
    );
    await expect(launchFetch("/funds/core", "GET", schema)).rejects.toMatchObject({
      status: 503,
      code: "V2_REQUEST_FAILED",
    });
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ deferred: true }), { status: 401 }),
    );
    await expect(launchFetch("/funds/core", "GET", schema)).rejects.toMatchObject({
      status: 401,
      code: "V2_REQUEST_FAILED",
    });
  });
});
