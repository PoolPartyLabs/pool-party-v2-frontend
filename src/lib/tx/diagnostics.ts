/**
 * @id PP-CORE-LIB-012 (POO-1093, POO-1107, POO-1135, POO-1251, POO-1403, POO-1173)
 * @name tx diagnostics
 * @implements-rules-version v4 (POO-1763 rules v2 [R9]: the `transient` kind) · v1 (POO-1403 rules v1) · v2 (POO-1385 rules v2) · v3 (POO-1135 / POO-1129 rules v3) · v1 (POO-1026 rules v1) · v1 (POO-1044 rules v1) · v1 (POO-1107 rules v1) · v1 (POO-1251 rules v1) · v1 (POO-1173 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Client-environment diagnostics for the transaction error-details box (PP-CORE-MOD-002 v2,
 * POO-279 R1/R2): browser, OS, wallet kind and active app language, plus the full "Copy error"
 * payload builder. Pure functions only — the React side lives in `useTxDiagnostics`. The payload
 * goes to the clipboard ONLY; analytics never receives `error.message` (error.tsx rule R3).
 *
 * POO-461 (v1): the central transaction-error CATALOG lives here too. `classifyTxError` maps a
 * thrown failure to a machine-readable {@link TxErrorKind} with the precedence stable backend code
 * → message patterns → provider codes (R2); `toTxError` attaches the kind so every error view (and
 * the POO-467 slippage auto-retry) can branch on `TxError.kind` instead of string-matching locally.
 *
 * POO-1251 (v4): `TxError` also carries the backend's `correlationId`, and the copy payload leads
 * with it. See {@link buildErrorReport} for what the clipboard may and may not contain, and why.
 *
 * POO-1403: for an ON-RAMP failure the payload carries a SECOND id, the vendor's own
 * ({@link ErrorReportContext.paybisRequestId}). Ours finds our trace and Paybis has never heard of
 * it; theirs is the only handle on the purchase, which is the only thing that answers "was this
 * person charged". Passed in by the on-ramp surfaces alone, so the generic dialog is unchanged [R4].
 */
import { redactSecrets } from "@/lib/observability/redact";

