import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import {
  computeManagerStats,
  synthesizeManagerProfile,
} from "@/features/manager/lib/synthesizeManagerProfile";
import { ManagerProfileScreen } from "@/features/manager/ManagerProfileScreen";
import { getSessionWallet } from "@/lib/auth/session";
import { fetchManagerProfile } from "@/lib/manager/profile/fetchManagerProfile";
import type { Strategy } from "@/lib/schemas";
import { isMockMode, managerService } from "@/lib/services";
import { listStrategies } from "@/lib/strategies/strategyCatalog";
import { isEvmAddress } from "@/lib/utils/address";

/**
 * PP-MGR-SCR-005 — public manager profile at `/m/<param>`. Investor-facing discovery (reached by
 * clicking a manager name/address next to a strategy/position) and is not gated. POO-618: `<param>`
 * is EITHER a handle OR a wallet address. Resolution (POO-631):
 * 1. A registered profile (handle or address) renders as-is; its strategies are filtered by
 *    `managerHandle` OR `managerAddress`.
 * 2. Else, if `<param>` is a wallet address that runs strategies (matched by `managerAddress`, real
 *    data from `/pools`), render a GENERIC profile synthesized from those strategies (masked address +
 *    computed stats) — no manager-profile DB needed.
 * 3. Else 404.
 *
 * POO-781 (@implements-rules-version v1): the catalog drain and the profile read are parallelized
 * (`Promise.all`) — they have no data dependency, so overlapping them shaves +1 cold-path RTT.
 *
 * POO-895 (@implements-rules-version v1): when the resolved profile's wallet equals the viewer's
 * SERVER-trusted identity (SIWE session wallet in real mode [R1]; the mock dashboard's manager
 * address in mock mode [R6]), the screen gets `isOwner` and shows an "Edit profile" action. The
 * check is case-insensitive; a signed-out viewer, a different wallet, or an address-less profile
 * is simply not the owner, never an error [R3][R4]. Both resolution branches pass the flag, so the
 * owner's own synthesized (no-registry-row) profile invites them to fill it in [R5].
 */
export default async function ManagerProfilePage({
  params,
}: {
  params: Promise<{ locale: string; handle: string }>;
}) {
  const { locale, handle: param } = await params;
  setRequestLocale(locale);

  // POO-781 R1: the live-catalog drain and the registered-profile read have NO data dependency on each
  // other (both results are consumed unconditionally below), and in real mode the catalog is a
  // multi-RTT cold drain. Run them concurrently so the profile RTT overlaps the drain instead of
  // serializing after it, shaving +1 cold-path RTT. Rendering semantics are identical.
  // POO-579: real mode reads the deployed manager-profile registry (`GET /managers/:handleOrAddress`);
  // mock mode reads the in-session mock service.
  // POO-895 [R1][R6]: the viewer identity joins the same concurrent read wave (no data dependency).
  // Real mode reads the SIWE session wallet (the identity the backend trusts; null when the cookie is
  // missing/expired/malformed [R4]); mock mode has no SIWE cookie, so the mock owner identity is the
  // dashboard's manager address (DEV_MANAGER_ADDRESS).
  const [all, registered, viewerWallet] = await Promise.all([
    listStrategies(),
    isMockMode ? managerService.getProfile(param) : fetchManagerProfile(param),
    isMockMode
      ? managerService.getDashboard().then((dashboard) => dashboard.address ?? null)
      : getSessionWallet(),
  ]);
  const viewer = viewerWallet?.toLowerCase() ?? null;
  // [R1][R3]: owner = profile wallet equals the viewer wallet, case-insensitively; no session or no
  // profile address resolves as not-owner.
  const ownsAddress = (address: string | undefined): boolean =>
    Boolean(viewer && address && address.toLowerCase() === viewer);

  // 1. A registered profile.
  if (registered) {
    const address = registered.address?.toLowerCase();
    const strategies = all.filter(
      (strategy) =>
        (Boolean(registered.handle) && strategy.managerHandle === registered.handle) ||
        (Boolean(address) && strategy.managerAddress?.toLowerCase() === address),
    );
    // The registry does NOT own stats (a separate POO-579 aggregation wave), so compose them from the
    // manager's `/pools`-derived strategies in real mode. Mock profiles keep their fixture stats.
    const profile = isMockMode
      ? registered
      : { ...registered, stats: computeManagerStats(strategies) };
    return (
      <ManagerProfileScreen
        profile={profile}
        strategies={strategies}
        isOwner={ownsAddress(registered.address)}
      />
    );
  }

  // 2. No registered profile: an address that runs strategies gets the generic, synthesized profile.
  // POO-895 [R5]: the owner still gets the Edit action here, inviting them to create their profile.
  if (isEvmAddress(param)) {
    const target = param.toLowerCase();
    const owned = all.filter(
      (strategy: Strategy) => strategy.managerAddress?.toLowerCase() === target,
    );
    if (owned.length > 0) {
      return (
        <ManagerProfileScreen
          profile={synthesizeManagerProfile(param, owned)}
          strategies={owned}
          isOwner={ownsAddress(param)}
        />
      );
    }
  }

  // 3. Unknown handle, and not an address with strategies.
  notFound();
}
