import { setRequestLocale } from "next-intl/server";
import { requireFeature } from "@/lib/features/requireFeature";

/**
 * @id PP-ADM-SCR-000
 * @name Admin Console root layout
 * @implements-rules-version v1
 *
 * Root of the Admin Console surface (POO-144). Host-gated to `adm.` in middleware; here it also
 * gates the whole `/admin` tree behind the `adminConsole` feature flag (404 when off — dark-launched
 * per CLAUDE.md premise 10). Enable locally with `NEXT_PUBLIC_FEATURE_ADMIN_CONSOLE=on` (or
 * `NEXT_PUBLIC_FEATURE_ALL=on` in non-prod); to also get a dev session before real auth, set the
 * server-only `ADMIN_DEV_MASTER=1` (non-prod only). Admin routes are internal, per-request, and data-driven,
 * never statically prerendered. Pre-auth screens (sign-in, 2fa) live directly under here; the
 * authenticated console lives in the (console) group with its own guard + shell.
 */
export const dynamic = "force-dynamic";

export default async function AdminRootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  requireFeature("adminConsole");
  return children;
}
