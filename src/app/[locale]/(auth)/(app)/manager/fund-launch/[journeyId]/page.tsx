/**
 * @id PP-MGR-CMP-081 (POO-2177)
 * @name FundLaunchJourneyRoute
 * @implements-rules-version v1
 */
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { FundLaunchJourney } from "@/features/manager/fund/launch/FundLaunchJourney";
import { isFeatureEnabled } from "@/lib/features";
export default async function FundLaunchJourneyPage({
  params,
}: {
  params: Promise<{ locale: string; journeyId: string }>;
}) {
  const { locale, journeyId } = await params;
  setRequestLocale(locale);
  if (!isFeatureEnabled("fundContracts")) notFound();
  return <FundLaunchJourney journeyId={journeyId} />;
}
