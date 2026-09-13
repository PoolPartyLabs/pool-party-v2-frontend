/**
 * @id PP-CORE-LIB-095
 * @name toAnalyticsErrorCode
 * @implements-rules-version v1
 *
 * Resolve the `error_code` an analytics failure event should carry. POO-1173 D1 [R2].
 *
 * ## The defect this closes
 *
 * `toTxError` sets `code: String(providerCode)`, so an EIP-1193 wallet error arrives as the digits
 * `"4001"`. `isAnalyticsErrorCodeShape` requires `^[A-Z]`, so `sanitizeParams` DROPPED the param.
 * The single most common failure in the product, the user declining the wallet prompt, reached GA4
 * with **no `error_code` at all**. Not a wrong bucket, a blank dimension, on `deposit_failed` and
 * every other failure event. Measured by Rafael on 2026-08-08 and reproduced before this was
 * written.
 *
 * ## Code first, kind second, and the order is a resolved conflict rather than a preference
 *
 * POO-1173's original text asked for "kind first and only then the stable code", to stop one
 * condition splitting across two rows: a wallet rejection reported as `4001` by the provider and as
 * `USER_REJECTED` by the backend.
 *
 * Taken literally that instruction now conflicts with D3 [R2], which gave `TX_REVERTED` and
 * `TX_SIMULATION_REVERTED` a SINGLE kind on purpose and made `error_code` the thing that separates
 * them in GA4. Kind-first would collapse them and undo that decision.
 *
 * Resolving in favour of the code satisfies both, because a usable code is strictly more specific
 * than the kind it classifies to:
 *   - `TX_REVERTED` and `TX_SIMULATION_REVERTED` stay two rows, as D3 wanted.
 *   - `4001` is NOT usable, falls through to the kind, and resolves to `USER_REJECTED`, which is
 *     the same value the backend spelling resolves to. The split POO-1173 named is still closed.
 *
 * That preference is only real if the code can be FOUND. It is read from the whole error through
 * `collectErrorFacets`, the traversal `classifyTxError` uses, because an own `code` property is what
 * a raw EIP-1193 provider error carries and nothing else: every stable code this repo raises rides
 * on `error.cause.code`. Reading one own property would find none of them and leave this module
 * behaving exactly like the kind-first design argued against above.
 *
 * ## Never blank
 *
 * Every path ends at a shape-valid name. A missing dimension is worse than a coarse one: a coarse
 * bucket can be split later from the trace id, a blank row cannot be recovered at all.
 */
import { collectErrorFacets, type TxErrorKind } from "@/lib/tx/diagnostics";
import { isAnalyticsErrorCodeShape } from "./events";

/**
 * Kind → the name to report when the raw code cannot be used.
 *
 * A `Record` over the union, so adding a `TxErrorKind` is a type error here rather than a kind that
 * silently reports `SYSTEM_UNKNOWN`. That is the same interlock `errorOrigin.ts` and
 * `executionCopy.ts` already apply to origin and copy; this is the third consumer of the union and
 * the third decision a new kind must carry.
 *
 * Names follow the BACKEND's vocabulary wherever the backend has one, so a condition reported by
 * the API and the same condition inferred from a provider error land on ONE GA4 row rather than two
 * spellings of the same thing. Verified against `uBits-Capital/pool-party-api`
 * `src/common/errors/error-codes.ts` at `560c71a`.
 *
 * Exported for its own test. The `satisfies` clause pins the KEYS to the union but says nothing
 * about the VALUES, so a kind added as `REVERTED` or `TX-NO-ROUTE` would compile clean and put back
 * the blank dimension this module exists to remove. This table is the one path a resolved code does
 * NOT travel, so it is asserted directly rather than sampled through the two or three kinds a
 * behavioural test happens to reach.
 */
