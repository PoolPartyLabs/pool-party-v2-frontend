/**
 * @id PP-PROF-HOOK-002 (POO-580, POO-233, POO-637, POO-694)
 * @name useUploadAvatar
 * @implements-rules-version v1
 *
 * The investor-avatar upload used by the real-mode `PersonalInfoDataLoader`. POO-694 generalized the
 * mint→S3→publicUrl mechanics into the shared, `assetType`-parameterized {@link useUploadMedia}; this is
 * now the thin `useUploadMedia("avatar")` binding, so the investor screen keeps its exact contract (a
 * `(blob) => Promise<publicUrl>` staged into `PATCH /users/me` avatarUrl) while the manager avatar/banner
 * uploaders reuse the same hook with `"avatar"` / `"banner"`. POO-707 [R2]: the mint is session-authorized
 * (the SIWE JWT), so an upload needs NO wallet signature.
 */
"use client";

import { type MediaUploadFn, useUploadMedia } from "@/lib/media/useUploadMedia";

/** Uploads a cropped avatar Blob and resolves its trusted CDN `publicUrl`. */
export type AvatarUploadFn = MediaUploadFn;

/** The investor-avatar upload function (real mode only). Mints (session-auth), uploads to S3, resolves the URL. */
export function useUploadAvatar(): AvatarUploadFn {
  return useUploadMedia("avatar");
}
