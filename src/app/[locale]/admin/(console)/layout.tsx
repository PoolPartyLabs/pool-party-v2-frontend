import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { AdminShell } from "@/components/admin/AdminShell";
import { resolveAdminSession } from "@/lib/admin/session";

/**
 * @id PP-ADM-SCR-000
 * @name Admin Console (authenticated) layout
 * @implements-rules-version v1
 *
 * Guard + chrome for the authenticated console (POO-144 R6). No session → sign-in; a session that
 * has not passed the TOTP challenge → 2fa; otherwise render inside the {@link AdminShell}. In mock
 * mode {@link resolveAdminSession} injects a dev master session so the console renders locally before
 * real auth lands. Per-route capability gating (403) arrives with the feature routes.
 */
export const dynamic = "force-dynamic";

export default async function AdminConsoleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await resolveAdminSession();
  if (!session) redirect(`/${locale}/admin/sign-in`);
  if (!session.twoFactorVerified) redirect(`/${locale}/admin/2fa`);

  return (
    <AdminShell email={session.email} role={session.role}>
      {children}
    </AdminShell>
  );
}
