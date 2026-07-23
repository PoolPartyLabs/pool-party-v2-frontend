/**
 * @id PP-CORE-LIB-033 (POO-580, POO-233)
 * @name media upload write contract
 * @implements-rules-version v1
 *
 * The request payload + response contract for the deployed pool-party-api media mint
 * (`POST /api/v1/media/upload-url`, POO-580 rules-v1). POO-707 [R1] moved the mint's authorization
 * from the POO-637 signed-write guard to the SIWE SessionTokenGuard (the JWT), so an upload needs NO
 * per-upload wallet signature; the S3 key namespace is scoped to the session wallet. The endpoint
 * mints a short-lived presigned S3 POST plus a trusted CDN `publicUrl`; it never holds the bytes (the
 * browser uploads straight to S3) and never persists the URL (the caller's existing profile / strategy
 * write does). This module holds the wire types + response Zod so the `"use server"` action stays a
 * pure async-only module (Next forbids non-function runtime exports there).
 *
 * The allow-lists MIRROR pool-party-api `src/media/media.constants.ts` byte-for-byte (asset kinds,
 * content types, the 10 MiB ceiling) — any drift makes the DTO reject the body.
 *
 * PP-INTEGRATION-POINT (POO-580): request body + response shape of `POST /api/v1/media/upload-url`.
 */
import { z } from "zod";

/** [R2] Asset kinds the backend hosts. `avatar`/`banner` belong to a manager; `logo` to a strategy. */
export const MEDIA_ASSET_TYPES = ["avatar", "banner", "logo"] as const;
export type MediaAssetType = (typeof MEDIA_ASSET_TYPES)[number];

/** [R2] Allowed image MIME types (allow-listed in the DTO and re-bound as an S3 presign condition). */
export const MEDIA_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type MediaContentType = (typeof MEDIA_CONTENT_TYPES)[number];

/** The mint request body. `strategyId` is required only for `assetType: "logo"` (ownership-checked). */
export interface MintUploadUrlBody {
  /** The asset kind to mint an upload for. */
  assetType: MediaAssetType;
  /** MIME type of the file to upload (allow-listed). */
  contentType: MediaContentType;
  /** Owned strategy the logo belongs to; only for `assetType: "logo"`. */
  strategyId?: string;
}

/**
 * The mint response (pool-party-api `MintUploadUrlResponseDto`, [R8]): a presigned S3 POST the browser
 * submits the bytes to (`uploadUrl` + `fields`, multipart/form-data) plus the trusted `publicUrl` the
 * caller persists once the upload succeeds. Only the fields the FE consumes are pinned strictly; the
 * rest are validated loosely so a richer echo never fails the parse.
 */
export const mintUploadUrlResponseSchema = z.object({
  /** Presigned S3 endpoint the client POSTs the file to. */
  uploadUrl: z.string().url(),
  /** Form fields (policy + signature) the client must send with the multipart POST, `file` appended last. */
  fields: z.record(z.string(), z.string()),
  /** HTTP method for the upload. */
  method: z.literal("POST"),
  /** Stable S3 object key for this (owner, assetType). */
  key: z.string(),
  /** Trusted CDN URL to persist once the upload succeeds (cache-busted per mint). */
  publicUrl: z.string().url(),
  /** Max bytes S3 will accept for this upload. */
  maxSizeBytes: z.number(),
  /** Seconds until the presigned upload expires. */
  expiresIn: z.number(),
});

/** The parsed mint response. */
export type MintUploadUrlResponse = z.infer<typeof mintUploadUrlResponseSchema>;
