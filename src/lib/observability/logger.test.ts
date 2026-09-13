/**
 * @id PP-CORE-LIB-068 (POO-243, POO-1388, POO-1629) — tests
 * @implements-rules-version v4 (POO-1629 rules v2) · v3 (POO-1388 rules v1) · v2 (POO-1147) · v1 (POO-243)
 *
 * The structured logger: one JSON object per line, flat and greppable, address-masked, bounded, and
 * incapable of throwing. Plus the suppression rule lifted from `observeAnalyticsFailure`, which is
 * the reason the signal is worth reading at all.
 */
import { captureMessage, logger as sentryLogger } from "@sentry/nextjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import {
  buildLogRecord,
  isExpectedNonOutage,
  logError,
  logInfo,
  logWarn,
  redactAddresses,
  summarizeZodIssues,
} from "./logger";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const sentryMessage = vi.mocked(captureMessage);
const sentryLog = vi.mocked(sentryLogger);

/** Parse the single JSON line a spy captured. Fails loudly if it is not one JSON object. */
function loggedLine(spy: { mock: { calls: unknown[][] } }, index = 0): Record<string, unknown> {
  const call = spy.mock.calls[index];
  expect(call).toHaveLength(1);
  return JSON.parse(String(call?.[0])) as Record<string, unknown>;
}

describe("logEvent", () => {
  it("emits ONE json object on ONE line, with ts/level/event and the flat context", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("catalog.v2_degraded", { read: "explore-page", status: 503 });

    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).not.toContain("\n");
    const record = loggedLine(warn);
    expect(record).toMatchObject({
      level: "warn",
      event: "catalog.v2_degraded",
      read: "explore-page",
      status: 503,
    });
    expect(Date.parse(String(record.ts))).not.toBeNaN();
    warn.mockRestore();
  });

  it("routes each level to its own console method so the container keeps the stream", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logInfo("a.b", {});
    logError("c.d", {});

    expect(loggedLine(info).level).toBe("info");
    expect(loggedLine(error).level).toBe("error");
    info.mockRestore();
    error.mockRestore();
  });

  it("drops undefined fields rather than emitting nulls", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("a.b", { present: 1, absent: undefined });

    const record = loggedLine(warn);
    expect(record.present).toBe(1);
    expect("absent" in record).toBe(false);
    warn.mockRestore();
  });

  it("never lets a circular field throw at the call site", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    expect(() => logWarn("a.b", { circular })).not.toThrow();
    warn.mockRestore();
  });

  it("reduces an Error field to name + message and never a stack", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("a.b", { cause: new TypeError("boom") });

    expect(loggedLine(warn).cause).toBe("TypeError: boom");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("at ");
    warn.mockRestore();
  });

  it("serializes BigInt as a string (the repo-wide on-chain numerics convention)", () => {
    expect(buildLogRecord("info", "a.b", { amount: BigInt(123) }).amount).toBe("123");
  });

  it("cannot be tricked into overwriting ts / level / event from a context field", () => {
    const record = buildLogRecord("warn", "real.event", { event: "spoofed", level: "debug" });
    expect(record.event).toBe("real.event");
    expect(record.level).toBe("warn");
  });

  it("bounds a long array so one field cannot inflate the line", () => {
    const many = Array.from({ length: 100 }, (_, i) => i);
    const logged = buildLogRecord("info", "a.b", { many }).many as unknown[];
    expect(logged).toHaveLength(26);
    expect(logged[25]).toBe("+75 more");
  });
});

describe("redactAddresses", () => {
  it("masks a wallet address anywhere in a string", () => {
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    expect(redactAddresses(`GET /portfolio/${wallet}`)).toBe("GET /portfolio/0x1234…5678");
    expect(redactAddresses(`?managerWallet=${wallet}`)).not.toContain(wallet);
  });

  it("leaves a short 0x value (chain id, selector, 0x0) alone", () => {
    expect(redactAddresses("chain 0xa4b1 and 0x0")).toBe("chain 0xa4b1 and 0x0");
  });

  it("is applied to every string that reaches a log line, not just to a named field", () => {
    const wallet = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const record = buildLogRecord("warn", "a.b", { key: wallet, nested: { note: wallet } });
    expect(JSON.stringify(record)).not.toContain(wallet);
  });
});

describe("summarizeZodIssues", () => {
  it("names WHICH field drifted, with expected and received", () => {
    const schema = z.object({ strategies: z.array(z.object({ tvlUsd: z.number() })) });
    const result = schema.safeParse({ strategies: [{ tvlUsd: "1200.5" }] });
    expect(result.success).toBe(false);

    const [issue] = summarizeZodIssues(result.success ? [] : result.error.issues);
    expect(issue).toMatchObject({
      path: "strategies.0.tvlUsd",
      code: "invalid_type",
      expected: "number",
      received: "string",
    });
  });

  it("labels a root-level issue rather than emitting an empty path", () => {
    const result = z.array(z.string()).safeParse("not an array");
    const [issue] = summarizeZodIssues(result.success ? [] : result.error.issues);
    expect(issue?.path).toBe("<root>");
  });

  it("caps the number of issues so a wholesale mismatch cannot flood the line", () => {
    const schema = z.array(z.number());
    const result = schema.safeParse(Array.from({ length: 60 }, () => "x"));
    expect(summarizeZodIssues(result.success ? [] : result.error.issues)).toHaveLength(20);
  });

  it("masks an address that rode in on an issue value", () => {
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    const result = z.literal("expected").safeParse(wallet);
    const summarized = JSON.stringify(
      summarizeZodIssues(result.success ? [] : result.error.issues),
    );
    expect(summarized).not.toContain(wallet);
  });
});

