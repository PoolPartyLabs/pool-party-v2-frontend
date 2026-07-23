/**
 * @id PP-MGR-SCR-001 · PP-CORE-LIB-049 (POO-991)
 * @name ManagerDashboardView
 * @implements-rules-version v3 · v1 (POO-901: referral-aware invite link + copy field) · v1 (POO-991:
 *   honest-null net-inflows + earnings tiles after dropping the legacy /analytics/wallets read)
 *
 * PP-CORE-LIB-049 (POO-991) [R3]: the net-inflows caption and the earnings card (total + performance)
 * render `common.unavailable` when their `dashboard.*` value is null — those tiles source only from the
 * C1 /financials payload (no on-chain Σ), so a null payload / served-null field is honest absence, not
 * a fabricated $0 (mirrors the investor HomeView precedent).
 *
 * POO-901 v1: the "Share your strategies" invite link carries the manager's referral code once one
 * exists — `?ref=<code>` appended via `managerProfileReferralUrl` ([R1], shared `useReferral` state,
 * so the surface upgrades in place when the code resolves) — and the plain-text link box became a
 * copy field ([R4], the rewards `ReferralField`: read-only value + copy button + copied confirmation
 * + the `reward_referral_shared` event). The `ShareInviteButton` stays and shares the same resolved
 * URL ([R5]).
 *
 * v3 (POO-655): the "Share your strategies" invite link is the manager's public profile URL, the
 * handle if set, else the connected wallet address (identity=address, matching the greeting).
 *
 * POO-659 v1: the invite link prefers the dashboard's own address over the connected wallet
 * (`dashboard.handle || dashboard.address || address`). `dashboard.address` is the authoritative
 * manager identity — real mode populates it in `buildManagerConsole` from the authenticated wallet
 * (the manager profile's `walletAddress`, else the session wallet) — so an unfilled, neutralized
 * manager (no handle) still resolves to `/m/<address>` instead of a broken `pool-party.xyz/m/`. The
 * connected wallet stays the last-resort fallback.
 *
 * v2 (POO-650): the Entry / Exit fee rows in the "Fees earned" card are hidden for now (both $0.00);
 * PP-DEBT POO-651 restores them with the official referral program. Keys + data are left intact.
 *
 * The manager console Overview panel body: an AUM hero (total + 30d change + net inflows +
 * AUM-over-time chart) with a share-your-strategies aside, a KPI row, and a "Your strategies" table
 * (mobile cards / desktop table; ACTIVE strategies only — POO-553, murilo 2026-07-04; was ALL statuses
 * with a per-row chip, murilo 2026-06-10. Paused/closed live in the Manage-strategies status tabs).
 * Strategy names open the client-side manage detail. The surrounding console chrome (greeting +
 * "Create new strategy" CTA + in-screen tabs) now lives in the shared ConsoleShell (POO-451), which
 * wraps this and every other selectable tab. This is the populated state of the console; the
 * first-run empty state lives in ManagerConsoleScreen.
 *
 * POO-669 (rules-v1): the "Your strategies" list is a CLIENT-SIDE "Load more" reveal ([R1]) over the
 * active-strategy list — the first page (5) rows, +5 per click via {@link useRevealCount}.
 * ONE reveal count feeds BOTH layouts (mobile cards + desktop table), so a single "Load more" grows
 * them together; the button sits after both, working at any breakpoint. This list is NOT server-paged:
 * the console derives it from the wallet's positions drain, and a closed managed pool that dropped out
 * of `/pools` (POO-373) is still shown via the position-synth fallback (POO-455/537) that
 * `/pools/all?poolManager=` cannot serve (see the feature README endpoint-gap note). The Overview has
 * no status filter, so the reveal has no resetKey: it only grows, and a same-set 45s/focus/
 * router.refresh refetch keeps the revealed count ([R2] DO-NOT-RESET, POO-628). This REPLACES the
 * POO-627 windowing on this list ([R3]); the shared VirtualCardList/VirtualTableBody primitives and
 * their own tests stay intact elsewhere.
 *
 * The manage detail is owned by the parent console and rendered OUTSIDE this list ([R3]); the KPI
 * aggregates read `dashboard.*`, decoupled from the row list, so the reveal changes only which rows
 * render, never the tiles ([R1]).
 */
