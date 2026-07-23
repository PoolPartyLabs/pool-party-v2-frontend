/**
 * @id PP-REW (POO-207)
 * @name Analytics error model
 * @implements-rules-version v1
 *
 * Typed errors for the Analytics HTTP client. AnalyticsError carries the HTTP
 * status plus the backend error code (from the `{ error, message }` body);
 * AnalyticsParseError wraps a zod validation failure at the response boundary.
 */
import type { ZodIssue } from "zod";

/** An error returned by (or while reaching) the analytics backend. */
export class AnalyticsError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AnalyticsError";
    this.status = status;
    this.code = code;
  }
}

/** A response that did not match its expected zod schema. */
export class AnalyticsParseError extends Error {
  readonly status = 422;
  readonly code = "SYSTEM_PARSE_ERROR" as const;
  readonly issues: ZodIssue[];
  constructor(message: string, issues: ZodIssue[]) {
    super(message);
    this.name = "AnalyticsParseError";
    this.issues = issues;
  }
}
