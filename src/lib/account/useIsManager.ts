/**
 * @id PP-MGR (POO-224, POO-456, POO-779)
 * @name useIsManager
 * @implements-rules-version v2
 *
 * The manager role, read from the session profile store (POO-779 R1). It is a thin projection over
 * {@link useOwnerProfileSession}: the store fetches the owner profile once per session (`GET /users/me`)
 * and exposes `isManager`; this hook issues NO request of its own. This REPLACES the old positions drain
 * (`getManagerRoleAction` → `GET /portfolio/:wallet/all?closed=all`) that ran on every hard load for
 * every user — killing a full portfolio composition and issuing zero role-dedicated requests.
 *
 * POO-456 holds by construction: `profiles.is_manager` is sticky-true, so a fully-exited manager still
 * resolves as manager without re-deriving from positions. The loading state carries the store's
 * `loading` window (incl. the SIWE signing handshake) so the sidebar keeps its skeleton instead of
 * flashing "Become a manager" before the role resolves.
 *
 * Mock-safe like the other wallet-scoped hooks: in mock mode it returns false, since the Dev-menu toggle
 * drives the manager entry there (R5).
 */
"use client";

import { useOwnerProfileSession } from "@/lib/profile/useOwnerProfileSession";
import { isMockMode } from "@/lib/services";

/** Manager role + whether it's still resolving (the sidebar shows a skeleton while loading). */
export interface ManagerRole {
  /** Whether the connected wallet manages at least one pool. */
  isManager: boolean;
  /** True while the role is still resolving in real mode (always false in mock mode). */
  isLoading: boolean;
}

/**
 * Whether the connected wallet manages at least one pool, plus its loading state. Reads the session
 * profile store; the manager role is reported only once the profile is `loaded`, so a `loading` store
 * (incl. the signing window) keeps `isManager` false while `isLoading` holds the skeleton.
 */
export function useIsManager(): ManagerRole {
  const { status, isManager } = useOwnerProfileSession();
  // Mock mode: the Dev-menu toggle drives the manager entry, so the role is never derived here (R5).
  if (isMockMode) {
    return { isManager: false, isLoading: false };
  }
  return {
    isManager: status === "loaded" ? isManager : false,
    isLoading: status === "loading",
  };
}
