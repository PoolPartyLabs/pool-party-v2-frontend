/**
 * @id PP-MGR-LIB-002
 * @name verificationEligibility
 * @implements-rules-version v1
 *
 * POO-593 R2: whether a manager may request identity verification. The gate is the IDENTITY social —
 * X — exposed as a SAFE absolute http(s) URL (the same `safeHttpUrl` rule the profile form and public
 * render use). Community links (Telegram/Discord/YouTube) and the website do not qualify. POO-579:
 * Instagram is no longer a gate network — the deployed registry does not persist an Instagram column,
 * so a gate on it would let a manager qualify on a link the backend silently drops. Pure +
 * framework-free so the Profile tab can gate its "Request verification" control off the live values.
 */
import type { ManagerSocials } from "@/lib/schemas";
import { safeHttpUrl } from "@/lib/utils/sanitize";

/** The social networks that satisfy the verification gate (identity, not community). */
export const VERIFICATION_IDENTITY_NETWORKS = ["x"] as const satisfies ReadonlyArray<
  keyof ManagerSocials
>;

/**
 * True when the identity social (X) is present as a safe http(s) URL. Unsafe (`javascript:`/`data:`)
 * or blank links never count (safeHttpUrl returns null for them).
 */
export function hasVerificationIdentitySocial(socials: ManagerSocials): boolean {
  return VERIFICATION_IDENTITY_NETWORKS.some((key) => safeHttpUrl(socials[key]) !== null);
}
