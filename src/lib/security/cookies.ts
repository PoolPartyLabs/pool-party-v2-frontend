/**
 * @id PP-CORE (SETUP-015 / POO-81)
 * @name secure cookie helpers
 * @implements-rules-version v1
 *
 * Hardened cookie helpers. Most auth tokens are managed by Privy; the cookies we own are
 * `pp_consent` (read client-side by the consent banner, so NOT HttpOnly) and the next-intl locale
 * cookie (managed by the framework). Source: `docs/10_SECURITY.md` section 3 + frontend-security.
 *
 * PP-INTEGRATION-POINT: when server-side sessions land (backend), set them with `setSecureCookie`
 * and add `Cache-Control: no-store` (NO_STORE) on authenticated responses.
 */
import type { NextResponse } from "next/server";

export interface SecureCookieOptions {
  /** Defaults to true. Set false only for cookies the client must read (e.g. consent). */
  httpOnly?: boolean;
  /** Defaults to "lax". Use "strict" for the most sensitive sessions. */
  sameSite?: "lax" | "strict";
}

/** Set a hardened cookie (HttpOnly + Secure + SameSite=Lax by default) on a response. */
export function setSecureCookie(
  response: NextResponse,
  name: string,
  value: string,
  options: SecureCookieOptions = {},
): void {
  response.cookies.set(name, value, {
    httpOnly: options.httpOnly ?? true,
    secure: true,
    sameSite: options.sameSite ?? "lax",
    path: "/",
  });
}

/** Consent cookie: read client-side by the banner, so Secure + SameSite but NOT HttpOnly. */
export function setConsentCookie(response: NextResponse, value: string): void {
  setSecureCookie(response, "pp_consent", value, { httpOnly: false });
}

/** `Cache-Control` value for authenticated responses so session data is never cached. */
export const NO_STORE = "no-store";
