/**
 * @id PP-CORE-LIB-034 (POO-580, POO-233, POO-707)
 * @name mintUploadUrlAction tests
 * @implements-rules-version v1
 *
 * The `"use server"` bridge for the media mint. POO-707 [R2]: it authorizes the mint via the SIWE
 * SESSION — forwarding the `pp_access_token` Bearer the SAME way the session-guarded owner read
 * (`GET /users/me`) does, via `getAuthHeader` — with NO per-upload wallet signature, and validates the
 * presigned-POST response against the wire schema. Signed out (no Bearer) the request carries no
 * Authorization and pp-api returns 401. A 503 MEDIA_NOT_CONFIGURED (env unset) propagates as a typed
 * ApiError so the caller keeps the local preview and surfaces the failure.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { MintUploadUrlBody } from "./mediaUploadSchema";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), getAuthHeader: vi.fn() }));

vi.mock("@/lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/client")>();
  return { ...actual, apiFetch: mocks.apiFetch };
});

vi.mock("@/lib/auth/session", () => ({ getAuthHeader: mocks.getAuthHeader }));

import { mintUploadUrlAction } from "./mintUploadUrlAction";

const body: MintUploadUrlBody = { assetType: "avatar", contentType: "image/png" };

/** A well-formed presigned-POST mint response (mirrors MintUploadUrlResponseDto). */
const mintResponse = {
  uploadUrl: "https://s3.example.com/pool-party-media",
  fields: { key: "avatars/0xwallet.png", policy: "base64policy", "x-amz-signature": "sig" },
  method: "POST" as const,
  key: "avatars/0xwallet.png",
  publicUrl: "https://cdn.pool-party.xyz/avatars/0xwallet.png?v=1720000000000",
  maxSizeBytes: 10 * 1024 * 1024,
  expiresIn: 300,
};

describe("mintUploadUrlAction", () => {
  // Reset inline (not in a `beforeEach`): resetting in a separate lifecycle frame leaves the rejection
  // test's mocked ApiError flagged as an unhandled rejection under vitest v4. Same-tick reset avoids it.
  it("POSTs to media/upload-url with the body and the SIWE session Bearer (no signature)", async () => {
    mocks.apiFetch.mockReset();
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockResolvedValue({ Authorization: "Bearer jwt-session" });
    mocks.apiFetch.mockResolvedValue(mintResponse);

    await mintUploadUrlAction(body);

    const [path, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("media/upload-url");
    expect(options).toMatchObject({ method: "POST", body });
    // The mint is session-authorized: the ONLY header forwarded is the session Bearer — no signed-write
    // headers, no wallet signature.
    expect(options.headers).toEqual({ Authorization: "Bearer jwt-session" });
  });

  it("forwards no Authorization when signed out (pp-api then 401s)", async () => {
    mocks.apiFetch.mockReset();
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockResolvedValue({});
    mocks.apiFetch.mockResolvedValue(mintResponse);

    await mintUploadUrlAction(body);

    const [, options] = mocks.apiFetch.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.headers).toEqual({});
  });

  it("parses and returns the presigned-POST response", async () => {
    mocks.apiFetch.mockReset();
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockResolvedValue({ Authorization: "Bearer jwt-session" });
    mocks.apiFetch.mockResolvedValue(mintResponse);
    const result = await mintUploadUrlAction(body);
    expect(result.publicUrl).toBe(mintResponse.publicUrl);
    expect(result.uploadUrl).toBe(mintResponse.uploadUrl);
    expect(result.fields).toEqual(mintResponse.fields);
  });

  it("propagates a 503 MEDIA_NOT_CONFIGURED as a typed ApiError", async () => {
    mocks.apiFetch.mockReset();
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockResolvedValue({ Authorization: "Bearer jwt-session" });
    mocks.apiFetch.mockRejectedValue(
      new ApiError(503, "MEDIA_NOT_CONFIGURED", "media not configured"),
    );
    // The typed ApiError (status + code) reaches the caller so it can keep the local preview and
    // surface the failure — 503 is never swallowed into a spurious success.
    let caught: unknown;
    try {
      await mintUploadUrlAction(body);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect(caught).toMatchObject({ status: 503, code: "MEDIA_NOT_CONFIGURED" });
  });

  it("throws when the mint returns an empty response (no presigned POST)", async () => {
    mocks.apiFetch.mockReset();
    mocks.getAuthHeader.mockReset();
    mocks.getAuthHeader.mockResolvedValue({ Authorization: "Bearer jwt-session" });
    mocks.apiFetch.mockResolvedValue(null);
    await expect(mintUploadUrlAction(body)).rejects.toThrow(/empty response/);
  });
});
