/**
 * @tests PP-MGR-LIB-100 (POO-2262)
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiParseError } from "../errors";
import { solanaFetch, stripProtocolVersion, V2SolanaApiError } from "./solanaFetch";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("PP_API_URL", "http://api.test/");
  vi.stubEnv("PP_API_KEY", "key");
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const ok = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "x-pool-party-protocol": "v2" },
  });

it("strips every protocolVersion tag before strict parsing", async () => {
  fetchMock.mockResolvedValue(
    ok({ protocolVersion: "v2", inner: { protocolVersion: "v2", a: 1 } }),
  );
  const data = await solanaFetch(
    "/funds/creation-options",
    "GET",
    z.object({ inner: z.object({ a: z.number() }).strict() }).strict(),
  );
  expect(data).toEqual({ inner: { a: 1 } });
  expect(fetchMock).toHaveBeenCalledWith(
    "http://api.test/api/v2/funds/creation-options",
    expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "key" }) }),
  );
  expect(stripProtocolVersion([{ protocolVersion: "v2", b: [{ protocolVersion: "v2" }] }])).toEqual(
    [{ b: [{}] }],
  );
});
it("keeps the API's stable code and retry hint, never its message", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        statusCode: 409,
        code: "SOLANA_REPORT_REFRESHING",
        message: "internal detail with a secret",
        response: { jobId: "0f8fad5b-d9cb-469f-a165-70867728950e", retryAfterSeconds: 30 },
      }),
      { status: 409 },
    ),
  );
  const failure = await solanaFetch(
    "/funds/0x1E45E497a734b3BcD67e514F0681F161EC78a718/build",
    "POST",
    z.unknown(),
    {},
  ).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(V2SolanaApiError);
  expect(failure).toMatchObject({
    status: 409,
    code: "SOLANA_REPORT_REFRESHING",
    detail: { retryAfterSeconds: 30, jobId: "0f8fad5b-d9cb-469f-a165-70867728950e" },
  });
  expect(JSON.stringify((failure as V2SolanaApiError).detail)).not.toContain("secret");
});
it("surfaces a decoded revert name and falls back for unknown or malformed codes", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ code: "BAD_REQUEST", response: { error: "InsufficientFreeIdle" } }),
      {
        status: 400,
      },
    ),
  );
  await expect(
    solanaFetch("/funds/0x1E45E497a734b3BcD67e514F0681F161EC78a718/build", "POST", z.unknown(), {}),
  ).rejects.toMatchObject({ code: "BAD_REQUEST", detail: { revert: "InsufficientFreeIdle" } });
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: "<script>" }), {
      status: 429,
      headers: { "retry-after": "7" },
    }),
  );
  await expect(solanaFetch("/funds/creation-options", "GET", z.unknown())).rejects.toMatchObject({
    code: "SYSTEM_RATE_LIMITED",
    detail: { retryAfterSeconds: 7 },
  });
});
it("refuses paths outside the Fund routes and responses without the v2 header", async () => {
  await expect(solanaFetch("/admin/keys", "GET", z.unknown())).rejects.toMatchObject({
    code: "V2_INVALID_PATH",
  });
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
  await expect(solanaFetch("/funds/creation-options", "GET", z.unknown())).rejects.toBeInstanceOf(
    ApiParseError,
  );
});
