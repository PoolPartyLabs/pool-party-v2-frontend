import { setRequestLocale } from "next-intl/server";
import { ManagerIncentiveProgramScreen } from "@/features/rewards/ManagerIncentiveProgramScreen";
import { rewardsService } from "@/lib/services";

/** PP-REW-SCR-002 — ManagerIncentiveProgram (manager-side) rewards dashboard. */
export default async function ManagerIncentiveProgramPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const data = await rewardsService.getManagerIncentiveProgram();

  return <ManagerIncentiveProgramScreen data={data} />;
}
