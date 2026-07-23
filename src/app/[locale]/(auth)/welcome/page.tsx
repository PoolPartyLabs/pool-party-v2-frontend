import { setRequestLocale } from "next-intl/server";
import { WalletReadyScreen } from "@/features/auth/WalletReadyScreen";

/** Route for PP-AUTH-SCR-003 — Maria's "wallet ready" confirmation after Google sign-in. */
export default async function WelcomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <WalletReadyScreen />;
}
