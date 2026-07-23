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
 * The consuming hooks convert `{ ok: false }` back into a thrown `TransactionError(message, { code })`
 * so the code lands on `error.cause.code`, where `collectErrorFacets` reads it and `classifyTxError`
 * classifies it (POO-475 [R3]).
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
    return { ok: false, code: "SCHEMA_MISMATCH", message: error.message };
  }
  if (error instanceof ApiError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: "SYSTEM_INTERNAL", message: String(error) };
}
