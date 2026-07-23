import { setRequestLocale } from "next-intl/server";
import { LegalPlaceholder } from "@/features/auth/LegalPlaceholder";

/** Reserved "new to wallets?" guide (full content lands before launch). */
export default async function LearnWalletsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalPlaceholder kind="learnWallets" />;
}
