/**
 * @id PP-ADM-AUTH-001
 * @name admin RBAC — roles, capability catalog, and the permission check
 * @implements-rules-version v1
 *
 * Access control for the internal Admin Console (POO-144 R7/R8). Three roles
 * (operator < admin < master) and a data-driven capability catalog. The role→capability mapping is
 * NOT hardcoded at call sites: pages and server actions ask {@link assertAdminCan}. `master`
 * implicitly holds every capability (it also edits the mapping and manages admin users), so it can
 * never lock itself out. {@link DEFAULT_ROLE_CAPABILITIES} is the v1 baseline the master retunes
 * later in the Roles & Permissions page.
 *
 * PP-INTEGRATION-POINT: the live role→capability mapping is fetched from pool-party-api
 * (`GET /admin/roles`) via `apiFetch` once the master Roles & Permissions page + backend land; the API
 * owns the store (Neon) and the admin frontend NEVER touches the database directly. Until then the
 * default mapping below is the source of truth.
 */

/** The three access levels, low → high. */
export const ADMIN_ROLES = ["operator", "admin", "master"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Every gateable admin capability. Add exactly one entry here when a feature ships an action. */
export type AdminCapability =
  | "verification.approve"
  | "verification.reject"
  | "image.approve"
  | "image.remove"
  | "adminUsers.manage"
  | "roles.configure";

/** One capability in the catalog. Drives the master Roles & Permissions page. */
export interface AdminCapabilityDef {
  key: AdminCapability;
  /** Human label shown in the Roles & Permissions page. */
  label: string;
  /** Feature area, used to group capabilities in the UI. */
  group: string;
  /** When true, only `master` may ever hold it (not assignable to operator/admin). */
  masterOnly?: boolean;
}

/**
 * The capability catalog — the single list the master Roles & Permissions page renders. It grows as
 * features land (POO-149 verification, image moderation, …). `masterOnly` capabilities are the
 * administration primitives that must never be delegated.
 */
export const ADMIN_CAPABILITIES: readonly AdminCapabilityDef[] = [
  { key: "verification.approve", label: "Approve manager verification", group: "Managers" },
  { key: "verification.reject", label: "Reject manager verification", group: "Managers" },
  { key: "image.approve", label: "Approve uploaded image", group: "Moderation" },
  { key: "image.remove", label: "Remove (soft-hide) uploaded image", group: "Moderation" },
  {
    key: "adminUsers.manage",
    label: "Manage admin users",
    group: "Administration",
    masterOnly: true,
  },
  {
    key: "roles.configure",
    label: "Edit role permissions",
    group: "Administration",
    masterOnly: true,
  },
] as const;

/** All capability keys, in catalog order. */
export const ADMIN_CAPABILITY_KEYS: readonly AdminCapability[] = ADMIN_CAPABILITIES.map(
  (c) => c.key,
);

/** role → the capabilities granted to it. `master`'s grants are implicit (see {@link roleHasCapability}). */
export type RoleCapabilityMapping = Record<AdminRole, AdminCapability[]>;

/**
 * v1 default grants (POO-143). operator and admin start equal at the feature level; master holds
 * everything, including the `masterOnly` administration capabilities. The master can later grant/
 * revoke operator and admin capabilities; master's own grants cannot be revoked.
 */
export const DEFAULT_ROLE_CAPABILITIES: RoleCapabilityMapping = {
  operator: ["verification.approve", "image.approve", "image.remove"],
  admin: ["verification.approve", "verification.reject", "image.approve", "image.remove"],
  master: [...ADMIN_CAPABILITY_KEYS],
};

/** Pure: does `role` hold `capability` under `mapping`? `master` always does, whatever the mapping. */
export function roleHasCapability(
  mapping: RoleCapabilityMapping,
  role: AdminRole,
  capability: AdminCapability,
): boolean {
  if (role === "master") return true;
  return mapping[role]?.includes(capability) ?? false;
}

/** The minimal session shape the permission check needs. */
export interface CapableSession {
  role: AdminRole;
}

/** Non-throwing capability check for a session (a null/absent session is never capable). */
export function adminCan(
  session: CapableSession | null | undefined,
  capability: AdminCapability,
  mapping: RoleCapabilityMapping = DEFAULT_ROLE_CAPABILITIES,
): boolean {
  if (!session) return false;
  return roleHasCapability(mapping, session.role, capability);
}

/** Thrown by {@link assertAdminCan} when a session lacks a required capability. */
export class AdminForbiddenError extends Error {
  readonly capability: AdminCapability;
  constructor(capability: AdminCapability) {
    super(`Admin action forbidden: missing capability "${capability}"`);
    this.name = "AdminForbiddenError";
    this.capability = capability;
  }
}

/** Throwing guard for server actions and route guards. No-op when the session is capable. */
export function assertAdminCan(
  session: CapableSession | null | undefined,
  capability: AdminCapability,
  mapping: RoleCapabilityMapping = DEFAULT_ROLE_CAPABILITIES,
): void {
  if (!adminCan(session, capability, mapping)) {
    throw new AdminForbiddenError(capability);
  }
}
