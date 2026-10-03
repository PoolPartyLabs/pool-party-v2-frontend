/**
 * @id PP-CORE-LIB-112 (POO-2133)
 * @name v2ApiClient
 * @implements-rules-version v1
 * Server-only, protocol-discriminated fund API reads.
 */
import "server-only";
import type { ZodType } from "zod";
import { ApiError, ApiParseError, parseApiErrorBody } from "../errors";

function assertVersion(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) assertVersion(entry, path);
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.protocolVersion !== "v2") throw new ApiParseError(path, []);
    for (const entry of Object.values(record)) assertVersion(entry, path);
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function v2Fetch<ResponseData>(
  path: string,
  schema: ZodType<ResponseData>,
): Promise<ResponseData> {
  const base = process.env.PP_API_URL;
  const key = process.env.PP_API_KEY;
  if (!base || !key) throw new ApiError(503, "V2_UNAVAILABLE", "v2 API unavailable");
  if (!/^\/(catalog|funds)(\/|\?|$)/.test(path))
    throw new ApiError(400, "V2_INVALID_PATH", "invalid v2 read");
  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/api/v2${path}`, {
      headers: { "x-api-key": key, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(0, "V2_UNAVAILABLE", "v2 API unavailable");
  }
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new ApiParseError(path, []);
    body = {};
  }
  if (!response.ok) {
    const envelope = recordOf(body);
    const nested = recordOf(envelope.response);
    const parsed = parseApiErrorBody(response.status, body);
    const contractName =
      typeof nested.error === "string" && /^[A-Z][A-Za-z0-9]+$/.test(nested.error)
        ? nested.error
        : null;
    const deferred = nested.deferred === true || envelope.deferred === true;
    const code =
      contractName ??
      (deferred
        ? "V2_DEFERRED"
        : typeof nested.code === "string"
          ? nested.code
          : response.status === 404
            ? "V2_NOT_FOUND"
            : response.status === 503
              ? "V2_UNAVAILABLE"
              : parsed.code);
    throw new ApiError(
      response.status,
      code,
      response.status >= 500 ? "v2 API unavailable" : parsed.message,
      parsed.correlationId,
    );
  }
  if (response.headers.get("x-pool-party-protocol") !== "v2") throw new ApiParseError(path, []);
  const data = recordOf(body).data;
  assertVersion(data, path);
  const result = schema.safeParse(data);
  if (!result.success) throw new ApiParseError(path, result.error.issues);
  return result.data;
}
