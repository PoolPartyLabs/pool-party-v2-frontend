import { ApiError } from "../errors";

export interface DiscoveryProgress {
  cursor?: string | number;
  target?: string | number;
}

export class V2DiscoveryPendingError extends ApiError {
  readonly retryAfterSeconds?: number;
  readonly progress?: DiscoveryProgress;

  constructor(status = 409, retryAfterSeconds?: number, progress?: DiscoveryProgress) {
    super(status, "V2_DISCOVERY_PENDING", "v2 request failed");
    this.retryAfterSeconds = retryAfterSeconds;
    this.progress = progress;
  }
}

export function discoveryPendingError(
  status: number,
  payload: unknown,
  retryAfter?: string | null,
): V2DiscoveryPendingError | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as Record<string, unknown>;
  const candidates = [envelope.error, envelope.response, envelope].filter(
    (value): value is Record<string, unknown> =>
      !!value && typeof value === "object" && !Array.isArray(value),
  );
  const code = candidates.find((candidate) => typeof candidate.code === "string")?.code;
  const retry = candidates.find(
    (candidate) => typeof candidate.retryAfterSeconds === "number",
  )?.retryAfterSeconds;
  const retryAfterSeconds =
    typeof retry === "number" && Number.isFinite(retry) && retry >= 0 ? retry : undefined;
  const headerRetry =
    retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : undefined;
  const effectiveRetry =
    retryAfterSeconds ??
    (headerRetry !== undefined && Number.isFinite(headerRetry) ? headerRetry : undefined);
  if (
    code !== "V2_DISCOVERY_PENDING" &&
    !(code === undefined && [409, 425, 503].includes(status) && effectiveRetry !== undefined)
  )
    return null;
  const rawProgress = candidates.find(
    (candidate) => candidate.progress && typeof candidate.progress === "object",
  )?.progress as Record<string, unknown> | undefined;
  const progress: DiscoveryProgress = {};
  for (const field of ["cursor", "target"] as const) {
    const value = rawProgress?.[field];
    if (
      (typeof value === "string" && /^\d{1,78}$/.test(value)) ||
      (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    )
      progress[field] = value;
  }
  return new V2DiscoveryPendingError(
    status,
    effectiveRetry,
    Object.keys(progress).length ? progress : undefined,
  );
}
