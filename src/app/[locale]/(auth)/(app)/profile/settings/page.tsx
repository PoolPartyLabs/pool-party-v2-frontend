import { setRequestLocale } from "next-intl/server";
import { AppSettingsScreen } from "@/features/profile/AppSettingsScreen";

/** PP-PROF-SCR-006 — app settings. */
export default async function AppSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AppSettingsScreen />;
}
