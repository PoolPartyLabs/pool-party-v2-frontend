/**
 * @id PP-CORE-LIB-069 (POO-243) — tests
 * @implements-rules-version v1
 *
 * The trace contract the API and analytics repos implement the other half of. The id format is the
 * part that must not drift: it doubles as the user-facing correlation id, and the backend parses it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSentryTraceId } from "./sentry/traceId";
import {
  buildTraceHeaders,
  isTraceId,
  newSpanId,
  newTraceId,
  readResponseRequestId,
  resolveRequestTraceId,
} from "./trace";

vi.mock("./sentry/traceId", () => ({ activeSentryTraceId: vi.fn() }));
const sentryTraceId = vi.mocked(activeSentryTraceId);

describe("trace ids", () => {
  it("mints a 32 lowercase-hex trace id", () => {
    const traceId = newTraceId();
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(isTraceId(traceId)).toBe(true);
  });

  it("mints a 16 lowercase-hex span id", () => {
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not repeat", () => {
    expect(newTraceId()).not.toBe(newTraceId());
  });

  it("rejects anything that is not exactly 32 lowercase hex", () => {
    expect(isTraceId("ABCDEF")).toBe(false);
    expect(isTraceId(`${newTraceId()}0`)).toBe(false);
    expect(isTraceId(newTraceId().toUpperCase())).toBe(false);
    expect(isTraceId(undefined)).toBe(false);
  });
});

describe("buildTraceHeaders", () => {
  const traceId = "0123456789abcdef0123456789abcdef";

  it("emits a W3C traceparent carrying the trace id and a fresh span", () => {
    const traceparent = String(buildTraceHeaders(traceId).traceparent);
    const [version, tid, spanId, flags] = traceparent.split("-");
    expect(version).toBe("00");
    expect(tid).toBe(traceId);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(flags).toBe("01");
  });

  it("sends x-request-id alongside traceparent on an uncached request", () => {
    expect(buildTraceHeaders(traceId)["x-request-id"]).toBe(traceId);
  });

  /**
   * The load-bearing case. Next derives a cached fetch's key from its HEADERS and strips only
   * `traceparent`/`tracestate` (incremental-cache/index.js). A per-request `x-request-id` would make
   * every data-cached GET a permanent MISS and silently undo POO-453's throttle mitigation, which
   * exists because all SSR shares one container IP.
   */
  it("OMITS x-request-id on a data-cached request, so the fetch cache key stays stable", () => {
    const headers = buildTraceHeaders(traceId, { dataCached: true });
    expect(headers.traceparent).toContain(traceId);
    expect("x-request-id" in headers).toBe(false);
  });

  it("gives each call its own span id under one trace id", () => {
    const a = String(buildTraceHeaders(traceId).traceparent).split("-")[2];
    const b = String(buildTraceHeaders(traceId).traceparent).split("-")[2];
    expect(a).not.toBe(b);
  });
});

describe("readResponseRequestId", () => {
  it("prefers the backend's echoed x-request-id", () => {
    const headers = new Headers({ "x-request-id": "abc-123" });
    expect(readResponseRequestId(headers)).toBe("abc-123");
  });

  it("falls back to the trace id inside a returned traceparent", () => {
    const traceId = "0123456789abcdef0123456789abcdef";
    const headers = new Headers({ traceparent: `00-${traceId}-1111111111111111-01` });
    expect(readResponseRequestId(headers)).toBe(traceId);
  });

  it("is undefined when the backend echoed nothing (an older API build)", () => {
    expect(readResponseRequestId(new Headers())).toBeUndefined();
  });

  it("clips an absurdly long echoed value rather than logging it whole", () => {
    const headers = new Headers({ "x-request-id": "z".repeat(500) });
    expect(readResponseRequestId(headers)).toHaveLength(64);
  });
});

/**
 * POO-1147. ONE id, or the Sentry issue and the container logs for the same incident are two
 * unrelated search results. `resolveRequestTraceId` is what `getRequestTraceId` memoizes per request;
 * it is tested directly because React `cache()` outside a render is a pass-through.
 */
describe("resolveRequestTraceId (POO-1147)", () => {
  const sentryId = "0af7651916cd43dd8448eb211c80319c";

  beforeEach(() => {
    sentryTraceId.mockReset();
  });

  it("adopts Sentry's trace id, so one id spans Sentry, the logs and the API", () => {
    sentryTraceId.mockReturnValue(sentryId);
    expect(resolveRequestTraceId()).toBe(sentryId);
    // And it is still a valid wire value: the backends parse this out of `traceparent`.
    expect(buildTraceHeaders(resolveRequestTraceId()).traceparent).toContain(sentryId);
  });

  it("mints its own id when Sentry is disabled (no DSN)", () => {
    sentryTraceId.mockReturnValue(undefined);
    const first = resolveRequestTraceId();
    expect(isTraceId(first)).toBe(true);
    // Distinct per call, which is the whole reason the fallback cannot be a scope-derived constant.
    expect(resolveRequestTraceId()).not.toBe(first);
  });

  it("mints its own id rather than propagating a malformed one", () => {
    for (const bad of ["not-a-trace", sentryId.toUpperCase(), `${sentryId}00`, ""]) {
      sentryTraceId.mockReturnValue(bad);
      expect(resolveRequestTraceId()).not.toBe(bad);
      expect(isTraceId(resolveRequestTraceId())).toBe(true);
    }
  });

  it("rejects the all-zero trace id, which W3C defines as invalid", () => {
    sentryTraceId.mockReturnValue("0".repeat(32));
    const resolved = resolveRequestTraceId();
    expect(resolved).not.toBe("0".repeat(32));
    expect(isTraceId(resolved)).toBe(true);
  });
});
