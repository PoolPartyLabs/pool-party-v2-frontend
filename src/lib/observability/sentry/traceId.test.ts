/**
 * @id PP-CORE-LIB-076 (POO-1147) - tests
 * @implements-rules-version v1
 *
 * The bridge that makes the Sentry trace id and POO-243's trace id the same value. The important
 * case is the NEGATIVE one: `getTraceData` returns `{}` when the SDK is not enabled, and this must
 * report `undefined` so the caller mints its own id. Returning a scope-derived id there would give
 * every request in the process the SAME id for the life of the container.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTraceData = vi.fn();
vi.mock("@sentry/nextjs", () => ({ getTraceData: (...args: unknown[]) => getTraceData(...args) }));

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

async function importBridge() {
  vi.resetModules();
  return import("./traceId");
}

describe("activeSentryTraceId", () => {
  beforeEach(() => {
    getTraceData.mockReset();
  });

  it("reads the trace id out of the W3C traceparent", async () => {
    getTraceData.mockReturnValue({
      traceparent: `00-${TRACE_ID}-b7ad6b7169203331-01`,
      "sentry-trace": `${TRACE_ID}-b7ad6b7169203331-1`,
    });
    const { activeSentryTraceId } = await importBridge();
    expect(activeSentryTraceId()).toBe(TRACE_ID);
  });

  it("asks for the traceparent form explicitly", async () => {
    getTraceData.mockReturnValue({ traceparent: `00-${TRACE_ID}-b7ad6b7169203331-01` });
    const { activeSentryTraceId } = await importBridge();
    activeSentryTraceId();
    expect(getTraceData).toHaveBeenCalledWith({ propagateTraceparent: true });
  });

  it("falls back to sentry-trace when only that is present", async () => {
    getTraceData.mockReturnValue({ "sentry-trace": `${TRACE_ID}-b7ad6b7169203331-1` });
    const { activeSentryTraceId } = await importBridge();
    expect(activeSentryTraceId()).toBe(TRACE_ID);
  });

  /**
   * The load-bearing case. `{}` is what the SDK returns when it is not enabled, and it MUST surface
   * as "no id" rather than as some other id.
   */
  it("is undefined when Sentry is not enabled", async () => {
    getTraceData.mockReturnValue({});
    const { activeSentryTraceId } = await importBridge();
    expect(activeSentryTraceId()).toBeUndefined();
  });

  it("is undefined rather than throwing when the SDK throws", async () => {
    getTraceData.mockImplementation(() => {
      throw new Error("no client");
    });
    const { activeSentryTraceId } = await importBridge();
    expect(activeSentryTraceId()).toBeUndefined();
  });
});
