/**
 * @id PP-PROF-LIB-006 (POO-233 R4, POO-426, POO-232)
 * @name buildProfileWriteBody
 * @implements-rules-version v1
 *
 * Map the FE editable subset (`ProfilePatch`: name/displayName/email/country/phone/avatarUrl) to the
 * backend-supported `PATCH /users/me` body (POO-232 + POO-675 + POO-693). Each rule is explicit:
 *
 * - `name` -> `name` (POO-693: the PRIVATE comms-only field) and `displayName` -> `displayName` (the
 *   PUBLIC display name), each forwarded as-is including "" which is a valid clear the backend accepts.
 * - `email` -> `email`, forwarded whenever provided INCLUDING "" — the backend now treats a blank email
 *   as a clear-to-null (POO-652 [R4]: `@ValidateIf(v => v.email !== '') @IsEmail`), so a blank value is a
 *   real edit (clear the field), no longer omitted.
 * - `country` -> `country` (POO-675 column) and `phone` -> `phone` (POO-675 column), both forwarded
 *   whenever provided including "" (blank clears to null). No longer dropped.
 * - `avatarUrl` -> `avatarUrl`, but ONLY when it is an `https://` URL (POO-580): the backend's
 *   `@IsUrl({ protocols: ['https'] })` validator rejects anything else, and a failed upload leaves a
 *   `data:` preview we must never persist. A non-https / absent value is a no-op (omitted), never a 400.
 *
 * An `undefined` key means "not edited — leave the stored field untouched", so it is never sent.
 *
 * PP-INTEGRATION-POINT (POO-675): the `country`/`phone` columns + the relaxed blank-email/`''`-clear
 * validation are the paired pp-api change; the whitelist `ValidationPipe` still strips any other key.
 */
import type { ProfilePatch } from "@/lib/services";

/** The backend-supported PATCH body shape (POO-232 identity + POO-580 avatarUrl + POO-675 country/phone + POO-693 private name). */
export interface ProfileWriteBody {
  name?: string;
  displayName?: string;
  email?: string;
  country?: string;
  phone?: string;
  avatarUrl?: string;
}

/** Build the PATCH body from the editable patch, applying the documented field map. */
export function buildProfileWriteBody(patch: ProfilePatch): ProfileWriteBody {
  const body: ProfileWriteBody = {};
  // POO-693: the PRIVATE `name` and the PUBLIC `displayName` are now distinct backend fields, each
  // forwarded verbatim whenever edited (including "" — a valid clear the backend accepts).
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.displayName !== undefined) body.displayName = patch.displayName;
  // email/country/phone: forward whenever edited, including "" — a blank value clears the field to null
  // (POO-675). Omitted only when undefined (not edited).
  if (patch.email !== undefined) body.email = patch.email;
  if (patch.country !== undefined) body.country = patch.country;
  if (patch.phone !== undefined) body.phone = patch.phone;
  // Only send an https avatar URL (backend @IsUrl requires https); a failed-upload data: preview is dropped.
  if (patch.avatarUrl?.startsWith("https://")) {
    body.avatarUrl = patch.avatarUrl;
  }
  return body;
}
