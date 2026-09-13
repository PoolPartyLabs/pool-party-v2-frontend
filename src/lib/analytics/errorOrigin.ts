/**
 * @id PP-CORE-LIB-085 (POO-1171, POO-1173)
 * @name analytics error origin
 * @implements-rules-version v2 (POO-1385 rules v2) · v1 (POO-1212 [2]) · v1 (POO-1173 rules v1)
 * @epic POO-1168 (Google Analytics: GTM, GA4, Hotjar)
 *
 * `TxErrorKind` -> `AnalyticsErrorOrigin`, as a total function.
 *
 * POO-1212 [2] is explicit that the origin is DERIVED, never invented alongside: `diagnostics.ts`
 * already produces `TxErrorKind`, so this is a fold over those kinds rather than a new fact about
 * the world. It lives here and not in `diagnostics.ts` so the transaction layer keeps no analytics
 * concern, and it is a `Record` over the union rather than a lookup object typed `string`, so
 * **adding a kind without deciding its origin is a compile error**. A parallel table that could
 * silently miss a kind is the thing POO-1212 says drifts within a quarter.
 *
 * ## Six values, not seven
 *
 * `pending` was removed as a category error (POO-1212 [2]): `user` / `funds` / `market` / `upstream`
 * / `app` / `unknown` all answer *"who caused this?"*, while `pending` answers *"did it finish?"*.
 * Those are orthogonal, and collapsing them means `error_origin IN ("app","upstream")` silently
 * excludes every failure that is pending because our own watcher gave up. Terminality is carried
 * separately.
 *
 * ## The tie-break rule for kinds with two real causes
 *
 * Two kinds genuinely have both an app cause and a user cause, and a single-origin fold cannot say
 * both. They are resolved by ONE rule, stated here so it is arguable rather than arbitrary:
 *
 * > **When a kind can be our fault or the user's, it maps to `app`.**
 *
 * The consumer of `error_origin` is alerting: `origin IN ("app","upstream")` is what wakes someone.
 * A false `app` costs one person one look at a dashboard. A false `user` hides a real defect
 * permanently, because nobody ever queries the bucket labelled "the user did this to themselves".
 * That asymmetry is the same one POO-1212 used to delete `pending`, applied consistently.
 *
 * Each such kind says so on its own line below. If a later reader disagrees, the argument to have is
 * about the rule, not about the individual entry.
 */
import type { TxErrorKind } from "@/lib/tx/diagnostics";

/**
 * Who caused a failure. Deliberately causal and deliberately small: a value here should change who
 * looks at it, otherwise it is a label rather than a signal.
 */
export const ANALYTICS_ERROR_ORIGINS = [
  /** The user chose this, or their wallet state did. Nothing to fix on our side. */
  "user",
  /** Not enough money or gas. Real, expected, and not a defect. */
  "funds",
  /** The chain or the pool moved. Slippage, deadlines, reverts on price. */
  "market",
  /** A third party we depend on was unavailable. */
  "upstream",
  /** Our defect. This is the bucket that must never quietly lose a member. */
  "app",
  /** Genuinely unclassified. Not a dumping ground: every kind below has a reasoned entry. */
  "unknown",
] as const;

export type AnalyticsErrorOrigin = (typeof ANALYTICS_ERROR_ORIGINS)[number];

/**
 * The fold. Exhaustive by type: `Record<TxErrorKind, …>` fails to compile the moment
 * `diagnostics.ts` grows a kind, which is the whole point of deriving rather than duplicating.
 */
