/**
 * @id PP-CORE-LIB-012
 * @name tx diagnostics
 * @implements-rules-version v1 · v1 (POO-1026 rules v1)
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
 */

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
  | "unknown";

/**
 * Stable machine codes from the pool-party-api build endpoints → kind (POO-461 R2a).
 * PP-INTEGRATION-POINT (POO-461 R5): the API currently throws prose-only errors; once the build
 * endpoints return these stable codes (and the server actions surface them as data, so they survive
 * Next's production masking), this map becomes the primary classification source.
 */
const BACKEND_CODE_KINDS: Record<string, TxErrorKind> = {
  SLIPPAGE_EXCEEDED: "slippage",
  DEADLINE_EXPIRED: "deadlineExpired",
  INSUFFICIENT_FUNDS: "insufficientFunds",
  USER_REJECTED: "userRejected",
  NOT_AUTHORIZED: "unauthorized",
  UNAUTHORIZED: "unauthorized",
  // POO-1026: emitted by assertProviderOnChain, not by the API.
  WRONG_CHAIN: "wrongChain",
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
  // POO-1026: a wallet-side mismatch that carries no stable code. Deliberately LAST so a message
  // that ALSO reads as a rejection ("user rejected the network switch") keeps `userRejected`.
  // This ordering does NOT govern the choke point's declined-switch path: `assertProviderOnChain`
  // catches the wallet's 4001 and re-throws with the WRONG_CHAIN code, which is resolved above,
  // before any message pattern runs — so a declined corrective switch classifies as `wrongChain`
  // on purpose ("switch to Arbitrum" is that user's remedy). See `wrongChain.test.ts`.
  [/chain mismatch|wrong network|targets chain \d+|unrecognized chain/i, "wrongChain"],
];

/** EIP-1193 provider error codes → kind (POO-461 R2c). */
const PROVIDER_CODE_KINDS: Record<number, TxErrorKind> = {
  4001: "userRejected",
  4100: "unauthorized",
};

/** How deep to walk an error's `cause` chain when collecting codes + messages. */
const MAX_CAUSE_DEPTH = 4;

/** Collect every code and message reachable from an error (own props, `data`, `cause` chain). */
function collectErrorFacets(error: unknown): { codes: (string | number)[]; messages: string[] } {
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
      | { code?: string | number; targetChainId?: number; txHash?: string }
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
    return {
      code: code != null ? String(code) : fallbackCode,
      message: error.message,
      kind,
      ...(targetChainId != null ? { targetChainId } : {}),
      ...(txHash != null ? { txHash } : {}),
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

/**
 * The full "Copy error" payload (POO-279 R2): raw message + code + diagnostics + timestamp.
 * Clipboard only — never sent to analytics.
 */
export function buildErrorReport(
  error: TxError,
  diagnostics: TxDiagnostics,
  timestamp: Date = new Date(),
): string {
  return [
    `Pool Party error report`,
    `Message: ${error.message}`,
    `Code: ${error.code}`,
    `Browser: ${diagnostics.browser}`,
    `Wallet: ${diagnostics.wallet}`,
    `OS: ${diagnostics.os}`,
    `Language: ${diagnostics.language}`,
    `Timestamp: ${timestamp.toISOString()}`,
  ].join("\n");
}