/** Machine classification of a transaction failure (POO-461 R1). */
export type TxErrorKind =
  | "slippage"
  | "deadlineExpired"
  | "insufficientFunds"
  | "userRejected"
  | "unauthorized"
  /**
   * POO-1026: the wallet is on a different chain than the transaction targets. Thrown by the single
   * broadcast choke point (`sendTransaction.ts`) after its one corrective switch fails. Load-bearing
   * for cross-chain provisioning, where a plan legitimately switches networks between legs.
   */
  | "wrongChain"
  /**
   * POO-1385: the wallet cannot offer the operation's chain AT ALL, so there is nothing to switch to.
   *
   * One keystroke from `wrongChain` in this union and the opposite instruction to the user, which is
   * exactly why it is separate. `wrongChain` means the wallet has the network and is pointed
   * elsewhere: move it. This means the network is not in the wallet, and no amount of switching will
   * produce it. A Ledger Live session carries only the chains its owner selected when pairing, so a
   * user with Arbitrum alone gets this for every Base or Polygon strategy, and "switch to Base" sends
   * them hunting for a control that does not exist in their session.
   *
   * Also covers a switch request the wallet never ANSWERS, which is what that session actually does
   * with an out-of-namespace chain: it does not refuse, it goes quiet.
   */
  | "chainUnavailable"
  /**
   * POO-1093: this leg is already on chain and the rail refused to send it again. Distinct from a
   * generic failure in the only way that matters to the user: the money is fine, and the corrective
   * action is to reload into recovery rather than to press the button again.
   */
  | "alreadyBroadcast"
  /**
   * POO-1107: a route could not be PRICED because the upstream was unavailable, not because no
   * route exists. Separate from a funding shortfall precisely because the two need opposite things
   * from the user: wait and retry, versus find more money.
   */
  | "upstreamUnavailable"
  /**
   * POO-1044: the chain the operation runs on holds no native coin, so it cannot pay for a
   * transaction and no route can be planned into it. Raised by the provisioning planner, never by a
   * wallet: nothing was broadcast and nothing failed on-chain. It is catalogued because it is one of
   * the few failures the user can actually resolve, and because the generic "something went wrong"
   * body would tell them nothing about what to do.
   */
  | "gasBlocked"
  /**
   * POO-1173: the transaction reverted. Covers BOTH sides of the broadcast line on purpose: our own
   * post-broadcast `TX_REVERTED` (`sendTransaction.ts`, gas spent, the transaction mined and failed)
   * and the API's pre-broadcast `TX_SIMULATION_REVERTED` (nothing sent, nothing paid).
   *
   * ONE kind rather than two because a kind's job is to drive the user-facing copy, and today both
   * render the identical generic view. `error_code` separates them in GA4, which is where the
   * distinction currently earns anything. Split this the moment product wants different copy for
   * "you paid gas for nothing" versus "we stopped you before you paid"; that is a rules question for
   * the modal lanes, not for the classifier.
   *
   * Before this existed both classified as `unknown`, which excluded the most common on-chain
   * failure from `error_origin IN ("app","upstream")`, the product failure rate.
   */
  | "reverted"
  /**
   * POO-1173: the contract rejected the ARGUMENTS (tick range, zero address, permit batch, missing
   * swap path, minimum investment). The API's own catalog says it plainly: "almost always a
   * client-side defect rather than a user one... a rise here means a frontend is sending something
   * the contract will never accept."
   *
   * Catalogued rather than folded into `unknown` for exactly that reason: it is the code that most
   * directly measures OUR defects, so burying it in the one bucket excluded from the failure rate
   * would hide the thing the metric exists to surface.
   */
  | "invalidParams"
  /**
   * POO-1173: the position or pool exists, but its on-chain state forbids the operation (closed,
   * paused, mid-move-range, still holding liquidity, nothing to collect, at its position cap), or
   * no position exists for the supplied id at all. The user's view is stale; the remedy is to
   * re-read and re-decide.
   *
   * `TX_STATE_CONFLICT` and `TX_POSITION_NOT_FOUND` share this kind because they share that remedy,
   * and the remedy is what the copy has to say. They stay distinguishable in GA4 by `error_code`.
   */
  | "staleState"
  /**
   * POO-1173: no executable route exists for this amount and pair (Uniswap's routing 404). Distinct
   * from `upstreamUnavailable`, which is the router being DOWN: here the router answered correctly
   * and the answer is that the trade cannot be made right now. Liquidity conditions, so neither our
   * defect nor the user's, which is why it folds to `market` alongside slippage.
   */
  | "noRoute"
  /**
   * POO-1711: the manager asked to move a range to the range it already has. Nothing is wrong and
   * nothing failed; there is simply nothing to do.
   *
   * Catalogued rather than left `unknown` because it is the ONE move-range refusal the manager can
   * act on directly, and because it is the replacement for POO-319's `0/0` guard, whose copy ("No
   * rebalance is possible for this range. Try a different one.") was wrong in exactly the way that
   * matters: it blamed the range for a condition that was not about the range at all. This kind
   * exists so the copy can say the true thing instead.
   */
  | "rangeUnchanged"
  /**
   * POO-1763 [R9]: the chain, the RPC, the backend or the wallet did not answer, or answered "not
   * now" (a timeout, an unreachable upstream, a throttle, a dropped RPC answer, a nonce race). The
   * one class a second attempt can fix, which is why it gets its own copy ("try again in a moment")
   * and why `withTransientRetry` (PP-CORE-LIB-104) may act on it once, on work that broadcasts
   * nothing. Deliberately LAST among the message patterns: a rejection that mentions a timeout is a
   * rejection, and a revert wrapped in an "Internal JSON-RPC error" envelope is a revert. Excludes
   * the post-broadcast family (receipt-confirmation timeout, `nonce too low`, `already known`,
   * `replacement transaction underpriced`): those may already be on chain, and are handled below.
   */
  | "transient"
  /**
   * POO-1763 [R9]: we broadcast, then the confirmation poll hit its ceiling with no answer
   * (`TX_CONFIRMATION_UNKNOWN`, `sendTransaction.ts`). One keystroke from `transient` in this union
   * and the opposite thing to say to the user, which is exactly why it is separate: `transient` means
   * nothing was sent, so retry; this means something WAS sent and we could not confirm it, so the copy
   * must not claim the funds are untouched and must not offer a blind retry. It carries the tx hash so
   * the user can check their own wallet, which the copy tells them to do.
   */
  | "confirmationTimeout"
  | "unknown";

