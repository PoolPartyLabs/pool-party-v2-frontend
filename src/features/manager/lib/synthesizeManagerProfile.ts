/**
 * @id PP-MGR-LIB-003
 * @name synthesizeManagerProfile
 * @implements-rules-version v1
 *
 * Builds a GENERIC public manager profile for a wallet that runs strategies but has not filled a
 * profile in the manager-profile DB (POO-631, follows POO-618 / POO-620). REAL data only: the
 * display fields stay empty (the profile screen shows the masked address + hides them, POO-618) and
 * the headline stats are computed from the manager's own strategies. Used by the `/m/<address>` route
 * when `managerService.getProfile(address)` has no record.
 *
 * PP-INTEGRATION-POINT: the rich profile (name / bio / socials / handle / photo / banner) comes from
 * the manager-profile DB (POO-630 / POO-576 / POO-579); until then an address resolves to this
 * generic profile.
 */
import type { ManagerProfile, Strategy } from "@/lib/schemas";

/**
 * Compose a manager's headline stats from their `strategies` (real data): AUM = sum of managed value,
 * investors = sum, strategies = count, and a TVL-weighted blended rate (a simple mean when the managed
 * value is 0, and 0 when there are no strategies). Shared by the synthesized generic profile AND the
 * registered-profile read (POO-579): the manager-profile registry does NOT own stats, so a real
 * registered profile composes them here from the same `/pools`-derived strategies.
 */
export function computeManagerStats(strategies: Strategy[]): ManagerProfile["stats"] {
  const aum = strategies.reduce((total, strategy) => total + strategy.tvl, 0);
  const investors = strategies.reduce((total, strategy) => total + strategy.investors, 0);
  const weighted = strategies.reduce(
    (total, strategy) => total + strategy.estReturn * strategy.tvl,
    0,
  );
  const avgApy =
    aum > 0
      ? weighted / aum
      : strategies.length > 0
        ? strategies.reduce((total, strategy) => total + strategy.estReturn, 0) / strategies.length
        : 0;
  return { aum, investors, strategies: strategies.length, avgApy };
}

/**
 * Synthesize a generic {@link ManagerProfile} for `address` from its `strategies` (R1/R2). Display
 * fields are empty (the screen degrades to the masked address); stats are the manager's aggregates
 * ({@link computeManagerStats}).
 */
export function synthesizeManagerProfile(address: string, strategies: Strategy[]): ManagerProfile {
  return {
    handle: "",
    address,
    name: "",
    bio: "",
    // POO-745: a synthesized (address-only) manager has never requested verification.
    managerVerification: "none",
    sinceLabel: "",
    socials: {},
    stats: computeManagerStats(strategies),
  };
}
