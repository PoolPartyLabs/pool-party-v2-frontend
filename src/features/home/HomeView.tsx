/**
 * @id PP-DASH-SCR-001
 * @name Home
 * @implements-rules-version v3
 *
 * The investor dashboard (presentational; data is fetched by the route and passed in). Growth-first
 * narrative — withdrawal is never surfaced for a still-growing position; the ONE exception is a
 * closed position (the manager ended it — it is done growing), which shows the Closed cue and a
 * Withdraw entry in place of Manage (POO-543). Responsive: mobile stacks a hero card, KPI grid,
 * compact positions and an auto-advancing strategy carousel; desktop adds a hero aside
 * (allocation-by-risk + referral) and "Your positions" / "Discover strategies" tables. Delegates
 * the empty/first-run state to EmptyHome when the investor has no positions yet.
 *
 * POO-543 (rules v1): a closed position's Withdraw entry deep-links to /strategies/<id>?withdraw=1,
 * which auto-opens the canonical WithdrawModal on the detail screen (which owns the real-mode build
 * wiring + post-write refresh) — Home never mounts a second copy of the flow [R3].
 * POO-647 (rules v1): dropped the redundant green "Available to withdraw" pill from closed rows —
 * the Withdraw action already conveys it [R1].
 * POO-653 (rules v1): a closed position shows no rate — the desktop Rate column renders the muted
 * em-dash placeholder for closed rows (the rate is stale/uninformative); Withdraw is the affordance [R1].
 * POO-579 (Feature B, rules v1): mounts the one-time ReferralWelcomeBanner at the top of both the
 * populated and empty states, shown once right after a new user's referral join was validated.
 */
"use client";

