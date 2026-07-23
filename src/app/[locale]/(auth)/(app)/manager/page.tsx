import { setRequestLocale } from "next-intl/server";
import { ManagerConsoleDataLoader } from "@/features/manager/ManagerConsoleDataLoader";
import { ManagerConsoleScreen } from "@/features/manager/ManagerConsoleScreen";
import { loadOwnerDisplayName } from "@/lib/profile/loadInvestorProfile";
import { isMockMode, managerService } from "@/lib/services";

/** PP-MGR-SCR-001 — Manager console (Overview). Ships in v1 (not feature-flagged, murilo 2026-06-11). */
export default async function ManagerPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ manage?: string }>;
}) {
  const { locale } = await params;
  // Deep link: ?manage=<id> opens that strategy's manage view (a manager opening their own strategy
  // from an investor surface, POO-224).
  const { manage } = await searchParams;
  setRequestLocale(locale);

  // Real mode: a client boundary reads the connected wallet and derives the console from its
  // managed pools (isPoolManager positions ⋈ catalog, POO-224). Mock mode: SSR the mock console.
  if (!isMockMode) {
    // POO-704: the owner's PUBLIC displayName for the greeting, read server-side from the SIWE-session
    // identity (same seam the profile page + Home use); blank/absent → masked wallet. The greeting
    // shows the person's public name, not the manager handle (a URL slug). A hard identity outage
    // degrades to undefined so the console still renders (its data loads client-side) — this real
    // branch had no server-side dependency before POO-704.
    const displayName = await loadOwnerDisplayName();
    return (
      <div className="flex flex-col gap-6">
        <ManagerConsoleDataLoader initialManageId={manage} displayName={displayName} />
      </div>
    );
  }

  const [dashboard, strategies] = await Promise.all([
    managerService.getDashboard(),
    managerService.listStrategies(),
  ]);
  // PP-INTEGRATION-POINT: the authenticated manager's own profile. POO-659: looked up by the stable
  // id — the wallet address when present (the unfilled dev manager has no handle), else the handle.
  const managerId = dashboard.address ?? dashboard.handle;
  const profile = await managerService.getProfile(managerId);
  if (!profile) throw new Error(`manager profile missing for id "${managerId}"`);
  return (
    <div className="flex flex-col gap-6">
      <ManagerConsoleScreen
        dashboard={dashboard}
        strategies={strategies}
        profile={profile}
        initialManageId={manage}
      />
    </div>
  );
}
