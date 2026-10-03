/**
 * @id PP-CORE-LIB-112 (POO-2133)
 * @name v2ApiClientTests
 * @implements-rules-version v1
 * Protocol boundary and sanitized upstream error regressions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, ApiParseError } from "../errors";
import { v2Fetch } from "./client";

const schema = z.object({ protocolVersion: z.literal("v2"), value: z.string() });
const fetchMock = vi.fn();
const reply = (data: unknown, status = 200, version = "v2") =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "x-pool-party-protocol": version, "content-type": "application/json" },
  });

describe("v2Fetch", () => {
  beforeEach(() => {
    vi.stubEnv("PP_API_URL", "https://api.example.test");
    vi.stubEnv("PP_API_KEY", "server-secret");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  // @rule R1
  it("unwraps validated v2 data with the server key and no cached stale reads", async () => {
    fetchMock.mockResolvedValue(reply({ data: { protocolVersion: "v2", value: "catalog" } }));
    await expect(v2Fetch("/catalog/tokens?chainId=42161", schema)).resolves.toEqual({
      protocolVersion: "v2",
      value: "catalog",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/v2/catalog/tokens?chainId=42161",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ "x-api-key": "server-secret" }),
      }),
    );
  });

  // @rule R1
  it.each([
    [{ data: { protocolVersion: "v1", value: "old" } }, "v2"],
    [{ data: { protocolVersion: "v2", value: "old" } }, "v1"],
    [{ data: { value: "untagged" } }, "v2"],
    [{ data: { protocolVersion: "v2", value: 42 } }, "v2"],
    [{ data: { protocolVersion: "v2", value: "ok", nested: { protocolVersion: "v1" } } }, "v2"],
  ])("rejects legacy, untagged and malformed payloads", async (body, header) => {
    fetchMock.mockResolvedValue(reply(body, 200, header));
    await expect(v2Fetch("/catalog/tokens", schema)).rejects.toBeInstanceOf(ApiParseError);
  });

  // @rule R2
  it.each([
    [400, { response: { error: "TooManyTokens" } }, "TooManyTokens"],
    [404, { message: "not found" }, "V2_NOT_FOUND"],
    [409, { response: { code: "FUND_LIMIT_EXCEEDED" } }, "FUND_LIMIT_EXCEEDED"],
    [409, { response: { deferred: true } }, "V2_DEFERRED"],
    [503, { message: "v2 alpha disabled" }, "V2_UNAVAILABLE"],
  ])("maps status %s into the app error model", async (status, body, code) => {
    fetchMock.mockResolvedValue(reply(body, status));
    await expect(v2Fetch("/funds", schema)).rejects.toMatchObject({ status, code });
  });

  // @rule R2
  it("sanitizes transport failures and never calls the API without configuration", async () => {
    fetchMock.mockRejectedValue(new Error("private RPC URL and server-secret"));
    await expect(v2Fetch("/funds", schema)).rejects.toMatchObject({
      status: 0,
      message: "v2 API unavailable",
    });
    vi.stubEnv("PP_API_KEY", "");
    await expect(v2Fetch("/funds", schema)).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
