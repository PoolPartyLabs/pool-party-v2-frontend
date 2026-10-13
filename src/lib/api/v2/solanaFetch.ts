/**
 * @id PP-MGR-LIB-100 (POO-2262)
 * @name v2SolanaApi
 * @implements-rules-version DEC-188, DEC-190, DEC-191 (founder rulings, unversioned)
 * Server-only transport for the v6 (Hub + Robinhood + Solana) Fund routes of the API contract
 * (pool-party-api `docs/SOLANA_API_CONTRACT.md` §3, §9). Unlike `launchFetch`, a refusal keeps the
 * API's STABLE machine code (`CREATION_PLAN_STALE`, `SOLANA_REPORT_REFRESHING`,
 * `SOLANA_LOOKUP_TABLE_WARMING`, ...) and its retry hint, because the launch journey branches on
 * them. The upstream message never crosses this boundary.
 */
import "server-only";
// PP-INTEGRATION-POINT: v6 Fund creation, Solana builders, transits and reports (PP_API_URL + PP_API_KEY).
import type { ZodType } from "zod";
import { ApiError, ApiParseError } from "../errors";
import type { LaunchErrorDetail } from "./launchAuth";

const PATH =
  /^\/funds\/(?:creation-options|build-creation|discover|0x[0-9a-fA-F]{40}(?:\/[a-zA-Z0-9/-]+)?)$/;
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const REVERT = /^[A-Z][A-Za-z0-9]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An upstream refusal with the structured fields the journey needs. */
export class V2SolanaApiError extends ApiError {
  readonly detail: LaunchErrorDetail;
  constructor(status: number, code: string, detail: LaunchErrorDetail) {
    super(status, code, "v2 request failed");
    this.detail = detail;
  }
}

/** The v2 interceptor tags every object with `protocolVersion`; strip it before strict parsing. */
export function stripProtocolVersion(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripProtocolVersion);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "protocolVersion")
        .map(([key, entry]) => [key, stripProtocolVersion(entry)]),
    );
  return value;
}

function refusal(status: number, payload: unknown, retryAfter: string | null): V2SolanaApiError {
  const envelope =
    payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested = [envelope.error, envelope.response, envelope].filter(
    (value): value is Record<string, unknown> =>
      !!value && typeof value === "object" && !Array.isArray(value),
  );
  const rawCode = nested.map((value) => value.code).find((code) => typeof code === "string");
  const code =
    typeof rawCode === "string" && CODE.test(rawCode)
      ? rawCode
      : status === 429
        ? "SYSTEM_RATE_LIMITED"
        : "V2_REQUEST_FAILED";
  const detail: LaunchErrorDetail = {};
  const retry = nested
    .map((value) => value.retryAfterSeconds)
    .find((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
  if (typeof retry === "number") detail.retryAfterSeconds = Math.min(retry, 3600);
  else if (retryAfter && /^\d{1,5}$/.test(retryAfter))
    detail.retryAfterSeconds = Number(retryAfter);
  const jobId = nested.map((value) => value.jobId).find((value) => typeof value === "string");
  if (typeof jobId === "string" && UUID.test(jobId)) detail.jobId = jobId;
  const revert = nested.map((value) => value.error).find((value) => typeof value === "string");
  if (typeof revert === "string" && REVERT.test(revert) && revert !== "Conflict")
    detail.revert = revert;
  return new V2SolanaApiError(status, code, detail);
}

export async function solanaFetch<ResponseData>(
  path: string,
  method: "GET" | "POST",
  schema: ZodType<ResponseData>,
  body?: unknown,
): Promise<ResponseData> {
  if (!PATH.test(path)) throw new ApiError(400, "V2_INVALID_PATH", "invalid path");
  const base = process.env.PP_API_URL;
  const key = process.env.PP_API_KEY;
  if (!base || !key) throw new ApiError(503, "V2_UNAVAILABLE", "v2 unavailable");
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/api/v2${path}`, {
      method,
      headers: {
        "x-api-key": key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
    payload = await response.json();
  } catch {
    throw new ApiError(503, "V2_UNAVAILABLE", "v2 unavailable");
  }
  if (!response.ok) throw refusal(response.status, payload, response.headers.get("retry-after"));
  if (response.headers.get("x-pool-party-protocol") !== "v2") throw new ApiParseError(path, []);
  const data =
    payload !== null && typeof payload === "object"
      ? (payload as { data?: unknown }).data
      : undefined;
  const result = schema.safeParse(stripProtocolVersion(data));
  if (!result.success) throw new ApiParseError(path, result.error.issues);
  return result.data;
}