/**
 * Stable machine codes from the pool-party-api build endpoints → kind (POO-461 R2a).
 *
 * POO-1173: the note that stood here said "the API currently throws prose-only errors; once the
 * build endpoints return these stable codes, this map becomes the primary classification source."
 * It was deleted because it had been false since POO-1253 shipped the `TX_*` domain, and because
 * describing a live map as aspirational is exactly what let the drift below survive unnoticed.
 *
 * THE DRIFT, worth keeping so it is not repeated: the four original rows were keyed on un-prefixed
 * names written while the map was speculative. The API then shipped every one of them with a `TX_`
 * prefix. Lookup is an exact key match, so NONE of the backend's codes reached this map. Slippage,
 * deadline and insufficient-funds still classified correctly, but only through
 * {@link MESSAGE_PATTERN_KINDS} reading English prose, which is why nobody noticed: the fallback
 * was quietly covering for a dead primary. The rest classified as `unknown` and dropped out of the
 * product failure rate.
 *
 * The legacy un-prefixed keys are KEPT alongside the prefixed ones. They cost nothing, and any
 * caller or older deployment still emitting them keeps classifying rather than silently regressing
 * to `unknown`. `backendCodeCatalog.test.ts` asserts the two forms agree.
 *
 * Verified against `uBits-Capital/pool-party-api` `src/common/errors/error-codes.ts` at `560c71a`,
 * 2026-08-08.
 */
const BACKEND_CODE_KINDS: Record<string, TxErrorKind> = {
  SLIPPAGE_EXCEEDED: "slippage",
  // POO-1173: the `TX_`-prefixed twins the API actually sends today.
  TX_SLIPPAGE_EXCEEDED: "slippage",
  TX_DEADLINE_EXPIRED: "deadlineExpired",
  TX_INSUFFICIENT_FUNDS: "insufficientFunds",
  TX_NOT_AUTHORIZED: "unauthorized",
  // Both sides of the broadcast line, one kind. See `reverted` in TxErrorKind for why.
  TX_REVERTED: "reverted",
  TX_SIMULATION_REVERTED: "reverted",
  // The contract refused the arguments: our defect, not the user's.
  TX_INVALID_PARAMS: "invalidParams",
  // Stale view, same remedy for both: re-read and re-decide.
  TX_STATE_CONFLICT: "staleState",
  TX_POSITION_NOT_FOUND: "staleState",
  // The router answered, and the answer is that the trade cannot be made right now.
  TX_NO_ROUTE: "noRoute",
  // The cross-cutting twin of PROVISIONING_UPSTREAM_UNAVAILABLE below, which was mapped alone.
  SYSTEM_UPSTREAM_UNAVAILABLE: "upstreamUnavailable",
  // POO-1763 [R9]: the API client's own transient envelopes (`apiFetch`): a timed-out request, an
  // unreachable backend, a throttle. All three answer to "try again in a moment", and a caller that
  // cannot move funds may do that once on its own (`withTransientRetry`).
  SYSTEM_TIMEOUT: "transient",
  SYSTEM_NETWORK_ERROR: "transient",
  SYSTEM_RATE_LIMITED: "transient",
  // POO-1763 [R9]: the broadcast-but-unconfirmed timeout. Its own kind, NOT `transient`, because the
  // transaction may be on chain (`sendTransaction.ts` `waitForReceipt`).
  TX_CONFIRMATION_UNKNOWN: "confirmationTimeout",
  // POO-1173: ours, thrown by the broadcast choke point when the connected account is not the one
  // the transaction was built for. `unauthorized` already covers the EIP-1193 4100 case.
  WRONG_ACCOUNT: "unauthorized",
  DEADLINE_EXPIRED: "deadlineExpired",
  INSUFFICIENT_FUNDS: "insufficientFunds",
  // POO-1141: the provisioning planner's own shortfall code (`buildPlan`), whose message names the
  // covered-vs-required base units and carries no "insufficient funds" prose, so the message-pattern
  // fallback never caught it and it classified as `unknown`. The kind already exists; this is the map.
  PROVISIONING_INSUFFICIENT_FUNDS: "insufficientFunds",
  USER_REJECTED: "userRejected",
  NOT_AUTHORIZED: "unauthorized",
  UNAUTHORIZED: "unauthorized",
  // POO-1026: emitted by assertProviderOnChain, not by the API.
  WRONG_CHAIN: "wrongChain",
  // POO-1385: emitted by the chain ladder and by the choke point, also never by the API.
  CHAIN_UNAVAILABLE: "chainUnavailable",
  // POO-1044: emitted by the provisioning planner (`buildPlan`) before anything is broadcast.
  PROVISIONING_GAS_BLOCKED: "gasBlocked",
  // POO-1093: the retry guard. Distinct from a generic failure because the money is fine and
  // the corrective action is to reload into recovery, never to press the button again.
  PROVISIONING_LEG_ALREADY_BROADCAST: "alreadyBroadcast",
  PROVISIONING_UPSTREAM_UNAVAILABLE: "upstreamUnavailable",
  // POO-1711: ours, thrown by the move-range build step before any server call. Never sent by the
  // API. Replaces the POO-319 `0/0` guard, which threw with NO code at all and therefore landed on
  // the `MOVE_RANGE_FAILED` fallback with `kind: "unknown"` and generic copy.
  MOVE_RANGE_UNCHANGED: "rangeUnchanged",
};

