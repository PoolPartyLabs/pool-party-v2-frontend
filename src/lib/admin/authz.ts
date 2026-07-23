/**
 * @id PP-ADM-AUTH-001
 * @name admin live authorization
 * @implements-rules-version v1
 *
 * Server-side capability checks that read the LIVE role→capability mapping (POO-591), not the
 * hardcoded default. Every admin server action + page gates through these so a master's edits in the
 * Roles & Permissions page take effect immediately. `master` is always all-powerful (enforced by the
 * pure {@link adminCan}); the mapping only ever tunes operator/admin.
 */
import "server-only";

import { rbacService } from "@/lib/services";
import { type AdminCapability, adminCan, assertAdminCan, type CapableSession } from "./rbac";

/** The current role→capability mapping (from the rbac service). */
export async function getRoleCapabilityMapping() {
  return rbacService.getRoleCapabilities();
}

/** Non-throwing capability check against the live mapping. */
export async function adminCanLive(
  session: CapableSession | null | undefined,
  capability: AdminCapability,
): Promise<boolean> {
  return adminCan(session, capability, await rbacService.getRoleCapabilities());
}

/** Throwing guard against the live mapping. */
export async function assertAdminCanLive(
  session: CapableSession | null | undefined,
  capability: AdminCapability,
): Promise<void> {
  assertAdminCan(session, capability, await rbacService.getRoleCapabilities());
}