export const TX_ERROR_KIND_TO_ORIGIN = {
  /** The pool moved between quote and execution. Nobody erred. */
  slippage: "market",
  /** The quote aged out. Same class as slippage: a market condition, not a defect. */
  deadlineExpired: "market",
  /** Not enough balance for the operation. */
  insufficientFunds: "funds",
  /** No native coin to pay for gas. Distinct product problem from `insufficientFunds`, same cause. */
  gasBlocked: "funds",
  /** The user declined the signature. Unambiguous. */
  userRejected: "user",
  /** A dependency was down. The one origin that is someone else's on-call. */
  upstreamUnavailable: "upstream",
  /**
   * TWO CAUSES, resolved to `app` by the rule above.
   *
   * `diagnostics.ts:102-105` is explicit that `assertProviderOnChain` catches the wallet's 4001
   * (the user DECLINING our corrective switch) and re-throws it as `WRONG_CHAIN` on purpose,
   * because "switch to Arbitrum" is that user's remedy. So this kind deliberately merges "the user
   * refused the switch" with "our switch failed for a reason that was not a refusal".
   *
   * Mapping it to `user` would be defensible on remedy, and wrong on cause: it would make every
   * failure of our own chain-switch invisible, and that failure is a real defect on a wallet app.
   */
  wrongChain: "app",
  /**
   * TWO CAUSES, resolved to `app` by the rule above (POO-1385).
   *
   * The dominant cause is the user's wallet: a Ledger Live session contains only the networks its
   * owner selected at pairing, and no code of ours can add one. On cause alone this reads `user`.
   *
   * It maps to `app` because of the SECOND source. The ladder also raises this kind when a switch
   * request is never ANSWERED, and it cannot tell a wallet that lacks the chain from a healthy wallet
   * that was merely slower than our 30 second bound. If that bound is ever too tight, `user` would
   * bury the evidence in the one bucket nobody queries, exactly as the rule above predicts.
   */
  chainUnavailable: "app",
  /**
   * TWO CAUSES, resolved to `app` by the rule above.
   *
   * Reached from the EIP-1193 code 4100 (the wallet says the account is not authorized, typically
   * because the user switched account behind our back) AND from the contract's `only pool manager`
   * revert AND from an expired session we failed to refresh. The first two are the user's state;
   * the third is ours, and it is a session dying in the middle of a money flow.
   */
  unauthorized: "app",
  /**
   * Our defect, unambiguously (confirmed by the product owner).
   *
   * The rail refused to re-send a leg that is already on chain. `diagnostics.ts` notes the money is
   * fine and the remedy is to reload into recovery, which is precisely the shape of a state-tracking
   * bug on our side: we lost track of what we had already broadcast.
   */
  alreadyBroadcast: "app",
  /**
   * POO-1173: `app`, and the argument is the METRIC DEFINITION rather than the tie-break rule above.
   *
   * The rule arbitrates "our fault or the user's". A generic revert is our fault or the MARKET's,
   * which the rule does not reach. What decides it is that the product failure rate is
   * `error_origin IN ("app","upstream")`, and `market` is excluded from that number exactly as
   * `unknown` is. So mapping a revert to `market` would move the most common on-chain failure from
   * one excluded bucket to another and deliver precisely zero improvement to the number POO-1173
   * exists to fix. Only `app` changes anything.
   *
   * Two supports. A price-caused revert already classifies as `slippage` BEFORE it can reach
   * `reverted`, so the "reverts on price" line under `market` above stays true as written and does
   * not conflict. And the API's own catalog says `TX_SIMULATION_REVERTED` is "the only `TX_*` code
   * that deserves an alert on its own", which is a statement that it belongs in the bucket that
   * wakes someone.
   */
  reverted: "app",
  /**
   * Our defect, and the API says so directly: "almost always a client-side defect rather than a
   * user one... a rise here means a frontend is sending something the contract will never accept."
   * There is no ambiguity to arbitrate here.
   */
  invalidParams: "app",
  /**
   * `app` by the tie-break rule, which does reach this one. A stale view is either our render that
   * did not refresh (ours) or a genuine race with another actor (nobody's). A false `app` costs one
   * look; classifying it as anything excluded from the failure rate would hide a refresh bug
   * permanently.
   */
  staleState: "app",
  /**
   * Neither our defect nor the user's: there is no executable route at this size right now.
   * Liquidity conditions, which is what `market` is for, alongside slippage. Deliberately NOT
   * `upstream`: that is the router being down, and this is the router answering correctly.
   */
  noRoute: "market",
  /**
   * POO-1711: the manager asked to move a range to the range it already has. `user`, for the same
   * reason `userRejected` is: nothing failed and nothing is broken, a person asked for a no-op and
   * the product said so. Counting it as `app` would inflate the product failure rate with a
   * correctly-handled input, which is exactly the distortion this map exists to prevent.
   */
  rangeUnchanged: "user",
  /**
   * POO-1763 [R9]: the chain, the RPC or the backend did not answer in time. `upstream`, alongside
   * `upstreamUnavailable`: infrastructure that will answer next time, not our defect and not the
   * user's. Counted in the failure rate, because a user still saw a failure.
   */
  transient: "upstream",
  /**
   * POO-1763 [R9]: a broadcast we could not confirm. `upstream`, alongside `transient`: the chain or
   * the RPC did not answer, not our defect and not the user's. Counted in the failure rate, since a
   * user still saw a failure they could not resolve on the spot.
   */
  confirmationTimeout: "upstream",
  /** Unclassified by the classifier itself. Honest, and the only entry that should stay small. */
  unknown: "unknown",
} as const satisfies Record<TxErrorKind, AnalyticsErrorOrigin>;

/** The origin for a kind. Total, so it never returns undefined and never needs a fallback. */
export function analyticsErrorOrigin(kind: TxErrorKind): AnalyticsErrorOrigin {
  return TX_ERROR_KIND_TO_ORIGIN[kind];
}
