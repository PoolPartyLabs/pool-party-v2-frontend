import { setRequestLocale } from "next-intl/server";
import { ConnectWalletScreen } from "@/features/auth/ConnectWalletScreen";

/** Route for PP-AUTH-SCR-004 — Carlos's external wallet connector picker. */
export default async function ConnectPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ConnectWalletScreen />;
}
