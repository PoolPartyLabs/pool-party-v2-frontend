/**
 * @id PP-STR-LIB-027 (POO-2175)
 * @name fundTransport
 * @implements-rules-version v2; v1 (POO-2262 stable refusal codes and retry hints, API contract §1, §3.9)
 * PP-INTEGRATION-POINT: server-only simulated builds and privileged report broker.
 */
import "server-only";
import type { ZodType } from "zod";
import { ApiError, ApiParseError } from "../errors";
import { reportWaitCodes } from "./fundSchemas";

const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const REVERT = /^[A-Z][A-Za-z0-9]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** The structured part of a refusal a client may act on (the same fields `solanaFetch` keeps). */
export interface FundRequestDetail {
  retryAfterSeconds?: number;
  jobId?: string;
}
/** A refusal with the API's retry hint, so a report wait (§3.9) becomes a wait, not a failure. */
export class FundRequestError extends ApiError {
  readonly detail: FundRequestDetail;
  constructor(status: number, code: string, detail: FundRequestDetail) {
    super(status, code, "fund operation failed");
    this.detail = detail;
  }
}

/**
 * The refusal code, never the upstream message: a deferred build, then the report waits, then a
 * contract revert name (`StaleSpokeReport`), then the API's allow-listed stable `code`.
 */
function refusal(status: number, payload: unknown, retryAfter: string | null): FundRequestError {
  const envelope = isRecord(payload) ? payload : {};
  const nested = isRecord(envelope.response) ? envelope.response : envelope;
  const records = [nested, envelope, envelope.error].filter(isRecord);
  const stable = records
    .map((record) => record.code)
    .find((code): code is string => typeof code === "string" && CODE.test(code));
  const revert =
    typeof nested.error === "string" && REVERT.test(nested.error) ? nested.error : undefined;
  const code =
    nested.deferred === true
      ? "V2_DEFERRED"
      : stable && (reportWaitCodes as readonly string[]).includes(stable)
        ? stable
        : (revert ?? stable ?? (status === 503 ? "V2_UNAVAILABLE" : "V2_INVALID_RESPONSE"));
  const detail: FundRequestDetail = {};
  const retry = records
    .map((record) => record.retryAfterSeconds)
    .find(
      (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
  if (retry !== undefined) detail.retryAfterSeconds = Math.min(retry, 3600);
  else if (retryAfter && /^\d{1,5}$/.test(retryAfter))
    detail.retryAfterSeconds = Math.min(Number(retryAfter), 3600);
  const jobId = records.map((record) => record.jobId).find((value) => typeof value === "string");
  if (typeof jobId === "string" && UUID.test(jobId)) detail.jobId = jobId;
  return new FundRequestError(status, code, detail);
}

export async function fundRequest<ResponseData>(
  path: string,
  schema: ZodType<ResponseData>,
  body?: unknown,
  admin = false,
): Promise<ResponseData> {
  if (!/^\/(funds\/0x[0-9a-fA-F]{40}\/(build|report)|report-jobs\/[0-9a-f-]{36})$/.test(path))
    throw new ApiError(400, "V2_INVALID_PATH", "invalid path");
  const base = process.env.PP_API_URL;
  const key = process.env.PP_API_KEY;
  const adminKey = process.env.PP_API_ADMIN_KEY;
  if (!base || !key || (admin && !adminKey))
    throw new ApiError(503, "V2_UNAVAILABLE", "unavailable");
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/api/v2${path}`, {
      method: body === undefined ? "GET" : "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        "x-api-key": key,
        "Content-Type": "application/json",
        ...(admin ? { "x-admin-key": adminKey as string } : {}),
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(503, "V2_UNAVAILABLE", "unavailable");
  }
  const payload: unknown = await response.json().catch(() => null);
  const envelope =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (!response.ok) throw refusal(response.status, payload, response.headers.get("retry-after"));
  if (response.headers.get("x-pool-party-protocol") !== "v2") throw new ApiParseError(path, []);
  function validateVersion(value: unknown): void {
    if (Array.isArray(value)) for (const entry of value) validateVersion(entry);
    else if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.protocolVersion !== "v2") throw new ApiParseError(path, []);
      for (const entry of Object.values(record)) validateVersion(entry);
    }
  }
  validateVersion(envelope.data);
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) throw new ApiParseError(path, parsed.error.issues);
  return parsed.data;
}