/**
 * Message patterns → kind (POO-461 R2b), first match wins. Mirrors the backend's
 * `checkIsSlippageError` ("slippage error" / "price slippage check" / "too little received"), its
 * contract-selector prose ("Transaction deadline has expired", "Unauthorized access", insufficient
 * funds) and the common wallet/Uniswap revert strings, so wallet-side rejections classify even
 * before the R5 stable codes exist.
 */
const MESSAGE_PATTERN_KINDS: [RegExp, TxErrorKind][] = [
  [/user rejected|user denied|rejected the request/i, "userRejected"],
  // Precedence is intentional: slippage's "insufficient output amount" must be matched before the
  // generic "insufficient funds" below. Both share the "insufficient" token and this list is
  // first-match-wins, so a slippage revert would otherwise be misclassified as a funds error.
  [/slippage|too little received|price slippage check|insufficient output amount/i, "slippage"],
  [/deadline|transaction too old|signature has expired/i, "deadlineExpired"],
  [/insufficient funds|exceeds the balance|insufficient balance/i, "insufficientFunds"],
  [/unauthorized|not authorized|only pool manager/i, "unauthorized"],
  // POO-1385: a chain the wallet does not HAVE, matched BEFORE the wrongChain pattern below.
  // "unrecognized chain" used to live in that pattern, which told a wallet without the network to
  // switch to it. First-match-wins, so the order IS the fix, not a stylistic preference.
  [
    /unrecognized chain|unsupported chain|chain (?:id )?\d*\s*(?:is )?not (?:approved|added|available|enabled)/i,
    "chainUnavailable",
  ],
  // POO-1026: a wallet-side mismatch that carries no stable code. Deliberately LAST so a message
  // that ALSO reads as a rejection ("user rejected the network switch") keeps `userRejected`.
  // This ordering does NOT govern the choke point's declined-switch path: `assertProviderOnChain`
  // catches the wallet's 4001 and re-throws with the WRONG_CHAIN code, which is resolved above,
  // before any message pattern runs — so a declined corrective switch classifies as `wrongChain`
  // on purpose ("switch to Arbitrum" is that user's remedy). See `wrongChain.test.ts`.
  [/chain mismatch|wrong network|targets chain \d+/i, "wrongChain"],
  // POO-1763 [R9]: a revert that arrives WITHOUT its stable code (a -32603 whose nested reason is
  // "execution reverted"). Matched BEFORE the transient patterns below, because the envelope of such
  // an error ("Internal JSON-RPC error.") reads as transient while the reason does not, and a
  // revert will fail the same way twice.
  [/execution reverted|reverted on-chain/i, "reverted"],
  // POO-1763 [R9]: the chain, the RPC or the backend did not answer, or answered "not now", on work
  // that broadcast nothing. Every specific kind above wins first (a rejection that mentions a timeout
  // is a rejection; a nested revert stays a revert). Deliberately EXCLUDES the post-broadcast family
  // (`nonce too low`, `replacement transaction underpriced`, `already known`, and the receipt-
  // confirmation timeout): those mean a transaction with that nonce is already in the mempool or
  // mined, so "nothing moved, try again" would be a false claim and a re-broadcast a double-send.
  // The receipt timeout is kept out by carrying `TX_CONFIRMATION_UNKNOWN` (classified above by code),
  // and the mempool strings are simply not matched here, so they fall to `unknown` (their pre-POO-1763
  // behaviour). This pattern is reached only by a codeless, pre-broadcast timeout/network/rate-limit.
  [
    /timed out|timeout|did not answer|failed to fetch|networkerror|network error|socket hang up|econnreset|too many requests|rate limit|internal json-rpc error/i,
    "transient",
  ],
];

