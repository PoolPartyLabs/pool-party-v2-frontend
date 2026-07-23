/**
 * @id PP-CORE-LIB-026
 * @name validateImageFile
 * @implements-rules-version POO-586 v1
 *
 * POO-586: the single, pure client-side guard every image-upload entry point runs before it opens
 * the crop flow (ManagerProfileTabView banner + photo, create-strategy ReviewStep logo,
 * PersonalInfoScreen avatar). Centralizing it (R4) means the type/size rule cannot drift between
 * surfaces.
 *
 * - R1: PNG and JPG only. The `accept` attribute is a hint the OS can bypass, so the pick handler
 *   re-checks the reported MIME type against {@link ACCEPTED_IMAGE_TYPES}.
 * - R2: at most 10 MB ({@link MAX_IMAGE_BYTES}). Exactly 10 MB is allowed; the boundary is inclusive.
 *
 * PP-SECURITY: type is checked BEFORE size so a disallowed format (e.g. SVG, an XSS vector) is
 * always reported as a type problem, never masked by a size failure. This is UX-level validation
 * only; authoritative type/size limits live server-side with image hosting (POO-580).
 */

/** R2: the maximum accepted image size, 10 MB in bytes. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** R1: the only accepted image MIME types (PNG + JPG). */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;

/** R1: the value for every crop-feeding `<input type="file" accept=...>`. */
export const IMAGE_ACCEPT_ATTR = "image/png,image/jpeg";

/** The reason a file was rejected: wrong type (R1) or too large (R2). */
export type ImageRejectReason = "type" | "size";

/** The result of {@link validateImageFile}: accepted, or rejected with a reason. */
export type ImageValidationResult = { ok: true } | { ok: false; reason: ImageRejectReason };

/**
 * Validate a picked file against the upload rules. Type (R1) is checked before size (R2), so a
 * wrong-type file that is also oversized is reported as `"type"`.
 */
export function validateImageFile(file: File): ImageValidationResult {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: "type" };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "size" };
  }
  return { ok: true };
}
