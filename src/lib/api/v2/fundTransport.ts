/**
 * @id PP-STR-LIB-027 (POO-2175)
 * @name fundTransport
 * @implements-rules-version v2
 * PP-INTEGRATION-POINT: server-only simulated builds and privileged report broker.
 */
import "server-only";
import type { ZodType } from "zod";
import { ApiError, ApiParseError } from "../errors";

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
  if (!response.ok) {
    const nested =
      envelope.response && typeof envelope.response === "object"
        ? (envelope.response as Record<string, unknown>)
        : envelope;
    const code =
      nested.deferred === true
        ? "V2_DEFERRED"
        : typeof nested.error === "string"
          ? nested.error
          : typeof nested.code === "string"
            ? nested.code
            : response.status === 503
              ? "V2_UNAVAILABLE"
              : "V2_INVALID_RESPONSE";
    throw new ApiError(response.status, code, "fund operation failed");
  }
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
