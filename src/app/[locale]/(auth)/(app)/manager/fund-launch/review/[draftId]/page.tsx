/**
 * @id PP-MGR-SCR-007 (POO-2183)
 * @name FallbackReviewRoute
 * @implements-rules-version v1
 */
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { FallbackReview } from "@/features/manager/fund/launch/fallback/FallbackReview";
import { isFeatureEnabled } from "@/lib/features";
import { isMockMode } from "@/lib/services";

export default async function FallbackReviewPage({
  params,
}: {
  params: Promise<{ locale: string; draftId: string }>;
}) {
  const { locale, draftId } = await params;
  setRequestLocale(locale);
  if (!isFeatureEnabled("fundContracts") || isMockMode) notFound();
  return <FallbackReview draftId={draftId} />;
}
