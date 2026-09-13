/**
 * @id PP-CORE-LIB-023
 * @name build-tx action result
 * @description Typed result + failure mapper so build server actions surface errors as data, not throws.
 * @linear https://linear.app/yeildbay/issue/POO-475
 * @owner core-team
 * @since 2026-07-02
 * @i18n-namespace n/a (server-only, no user-facing copy)
 * @implements-rules-version v1
 *
 * @notes
 * The build server actions ("use server") must never throw across the RSC boundary: Next masks a
 * thrown Server Action error in production ("An error occurred in the Server Components render..."),
 * which strips the stable backend code and defeats `classifyTxError` (src/lib/tx/diagnostics.ts) —
 * a real SLIPPAGE_EXCEEDED build failure would reach the client as an opaque digest. So every build
 * action returns a {@link BuildTxResult} discriminated union instead: the happy path is
 * `{ ok: true, tx }`, and any failure (including the not-signed-in case) is `{ ok: false, code,
 * message }` (POO-475).
 *
 * `buildTxFailure` centralizes the throwable → failure mapping [R2]:
 * - {@link ApiError}: its `.code` + `.message` are preserved verbatim (nothing masked).
 * - {@link ApiParseError}: contract drift becomes `SCHEMA_MISMATCH`.
 * - anything else: `SYSTEM_INTERNAL` with `String(error)`.
 *
 * The consuming hooks convert `{ ok: false }` back into a thrown
 * `TransactionError(message, { code, correlationId })` so both land on `error.cause`, where
 * `collectErrorFacets` reads the code and `toTxError` reads the correlation id (POO-475 [R3],
 * POO-1251 [R1]).
 *
 * POO-1251: the mapping also carries `correlationId`. It was already on `ApiError.requestId` and it
 * stopped HERE, which is why the error dialog could never show a reference — the id existed on the
 * server for every failed build and nothing carried it the last hop.
 *
 * FOUR places dropped it, each a private copy of this shape that kept only `code` and `message`, and
 * all four are gone: this mapper (every build action), `toFailure` in `lib/onramp/onRampActions.ts`
 * (the on-ramp mint), `computePlanAction`'s catch in `lib/provisioning/planActions.ts`, and
 * `toFailure` in `lib/uniswap/actions.ts` — the FUNDING rail, which is the money path, and which
 * additionally needed `UniswapApiError` / `UniswapParseError` to grow a `requestId` at all so
 * `fundingClient.ts` had something to translate `ApiError.requestId` into.
 */
import { ApiError, ApiParseError } from "@/lib/api/errors";
import type { BuiltTx } from "./builtTxSchema";

/** A build-action failure surfaced as data: a stable machine code + the raw message. */
export interface BuildTxFailure {
  ok: false;
  /** Machine-readable code (backend code verbatim, or SCHEMA_MISMATCH / SYSTEM_INTERNAL / SESSION_MISSING). */
  code: string;
  /** Human-readable message: the backend message verbatim, or String(error) for unmapped throws. */
  message: string;
  /**
   * POO-1251 [R1]: the cross-service correlation id, resolved by `apiFetch` as the error envelope's
   * `error.correlationId` falling back to the echoed `x-request-id` header, and carried onto
   * `ApiError.requestId` / `ApiParseError.requestId`.
   *
   * It has to travel AS DATA for the same reason the code does: a thrown Server Action error is
   * masked in production, so anything not on this object is gone by the time the dialog renders.
   * Absent for a failure that never reached the backend (no config, a network failure, a local
   * guard) — the dialog then falls back to the browser's own Sentry trace id.
   */
  correlationId?: string;
}

/**
 * The result of a build server action: the built tx on success, or a typed failure. Never throws
 * across the RSC boundary (POO-475 [R1]).
 */
export type BuildTxResult = { ok: true; tx: BuiltTx } | BuildTxFailure;

/**
 * Map a caught throwable from a build action to a {@link BuildTxFailure} (POO-475 [R2]). Precedence:
 * an {@link ApiError} keeps its `.code` + `.message` verbatim; an {@link ApiParseError} (contract
 * drift) becomes `SCHEMA_MISMATCH`; anything else becomes `SYSTEM_INTERNAL` with `String(error)`.
 * Nothing is masked — the client rethrows the code so `classifyTxError` can act on it.
 */
export function buildTxFailure(error: unknown): BuildTxFailure {
  if (error instanceof ApiParseError) {
    return {
      ok: false,
      code: "SCHEMA_MISMATCH",
      message: error.message,
      ...(error.requestId ? { correlationId: error.requestId } : {}),
    };
  }
  if (error instanceof ApiError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.requestId ? { correlationId: error.requestId } : {}),
    };
  }
  return { ok: false, code: "SYSTEM_INTERNAL", message: String(error) };
}
