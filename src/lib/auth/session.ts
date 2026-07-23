/**
 * @id PP-AUTH (POO-270)
 * @name Server session
 * @implements-rules-version v1
 *
 * Server-trusted wallet identity. After the SIWE handshake, pool-party-api mints an access
 * token (a JWT whose payload carries the wallet `address`) which we store in an httpOnly
 * cookie. Server Actions read it here to derive the wallet server-side instead of trusting a
 * client-supplied address, and to forward the token as a Bearer to the API.
 *
 * The token signature is verified by pool-party-api (its secret); this module only DECODES
 * the payload to read the `address` claim — it does not, and cannot, verify the signature.
 *
 * PP-INTEGRATION-POINT: identity ← pool-party-api SIWE access token (POO-270).
 */
import "server-only";

import { cookies } from "next/headers";

/** Name of the httpOnly cookie holding the pool-party-api access token. */
export const ACCESS_TOKEN_COOKIE = "pp_access_token";

interface AccessTokenPayload {
  address?: string;
  exp?: number;
}

/**
 * Decode a JWT payload (base64url) WITHOUT verifying the signature. Returns null when the
 * token is malformed. Signature verification is the API's responsibility.
 */
export function decodeAccessToken(token: string): AccessTokenPayload | null {
  const parts = token.split(".");
  const payloadPart = parts[1];
  if (parts.length !== 3 || !payloadPart) return null;
  try {
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as AccessTokenPayload) : null;
  } catch {
    return null;
  }
}

/** Pure: the wallet address a token vouches for, or null when missing/expired/malformed. */
export function walletFromToken(token: string | null): `0x${string}` | null {
  if (!token) return null;
  const payload = decodeAccessToken(token);
  if (!payload?.address) return null;
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
  return payload.address.toLowerCase() as `0x${string}`;
}

/** The raw session access token from the httpOnly cookie, or null. */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

/** The server-trusted wallet address for the current session, or null when not signed in. */
export async function getSessionWallet(): Promise<`0x${string}` | null> {
  return walletFromToken(await getSessionToken());
}

/** Authorization header to forward the session token as a Bearer, or `{}` when not signed in. */
export async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