describe("isExpectedNonOutage", () => {
  // The suppression rule lifted from observeAnalyticsFailure [R3]/[R4]. A logger that fires on the
  // normal case is noise, and noise is why nobody reads the logs.
  it("suppresses SYSTEM_NOT_CONFIGURED (mock mode is the repo default, not an outage)", () => {
    expect(isExpectedNonOutage({ status: 503, code: "SYSTEM_NOT_CONFIGURED" })).toBe(true);
  });

  it("suppresses a 404 / WALLET_NOT_FOUND (no data yet, not an outage)", () => {
    expect(isExpectedNonOutage({ status: 404, code: "NOT_FOUND" })).toBe(true);
    expect(isExpectedNonOutage({ status: 400, code: "WALLET_NOT_FOUND" })).toBe(true);
  });

  /**
   * @rule POO-1629 [R2]
   *
   * The verification the ticket asked for instead of an assumption, on the object the
   * wire actually produces: since POO-1619 an unsupported on-ramp pair is `ONRAMP_PAIR_UNAVAILABLE`
   * at HTTP 404, and dev's sandbox does not sell `USDC-BASE`, so this is the normal state of the buy
   * panel there rather than a failure worth an alert.
   *
   * Both halves matter, and the second one is why this test exists at all. The predicate reads
   * PROPERTIES: it suppresses the raw `ApiError` because that object carries `status: 404`. It does
   * NOT suppress a synthetic error built around the same code, because a code inside a MESSAGE is not
   * a property. That is exactly what `useBuyRouteQuote.reportOnce` hands `reportClientError`, so the
   * API fix does not silence the frontend on its own (POO-1673 owns that half). Pinned as a pair so
   * the gate is understood as status-shaped, and so the second fact cannot quietly be assumed away.
   */
  it("suppresses the wire's 404 unsupported-pair error, but not a synthetic one built from its code", () => {
    expect(isExpectedNonOutage(new ApiError(404, "ONRAMP_PAIR_UNAVAILABLE", "no such pair"))).toBe(
      true,
    );
    expect(
      isExpectedNonOutage(new Error("onramp.methods_unavailable: ONRAMP_PAIR_UNAVAILABLE")),
    ).toBe(false);
  });

  it("suppresses a 429: our own throttle answering, and the one failure that amplifies itself", () => {
    // The global QueryCache onError reports once per failing read per open tab, so during a throttle
    // the report volume scales with the load that caused it instead of describing it.
    expect(isExpectedNonOutage({ status: 429, code: "SYSTEM_RATE_LIMITED" })).toBe(true);
    expect(isExpectedNonOutage({ status: 429, code: "THROTTLER" })).toBe(true);
  });

  it("does NOT suppress a genuine outage or an unknown throw", () => {
    expect(isExpectedNonOutage({ status: 503, code: "SYSTEM_INTERNAL" })).toBe(false);
    expect(isExpectedNonOutage(new Error("boom"))).toBe(false);
    expect(isExpectedNonOutage("nope")).toBe(false);
    expect(isExpectedNonOutage(null)).toBe(false);
    // RPC transport flakes stay VISIBLE by decision: noisy, but there is no volume figure to tune
    // against yet, and a keyless public endpoint dropping requests is somebody's broken session.
    expect(isExpectedNonOutage({ name: "HttpRequestError", status: 0 })).toBe(false);
  });
});

/**
 * POO-1147. `error` forwards to Sentry, the other three levels do not. The split is about volume:
 * `warn` is the degrade class and is already high-volume by design, and the browser-side warns that
 * `/api/client-error` re-logs reach Sentry from the BROWSER already, so forwarding them here would
 * count one failure twice under two different events.
 */
