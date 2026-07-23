import { setRequestLocale } from "next-intl/server";
import { NotificationsScreen } from "@/features/profile/NotificationsScreen";

/** PP-PROF-SCR-005 — alerts & notifications. */
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <NotificationsScreen />;
}
