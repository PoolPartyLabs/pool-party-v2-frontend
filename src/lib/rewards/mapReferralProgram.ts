/**
 * @id PP-REW-LIB-003 (POO-661, POO-853)
 * @name mapReferralProgram
 * @implements-rules-version v1
 *
 * ACL mapper: the deployed pp-api `/referral/:wallet` record (or null) -> the FE `ReferralProgram`.
 * Encodes the POO-661 field-gap decisions explicitly so nothing is fabricated or dropped:
 *
 * - `code` <- `code` when non-empty (an empty string means "not a referrer" -> null, matching the mock
 *   one-time-code lifecycle where `code === null` is the pre-creation empty state).
 * - `inviteLink` <- the canonical `?ref=<code>` invite URL via {@link referralUrl} (POO-853 [R3], the
 *   as-typed `?ref=` form that POO-718 capture reads back), or null when there is no code. The dead
 *   `/r/<code>` route form was retired here (it 404s in v2 and attributed nobody).
 * - `friendsJoined` <- `referees.length`.
 * - `invites` <- one entry per referee. `/referral` carries only `wallet` + `createdAt` per referee, so
 *   `name` is the masked wallet, `status` defaults to `"pending"` (this endpoint has no invest/earn
 *   signal — that lives in the separate `/referral/:wallet/operations` endpoint), and `investedUsd` is
 *   left absent (never fabricated). PP-INTEGRATION-POINT (POO-652): a richer backend fills name/status/
 *   investedUsd from a per-referee operations join.
 * - `rewardUsd` / `minInvestUsd` are PROGRAM CONSTANTS (not per-user), kept in sync with the mock.
 * - `totalEarnedUsd` <- 0. `/referral` exposes no USD-earned aggregate; PP-INTEGRATION-POINT (POO-652):
 *   sourced from the referral rewards backend when it surfaces one (POO-584) — never fabricated here.
 * - `invitedByCode` <- `referredBy.code` (POO-579, Feature A): the code of whoever referred THIS wallet,
 *   for the referee "Invited by <code>" view. `null` when the record has no `referredBy` (not a referee)
 *   or a partial `referredBy` with no code; never fabricated.
 */
import type { ReferralProgram } from "@/lib/schemas";
import { referralUrl } from "@/lib/urls";
import { maskAddress } from "@/lib/utils/address";
import type { ApiReferral } from "./referralApiSchema";

/**
 * Give-get reward per qualified referral, in USD. Program constant (not per-user); mirrors the mock
 * fixture (`src/mocks/data/rewards.ts`). PP-NOTE: if the backend ever exposes program config, source
 * both constants from there instead.
 */
export const REFERRAL_REWARD_USD = 10;
/** Minimum first investment a referred friend must make to qualify, in USD. Program constant. */
export const REFERRAL_MIN_INVEST_USD = 50;

/**
 * Map the pp-api referral record (or null) into a `ReferralProgram`. A null record (wallet has no
 * referral entry) maps to the empty program: no code, no invites, zero earnings.
 */
export function mapReferralProgram(api: ApiReferral | null): ReferralProgram {
  const referees = api?.referees ?? [];
  const code = api?.code != null && api.code.length > 0 ? api.code : null;
  return {
    rewardUsd: REFERRAL_REWARD_USD,
    minInvestUsd: REFERRAL_MIN_INVEST_USD,
    // PP-INTEGRATION-POINT (POO-652): no USD-earned aggregate on /referral yet; never fabricate.
    totalEarnedUsd: 0,
    friendsJoined: referees.length,
    code,
    // POO-853 [R3]: the canonical `?ref=` invite link (code as-typed), never the dead `/r/` route.
    inviteLink: code ? referralUrl(code) : null,
    // POO-579 (Feature A): who referred this wallet, for the referee "Invited by <code>" view. Null
    // when there is no (or a code-less) referredBy record; never fabricated.
    invitedByCode: api?.referredBy?.code ?? null,
    // PP-INTEGRATION-POINT (POO-652): /referral carries only wallet+createdAt per referee, so name is
    // the masked wallet and status is "pending" (no invest/earn signal here). A richer backend
    // (per-referee operations join) fills name/status/investedUsd.
    invites: referees.map((referee) => ({
      name: maskAddress(referee.wallet),
      status: "pending" as const,
    })),
  };
}
