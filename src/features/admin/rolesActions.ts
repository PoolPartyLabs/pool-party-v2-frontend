/**
 * @id PP-ADM-AUTH-001
 * @name admin roles server action
 * @implements-rules-version v1
 *
 * Server action for the master Roles & Permissions page (POO-591). Guarded by the `roles.configure`
 * capability (master-only), it grants/revokes a capability for operator/admin. The service enforces
 * the invariants (master is fixed; master-only capabilities are never delegable).
 */
"use server";

import { assertAdminCanLive } from "@/lib/admin/authz";
import type { AdminCapability, AdminRole } from "@/lib/admin/rbac";
import { resolveAdminSession } from "@/lib/admin/session";
import { rbacService } from "@/lib/services";

export async function updateRoleCapabilityAction(
  role: AdminRole,
  capability: AdminCapability,
  granted: boolean,
): Promise<void> {
  const session = await resolveAdminSession();
  if (!session) throw new Error("admin: not signed in");
  await assertAdminCanLive(session, "roles.configure");
  await rbacService.setRoleCapability(role, capability, granted);
}
