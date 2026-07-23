/**
 * @id PP-CORE (SETUP-014 / POO-82)
 * @name sanitizeParams
 * @implements-rules-version v1
 *
 * Defensive scrub of analytics params before they reach the dataLayer.
 * PP-SECURITY [R3]: drop any secret-looking key (seed phrase, mnemonic, private key, password) and
 * any value that looks like a raw EVM address or private key, so even a mistaken `track()` call
 * cannot leak identity-control data. PP-SECURITY [R4]: optionally drop `user_id` before consent.
 */
import type { AnalyticsParams } from "./events";

const BLACKLISTED_KEY = /seed|mnemonic|passphrase|password|secret|private.?key/i;
const RAW_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY = /^0x[a-fA-F0-9]{64}$/;

export function sanitizeParams(
  params?: AnalyticsParams,
  allowUserId = true,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  if (!params) return clean;

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (key === "user_id" && !allowUserId) continue;
    if (BLACKLISTED_KEY.test(key)) continue;
    if (typeof value === "string" && (RAW_ADDRESS.test(value) || PRIVATE_KEY.test(value))) continue;
    clean[key] = value;
  }
  return clean;
}
