/**
 * @id PP-CORE-HOOK-005 (POO-580, POO-233, POO-637, POO-694, POO-707)
 * @name useUploadMedia
 * @implements-rules-version v1
 *
 * Real-mode client hook that uploads a cropped image asset (an investor/manager `avatar`, a manager
 * `banner`, or a strategy `logo`) and resolves its trusted CDN URL. It mints a presigned S3 POST via
 * `mintUploadUrlAction` (POO-580), uploads the bytes straight to S3 from the browser (the API never
 * holds them), and returns the mint's `publicUrl` for the caller to stage into its entity write
 * (`PATCH /users/me` avatarUrl, `PATCH /managers/me` avatarUrl/bannerUrl, ...).
 *
 * POO-707 [R2]: the mint is authorized by the SIWE SESSION (the `pp_access_token` JWT forwarded
 * server-side by `mintUploadUrlAction`), NOT a per-upload wallet signature — so an upload needs ZERO
 * wallet signature. That is what makes a full profile edit cost ONE signature (the deferred PATCH) and
 * the strategy create cost ONE signature (the seed): the on-crop logo upload (`useUploadMedia("logo")`,
 * POO-701, consumed by the strategy builder) is now signature-free with no change to this hook's public
 * interface.
 *
 * `assetType` is the ONLY axis that varies across callers, so it is a parameter: `useUploadMedia(kind)`
 * returns a `(blob) => Promise<publicUrl>` bound to that kind. The concrete investor-avatar hook
 * ({@link useUploadAvatar}), the manager avatar/banner uploaders (POO-694, injected by the
 * manager-console data loader) and the strategy-builder logo (POO-701) are all thin
 * `useUploadMedia(<kind>)` calls, so the mint→S3→publicUrl mechanics live in exactly one place.
 *
 * A mint / upload failure (e.g. 503 MEDIA_NOT_CONFIGURED, 401 unauthenticated, an S3 error) rejects so
 * the caller keeps the local preview and surfaces the failure rather than persisting a broken URL.
 */
"use client";

import {
  MEDIA_CONTENT_TYPES,
  type MediaAssetType,
  type MediaContentType,
  type MintUploadUrlBody,
  type MintUploadUrlResponse,
} from "@/lib/media/mediaUploadSchema";
import { mintUploadUrlAction } from "@/lib/media/mintUploadUrlAction";

/** Uploads a cropped image Blob and resolves its trusted CDN `publicUrl`. */
export type MediaUploadFn = (blob: Blob) => Promise<string>;

/** The crop export is a PNG; fall back to it when a blob reports an unexpected/blank type. */
const DEFAULT_CONTENT_TYPE: MediaContentType = "image/png";

/** Resolve the allow-listed content type from the blob, defaulting to PNG (the crop export format). */
function resolveContentType(blob: Blob): MediaContentType {
  return (MEDIA_CONTENT_TYPES as readonly string[]).includes(blob.type)
    ? (blob.type as MediaContentType)
    : DEFAULT_CONTENT_TYPE;
}

/**
 * Upload the bytes to S3 with the minted presigned POST. S3 requires every policy field FIRST and the
 * binary `file` field LAST, so the fields are appended before the blob. Throws on a non-2xx S3 response.
 */
async function uploadToPresignedPost(mint: MintUploadUrlResponse, blob: Blob): Promise<void> {
  const form = new FormData();
  for (const [name, value] of Object.entries(mint.fields)) form.append(name, value);
  form.append("file", blob);
  // PP-INTEGRATION-POINT (POO-580): the browser uploads bytes straight to S3 (never through pool-party-api).
  const response = await fetch(mint.uploadUrl, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`useUploadMedia: S3 upload failed with ${response.status}`);
  }
}

/**
 * The media-upload function for a given `assetType`. Mints (session-authorized, no wallet signature),
 * uploads to S3, and resolves the trusted CDN URL. `strategyId` is forwarded for `assetType: "logo"`
 * (ownership-checked server-side).
 */
export function useUploadMedia(assetType: MediaAssetType, strategyId?: string): MediaUploadFn {
  return async (blob) => {
    const body: MintUploadUrlBody = {
      assetType,
      contentType: resolveContentType(blob),
      ...(strategyId ? { strategyId } : {}),
    };
    const mint = await mintUploadUrlAction(body);
    await uploadToPresignedPost(mint, blob);
    return mint.publicUrl;
  };
}