/** EIP-1193 provider error codes → kind (POO-461 R2c). */
const PROVIDER_CODE_KINDS: Record<number, TxErrorKind> = {
  4001: "userRejected",
  4100: "unauthorized",
  // EIP-3326 "Unrecognized chain ID" (POO-1385): the wallet does not have this network.
  4902: "chainUnavailable",
};

/** How deep to walk an error's `cause` chain when collecting codes + messages. */
const MAX_CAUSE_DEPTH = 4;

/** POO-1763 [R9]: is a `TimeoutError` (`withTimeout`) anywhere on the cause chain? */
function hasTimeoutErrorName(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
    if (typeof current !== "object") return false;
    const source = current as { name?: unknown; cause?: unknown };
    if (source.name === "TimeoutError") return true;
    current = source.cause;
  }
  return false;
}

/**
 * Collect every code and message reachable from an error (own props, `data`, `cause` chain).
 *
 * Exported for `toAnalyticsErrorCode` (PP-CORE-LIB-095), which must read the code from the SAME
 * traversal that produced the kind. An own `code` is what a raw EIP-1193 provider error carries;
 * every stable code this repo raises rides on `cause` instead (`actionResult.ts`,
 * `buildPlanSteps.ts`, `sendTransaction.ts`), so a second reader that looked only at the own
 * property would silently disagree with the classifier on every house error.
 *
 * Order is walk order: own `code`, then `data.code`, then the same pair one `cause` deeper, which
 * is the precedence `classifyTxError` already relies on (the outermost thrower wins).
 */
export function collectErrorFacets(error: unknown): {
  codes: (string | number)[];
  messages: string[];
} {
  const codes: (string | number)[] = [];
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
    if (typeof current === "string") {
      messages.push(current);
      break;
    }
    if (typeof current !== "object") break;
    const source = current as {
      code?: string | number;
      message?: string;
      shortMessage?: string;
      data?: { code?: string | number; message?: string };
      cause?: unknown;
    };
    if (source.code != null) codes.push(source.code);
    if (typeof source.message === "string") messages.push(source.message);
    if (typeof source.shortMessage === "string") messages.push(source.shortMessage);
    if (source.data != null && typeof source.data === "object") {
      if (source.data.code != null) codes.push(source.data.code);
      if (typeof source.data.message === "string") messages.push(source.data.message);
    }
    current = source.cause;
  }
  return { codes, messages };
}

/**
 * Classify a thrown transaction failure into a {@link TxErrorKind} (POO-461 R1/R2). Precedence:
 * (a) a stable backend code anywhere on the error/cause chain, (b) message patterns across every
 * reachable message (incl. the reason a -32603 nests under `data.message`), (c) numeric EIP-1193
 * provider codes. Anything unmapped is `"unknown"` and keeps the generic error view (R4).
 */