describe("[POO-1147] Sentry forwarding", () => {
  beforeEach(() => {
    sentryMessage.mockReset();
  });

  it("forwards an error line, keyed on the stable event token so it groups by failure KIND", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("api.response_parse_failed", {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      requestId: "req-9",
      endpoint: "GET /api/v1/pools",
      issueCount: 2,
    });

    expect(sentryMessage).toHaveBeenCalledWith(
      "api.response_parse_failed",
      expect.objectContaining({
        level: "error",
        tags: {
          log_event: "api.response_parse_failed",
          trace_id: "0af7651916cd43dd8448eb211c80319c",
          request_id: "req-9",
        },
        extra: expect.objectContaining({ endpoint: "GET /api/v1/pools", issueCount: 2 }),
      }),
    );
    vi.restoreAllMocks();
  });

  it("forwards the MASKED record, never the raw fields the caller passed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    logError("media.save_failed", { endpoint: `PATCH /users/${wallet}/avatar` });

    const context = sentryMessage.mock.calls[0]?.[1] as { extra: Record<string, unknown> };
    const extra = context.extra;
    expect(JSON.stringify(extra)).not.toContain(wallet);
    expect(extra.endpoint).toBe("PATCH /users/0x1234…5678/avatar");
    vi.restoreAllMocks();
  });

  it("does NOT forward warn or info", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    logWarn("catalog.v2_degraded", { endpoint: "GET /pools" });
    logInfo("media.save_request", { surface: "manager" });

    expect(sentryMessage).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("still writes the stdout line when the tracker throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sentryMessage.mockImplementation(() => {
      throw new Error("sdk exploded");
    });

    expect(() => logError("api.response_parse_failed", { endpoint: "GET /pools" })).not.toThrow();
    expect(errorSpy).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});

/**
 * POO-1388: the frontend was the one service of the three with no Sentry LOG channel. Only `error`
 * lines reached Sentry, as issues, so a trace id a user quoted resolved to the single failure line
 * and never to the `info`/`warn` context around it. That context lived only in container stdout,
 * which a recreate rotates away (POO-1354).
 */
describe("[POO-1388] Sentry log channel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("[R2] ships EVERY level as a log, keyed on the stable event token", () => {
    logInfo("catalog.v2_ok", { read: "explore-page" });
    logWarn("catalog.v2_degraded", { read: "explore-page", status: 503 });
    logError("api.response_parse_failed", { route: "/pools" });

    expect(sentryLog.info).toHaveBeenCalledWith("catalog.v2_ok", expect.any(Object));
    expect(sentryLog.warn).toHaveBeenCalledWith("catalog.v2_degraded", expect.any(Object));
    expect(sentryLog.error).toHaveBeenCalledWith("api.response_parse_failed", expect.any(Object));
  });

  it("[R2] carries trace_id as an attribute, which is what makes the quoted reference searchable", () => {
    logInfo("api.request", { traceId: "a99f6fa428df4fff86f04e1cba8acbb6", route: "/pools" });

    const [, attributes] = sentryLog.info.mock.calls[0] ?? [];
    expect(attributes).toMatchObject({
      trace_id: "a99f6fa428df4fff86f04e1cba8acbb6",
      route: "/pools",
    });
  });

  it("[R3] masks addresses in log attributes, exactly as the stdout line already does", () => {
    logWarn("portfolio.read_failed", {
      owner: "0x1234567890abcdef1234567890abcdef12345678",
    });

    const [, attributes] = sentryLog.warn.mock.calls[0] ?? [];
    expect(attributes).toMatchObject({ owner: "0x1234…5678" });
  });

  it("an error line still files its ISSUE as well as its log, so grouping and alerting survive", () => {
    logError("api.response_parse_failed", { route: "/pools" });

    expect(sentryMessage).toHaveBeenCalledTimes(1);
    expect(sentryLog.error).toHaveBeenCalledTimes(1);
  });

  it("a failing log channel never costs us the stdout line, which is the sink we control", () => {
    sentryLog.info.mockImplementationOnce(() => {
      throw new Error("vendor down");
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    expect(() => logInfo("catalog.v2_ok", { read: "explore-page" })).not.toThrow();
    expect(info).toHaveBeenCalledTimes(1);
  });
});

/**
 * POO-1387 security review. Two findings that were asserted in prose and pinned by nothing.
 */
describe("[POO-1387] the log channel's own hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("masks the EVENT token, which becomes the Sentry log message and is client-supplied", () => {
    // `/api/client-error` passes a browser-supplied `event` straight into `logWarn`, and
    // `forwardToSentryLogs` promotes it to the log body. Before this it was the one field
    // `buildLogRecord` skipped, so an unauthenticated caller could write unmasked text to Sentry.
    const wallet = "0x1234567890abcdef1234567890abcdef12345678";
    logWarn(`spoofed.event owner ${wallet}`, {});

    const [message] = sentryLog.warn.mock.calls[0] ?? [];
    expect(message).not.toContain(wallet);
    expect(message).toContain("0x1234…5678");
  });

  it("keeps csp.violation OFF the metered log channel while still writing it to stdout", () => {
    // Unbounded, visitor-driven, and carries no traceId, so it can never answer a quoted reference
    // while spending the same budget as the events that can (Rafael, 2026-08-06).
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("csp.violation", { directive: "script-src" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(sentryLog.warn).not.toHaveBeenCalled();
  });

  it("still ships every other warn, so the exclusion is one token and not a posture", () => {
    logWarn("catalog.v2_degraded", { status: 503 });
    expect(sentryLog.warn).toHaveBeenCalledTimes(1);
  });
});
