import { setRequestLocale } from "next-intl/server";
import { HelpScreen } from "@/features/profile/HelpScreen";

/** PP-PROF-SCR-007 — help center. */
export default async function HelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HelpScreen />;
}