export function classifyTxError(error: unknown): TxErrorKind {
  const { codes, messages } = collectErrorFacets(error);
  for (const code of codes) {
    const kind = typeof code === "string" ? BACKEND_CODE_KINDS[code.toUpperCase()] : undefined;
    if (kind) return kind;
  }
  // POO-1763 [R9]: our own `withTimeout` rejection, by NAME, whatever message the caller gave it.
  if (hasTimeoutErrorName(error)) return "transient";
  const haystack = messages.join("\n");
  for (const [pattern, kind] of MESSAGE_PATTERN_KINDS) {
    if (pattern.test(haystack)) return kind;
  }
  for (const code of codes) {
    const numeric = typeof code === "number" ? code : Number.parseInt(String(code), 10);
    const kind = Number.isFinite(numeric) ? PROVIDER_CODE_KINDS[numeric] : undefined;
    if (kind) return kind;
  }
  return "unknown";
}

/** A structured transaction error: machine code + raw provider message (POO-279 R1). */
export interface TxError {
  /** Error code (JSON-RPC / provider), e.g. "-32603". */
  code: string;
  /** Raw provider message, shown verbatim in the error-details box. */
  message: string;
  /**
   * Machine classification (POO-461 R1); drives the kind-specific error copy and the POO-467
   * slippage auto-retry. Optional so legacy hand-built errors stay valid; absent reads as unknown.
   */
  kind?: TxErrorKind;
  /**
   * POO-1026 [R2]: the chain the transaction targets, when the failure is a chain mismatch. Carried
   * explicitly by the thrower rather than parsed out of the message, so the copy layer can name the
   * network ("Switch to Arbitrum") instead of showing a generic failure. Absent on every other kind,
   * and legitimately absent on a hand-built wrongChain error [R4].
   */
  targetChainId?: number;
  /**
   * POO-1037: the hash of a transaction that WAS broadcast before this error was raised.
   *
   * Almost every failure in this app happens before anything reaches a chain, and for those it is
   * absent. It exists for the one case where it is not: a bridge leg whose source transaction mined
   * and whose funds have not arrived on the destination chain yet. `useWalletSignFlow` only records
   * a hash a step RETURNS, so without this the user would be told their transfer is in flight and
   * given no way to verify it. Carried by the thrower on `cause`, exactly like {@link targetChainId}.
   */
  txHash?: string;
  /**
   * POO-1251 [R1]: the cross-service correlation id for the failed call, shown on the error dialog
   * and copied to the clipboard as the ONE value that lets support find the trace.
   *
   * Resolved by `apiFetch` as `error.correlationId ?? x-request-id` (`src/lib/api/client.ts`),
   * carried across the RSC boundary on `BuildTxFailure` because a THROWN Server Action error is
   * masked in production, and re-attached here off `cause`, exactly like {@link targetChainId}.
   * Absent for a failure that never reached the backend (a wallet rejection, a client-side guard),
   * where the dialog falls back to the browser's own Sentry trace id.
   */
  correlationId?: string;
}

/**
 * Convert a thrown operation error into the structured {@link TxError} the error view renders. A
 * `TransactionError` carries the provider code on `error.cause.code`; a plain provider error carries it
 * on `error.code` (e.g. 4001 user-rejected, -32603 internal). Falls back to `fallbackCode` (per
 * operation) when no code is present. Kept here so every flow/modal maps errors identically.
 * POO-461 R1: also attaches the {@link TxErrorKind} classification.
 */
export function toTxError(error: unknown, fallbackCode = "TX_FAILED"): TxError {
  const kind = classifyTxError(error);
  if (error instanceof Error) {
    const cause = error.cause as
      | {
          code?: string | number;
          targetChainId?: number;
          txHash?: string;
          correlationId?: string;
        }
      | undefined;
    const causeCode = cause?.code;
    const ownCode = (error as { code?: string | number }).code;
    const code = causeCode ?? ownCode;
    // POO-1026 [R2]: read the target chain from the cause first (where the choke point attaches it),
    // then the error itself. Left undefined when neither carries it [R4].
    const targetChainId =
      cause?.targetChainId ?? (error as { targetChainId?: number }).targetChainId;
    // POO-1037: same lookup for a hash that already reached a chain (a bridge still settling).
    const txHash = cause?.txHash ?? (error as { txHash?: string }).txHash;
    // POO-1251 [R1]: same lookup again for the backend's correlation id. Empty strings are dropped
    // with the nullish ones, so the dialog can never render a blank reference row.
    const correlationId =
      cause?.correlationId || (error as { correlationId?: string }).correlationId;
    return {
      code: code != null ? String(code) : fallbackCode,
      message: error.message,
      kind,
      ...(targetChainId != null ? { targetChainId } : {}),
      ...(txHash != null ? { txHash } : {}),
      ...(correlationId ? { correlationId } : {}),
    };
  }
  return { code: fallbackCode, message: String(error), kind };
}

