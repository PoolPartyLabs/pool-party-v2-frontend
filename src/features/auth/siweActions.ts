/**
 * @id PP-AUTH (POO-270)
 * @name SIWE server actions
 * @implements-rules-version v1
 *
 * Server Actions for the SIWE handshake with pool-party-api. The browser drives these but
 * the API calls run server-side (apiFetch injects x-api-key); the minted access token is
 * stored in an httpOnly cookie the browser cannot read. The wallet address it vouches for is
 * derived server-side from the token afterwards (see lib/auth/session).
 *
 * PP-INTEGRATION-POINT: SIWE nonce/sign-in ← pool-party-api /auth (POO-270).
 */
"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { ACCESS_TOKEN_COOKIE, getSessionWallet } from "@/lib/auth/session";

const nonceSchema = z.object({ nonce: z.string() });
const signInSchema = z.object({ accessToken: z.string() });

/**
 * The wallet of the current session (from the httpOnly cookie), or null when there is none / it has
 * expired. Lets the client reuse a cached session instead of re-signing on every page load (POO-270).
 */
export async function getSessionAction(): Promise<`0x${string}` | null> {
  return getSessionWallet();
}

/** Request a fresh nonce for the wallet to sign. */
export async function getNonceAction(wallet: string): Promise<string> {
  const result = await apiFetch("auth/nonce", {
    method: "POST",
    body: { wallet },
    schema: nonceSchema,
  });
  return result?.nonce ?? "";
}

/** Input for {@link signInAction}: the signed SIWE proof. */
export interface SignInInput {
  wallet: string;
  signature: string;
  nonce: string;
  network: string;
  /**
   * The full EIP-4361 message that was signed. Sent only on the EIP-4361 path (POO-376) so the
   * backend verifies it verbatim; omitted on the legacy path, where the backend reconstructs the
   * branded string from `wallet` + `nonce`.
   *
   * PP-INTEGRATION-POINT (POO-376): backend must verify this message against its own known domain,
   * check chainId/expiry, and burn the single-use nonce (companion pool-party-api issue).
   */
  message?: string;
}

/**
 * Complete the handshake: post the signed proof to pool-party-api and persist the returned
 * access token in an httpOnly cookie. Returns whether sign-in succeeded.
 */
export async function signInAction(input: SignInInput): Promise<boolean> {
  const result = await apiFetch("auth/sign-in", {
    method: "POST",
    body: input,
    schema: signInSchema,
  });
  if (!result?.accessToken) return false;

  const store = await cookies();
  store.set(ACCESS_TOKEN_COOKIE, result.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    // PP-SECURITY (POO-352): Secure on every deployed env (any non-local build), not only when
    // NODE_ENV === "production"; only true local `next dev` over http opts out.
    secure: process.env.NODE_ENV !== "development",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return true;
}

/** Clear the session (used on logout). */
export async function signOutAction(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_TOKEN_COOKIE);
}
