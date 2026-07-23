/**
 * @id PP-ADM-AUTH-001
 * @name admin session
 * @implements-rules-version v1
 *
 * Server-trusted identity for the Admin Console, held in the httpOnly `pp_admin_session` cookie — a
 * DIFFERENT cookie from the investor `pp_access_token` (POO-144 R5). This module never reads or writes
 * the investor cookie, and is server-only. The cookie holds a JWT MINTED BY pool-party-api after Google
 * sign-in AND the 2FA challenge, mirroring the investor SIWE→JWT flow in `src/lib/auth/session.ts`: it
 * exists only after BOTH factors, so `twoFactorVerified` gates the console. Like the investor session,
 * this module only DECODES the payload to read the identity/role; pool-party-api verifies the signature
 * on every forwarded call. The admin frontend always goes through pool-party-api and NEVER touches the
 * database directly.
 *
 * PP-INTEGRATION-POINT: `pp_admin_session` ← pool-party-api admin auth (Google + TOTP), minted after
 * both factors. {@link resolveAdminSession}'s dev fallback (PP-MOCK) is removed once real issuance lands.
 */
import "server-only";

import { cookies } from "next/headers";
import { ADMIN_ROLES, type AdminRole } from "./rbac";

/** Name of the httpOnly cookie holding the admin session (distinct from `pp_access_token`). */
export const ADMIN_SESSION_COOKIE = "pp_admin_session";

/** The server-trusted admin identity for the current request. */
export interface AdminSession {
  userId: string;
  email: string;
  role: AdminRole;
  /** False until the TOTP challenge is passed; the console guard blocks access until true. */
  twoFactorVerified: boolean;
}

function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

/**
 * Decode a JWT payload segment (base64url) WITHOUT verifying the signature, mirroring the investor
 * {@link import("../auth/session").decodeAccessToken}. Returns null unless the token is exactly three
 * `.`-separated parts and `parts[1]` decodes to a JSON object. Signature verification is the API's job.
 */
function decodeJwtPayload(raw: string): Record<string, unknown> | null {
  const parts = raw.split(".");
  const payloadPart = parts.length === 3 ? parts[1] : undefined;
  if (!payloadPart) return null;
  try {
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Pure: decode the JWT payload segment of a raw cookie value and shape-validate it into an
 * {@link AdminSession}, or null when it is missing, not a three-part JWT, of the wrong shape/role, or
 * expired. The exact claim set is defined later by pool-party-api (format TBD); the API mints
 * `pp_admin_session` with HttpOnly + Secure + SameSite=Strict and verifies the signature. This only
 * reads the payload (as with the investor access token).
 */
export function parseAdminSession(raw: string | null | undefined): AdminSession | null {
  if (!raw) return null;
  const p = decodeJwtPayload(raw);
  if (!p) return null;
  try {
    if (typeof p.userId !== "string" || typeof p.email !== "string") return null;
    if (!isAdminRole(p.role)) return null;
    if (typeof p.twoFactorVerified !== "boolean") return null;
    if (typeof p.exp === "number" && p.exp * 1000 < Date.now()) return null;
    return {
      userId: p.userId,
      email: p.email,
      role: p.role,
      twoFactorVerified: p.twoFactorVerified,
    };
  } catch {
    return null;
  }
}

/** The current admin session read straight from the httpOnly cookie, or null when not signed in. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  return parseAdminSession(store.get(ADMIN_SESSION_COOKIE)?.value ?? null);
}

/**
 * The session the console layout guard acts on: a valid `pp_admin_session` cookie, or null.
 *
 * A dev escape hatch lets a developer work on the console before real Google + TOTP land, but it is
 * OFF by default and can NEVER be enabled in production or from the client: it requires the
 * server-only `ADMIN_DEV_MASTER=1` (not a `NEXT_PUBLIC_` var, so it is absent from the client bundle)
 * AND a non-production `NODE_ENV`. This deliberately does NOT key off `NEXT_PUBLIC_MOCK_MODE` — a
 * fail-open default on a high-control surface would let anyone become master (POO-591 security review).
 *
 * PP-MOCK + PP-INTEGRATION-POINT: delete the dev fallback once pool-party-api issues real sessions
 * (Google + TOTP).
 */
export async function resolveAdminSession(): Promise<AdminSession | null> {
  const real = await getAdminSession();
  if (real) return real;
  if (process.env.NODE_ENV !== "production" && process.env.ADMIN_DEV_MASTER === "1") {
    return {
      userId: "dev-master",
      email: "dev@pool-party.xyz",
      role: "master",
      twoFactorVerified: true,
    };
  }
  return null;
}