/** The environment snapshot rendered in the error box and embedded in the copy payload. */
export interface TxDiagnostics {
  /** Browser brand + major version, e.g. "Chrome 146". */
  browser: string;
  /** Operating system + version when available, e.g. "macOS 26.5". */
  os: string;
  /** Wallet backing the session, already localized (e.g. "Privy · Embedded"). */
  wallet: string;
  /** Active app language, e.g. "English (en-US)". */
  language: string;
}

/** Narrow view of the (still experimental) `navigator.userAgentData` surface. */
interface UserAgentData {
  brands?: { brand: string; version: string }[];
  platform?: string;
}

/** Fallback when a field cannot be determined (non-browser context, exotic UA). */
const UNKNOWN = "Unknown";

/** Pick the most meaningful brand from `userAgentData.brands` (skip the GREASE brand). */
function pickBrand(brands: { brand: string; version: string }[]): string | null {
  const real = brands.filter((entry) => !/not.?a.?brand/i.test(entry.brand));
  // Prefer the specific browser brand over the generic "Chromium".
  const specific = real.find((entry) => entry.brand !== "Chromium") ?? real[0];
  return specific ? `${specific.brand} ${specific.version}` : null;
}

/** Parse browser + OS from the classic user-agent string (fallback path). */
function parseUserAgent(ua: string): { browser: string; os: string } {
  let browser = UNKNOWN;
  const firefox = ua.match(/Firefox\/(\d+)/);
  const edge = ua.match(/Edg\/(\d+)/);
  const chrome = ua.match(/Chrome\/(\d+)/);
  const safari = ua.match(/Version\/(\d+).*Safari/);
  if (firefox) browser = `Firefox ${firefox[1]}`;
  else if (edge) browser = `Edge ${edge[1]}`;
  else if (chrome) browser = `Chrome ${chrome[1]}`;
  else if (safari) browser = `Safari ${safari[1]}`;

  let os = UNKNOWN;
  const macos = ua.match(/Mac OS X (\d+[._]\d+)/);
  const windows = ua.match(/Windows NT (\d+\.\d+)/);
  if (macos?.[1]) os = `macOS ${macos[1].replace("_", ".")}`;
  else if (windows) os = `Windows ${windows[1]}`;
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return { browser, os };
}

/** Read browser + OS from `navigator` (userAgentData first, UA string as fallback). */
export function collectUserAgentInfo(): { browser: string; os: string } {
  if (typeof navigator === "undefined") return { browser: UNKNOWN, os: UNKNOWN };
  const fallback = parseUserAgent(navigator.userAgent ?? "");
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  const browser = (data?.brands && pickBrand(data.brands)) || fallback.browser;
  const os = data?.platform || fallback.os;
  return { browser, os };
}

/** Human label for the active locale, e.g. "English (en-US)". */
export function languageLabel(locale: string): string {
  try {
    // Base subtag only, so "en-US" reads "English (en-US)", not "American English (en-US)".
    const base = locale.split("-")[0] ?? locale;
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(base);
    return name ? `${name[0]?.toUpperCase()}${name.slice(1)} (${locale})` : locale;
  } catch {
    return locale;
  }
}

