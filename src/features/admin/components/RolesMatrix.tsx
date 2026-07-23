/**
 * @id PP-ADM-CMP-014
 * @name RolesMatrix
 * @implements-rules-version v1
 *
 * The master Roles & Permissions matrix (POO-591): capability catalog × roles. `master` is always
 * granted and locked; operator/admin cells are editable EXCEPT `masterOnly` capabilities (which are
 * never delegable). Toggling a cell calls the guarded server action and refreshes so enforcement
 * (which reads the live mapping) updates everywhere.
 */
"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { updateRoleCapabilityAction } from "@/features/admin/rolesActions";
import { useRouter } from "@/i18n/navigation";
import type { AdminCapability, AdminRole } from "@/lib/admin/rbac";

interface CapabilityRow {
  key: AdminCapability;
  label: string;
  group: string;
  masterOnly?: boolean;
}

const EDITABLE_ROLES: readonly AdminRole[] = ["operator", "admin"];

export function RolesMatrix({
  capabilities,
  grants,
}: {
  capabilities: readonly CapabilityRow[];
  grants: Record<AdminRole, readonly AdminCapability[]>;
}) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const roleLabels: Record<AdminRole, string> = {
    operator: t("roles.operator"),
    admin: t("roles.admin"),
    master: t("roles.master"),
  };

  const has = (role: AdminRole, key: AdminCapability) => grants[role]?.includes(key) ?? false;

  const toggle = (role: AdminRole, key: AdminCapability, granted: boolean) => {
    startTransition(async () => {
      await updateRoleCapabilityAction(role, key, granted);
      router.refresh();
    });
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="border-border border-b bg-surface text-muted-foreground text-xs">
          <tr>
            <th className="px-4 py-3 font-medium">{t("rolesPage.colCapability")}</th>
            <th className="px-4 py-3 text-center font-medium">{roleLabels.operator}</th>
            <th className="px-4 py-3 text-center font-medium">{roleLabels.admin}</th>
            <th className="px-4 py-3 text-center font-medium">{roleLabels.master}</th>
          </tr>
        </thead>
        <tbody>
          {capabilities.map((cap) => (
            <tr key={cap.key} className="border-border border-b last:border-b-0">
              <td className="px-4 py-3">
                <div className="font-medium text-foreground">{cap.label}</div>
                <div className="text-muted-foreground text-xs">{cap.group}</div>
              </td>
              {EDITABLE_ROLES.map((role) => (
                <td key={role} className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary disabled:opacity-40"
                    checked={has(role, cap.key)}
                    disabled={cap.masterOnly || isPending}
                    aria-label={`${cap.label} · ${roleLabels[role]}`}
                    onChange={(event) => toggle(role, cap.key, event.target.checked)}
                  />
                </td>
              ))}
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked
                  readOnly
                  disabled
                  aria-label={`${cap.label} · ${roleLabels.master}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
