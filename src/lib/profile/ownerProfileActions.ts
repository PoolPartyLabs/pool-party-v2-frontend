/**
 * @id PP-PROF-ACT-003 (POO-779)
 * @name owner profile session read action
 * @implements-rules-version v2
 *
 * The "use server" read behind the session profile store (POO-779 R1/R2): the signed-in owner's
 * role, sourced from `profile.isManager` on the owner profile read (`GET /users/me` via
 * `loadInvestorProfile`, which the greeting + profile screens already use). This REPLACES the old
 * `getManagerRoleAction` positions drain (`GET /portfolio/:wallet/all?closed=all`) that fired on every
 * hard load for every user and triggered pp_api's heaviest 3-network RPC + CoinGecko + Revert
 * composition just to answer a boolean. The role now rides the one profile read; no positions/strategies
 * request is issued for it.
 *
 * Degrade-tolerant by construction: a read failure OR an absent `isManager` field resolves to the
 * investor role (`false`), never the manager surface. POO-788 reconciles `profiles.is_manager` upstream
 * (the flag is FALSE today for pre-POO-307 / v1-created managers); until it lands the FE must not grant
 * the console on a stale/absent flag, and the sticky-true nature of the flag means a false is only ever a
 * safe under-grant, never a false manager.
 *
 * PP-INTEGRATION-POINT (POO-779 / POO-788): manager role ← `profile.isManager` from the session profile
 * read (`loadInvestorProfile` → pp-api `GET /api/v1/users/me`). Assumed contract: the owner profile DTO
 * embeds `isManager`. Wired through the existing profile seam; no new endpoint.
 */
"use server";

import { loadInvestorProfile } from "./loadInvestorProfile";

/** The minimal owner-session projection the store needs today: the role. Extend as consumers land (POO-704). */
export interface OwnerProfileSnapshot {
  /** Whether the signed-in wallet is a manager (sticky-true `profiles.is_manager`). */
  isManager: boolean;
}

/**
 * Resolve the signed-in owner's role from the session profile read. Any failure (a hard identity-read
 * outage, or a response missing `isManager`) degrades to the investor role rather than throwing, so the
 * sidebar never breaks and never falsely grants the manager surface.
 */
export async function getOwnerProfileAction(): Promise<OwnerProfileSnapshot> {
  try {
    const profile = await loadInvestorProfile();
    return { isManager: profile.isManager === true };
  } catch {
    return { isManager: false };
  }
}