/** The support-handle context the copy payload carries alongside the error itself (POO-1251 [R2]). */
export interface ErrorReportContext {
  /** The correlation id support searches Sentry for. Omitted from the payload when unresolvable. */
  reference?: string;
  /**
   * POO-1403 [R1]: the VENDOR's own id for a fiat purchase, i.e. the server-minted Paybis
   * `requestId`. The `reference` above is ours and Paybis has never heard of it; this is the one
   * identifier their support can act on, and the only thing that answers "was this person charged".
   *
   * [R4] Passed ONLY by an on-ramp surface. Absent everywhere else, and an absent value omits its
   * line rather than writing a blank one, exactly like `reference` and `release`.
   */
  paybisRequestId?: string;
  /** The app release, read off the Sentry client so it names the exact running image. Omitted when absent. */
  release?: string;
  /** Overridable for tests; defaults to now. */
  timestamp?: Date;
}

/**
 * The full "Copy error" payload (POO-279 R2, extended by POO-1251 [R2]): reference + code + raw
 * message + diagnostics + release + timestamp. Clipboard only — never sent to analytics.
 *
 * The REFERENCE leads, because it is the only line that does real work: a failed money-path operation
 * is filed by the backend as an expected `HttpException`, so it produces no Sentry Issue, and the
 * money path is trace-sampled below 1, so it usually produces no spans either. It lands in Sentry
 * LOGS, and the correlation id is the only thing that finds it. Everything after it is secondary
 * context for a human reading the paste.
 *
 * What this deliberately does NOT carry (POO-1251 [R2]/[R3]): backend operational detail (slippage
 * numbers, amounts, the pool or position id) and raw wallet addresses. That context is attached to
 * the trace server-side (POO-1252) where support reads it privately.
 *
 * CORRECTION (Rafael, 2026-08-06): an earlier revision of this comment asserted the clipboard "is
 * pasted into a PUBLIC Discord channel, which is a more exposed surface than Sentry, not less". That
 * is NOT the destination. The Discord button opens our channel, where the user files a PRIVATE ticket
 * visible only to staff. The distinction is load-bearing and the false version was believed: it is
 * why two POO-1387 reviewers escalated the Paybis vendor-reason text as a public-disclosure risk. The
 * masking below is kept regardless, because a support ticket is still a place a wallet does not need
 * to be, but do not reason about this payload as if it were public. The raw provider
 * message is kept because it is already on screen, but it runs through `redactSecrets` first: a
 * viem/provider message routinely embeds `from`/`to` addresses that no call site can promise are
 * absent.
 *
 * `redactSecrets`, not `redactAddresses`: the two differ by `redactBareHex` (an UNPREFIXED run of 40+
 * hex characters, i.e. an address that lost its `0x` or a raw key), and `redactSecrets` is what the
 * Sentry scrubber applies. Handing the weaker of the two rules to the MORE exposed sink was backwards
 * — a bare hex run would have been masked on its way into our access-controlled infrastructure and
 * left intact on its way into a support ticket.
 *
 * What it still does NOT strip is a FIGURE in prose: `PROVISIONING_INSUFFICIENT_FUNDS` reads "the
 * selected funding sources cover 412000 of the 500000 required" (`buildPlan.ts`), and base units are
 * backend operational detail by the standard above. That is not a regression (the message was already
 * on screen and already in the clipboard before POO-1251) and it is not closed here: masking prose
 * figures needs a decision about which of them are diagnostic, which is a product call.
 *
 * A missing reference or release omits its line entirely rather than writing "undefined".
 */
export function buildErrorReport(
  error: TxError,
  diagnostics: TxDiagnostics,
  { reference, paybisRequestId, release, timestamp = new Date() }: ErrorReportContext = {},
): string {
  return [
    `Pool Party error report`,
    ...(reference ? [`Reference: ${reference}`] : []),
    // POO-1403 [R1]: directly under ours, because the pair only does its job read together, and
    // labelled with the vendor's NAME so a human can tell whose id is whose without being told.
    ...(paybisRequestId ? [`Paybis ref: ${paybisRequestId}`] : []),
    `Code: ${error.code}`,
    `Message: ${redactSecrets(error.message)}`,
    `Browser: ${diagnostics.browser}`,
    `Wallet: ${diagnostics.wallet}`,
    `OS: ${diagnostics.os}`,
    `Language: ${diagnostics.language}`,
    ...(release ? [`Release: ${release}`] : []),
    `Timestamp: ${timestamp.toISOString()}`,
  ].join("\n");
}
