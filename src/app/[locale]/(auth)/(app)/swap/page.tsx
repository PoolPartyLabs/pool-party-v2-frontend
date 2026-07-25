/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name SwapPage
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * `/swap`, the standalone swap and bridge screen. Dark-launched behind `swapScreen` ([R1]) and
 * guarded SERVER-side ([R5]): with the flag off a deep link 404s rather than merely being missing
 * from the nav, which is what makes the flag a launch decision instead of a UI preference.
 *
 * A thin orchestrator, per the page blueprint: the flag guard, the preview banner every
 * dark-launched area carries, and the client screen. It reads no data of its own, because the data
 * this screen needs is the user's WALLET, which is read per destination from the client through the
 * `"use server"` boundary (ADR 0003).
 */
import { setRequestLocale } from "next-intl/server";
import { FeatureFlagBanner } from "@/components/feedback/FeatureFlagBanner";
import { SwapScreen } from "@/features/swap";
import { requireFeature } from "@/lib/features/requireFeature";

export default async function SwapPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // [R1]/[R5] Off in v1: `/swap` 404s until the flag is flipped on, per environment.
  requireFeature("swapScreen");

  return (
    <div className="flex flex-col gap-6">
      {/* TEMP preview banner: every dark-launched area shows one; removed before launch. */}
      <FeatureFlagBanner feature="swapScreen" />
      <SwapScreen />
    </div>
  );
}
