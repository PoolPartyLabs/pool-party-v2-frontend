import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RolesMatrix } from "@/features/admin/components/RolesMatrix";
import { adminCanLive } from "@/lib/admin/authz";
import { ADMIN_CAPABILITIES } from "@/lib/admin/rbac";
import { resolveAdminSession } from "@/lib/admin/session";
import { rbacService } from "@/lib/services";

/**
 * @id PP-ADM-SCR-007
 * @name Roles & Permissions (master-only)
 * @implements-rules-version v1
 *
 * The master-only Roles & Permissions page (POO-591): the capability catalog × roles matrix. Gated
 * by the `roles.configure` capability, which is `masterOnly` — so only master reaches it (others get
 * a 404). The mapping comes from the rbac service (mock today; real = pool-party-api via apiFetch,
 * never the DB); edits take effect immediately because every enforcement point reads the live mapping.
 */
export const dynamic = "force-dynamic";

export default async function AdminRolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");

  const session = await resolveAdminSession();
  if (!(await adminCanLive(session, "roles.configure"))) notFound();

  const grants = await rbacService.getRoleCapabilities();
  const capabilities = ADMIN_CAPABILITIES.map((capability) => ({
    key: capability.key,
    label: capability.label,
    group: capability.group,
    masterOnly: capability.masterOnly,
  }));

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-foreground text-xl">{t("rolesPage.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("rolesPage.subtitle")}</p>
      </header>
      <RolesMatrix capabilities={capabilities} grants={grants} />
      <p className="text-muted-foreground text-xs">{t("rolesPage.masterNote")}</p>
    </section>
  );
}
