/**
 * @id PP-MGR-SCR-001
 * @name ManagerConsoleScreen
 * @implements-rules-version v3 (POO-847 rules v1)
 *
 * v3 (POO-847 R3): the managed surface is desktop-only for now — below `lg` the `/manager?manage=`
 * deep link degrades to the INVESTOR detail (preserving a pending `?invest=` resume), gated on the
 * measured viewport (useIsDesktop; never a guess).
 *
 * v2 (POO-650): the greeting links to the viewer's OWN public profile by their CONNECTED wallet
 * address (identity=address), matching the address the greeting displays — not the mock handle. In
 * mock mode the connected address is undefined (no shared session), so it falls back to the labeled
 * MOCK_VIEWER_ADDRESS so the greeting stays a clickable link in the visual harness.
 *
 * Manager console landing — the client-side state machine for the whole console (murilo
 * 2026-06-10: tabs switch views inside /manager, no route change). A new manager (no strategies)
 * sees the first-run empty state; otherwise the Overview dashboard, the Manage-strategies list
 * (PP-MGR-SCR-003) and the per-strategy manage detail (PP-MGR-SCR-004) all render here. Manage
 * mutations flow back through local state so every view reflects them for the rest of the session.
 *
 * POO-520 R1: `/manager?manage=<id>&invest=<amount>` (the manager-origin Deposit & invest return)
 * opens the manage view AND re-arms its Add-liquidity modal at Confirm & sign with the amount; the
 * `invest` param is handled once and stripped.
 */
"use client";

import { Briefcase } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useRouter } from "@/i18n/navigation";
import { useAuth } from "@/lib/auth/useAuth";
import type { MediaUploadFn } from "@/lib/media/useUploadMedia";
import type {
  ManagerDashboard,
  ManagerProfile,
  ManagerStrategy,
  ManagerStrategyDetail,
} from "@/lib/schemas";
import { isMockMode, managerService } from "@/lib/services";
import { ConsoleShell } from "./components/ConsoleShell";
import type { SelectableConsoleTab } from "./components/ConsoleTabs";
import { ManagerDashboardView } from "./components/ManagerDashboardView";
import { ManagerProfileTabView } from "./components/ManagerProfileTabView";
import { ManageStrategiesView } from "./components/ManageStrategiesView";
import { StrategyManageView } from "./components/StrategyManageView";

// PP-MOCK: mock-mode viewer wallet sentinel. In mock mode useAuth().address is undefined per consumer
// (no shared session), so the greeting's own-profile link would collapse to plain text. This labeled
// stand-in keeps it a clickable /m/<address> link in the visual harness. It is a syntactically valid
// EVM address (0x + 40 hex) so the /m/<param> route's isEvmAddress branch accepts it and renders the
// synthesized profile; the long zero-run + `MOCK_VIEWER_ADDRESS` name mark it as a placeholder, and it
// truncates to `0x0000…0c96` in the greeting (never a real wallet).
const MOCK_VIEWER_ADDRESS = "0x0000000000000000000000000000000000000c96" as const;

