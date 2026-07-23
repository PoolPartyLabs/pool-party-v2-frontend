/**
 * @id PP-MGR-LIB-012
 * @name managerVerificationSchema
 * @implements-rules-version v1
 *
 * POO-745: the client+server-safe contract for the manager account-verification REQUEST endpoint
 * (POO-744, `POST /api/v1/managers/me/verification/request`). No `server-only`/`use client` boundary,
 * so the `"use server"` action, the client hook AND the mock service can all share it.
 *
 * The response carries the one-time `code` — a SECRET the manager DMs to the Pool Party profile. It is
 * returned ONLY here (owner-proven via the signed write); it is NEVER on any public profile read (see
 * the POO-744 secret-exposure constraint). Idempotent on `pending`: re-requesting returns the SAME code.
 *
 * PP-INTEGRATION-POINT (POO-744): manager verification request ←
 * pool-party-api `POST /api/v1/managers/me/verification/request` (`@SignedWrite('manager.request-verification')`).
 */
import { z } from "zod";
import { managerVerificationStatusSchema } from "@/lib/schemas";

/** The signed-write action name the `@SignedWrite('manager.request-verification')` guard declares. */
export const MANAGER_REQUEST_VERIFICATION_ACTION = "manager.request-verification";

/**
 * Zod for the request-verification response (pp-api). `status` is the resulting lifecycle state
 * (`pending` after a first request or an idempotent re-request); `code` is the one-time DM code;
 * `message` is the server-authored instruction (the FE re-renders its own i18n copy, R4).
 */
export const managerVerificationRequestResponseSchema = z.object({
  /** Resulting verification status (`pending` on success). */
  status: managerVerificationStatusSchema,
  /** The one-time verification code to DM (secret; only ever on this authenticated response). */
  code: z.string(),
  /** Server-authored instruction message (the FE renders its own i18n copy instead). */
  message: z.string(),
});

/** The request-verification response (status + one-time code + message). */
export type VerificationRequestResult = z.infer<typeof managerVerificationRequestResponseSchema>;