"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { MaskableValue } from "@/components/data-display/MaskableValue";
import { MetricTile } from "@/components/data-display/MetricTile";
import { PerformanceChart } from "@/components/data-display/PerformanceChart";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { Button } from "@/components/ui/Button";
import { EyeToggle } from "@/components/ui/EyeToggle";
import { ReferralField } from "@/features/rewards/components/ReferralField";
import { ShareInviteButton } from "@/features/rewards/components/ShareInviteButton";
import { useReferral } from "@/features/rewards/useReferral";
import { useRevealCount } from "@/hooks/useRevealCount";
import { useAuth } from "@/lib/auth/useAuth";
import { EphemeralMaskProvider } from "@/lib/hooks/maskValue";
import type { ManagerDashboard, ManagerStrategy } from "@/lib/schemas";
import { absoluteUrl, managerProfileReferralUrl, managerProfileUrl } from "@/lib/urls";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatSignedUsd, formatUsd, formatUsdTile } from "@/lib/utils/format";
import { StrategyStatusChip } from "./StrategyStatusChip";

/** Public props for {@link ManagerDashboardView}. */
export interface ManagerDashboardViewProps {
  /** The manager's dashboard overview. */
  dashboard: ManagerDashboard;
  /** The manager's strategies (at least one — the empty case is handled upstream). */
  strategies: ManagerStrategy[];
  /** Opens the client-side manage detail for a strategy. */
  onManageStrategy: (strategyId: string) => void;
}