import { BadgeCheck, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { GreetingHeading } from "@/components/data-display/GreetingHeading";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { MetricTile } from "@/components/data-display/MetricTile";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { ManagerLink } from "@/features/manager/components/ManagerLink";
import { AllocationByRisk } from "@/features/portfolio/components/AllocationByRisk";
import { PositionLink } from "@/features/portfolio/components/PositionLink";
import { RiskMeter } from "@/features/strategies/components/RiskMeter";
import { Link } from "@/i18n/navigation";
import { INVESTOR_HIDE_VALUES_KEY, PersistedMaskProvider } from "@/lib/hooks/maskValue";
import type { Position, Strategy } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import {
  formatPercent,
  formatSignedUsd,
  formatSignedUsdTile,
  formatUsd,
  formatUsdTile,
} from "@/lib/utils/format";
import type { PortfolioSeries } from "@/mocks/data/portfolioSeries";
import { DiscoverCarousel } from "./components/DiscoverCarousel";
import { EmptyHome } from "./components/EmptyHome";
import { PortfolioChartCard } from "./components/PortfolioChartCard";
import { ReferralCard } from "./components/ReferralCard";
import { ReferralWelcomeBanner } from "./components/ReferralWelcomeBanner";

/** An owned position joined with the strategy it belongs to. */
export interface HomeViewPosition {
  position: Position;
  strategy: Strategy;
}

/** Public props for {@link HomeView}. */
export interface HomeViewProps {
  totalValue: number;
  /**
   * "Earned today" (24h fees), threaded to the hero chart-card badge. `null` = the C1 `/financials`
   * payload served this field honest-absent, OR financials are unavailable (real mode; PP-CORE-LIB-048);
   * the badge renders the "not available yet" affordance, NEVER a fabricated "+$0.00" ([R5]). In mock
   * mode this is always the (non-negative) mock-table number.
   */
  earnedToday: number | null;
  /**
   * The KPI-tile figures. `null` = the C1 `/financials` payload served this field honest-absent, OR
   * financials are unavailable (real mode; PP-CORE-LIB-048); the tile renders the "not available yet"
   * affordance, NEVER $0 ([R5]). In mock mode these are always the mock-computed numbers.
   */
  invested: number | null;
  totalYield: number | null;
  thisMonth: number | null;
  avgApy: number;
  /** Labelled value series per period for the hero chart. */
  seriesByPeriod: PortfolioSeries;
  /** The investor's positions (joined with their strategies). */
  positions: HomeViewPosition[];
  /** Strategies to surface for discovery (not yet invested in). */
  discover: Strategy[];
  /**
   * Spendable balance the investor can put to work, in USD. When there are no positions, a positive
   * value renders the "funded" empty state (balance + "invest now") instead of the brand-new "zero"
   * state. PP-INTEGRATION-POINT: sourced from a spendable-balance service (POO-239); undefined for now.
   */
  availableToInvest?: number;
  /**
   * POO-704: the authenticated owner's PUBLIC `displayName` (`/users/me`), resolved server-side and
   * forwarded to the greeting. Blank/absent → the greeting falls back to the masked wallet. Undefined
   * in mock mode, where the greeting uses the mock profile name.
   */
  displayName?: string;
}

/** Estimated-return cell: value + APR/APY unit tag. */
function RateLabel({ strategy }: { strategy: Strategy }) {
  return (
    <span className="font-medium text-foreground">
      {formatPercent(strategy.estReturn)}{" "}
      <AprTooltip className="font-normal text-[10px] text-muted-foreground uppercase">
        {strategy.rateType}
      </AprTooltip>
    </span>
  );
}

/** Section heading with an optional "see all" link. */
function SectionHeader({ title, href, seeAll }: { title: string; href?: string; seeAll?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-semibold text-foreground text-lg">{title}</h2>
      {href && seeAll ? (
        <Link href={href} className="text-muted-foreground text-sm hover:text-foreground">
          {seeAll}
        </Link>
      ) : null}
    </div>
  );
}

/** The investor dashboard. */
export function HomeView(props: HomeViewProps) {
  const t = useTranslations("home");
  // POO-936 [R5]: the "not available yet" affordance for a financials field the ledger backfill has
  // not populated yet (a served NULL — never rendered as $0).
  const tCommon = useTranslations("common");
  // The "Invest" action label + the Owned/Invested tags live in the strategies namespace.
  const ts = useTranslations("strategies");
  const investLabel = ts("card.invest");
  // A held strategy the investor manages shows "Owned"; a plain investment shows "Invested".
  const positionTag = (isManager: boolean | undefined) => (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 font-medium text-xs ring-1 ring-inset",
        isManager ? "text-primary ring-primary/60" : "text-info ring-info/60",
      )}
    >
      {isManager ? ts("explore.owned") : ts("explore.invested")}
    </span>
  );
  // POO-543 [R1][R4] + POO-647 [R1]: a closed position (the manager ended it) shows the Closed cue
  // in place of the generic Invested tag; a manager-owned closed position keeps its Owned tag. The
  // redundant green "Available to withdraw" pill was dropped in POO-647 — withdrawability is conveyed
  // by the Withdraw action (desktop) / tapping through to the owned detail (mobile), not a badge.
  const positionTags = (position: Position) =>
    position.status === "closed" ? (
      <>
        {position.isPoolManager ? positionTag(true) : null}
        <span className="shrink-0 rounded-full bg-surface-raised px-2 py-0.5 text-muted-foreground text-xs">
          {ts("detail.yourPosition.closed")}
        </span>
      </>
    ) : (
      positionTag(position.isPoolManager)
    );
  const { totalValue, earnedToday, invested, totalYield, thisMonth, avgApy, seriesByPeriod } =
    props;
  const { positions, discover, availableToInvest, displayName } = props;

  if (positions.length === 0) {
    // POO-579 (Feature B): a freshly-referred user typically lands here (no positions yet), so the
    // one-time welcome banner sits above the empty state too.
    return (
      <div className="flex flex-col gap-6">
        <ReferralWelcomeBanner />
        <EmptyHome discover={discover} availableToInvest={availableToInvest} />
      </div>
    );
  }

  // Allocation by risk band, weighted by current value (reused on the desktop aside).
  const allocation = Array.from(
    positions
      .reduce((map, { position, strategy }) => {
        map.set(strategy.riskLevel, (map.get(strategy.riskLevel) ?? 0) + position.currentValue);
        return map;
      }, new Map<number, number>())
      .entries(),
  ).map(([level, value]) => ({ level, value }));

  return (
    <PersistedMaskProvider persistKey={INVESTOR_HIDE_VALUES_KEY}>
      <div className="flex flex-col gap-8">
        {/* POO-579 (Feature B): one-time referral-welcome banner, shown once right after a referral join. */}
        <ReferralWelcomeBanner />
        {/* Time-of-day greeting (owner displayName, else masked wallet) — same component as the
            manager Overview. POO-704: displayName is server-resolved and threaded in (real mode). */}
        <GreetingHeading className="text-xl" displayName={displayName} />
        {/* Hero + aside (allocation + referral on desktop) */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
          <PortfolioChartCard
            totalValue={totalValue}
            earnedToday={earnedToday}
            seriesByPeriod={seriesByPeriod}
          />
          <aside className="hidden flex-col gap-4 lg:flex">
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="mb-3 font-medium text-foreground text-sm">{t("allocationByRisk")}</p>
              <AllocationByRisk allocation={allocation} />
            </div>
            <ReferralCard />
          </aside>
        </section>

        {/* KPI row */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile
            label={t("invested")}
            // POO-843 R4: compact past $1M so a 7-figure balance fits the half-width tile at 375px.
            // POO-936 [R5]: a served NULL renders "not available yet", never $0.
            value={
              invested === null ? (
                tCommon("unavailable")
              ) : (
                <MaskableValue>{formatUsdTile(invested)}</MaskableValue>
              )
            }
          />
          <MetricTile
            label={t("totalYield")}
            value={totalYield === null ? tCommon("unavailable") : formatSignedUsdTile(totalYield)}
            valueTone={totalYield !== null && totalYield < 0 ? "negative" : "positive"}
          />
          <MetricTile
            label={t("thisMonth")}
            value={thisMonth === null ? tCommon("unavailable") : formatSignedUsdTile(thisMonth)}
            valueTone={thisMonth !== null && thisMonth < 0 ? "negative" : "positive"}
          />
          <MetricTile
            label={<AprTooltip average>{t("avgApy")}</AprTooltip>}
            value={formatPercent(avgApy)}
          />
        </section>

        {/* Your positions */}
        <section>
          <SectionHeader title={t("yourPositions")} href="/portfolio" seeAll={t("seeAll")} />

          {/* Mobile: compact cards. Stretched-link pattern (as PositionCard): the whole card opens
            the position; only the manager name re-enables pointer events to link to the profile. */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {positions.map(({ position, strategy }) => (
              <li
                key={position.id}
                className="relative rounded-lg border border-border bg-surface transition-colors hover:bg-surface-raised"
              >
                <div className="pointer-events-none flex items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {/* POO-713: strategy logo with an initials monogram fallback. */}
                    <StrategyLogo
                      url={strategy.logoUrl}
                      name={strategy.name}
                      className="size-10 shrink-0 text-sm"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium text-foreground text-sm">
                          {strategy.name}
                        </p>
                        {positionTags(position)}
                      </div>
                      <p className="mt-0.5 truncate text-muted-foreground text-xs">
                        <ManagerLink
                          handle={strategy.managerHandle}
                          address={strategy.managerAddress}
                          className="pointer-events-auto relative z-10"
                        >
                          {strategy.manager}
                          {/* POO-771 R7: the verified badge inline in the attribution cell, gated on
                              the embedded managerVerified (single badge source). */}
                          {strategy.managerVerified === true ? (
                            <BadgeCheck
                              className="ml-0.5 inline-block size-3.5 align-text-bottom text-info"
                              aria-label={ts("detail.managerVerified")}
                            />
                          ) : null}
                        </ManagerLink>
                      </p>
                      <div className="mt-1.5">
                        <RiskMeter level={strategy.riskLevel} />
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-foreground text-sm">
                      <MaskableValue>{formatUsd(position.currentValue)}</MaskableValue>
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        position.totalYield < 0 ? "text-destructive" : "text-success",
                      )}
                    >
                      {formatSignedUsd(position.totalYield)}
                    </p>
                  </div>
                </div>
                <PositionLink
                  positionId={position.id}
                  strategyId={strategy.id}
                  className="absolute inset-0 z-0"
                  ariaLabel={strategy.name}
                />
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-xl border border-border lg:block">
            <table className="w-full text-sm">
              <thead className="bg-surface text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    {t("columns.strategy")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    {t("columns.risk")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t("columns.invested")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t("columns.value")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t("columns.yield")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t("columns.rate")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium sr-only">
                    {t("manage")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {positions.map(({ position, strategy }) => (
                  <tr key={position.id} className="border-border border-t">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* POO-713: strategy logo with an initials monogram fallback. */}
                        <StrategyLogo
                          url={strategy.logoUrl}
                          name={strategy.name}
                          className="size-8 shrink-0 text-xs"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <PositionLink
                              positionId={position.id}
                              strategyId={strategy.id}
                              className="font-medium text-foreground hover:underline"
                            >
                              {strategy.name}
                            </PositionLink>
                            {positionTags(position)}
                          </div>
                          <p className="text-muted-foreground text-xs">
                            <ManagerLink
                              handle={strategy.managerHandle}
                              address={strategy.managerAddress}
                            >
                              {strategy.manager}
                              {/* POO-771 R7: the verified badge inline in the attribution cell. */}
                              {strategy.managerVerified === true ? (
                                <BadgeCheck
                                  className="ml-0.5 inline-block size-3.5 align-text-bottom text-info"
                                  aria-label={ts("detail.managerVerified")}
                                />
                              ) : null}
                            </ManagerLink>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RiskMeter level={strategy.riskLevel} />
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      <MaskableValue>{formatUsd(position.invested)}</MaskableValue>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground">
                      <MaskableValue>{formatUsd(position.currentValue)}</MaskableValue>
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3 text-right",
                        position.totalYield < 0 ? "text-destructive" : "text-success",
                      )}
                    >
                      {formatSignedUsd(position.totalYield)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {/* POO-653 [R1]: a closed position's rate is stale/uninformative, so the Rate
                          column is reclaimed to the muted em-dash placeholder (as the Discover empty
                          cells). Withdraw lives in its own column (next). Active rows keep the rate. */}
                      {position.status === "closed" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <RateLabel strategy={strategy} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {position.status === "closed" ? (
                        // POO-543 [R2][R3]: a closed position offers Withdraw (restrained red-tint,
                        // growth-first) in place of Manage, deep-linking to the detail's withdraw
                        // flow (?withdraw=1) so Home never mounts a second copy of the modal.
                        <Link
                          href={`/strategies/${strategy.id}?withdraw=1`}
                          className="inline-flex items-center rounded-md border border-destructive/40 bg-destructive/5 px-3 py-1.5 font-medium text-destructive text-sm hover:bg-destructive/10"
                        >
                          {ts("detail.actions.withdraw")}
                        </Link>
                      ) : (
                        <Link
                          href={`/strategies/${strategy.id}`}
                          className="inline-flex items-center gap-1 font-medium text-muted-foreground text-sm hover:text-foreground"
                        >
                          {t("manage")}
                          <ChevronRight className="size-4" aria-hidden="true" />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Discover */}
        <section>
          {/* "Available investments" on mobile, "Discover strategies" on desktop (per Figma). */}
          <div className="lg:hidden">
            <SectionHeader
              title={t("availableInvestments")}
              href="/strategies"
              seeAll={t("seeAll")}
            />
          </div>
          <div className="hidden lg:block">
            <SectionHeader title={t("discover")} href="/strategies" seeAll={t("seeAll")} />
          </div>

          {/* Mobile: auto-advancing carousel */}
          <div className="lg:hidden">
            <DiscoverCarousel strategies={discover} exploreLabel={t("exploreMore")} />
          </div>

          {/* Desktop: table — same columns as positions, with "—" where not owned yet */}
          <div className="hidden overflow-hidden rounded-xl border border-border lg:block">
            <table className="w-full text-sm">
              <thead className="bg-surface text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    {t("columns.strategy")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">
                    {t("columns.risk")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t("columns.invested")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t("columns.value")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t("columns.yield")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    {t("columns.rate")}
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium sr-only">
                    {investLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {discover.map((strategy) => (
                  <tr key={strategy.id} className="border-border border-t">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {/* POO-713: strategy logo with an initials monogram fallback. */}
                        <StrategyLogo
                          url={strategy.logoUrl}
                          name={strategy.name}
                          className="size-8 shrink-0 text-xs"
                        />
                        <div className="min-w-0">
                          <Link
                            href={`/strategies/${strategy.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {strategy.name}
                          </Link>
                          <p className="text-muted-foreground text-xs">
                            <ManagerLink
                              handle={strategy.managerHandle}
                              address={strategy.managerAddress}
                            >
                              {strategy.manager}
                              {/* POO-771 R7: the verified badge inline in the attribution cell. */}
                              {strategy.managerVerified === true ? (
                                <BadgeCheck
                                  className="ml-0.5 inline-block size-3.5 align-text-bottom text-info"
                                  aria-label={ts("detail.managerVerified")}
                                />
                              ) : null}
                            </ManagerLink>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <RiskMeter level={strategy.riskLevel} />
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                    <td className="px-4 py-3 text-right">
                      <RateLabel strategy={strategy} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/strategies/${strategy.id}`}
                        className="inline-flex rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground text-sm hover:bg-primary/90"
                      >
                        {investLabel}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </PersistedMaskProvider>
  );
}