/** Public props for {@link ManagerConsoleScreen}. */
export interface ManagerConsoleScreenProps {
  /** The manager's dashboard overview. */
  dashboard: ManagerDashboard;
  /** The manager's strategies; empty → first-run empty state. */
  strategies: ManagerStrategy[];
  /** The manager's public profile (drives the Profile tab). */
  profile: ManagerProfile;
  /**
   * Reads the manage-detail for a strategy. Injected with the real action in real mode (POO-304);
   * defaults to the mock `managerService.getStrategyDetail` in mock mode.
   */
  getStrategyDetail?: (strategyId: string) => Promise<ManagerStrategyDetail | null>;
  /**
   * Re-fetches the console payload after a manage mutation (real mode). The data loader wires this
   * to its own `refresh()`; in mock mode it is absent and the local-state sync alone keeps the view.
   */
  onConsoleRefresh?: () => void;
  /**
   * Strategy id to open directly in the manage view on mount. Set from `/manager?manage=<id>` when a
   * manager opens their own strategy from an investor surface (POO-224). Ignored when absent.
   */
  initialManageId?: string;
  /**
   * Real-mode only (POO-694): uploads a cropped Profile-tab avatar / banner Blob to media storage and
   * resolves its trusted CDN URL. The data loader injects these via `useUploadMedia`; mock mode omits
   * them so the crop stays a session-local preview. Threaded straight to {@link ManagerProfileTabView}.
   */
  onUploadAvatar?: MediaUploadFn;
  /** Real-mode only (POO-694): the banner counterpart of {@link onUploadAvatar}. */
  onUploadBanner?: MediaUploadFn;
  /**
   * POO-704: the owner's PUBLIC `displayName` (`/users/me`, POO-693), resolved server-side by the
   * page and forwarded to the console greeting via {@link ConsoleShell}. Blank/absent falls back to
   * the masked wallet; undefined in mock mode (the greeting uses the mock profile name).
   */
  displayName?: string;
}

