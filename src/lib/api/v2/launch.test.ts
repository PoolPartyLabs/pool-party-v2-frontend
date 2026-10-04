import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { launchFetch } from "./launch";

const fetchMock = vi.fn();
const schema = z.object({ protocolVersion: z.literal("v2"), value: z.string() });
describe("server-only launch transport [R8]", () => {
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
});
