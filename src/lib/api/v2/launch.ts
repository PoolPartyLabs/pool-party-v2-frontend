/**
 * @id PP-MGR-LIB-039 (POO-2177)
 * @name v2LaunchApi
 * @implements-rules-version v3 (POO-2192)
 * Server-only writes, independent of the shared read client.
 */
import "server-only";
// PP-INTEGRATION-POINT: v2 launch writes and admin builders require the enabled API and server keys.
import type { ZodType } from "zod";
import { ApiError, ApiParseError } from "../errors";
import { discoveryPendingError } from "./discovery";

export async function launchFetch<ResponseData>(
  path: string,
  method: "GET" | "POST" | "PUT",
  schema: ZodType<ResponseData>,
  body?: unknown,
  admin = false,
  query?: Record<string, string>,
): Promise<ResponseData> {
  if (!/^\/(funds(?:\/[a-zA-Z0-9/-]+)?|swap-route|report-jobs\/[a-zA-Z0-9-]+)$/.test(path))
    throw new ApiError(400, "V2_INVALID_PATH", "invalid launch path");
  const base = process.env.PP_API_URL;
  const key = process.env.PP_API_KEY;
  const adminKey = admin ? process.env.PP_API_ADMIN_KEY : undefined;
  if (!base || !key || (admin && !adminKey))
    throw new ApiError(503, "V2_UNAVAILABLE", "v2 unavailable");
  const suffix = query ? `?${new URLSearchParams(query).toString()}` : "";
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/api/v2${path}${suffix}`, {
      method,
      headers: {
        "x-api-key": key,
        ...(adminKey ? { "x-admin-key": adminKey } : {}),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    payload = await response.json();
  } catch {
    throw new ApiError(503, "V2_UNAVAILABLE", "v2 unavailable");
  }
  if (!response.ok) {
    const pending = discoveryPendingError(
      response.status,
      payload,
      response.headers.get("retry-after"),
    );
    if (pending) throw pending;
    const envelope =
      payload !== null && typeof payload === "object"
        ? (payload as { deferred?: unknown; response?: { deferred?: unknown } })
        : {};
    throw new ApiError(
      response.status,
      response.status === 429
        ? "V2_RATE_LIMITED"
        : [408, 503].includes(response.status) &&
            (envelope.deferred === true || envelope.response?.deferred === true)
          ? "V2_DEFERRED"
          : response.status === 409
            ? "V2_CONFLICT"
            : "V2_REQUEST_FAILED",
      "v2 request failed",
    );
  }
  if (response.headers.get("x-pool-party-protocol") !== "v2") throw new ApiParseError(path, []);
  const data =
    payload !== null && typeof payload === "object"
      ? (payload as { data?: unknown }).data
      : undefined;
  const result = schema.safeParse(data);
  if (!result.success) throw new ApiParseError(path, result.error.issues);
  return result.data;
}