/** Manager console — empty state, Overview, Manage list and manage detail (client-side views). */
export function ManagerConsoleScreen({
  dashboard,
  strategies: initialStrategies,
  profile: initialProfile,
  getStrategyDetail = managerService.getStrategyDetail,
  onConsoleRefresh,
  initialManageId,
  onUploadAvatar,
  onUploadBanner,
  displayName,
}: ManagerConsoleScreenProps) {
  const t = useTranslations("manager");
  const router = useRouter();
  // POO-847 R3: the managed surface is desktop-only — the manage deep link degrades below `lg`.
  const isDesktop = useIsDesktop();
  // POO-650: the connected wallet address (the SAME source the greeting displays, via GreetingHeading's
  // useAuth) drives the greeting's own-profile link, so it resolves to /m/<address> (identity=address),
  // not the mock handle. In mock mode useAuth().address is undefined (no shared session), so fall back
  // to the labeled MOCK_VIEWER_ADDRESS to keep the greeting a link in the visual harness.
  const { address: connectedAddress } = useAuth();
  const viewerAddress = connectedAddress ?? (isMockMode ? MOCK_VIEWER_ADDRESS : undefined);
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  // Live deep-link param read from the client URL (not the server-passed `initialManageId`), so the
  // reset-to-Overview effect below reacts to navigation without needing a server re-render (POO-341).
  const manageParam = searchParams.get("manage");
  // The active console tab is URL-driven (POO-341): `?tab=strategies|profile`, else Overview. A
  // deep-linked strategy (`initialManageId`) opens under the Strategies tab. Because the tab lives in
  // the URL, clicking the "Manager Console" entry (plain `/manager`) is a real navigation that resets
  // the console to Overview, even from a sub-tab.
  const tab: SelectableConsoleTab =
    tabParam === "strategies" || tabParam === "profile"
      ? tabParam
      : initialManageId
        ? "strategies"
        : "overview";
  const [strategies, setStrategies] = useState(initialStrategies);
  const [profile, setProfile] = useState(initialProfile);
  const [detail, setDetail] = useState<ManagerStrategyDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  // POO-520 R1: a manager-origin Deposit & invest returns to /manager?manage=<id>&invest=<amount>.
  // The validated amount re-arms the manage view's Add-liquidity modal at Confirm & sign (POO-494
  // resume rules). Handled once, then the `invest` param is stripped (keeping `manage` and any other
  // params) so a refresh or back navigation doesn't re-open the flow; mirrors StrategyDetailScreen.
  const [investResume, setInvestResume] = useState<number | null>(null);
  const investResumeHandled = useRef(false);
  useEffect(() => {
    if (investResumeHandled.current || !initialManageId) return;
    const raw = searchParams.get("invest");
    const amount = raw ? Number.parseFloat(raw) : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0) return;
    investResumeHandled.current = true;
    setInvestResume(amount);
    const params = new URLSearchParams(window.location.search);
    params.delete("invest");
    window.history.replaceState(
      null,
      "",
      params.size ? `${window.location.pathname}?${params}` : window.location.pathname,
    );
  }, [searchParams, initialManageId]);

  // Deep link: open a specific strategy's manage view on mount (from /manager?manage=<id>), once.
  // PP-SECURITY: the manage detail is only shown for a strategy in the wallet's OWNED set
  // (`strategies` is the ownership-filtered list from buildManagerConsole, which drops every
  // non-`isPoolManager` row). The deep-link reader (getManagerStrategyDetailAction) matches by
  // catalog id + pool/network only and does not verify ownership, so a wallet that deep-links
  // `?manage=<any public strategy id>` would otherwise render the manager view (move-range /
  // remove-liquidity / close) of a pool it does not manage. Gating on the owned set here closes
  // that authorization-display gap; an unowned id falls through to the existing not-found state.
  const deepLinked = useRef(false);
  // Refs keep the router + searchParams identities OUT of the effect deps: Next 15 patches
  // history.replaceState and syncs it into useSearchParams (so the POO-520 strip WOULD change its
  // identity a commit later), and the router is not contractually stable — either dep would re-run
  // the effect after consumption and the cleanup would cancel the in-flight detail read.
  const routerRef = useRef(router);
  routerRef.current = router;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  useEffect(() => {
    if (!initialManageId || deepLinked.current) return;
    // POO-847 R3: the managed surface is desktop-only — wait for the first viewport measurement
    // (never guess), then below `lg` degrade the deep link to the INVESTOR detail, preserving a
    // pending Deposit&invest resume (POO-520) as the investor detail's own `?invest=` param.
    if (isDesktop == null) return;
    if (!isDesktop) {
      deepLinked.current = true;
      const raw = searchParamsRef.current.get("invest");
      const amount = raw ? Number.parseFloat(raw) : Number.NaN;
      routerRef.current.replace(
        `/strategies/${initialManageId}${
          Number.isFinite(amount) && amount > 0 ? `?invest=${amount}` : ""
        }`,
      );
      return;
    }
    if (!initialStrategies.some((strategy) => strategy.id === initialManageId)) {
      deepLinked.current = true;
      setDetailError(true);
      return;
    }
    let active = true;
    getStrategyDetail(initialManageId).then((loaded) => {
      if (!active) return;
      // Consumed only on settle: a dep change mid-flight (cleanup cancels the read) leaves the
      // deep link unconsumed, so the re-run re-fetches instead of dying silently.
      deepLinked.current = true;
      if (loaded) setDetail(loaded);
      else setDetailError(true);
    });
    return () => {
      active = false;
    };
  }, [initialManageId, getStrategyDetail, initialStrategies, isDesktop]);

  // The "Manager Console" sidebar entry navigates to a bare /manager (no ?tab, no ?manage). Drop any
  // open detail so it fully resets the console to a clean Overview from ANY sub-screen — a manage
  // detail (opened in-console or deep-linked) or a sub-tab (POO-341). Keying off the live URL params
  // makes this fire on client navigation without depending on a server re-render of the deep-link
  // param, so it works in real mode too. Skip the first run so a deep-link mount (which sets `detail`
  // via the effect above, before the test URL settles) isn't wiped before it opens.
  const resetMounted = useRef(false);
  useEffect(() => {
    if (!resetMounted.current) {
      resetMounted.current = true;
      return;
    }
    if (!tabParam && !manageParam) setDetail(null);
  }, [tabParam, manageParam]);

  if (strategies.length === 0) {
    return (
      <EmptyState
        icon={<Briefcase className="size-10" aria-hidden="true" />}
        title={t("empty.title")}
        description={t("empty.subtitle")}
        action={
          // PP-INTEGRATION-POINT: routes to the strategy builder (placeholder until the wizard lands).
          <Button size="lg" onClick={() => router.push("/manager/new")}>
            {t("cta.createFirst")}
          </Button>
        }
      />
    );
  }

  /** Opens the manage detail for a strategy (from the list or the Overview table). */
  async function handleManage(strategyId: string) {
    // POO-847 R3: the managed surface is desktop-only — an in-console Manage tap below `lg`
    // (URL-reachable /manager on a phone) opens the investor detail instead. Mirror the deep-link
    // effect's guard: an UNMEASURED viewport (`null`, SSR / first client render) is NOT yet desktop,
    // so degrade to the investor detail rather than fall through to the desktop manage view.
    if (isDesktop !== true) {
      router.push(`/strategies/${strategyId}`);
      return;
    }
    // Reflect the Strategies tab in the URL so the "Manager Console" entry can later reset back to
    // Overview (POO-341); the open detail takes precedence over the tab while it is set.
    router.push("/manager?tab=strategies");
    // Real mode injects the OAMS-backed reader (POO-304); mock mode resolves locally.
    const loaded = await getStrategyDetail(strategyId);
    if (!loaded) {
      setDetailError(true);
      return;
    }
    setDetailError(false);
    setDetail(loaded);
  }

  /** A manage mutation landed: sync the detail and its list/Overview row. */
  function handleDetailChange(updated: ManagerStrategyDetail) {
    setDetail(updated);
    setStrategies((current) =>
      current.map((strategy) => (strategy.id === updated.id ? updated : strategy)),
    );
  }

  /** Switches console tabs via the URL (POO-341), leaving any open detail. */
  function handleSelectTab(next: SelectableConsoleTab) {
    setDetail(null);
    router.push(next === "overview" ? "/manager" : `/manager?tab=${next}`);
  }

  if (detail) {
    return (
      <StrategyManageView
        detail={detail}
        onBack={() => setDetail(null)}
        onDetailChange={handleDetailChange}
        onConsoleRefresh={onConsoleRefresh}
        // POO-520 R1: only the deep-linked strategy resumes the invest round-trip.
        investResume={detail.id === initialManageId ? investResume : null}
      />
    );
  }

  // POO-620 + POO-650: the greeting links to the viewer's OWN public profile by their CONNECTED wallet
  // address (identity=address), matching the address the greeting itself displays — NOT the mock
  // handle. Real mode: the connected wallet IS the manager, so /m/<address> is their real profile; the
  // /m/[handle] route synthesizes an address profile when no handle is registered (POO-618). Mock mode
  // uses the labeled MOCK_VIEWER_ADDRESS fallback so the greeting stays a link.
  const profileHref = viewerAddress ? `/m/${viewerAddress}` : undefined;

  if (tab === "profile") {
    return (
      <ConsoleShell
        active="profile"
        onSelectTab={handleSelectTab}
        profileHref={profileHref}
        displayName={displayName}
      >
        <ManagerProfileTabView
          profile={profile}
          onSaved={setProfile}
          onUploadAvatar={onUploadAvatar}
          onUploadBanner={onUploadBanner}
        />
      </ConsoleShell>
    );
  }

  if (tab === "strategies") {
    return (
      <ConsoleShell
        active="strategies"
        onSelectTab={handleSelectTab}
        profileHref={profileHref}
        displayName={displayName}
      >
        {detailError ? (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {t("manage.notFound")}
          </p>
        ) : null}
        <ManageStrategiesView strategies={strategies} onManage={handleManage} />
      </ConsoleShell>
    );
  }

  return (
    <ConsoleShell
      active="overview"
      onSelectTab={handleSelectTab}
      profileHref={profileHref}
      displayName={displayName}
    >
      <ManagerDashboardView
        dashboard={dashboard}
        strategies={strategies}
        onManageStrategy={handleManage}
      />
    </ConsoleShell>
  );
}
