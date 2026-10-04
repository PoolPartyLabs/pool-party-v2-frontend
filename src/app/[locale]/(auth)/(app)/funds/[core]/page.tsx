/**
 * @id PP-STR-SCR-005 (POO-2175)
 * @name FundDetailPage
 * @implements-rules-version v2
 * Feature-gated v2 fund route, independent from V1 strategy identities.
 */
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { FundDetail } from "@/features/funds/FundDetail";
import { addressSchema } from "@/lib/api/v2/schemas";
import { isFeatureEnabled } from "@/lib/features";
export default async function FundDetailPage({
  params,
}: {
  params: Promise<{ locale: string; core: string }>;
}) {
  const { locale, core } = await params;
  setRequestLocale(locale);
  if (!isFeatureEnabled("fundContracts") || !addressSchema.safeParse(core).success) notFound();
  return <FundDetail core={core} />;
}
