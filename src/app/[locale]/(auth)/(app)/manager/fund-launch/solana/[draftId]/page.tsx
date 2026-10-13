/**
 * @id PP-MGR-SCR-010 (POO-2262)
 * @name SolanaFundLaunchRoute
 * @implements-rules-version DEC-188, DEC-190 (founder rulings, unversioned)
 */
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { SolanaFundLaunch } from "@/features/manager/fund/launch/SolanaFundLaunch";
import { isFeatureEnabled } from "@/lib/features";
import { isMockMode } from "@/lib/services";

export default async function SolanaFundLaunchPage({
  params,
}: {
  params: Promise<{ locale: string; draftId: string }>;
}) {
  const { locale, draftId } = await params;
  setRequestLocale(locale);
  if (!isFeatureEnabled("fundContracts") || !isFeatureEnabled("solanaSpoke") || isMockMode)
    notFound();
  return <SolanaFundLaunch draftId={decodeURIComponent(draftId)} />;
}
