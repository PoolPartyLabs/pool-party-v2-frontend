/** @id PP-CP-SCR-001 @name Cash+ route @implements-rules-version v1 */
import { setRequestLocale } from "next-intl/server";
import { CashPlusProvider } from "@/features/cash-plus/CashPlusProvider";
import { CashPlusScreen } from "@/features/cash-plus/CashPlusScreen";
import { requireFeature } from "@/lib/features/requireFeature";

export default async function CashPlusPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  requireFeature("cashPlus");
  return (
    <CashPlusProvider>
      <CashPlusScreen />
    </CashPlusProvider>
  );
}
