/**
 * @id PP-CORE-LIB-010
 * @name hashWalletAddress
 * @implements-rules-version v1
 *
 * Derives a pseudonymous, stable analytics `user_id` from a wallet address using HMAC-SHA-256
 * keyed with a server-held secret. Plain SHA-256 of a public EVM address is trivially matched
 * against any known address (it is NOT anonymization, just a reversible-by-lookup label); the HMAC
 * secret breaks that join so the id cannot be reproduced off-server.
 *
 * PP-SECURITY [R2]: never send the raw address to analytics; only this hash.
 * PP-SECURITY: run server-side ONLY. `secret` must come from a non-public env var
 * (`PP_ANALYTICS_USER_ID_SECRET`), never a `NEXT_PUBLIC_*` one, or the join protection is void.
 * PP-INTEGRATION-POINT: compute this in a server action / route handler and pass the result to the
 * client analytics layer; do not call it from the browser.
 */
export async function hashWalletAddress(address: `0x${string}`, secret: string): Promise<string> {
  if (!secret) {
    throw new Error("hashWalletAddress: missing HMAC secret (PP_ANALYTICS_USER_ID_SECRET).");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(address.toLowerCase()));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
