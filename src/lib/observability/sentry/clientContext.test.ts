/**
 * @id PP-CORE-LIB-082 (POO-1251) - tests
 * @implements-rules-version v1 (POO-1251 rules v1)
 *
 * The browser-side support handles. Both negative cases are the important ones: with Sentry off
 * (`getTraceData` returns `{}`, `getClient` returns undefined) each must report `undefined` so the
 * error dialog omits the row rather than rendering "Reference: undefined" [R1].
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTraceData = vi.fn();
const getClient = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  getTraceData: (...args: unknown[]) => getTraceData(...args),
  getClient: () => getClient(),
}));

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

async function importContext() {
  vi.resetModules();
  return import("./clientContext");
}

describe("browserTraceId", () => {
  beforeEach(() => {
    getTraceData.mockReset();
  });

  it("reads the trace id out of the W3C traceparent", async () => {
    getTraceData.mockReturnValue({
      traceparent: `00-${TRACE_ID}-b7ad6b7169203331-01`,
      "sentry-trace": `${TRACE_ID}-b7ad6b7169203331-1`,
    });
    const { browserTraceId } = await importContext();
    expect(browserTraceId()).toBe(TRACE_ID);
    expect(getTraceData).toHaveBeenCalledWith({ propagateTraceparent: true });
  });

  it("falls back to sentry-trace when only that is present", async () => {
    getTraceData.mockReturnValue({ "sentry-trace": `${TRACE_ID}-b7ad6b7169203331-1` });
    const { browserTraceId } = await importContext();
    expect(browserTraceId()).toBe(TRACE_ID);
  });

  // [R1] Sentry off (no DSN): local dev, tests, Storybook. No id exists, and none must be invented.
  it("is undefined when Sentry is not enabled", async () => {
    getTraceData.mockReturnValue({});
    const { browserTraceId } = await importContext();
    expect(browserTraceId()).toBeUndefined();
  });

  // A support handle that is not a searchable trace id is worse than no handle: it sends the user
  // to support with something that resolves to nothing.
  it("rejects a malformed or all-zero trace id", async () => {
    const { browserTraceId } = await importContext();
    getTraceData.mockReturnValue({ traceparent: "00-not-a-trace-id-01" });
    expect(browserTraceId()).toBeUndefined();
    getTraceData.mockReturnValue({ traceparent: `00-${"0".repeat(32)}-b7ad6b7169203331-00` });
    expect(browserTraceId()).toBeUndefined();
  });

  it("is undefined rather than throwing when the SDK throws", async () => {
    getTraceData.mockImplementation(() => {
      throw new Error("SDK not initialised");
    });
    const { browserTraceId } = await importContext();
    expect(browserTraceId()).toBeUndefined();
  });
});

describe("sentryRelease", () => {
  beforeEach(() => {
    getClient.mockReset();
  });

  // The release the bundler plugin injected, which is the same string the ECR image is tagged with.
  it("reads the release off the active client's options", async () => {
    getClient.mockReturnValue({ getOptions: () => ({ release: "v2.4.1" }) });
    const { sentryRelease } = await importContext();
    expect(sentryRelease()).toBe("v2.4.1");
  });

  it("is undefined with no client, and with a client that has no release", async () => {
    const { sentryRelease } = await importContext();
    getClient.mockReturnValue(undefined);
    expect(sentryRelease()).toBeUndefined();
    getClient.mockReturnValue({ getOptions: () => ({}) });
    expect(sentryRelease()).toBeUndefined();
    getClient.mockReturnValue({ getOptions: () => ({ release: "" }) });
    expect(sentryRelease()).toBeUndefined();
  });

  it("is undefined rather than throwing when the SDK throws", async () => {
    getClient.mockImplementation(() => {
      throw new Error("SDK not initialised");
    });
    const { sentryRelease } = await importContext();
    expect(sentryRelease()).toBeUndefined();
  });
});
