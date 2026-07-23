import { redirect } from "next/navigation";

/**
 * @id PP-ADM-SCR-000
 * @name Admin Console index
 * @implements-rules-version v1
 *
 * The bare `/admin` entry sends the user to the Overview. The (console) guard bounces to sign-in /
 * 2fa when the session is missing or unverified.
 */
export default async function AdminIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/admin/overview`);
}
