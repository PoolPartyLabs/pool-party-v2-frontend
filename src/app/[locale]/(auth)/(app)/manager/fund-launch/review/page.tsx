/**
 * @id PP-MGR-SCR-008 (POO-2183)
 * @name FallbackReviewIndexRoute
 * @implements-rules-version v1
 */
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { FallbackReviewIndex } from "@/features/manager/fund/launch/fallback/FallbackReviewIndex";
import { isFeatureEnabled } from "@/lib/features";
import { isMockMode } from "@/lib/services";

export default async function FallbackReviewIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!isFeatureEnabled("fundContracts") || isMockMode) notFound();
  return <FallbackReviewIndex />;
}
