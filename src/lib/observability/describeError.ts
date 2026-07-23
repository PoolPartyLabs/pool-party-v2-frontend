/**
 * @id PP-CORE-LIB-036 (POO-702 Secondary #1)
 * @name describeError
 * @implements-rules-version v1
 *
 * Reduce any caught `unknown` to a flat, PII-free description for a structured log. It is the shared
 * shape behind every save/upload failure log added in POO-702 Secondary #1, so a swallowed error is no
 * longer discarded but recorded consistently across the client screens and the server actions.
 *
 * It extracts the failure class (`name`), the `message`, and — by duck-typing, since a caught value can
 * be anything — an HTTP `status`, a machine `code` (e.g. `ApiError.status`/`code`), and Next.js's
 * server-action `digest`. The digest is the correlation key: a real-mode server-action rejection is
 * redacted to a generic `Error` + digest on the client, and the SAME digest is printed server-side, so
 * a client `PP-PROFILE-SAVE`/`PP-MEDIA-UPLOAD` line can be tied back to its `PP-MEDIA-SAVE` server line.
 *
 * Client-safe and pure: no `server-only`, no I/O — imported by both client components and the
 * server-only {@link mediaSaveLog} helper. It never reads any field VALUE (name/message aside), only the
 * error's own metadata, so it cannot leak profile PII into logs.
 */

/** A flat, log-safe description of a caught error. Absent fields are simply not present on the source. */
export interface ErrorDescription {
  /** The failure class, e.g. "ApiError", "TypeError", "Error". Falls back to "UnknownError". */
  name: string;
  /** The error message (may be redacted to a generic string for a prod server-action rejection). */
  message: string;
  /** HTTP status when the error carries one (e.g. `ApiError.status`, 0 for a network failure). */
  status?: number;
  /** A stable machine code when present (e.g. `ApiError.code` = "SYSTEM_INTERNAL"). */
  code?: string;
  /** Next.js server-action error digest — correlates a redacted client rejection to its server log. */
  digest?: string;
}

/** Read a duck-typed `status`/`code`/`digest` off a caught value into the description (when present). */
function attachMetadata(description: ErrorDescription, source: Record<string, unknown>): void {
  if (typeof source.status === "number") description.status = source.status;
  if (typeof source.code === "string") description.code = source.code;
  if (typeof source.digest === "string") description.digest = source.digest;
}

/** Describe any caught value (Error, Error-like object, or primitive) as a flat, log-safe record. */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof Error) {
    const description: ErrorDescription = { name: error.name || "Error", message: error.message };
    attachMetadata(description, error as unknown as Record<string, unknown>);
    return description;
  }
  if (error !== null && typeof error === "object") {
    const source = error as Record<string, unknown>;
    const description: ErrorDescription = {
      name: typeof source.name === "string" ? source.name : "UnknownError",
      message: typeof source.message === "string" ? source.message : String(error),
    };
    attachMetadata(description, source);
    return description;
  }
  return { name: "UnknownError", message: String(error) };
}
