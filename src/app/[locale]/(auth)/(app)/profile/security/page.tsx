import { setRequestLocale } from "next-intl/server";
import { SecurityScreen } from "@/features/profile/SecurityScreen";

/** PP-PROF-SCR-004 — security & login. */
export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SecurityScreen />;
}