export const KIND_CODES = {
  slippage: "TX_SLIPPAGE_EXCEEDED",
  deadlineExpired: "TX_DEADLINE_EXPIRED",
  insufficientFunds: "TX_INSUFFICIENT_FUNDS",
  /** Not in the API catalog: the provider reports this, and `BACKEND_CODE_KINDS` expects the name. */
  userRejected: "USER_REJECTED",
  unauthorized: "TX_NOT_AUTHORIZED",
  /** Ours: raised by `assertProviderOnChain`, never by the API. */
  wrongChain: "WRONG_CHAIN",
  /** Ours: POO-1385, the wallet cannot offer the chain at all. */
  chainUnavailable: "CHAIN_UNAVAILABLE",
  /** Ours: the retry guard on an already-broadcast leg. */
  alreadyBroadcast: "TX_ALREADY_USED",
  upstreamUnavailable: "SYSTEM_UPSTREAM_UNAVAILABLE",
  /** Ours: raised by the provisioning planner before anything is broadcast. */
  gasBlocked: "PROVISIONING_GAS_BLOCKED",
  /**
   * The post-broadcast name, because a kind-derived revert is the one we raised ourselves. A
   * simulation revert always arrives WITH its own usable code, so it never reaches this table.
   */
  reverted: "TX_REVERTED",
  invalidParams: "TX_INVALID_PARAMS",
  staleState: "TX_STATE_CONFLICT",
  noRoute: "TX_NO_ROUTE",
  /** Ours: POO-1711, the move-range build's own "nothing to move" guard. Never sent by the API. */
  rangeUnchanged: "MOVE_RANGE_UNCHANGED",
  /**
   * Ours: POO-1763 [R9], the chain or the RPC did not answer. Reached only when the failure carried
   * no usable code of its own (an API `SYSTEM_TIMEOUT` keeps its own name); a bare RPC "Internal
   * JSON-RPC error" or a `withTimeout` rejection lands here.
   */
  transient: "SYSTEM_TRANSIENT",
  /** Ours: POO-1763 [R9], a broadcast whose receipt we could not confirm. Distinct from a plain
   * transient failure because the transaction may be on chain. */
  confirmationTimeout: "TX_CONFIRMATION_UNKNOWN",
  /** The honest floor. Shape-valid, so it is still a row rather than a hole. */
  unknown: "SYSTEM_UNKNOWN",
} as const satisfies Record<TxErrorKind, string>;

/**
 * Find the first USABLE code anywhere on an unknown throwable.
 *
 * `trackFailure` receives `unknown`, and the value can be a `TxError`, a raw EIP-1193 provider
 * error, a Nest error body or anything a `catch` produced. Reading a single own `code` would find
 * only the provider shape: every stable code this repo raises rides on `error.cause.code`
 * (`actionResult.ts:26` "so both land on error.cause", `buildPlanSteps.ts:1412`,
 * `sendTransaction.ts` and ~12 hook call sites), so an own-property read makes `TX_SIMULATION_REVERTED`,
 * `TX_POSITION_NOT_FOUND`, `WRONG_ACCOUNT` and every `PROVISIONING_*` unreachable, silently
 * degrading this module to the kind-first behaviour the header above argues would undo D3 [R2].
 *
 * So it walks {@link collectErrorFacets}, the SAME traversal `classifyTxError` walks. One traversal,
 * one answer: the code and the kind can no longer be read off different parts of the same error.
 *
 * Usable means a STRING that passes the shape guard. A numeric provider code is excluded by the
 * `typeof` test rather than by the guard, and deliberately so: turning `4001` into `"4001"` is what
 * created the blank dimension in the first place, and the kind resolves it to `USER_REJECTED`.
 */
function readCode(error: unknown): string | undefined {
  for (const code of collectErrorFacets(error).codes) {
    if (typeof code === "string" && isAnalyticsErrorCodeShape(code)) return code;
  }
  return undefined;
}

/**
 * The `error_code` to report for a classified transaction error.
 *
 * Pass the result straight to `track`; `sanitizeParams` will accept it by shape. Prefer
 * `trackFailure`, which calls this for you so no call site has to remember.
 */
export function toAnalyticsErrorCode(error: unknown, kind: TxErrorKind): string {
  // A usable code is more specific than the kind it classifies to, so it wins. This is what keeps
  // two codes sharing one kind distinguishable in GA4.
  return readCode(error) ?? KIND_CODES[kind];
}
