import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { StrategyDetailDataLoader } from "@/features/strategies/StrategyDetailDataLoader";
import { StrategyDetailScreen } from "@/features/strategies/StrategyDetailScreen";
import { buildStrategyChartData } from "@/features/strategies/strategyChartData";
import { accountService, isMockMode, positionService, rewardsService } from "@/lib/services";
import { loadStrategyDetail } from "@/lib/strategies/loadStrategyDetail";
import { resolveDetailStrategy } from "@/lib/strategies/resolveDetailStrategy";
import { mapTimeseries } from "@/lib/timeseries/mapTimeseries";

/** PP-STR-SCR-002 / 003 — the strategy detail prospectus (Discovery or Owned). */
export default async function StrategyDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  // Real mode: resolve the strategy AND its wallet-independent AUM series CONCURRENTLY (POO-778 R2) —
  // the route id is the series key, so the analytics fetch starts before resolution completes rather
  // than stacking behind it. Resolution is single-request (R1) + the signed-in closed/held positions
  // fallback (POO-536/POO-455 R4); an unknown id resolves to null and 404s after ≤1 upstream request
  // (R3). A <2-point series (analytics 404/empty/error) passes nothing and the client loader renders
  // its explicit no-history state instead of a synthetic series (POO-557 R3).
  if (!isMockMode) {
    const { strategy, series } = await loadStrategyDetail(id);
    if (!strategy) notFound();
    const chartData = series.length >= 2 ? mapTimeseries(series, locale) : undefined;
    return <StrategyDetailDataLoader strategy={strategy} chartData={chartData} />;
  }

  // Mock mode: the discovery catalog is authoritative (no real portfolio to fall back to). The chart
  // is derived from the position, so no timeseries read is needed here.
  const strategy = await resolveDetailStrategy(id);
  if (!strategy) {
    notFound();
  }

  const [positions, balance] = await Promise.all([
    positionService.list(),
    accountService.getUsdcBalance(),
  ]);
  const position = positions.find((entry) => entry.strategyId === id) ?? null;

  // Share-yield data (POO-275): per-period earnings + the user's referral link, owned only.
  const [earnings, referralProgram] = position
    ? await Promise.all([positionService.getEarnings(position.id), rewardsService.getReferral()])
    : [null, null];

  const chartData = buildStrategyChartData(position, strategy, locale);

  return (
    <StrategyDetailScreen
      strategy={strategy}
      position={position}
      balance={balance}
      chartData={chartData}
      earnings={earnings}
      referralLink={referralProgram?.inviteLink ?? null}
    />
  );
}
