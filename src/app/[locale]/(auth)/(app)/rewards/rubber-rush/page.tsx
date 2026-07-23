import { setRequestLocale } from "next-intl/server";
import { RubberRushDataLoader } from "@/features/rewards/components/RubberRushDataLoader";
import { RubberRushScreen } from "@/features/rewards/RubberRushScreen";
import { isMockMode, rewardsService } from "@/lib/services";

/** PP-REW-SCR-001 — Rubber Rush investor rewards dashboard. */
export default async function RubberRushPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Real mode: a client boundary reads the connected wallet and fetches via the
  // getRubberRushAction Server Action (the analytics reads run server-side in
  // fetchRubberRush). Mock mode: SSR the mock dashboard directly. POO-209.
  if (!isMockMode) {
    return <RubberRushDataLoader />;
  }

  const data = await rewardsService.getRubberRush();
  return <RubberRushScreen data={data} />;
}