/** Manager console Overview (populated). */
export function ManagerDashboardView({
  dashboard,
  strategies,
  onManageStrategy,
}: ManagerDashboardViewProps) {
  const t = useTranslations("manager");
  // POO-901 [R6]: the copy field reuses the rewards.referral.* keys (no new strings).
  const tRewards = useTranslations("rewards");
  // PP-CORE-LIB-049 (POO-991) [R3]: net inflows + earnings have no on-chain Σ, so a null value renders
  // the honest `common.unavailable` affordance ("Not available yet"), never a fabricated $0 (mirrors
  // the investor HomeView precedent). No new key — `common.unavailable` exists in every locale.
  const tCommon = useTranslations("common");
  // POO-655 / POO-659: the invite link = the manager's public profile URL, the handle if set, else the
  // dashboard's own address (the authoritative manager identity), else the connected wallet as a
  // last resort. An unfilled, neutralized manager (no handle) resolves to /m/<dashboard.address>,
  // never a broken /m/: real mode populates dashboard.address in buildManagerConsole from the
  // authenticated wallet (the manager profile's walletAddress, else the session wallet). The ""
  // fallback is unreachable in practice (dashboard.address is set whenever a wallet is connected).
  const { address } = useAuth();
  const inviteSlug = dashboard.handle || dashboard.address || address || "";
  // POO-901 [R1]: once the manager has created a referral code (shared useReferral state), the
  // invite URL carries ?ref=<code>; until then (no code, or the program still loading) it is the
  // plain profile URL. Derived per render, so the surface upgrades in place when the code resolves.
  const { program: referralProgram } = useReferral();
  const referralCode = referralProgram?.code ?? null;
  const inviteUrl = referralCode
    ? managerProfileReferralUrl(inviteSlug, referralCode)
    : managerProfileUrl(inviteSlug);
  const positive = dashboard.aumChangePct >= 0;
  // POO-555 R2: the 30d change pill only renders alongside a plottable series; an uncovered manager
  // must not see a measured-looking "0.0%" while the chart correctly hides itself.
  const showAumChange = dashboard.chart.length >= 2;
  // POO-553: the Overview "Your strategies" list shows only ACTIVE strategies (was ALL statuses with a
  // per-row chip, murilo 2026-06-10 → active-only, murilo 2026-07-04). Paused/closed live in the
  // Manage-strategies view's status tabs.
  const activeStrategies = strategies.filter((strategy) => strategy.status === "active");
  // POO-669 [R1]: one client-side reveal over the active list, shared by BOTH layouts (mobile cards +
  // desktop table). No status filter here, so no resetKey: the count only grows, and a same-set
  // refetch preserves it (POO-628 DO-NOT-RESET). One "Load more" (below both layouts) grows them
  // together; `slice` clamps naturally when a refetch yields fewer rows than are revealed.
  const { count, revealMore } = useRevealCount();
  const revealedStrategies = activeStrategies.slice(0, count);
  const hasMoreStrategies = activeStrategies.length > revealedStrategies.length;
  // POO-560 R1: the weekly-active delta only exists when there is a real weekly-active source
  // (`activeWoWPct` a number). Real mode has none yet (POO-561), so it is null and the tile renders
  // NO delta line rather than a fabricated "▲ +0% vs last week".
  const activeWoWPct = dashboard.activeWoWPct;
  const activeWoWDelta =
    activeWoWPct === null
      ? undefined
      : t("dashboard.kpi.activeWoW", {
          delta: `${activeWoWPct >= 0 ? "▲ +" : "▼ "}${activeWoWPct}%`,
        });
  return (
    // The manager console opens with values REVEALED (eye open by default, murilo 2026-06-30); the
    // EyeToggle still covers them on demand (ephemeral, re-reveals every load).
    <EphemeralMaskProvider defaultMasked={false}>
      {/* The greeting + create CTA + console tabs now live in the shared ConsoleShell (POO-451); this
          view is just the Overview panel body. */}
      <div className="flex flex-col gap-6">
        {/* Hero: AUM + chart, with the share aside on desktop */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <p className="text-muted-foreground text-xs">{t("dashboard.totalAum")}</p>
                <EyeToggle label={t("dashboard.hideValues")} />
              </div>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-semibold text-3xl text-foreground">
                  <MaskableValue>{formatUsd(dashboard.aum)}</MaskableValue>
                </span>
                {showAumChange ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs",
                      positive
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {positive ? (
                      <TrendingUp className="size-3" aria-hidden="true" />
                    ) : (
                      <TrendingDown className="size-3" aria-hidden="true" />
                    )}
                    {/* POO-555 R3: the window is fixed at 30d, so say so. */}
                    {formatPercent(Math.abs(dashboard.aumChangePct))} · {t("window30d")}
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">
                {/* PP-CORE-LIB-049 [R3]: a null net-inflows figure (no C1 payload / served null) renders
                    a single muted "not available yet" caption, never a fabricated "$0.00 net inflows". */}
                {dashboard.netInflows30d === null
                  ? tCommon("unavailable")
                  : t("dashboard.netInflows", {
                      amount: formatSignedUsd(dashboard.netInflows30d),
                    })}
              </p>
            </div>
            {/* POO-736 R1: the headline AUM is the live pool value; the chart's last point is a daily
                snapshot, so annotate the divergence (mirrors the manage detail). Only with a real series. */}
            {showAumChange ? (
              <p className="text-muted-foreground text-xs">
                {t("manage.performance.snapshotNote")}
              </p>
            ) : null}
            <PerformanceChart data={dashboard.chart} ariaLabel={t("dashboard.chartLabel")} />
          </div>
          <aside className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
            <p className="font-medium text-foreground text-sm">{t("dashboard.share.title")}</p>
            <p className="text-muted-foreground text-xs">{t("dashboard.share.body")}</p>
            {/* POO-901 [R4]: a copy field (the rewards ReferralField: read-only value + copy button
                with a copied confirmation). It displays and copies the FULL absolute URL — ?ref=
                included when the code exists ([R5]: always the currently resolved URL). */}
            <ReferralField
              label={tRewards("referral.link")}
              value={absoluteUrl(inviteUrl)}
              copyLabel={tRewards("referral.copyLink")}
              copiedLabel={tRewards("referral.shared")}
            />
            <ShareInviteButton
              url={inviteUrl}
              label={t("dashboard.share.cta")}
              copiedLabel={t("manage.shareCopied")}
            />
          </aside>
        </section>

        {/* KPI row */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile
            label={t("dashboard.kpi.yield")}
            // POO-843 R4: compact past $1M so a 7-figure yield fits the half-width tile at 375px.
            value={formatUsdTile(dashboard.yieldGenerated)}
            valueTone="positive"
          />
          <MetricTile
            // POO-743 (rules-v2): current/active investors (on-chain open positions). The week-over-
            // week active delta belongs here (a monotonic all-time count carries no WoW). POO-560 R1:
            // no delta when there is no weekly-active source (activeWoWDelta is undefined).
            label={t("dashboard.kpi.activeInvestors")}
            value={dashboard.totalInvestors.toLocaleString("en-US")}
            delta={activeWoWDelta}
            deltaTone={activeWoWPct !== null && activeWoWPct >= 0 ? "positive" : "negative"}
          />
          <MetricTile
            // POO-743 (rules-v2): all-time distinct investors (monotonic) from the C1 /financials
            // `totalInvestors` (field 14, manager-EXCLUDED); a full withdrawal does NOT decrement it.
            // Degrades to the on-chain current sum when financials is unavailable (PP-CORE-LIB-049).
            label={t("dashboard.kpi.totalInvestorsAllTime")}
            value={dashboard.totalInvestorsAllTime.toLocaleString("en-US")}
          />
          <MetricTile
            label={<AprTooltip average>{t("dashboard.kpi.apy")}</AprTooltip>}
            value={formatPercent(dashboard.avgApy)}
          />
        </section>

        {/* Earnings + referrals (POO-227 R5). Unique/current investors already sit in the KPI row
          above; the weekly-active delta only shows when a real source exists (POO-560 R1), so only
          these two cards are net-new here. */}
        <section className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-foreground text-sm">
                {t("dashboard.earnings.title")}
              </h2>
              <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                {t("dashboard.earnings.allTime")}
              </span>
            </div>
            {/* PP-CORE-LIB-049 [R3]: earnings (all-time perf fees) have no on-chain Σ, so a null renders
                the honest unavailable affordance, never a fabricated $0.00. */}
            <p className="mt-2 font-bold text-2xl text-foreground">
              {dashboard.earnings.totalUsd === null
                ? tCommon("unavailable")
                : formatUsd(dashboard.earnings.totalUsd)}
            </p>
            <dl className="mt-4 flex flex-col gap-2 border-border border-t pt-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{t("dashboard.earnings.performance")}</dt>
                <dd className="font-medium text-foreground">
                  {dashboard.earnings.performanceUsd === null
                    ? tCommon("unavailable")
                    : formatUsd(dashboard.earnings.performanceUsd)}
                </dd>
              </div>
              {/* POO-650: the Entry / Exit fee rows (both $0.00 today) are hidden for now. The i18n
                  keys (dashboard.earnings.entry/.exit) and the data (earnings.entryUsd/.exitUsd) are
                  left intact so restoring is a pure re-add.
                  PP-DEBT(SEV:LOW) POO-651: restore these two rows with the official referral program. */}
            </dl>
          </div>
          <MetricTile
            label={t("dashboard.kpi.referrals")}
            value={dashboard.referrals.toLocaleString("en-US")}
            delta={t("dashboard.kpi.referralsSub")}
          />
        </section>

        {/* Your strategies */}
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-foreground text-lg">{t("dashboard.yourStrategies")}</h2>

          {activeStrategies.length === 0 ? (
            <p className="rounded-xl border border-border border-dashed px-4 py-8 text-center text-muted-foreground text-sm">
              {t("strategies.empty.active")}
            </p>
          ) : (
            <>
              {/* Mobile: cards. POO-669 [R1]: a plain sliced `.map()` over the REVEALED active
                  strategies — one <li> per revealed card. The <ul> keeps the accessible list name +
                  its `flex flex-col gap-2` inter-card gap; the per-card box lives on the inner div. */}
              <ul
                aria-label={t("dashboard.yourStrategies")}
                className="flex flex-col gap-2 lg:hidden"
              >
                {revealedStrategies.map((strategy) => (
                  <li key={strategy.id}>
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
                      <StrategyLogo
                        url={strategy.logoUrl}
                        name={strategy.name}
                        initials={strategy.initials}
                        className="size-9 shrink-0 text-xs"
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onManageStrategy(strategy.id)}
                            className="truncate text-left font-medium text-foreground text-sm hover:text-primary"
                          >
                            {strategy.name}
                          </button>
                          {strategy.status !== "active" ? (
                            <StrategyStatusChip status={strategy.status} />
                          ) : null}
                        </span>
                        <span className="truncate text-muted-foreground text-xs">
                          {strategy.category}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-medium text-foreground text-sm">
                          <MaskableValue>{formatUsd(strategy.aum)}</MaskableValue>
                        </span>
                        <span className="text-success text-xs">{formatPercent(strategy.apy)}</span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onManageStrategy(strategy.id)}
                        className="shrink-0"
                      >
                        {t("dashboard.manage")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Desktop: table. POO-669 [R1]: a plain <tbody> over the REVEALED active strategies —
                  one <tr> per revealed row, driven by the same shared reveal count as the mobile list
                  so "Load more" grows both together. */}
              <div className="hidden overflow-x-auto rounded-xl border border-border lg:block">
                {/* table-fixed + explicit column widths keep the columns STABLE when values are masked,
                so toggling the eye never reflows the layout. */}
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col />
                    <col className="w-[150px]" />
                    <col className="w-[120px]" />
                    <col className="w-[150px]" />
                    <col className="w-[110px]" />
                    <col className="w-[120px]" />
                  </colgroup>
                  <thead className="bg-surface text-muted-foreground text-xs">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left font-medium">
                        {t("dashboard.columns.strategy")}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        {t("dashboard.columns.aum")}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        {t("dashboard.columns.investors")}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        {t("dashboard.columns.flows")}
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        <AprTooltip>{t("dashboard.columns.apy")}</AprTooltip>
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        <span className="sr-only">{t("dashboard.manage")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {revealedStrategies.map((strategy) => (
                      <tr key={strategy.id} className="border-border border-t">
                        <td className="px-4 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <StrategyLogo
                              url={strategy.logoUrl}
                              name={strategy.name}
                              initials={strategy.initials}
                              className="size-8 shrink-0 text-xs"
                            />
                            <div className="flex min-w-0 flex-col">
                              <span className="flex min-w-0 items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => onManageStrategy(strategy.id)}
                                  className="truncate text-left font-medium text-foreground hover:text-primary"
                                >
                                  {strategy.name}
                                </button>
                                {strategy.status !== "active" ? (
                                  <StrategyStatusChip status={strategy.status} />
                                ) : null}
                              </span>
                              <span className="text-muted-foreground text-xs">
                                {strategy.category}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">
                          <MaskableValue>{formatUsd(strategy.aum)}</MaskableValue>
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">
                          {strategy.investors.toLocaleString("en-US")}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right",
                            strategy.flows30d >= 0 ? "text-success" : "text-destructive",
                          )}
                        >
                          {formatSignedUsd(strategy.flows30d)}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground">
                          {formatPercent(strategy.apy)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => onManageStrategy(strategy.id)}
                          >
                            {t("dashboard.manage")}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* POO-669 [R1]: one "Load more" for BOTH layouts (the shared reveal count grows the
                  mobile cards + desktop rows together). Hidden once every active strategy is revealed. */}
              {hasMoreStrategies ? (
                <button
                  type="button"
                  onClick={revealMore}
                  className="self-center rounded-lg border border-border bg-surface px-5 py-2.5 font-medium text-foreground text-sm transition-colors hover:bg-surface/70 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("loadMore")}
                </button>
              ) : null}
            </>
          )}
        </section>
      </div>
    </EphemeralMaskProvider>
  );
}
