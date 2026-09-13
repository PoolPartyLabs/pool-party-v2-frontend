/**
 * @id PP-CORE-LIB-070 (POO-243, POO-1713) — tests
 * @implements-rules-version v2 (POO-1713 rules v1) · v1
 *
 * The browser reporter. Two properties matter: it keeps the local devtools DX identical to the
 * `console.error` sites it replaces, and it cannot throw — a reporting call that throws turns a
 * handled failure into an unhandled one, which is strictly worse than no reporting.
 */
import { captureException } from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ERROR_INGEST_PATH, reportClientError } from "./reportClientError";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
const sentryCapture = vi.mocked(captureException);

describe("reportClientError", () => {
  let beacon: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon: beacon });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The JSON the reporter handed to sendBeacon. */
  async function beaconPayload(): Promise<Record<string, unknown>> {
    const blob = beacon.mock.calls[0]?.[1] as Blob;
    return JSON.parse(await blob.text()) as Record<string, unknown>;
  }

  it("still console.errors with the same (event, fields) shape as the sites it replaces", () => {
    reportClientError("PP-PROFILE-SAVE failed", new Error("PATCH /users/me failed"), {
      surface: "investor",
      action: "save",
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "PP-PROFILE-SAVE failed",
      expect.objectContaining({
        surface: "investor",
        action: "save",
        message: "PATCH /users/me failed",
      }),
    );
  });

  it("beacons a first-party, same-origin payload with the event and the described error", async () => {
    reportClientError("wallet.connect_failed", new Error("rejected"), { connector: "metamask" });

    expect(beacon).toHaveBeenCalledOnce();
    expect(beacon.mock.calls[0]?.[0]).toBe(CLIENT_ERROR_INGEST_PATH);
    expect(await beaconPayload()).toMatchObject({
      event: "wallet.connect_failed",
      connector: "metamask",
      name: "Error",
      message: "rejected",
    });
  });

  it("never sends a stack", async () => {
    reportClientError("a.b", new Error("boom"));
    expect(Object.keys(await beaconPayload())).not.toContain("stack");
  });

  it("carries the server-action digest, the key that ties a redacted client error to its server log", async () => {
    const redacted = Object.assign(new Error("An error occurred in the Server Components render"), {
      digest: "1234567890",
    });
    reportClientError("PP-PROFILE-SAVE failed", redacted, { surface: "manager" });

    expect(await beaconPayload()).toMatchObject({ digest: "1234567890" });
  });

  it("falls back to a keepalive fetch when sendBeacon refuses the payload", () => {
    beacon.mockReturnValue(false);
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchSpy);

    reportClientError("a.b", new Error("boom"));

    expect(fetchSpy).toHaveBeenCalledWith(
      CLIENT_ERROR_INGEST_PATH,
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
  });

  it("truncates an oversized payload rather than shipping something the route would drop", async () => {
    reportClientError("a.b", new Error("x".repeat(9000)));
    expect(await beaconPayload()).toMatchObject({ event: "a.b", truncated: true });
  });

  it("does not throw when the transport itself fails", () => {
    beacon.mockImplementation(() => {
      throw new Error("beacon exploded");
    });
    vi.stubGlobal("fetch", () => {
      throw new Error("fetch exploded");
    });

    expect(() => reportClientError("a.b", new Error("boom"))).not.toThrow();
  });

  it("does not throw on a circular caught value", () => {
    const circular: Record<string, unknown> = { name: "Loop", message: "m" };
    circular.self = circular;

    expect(() => reportClientError("a.b", circular, { circular })).not.toThrow();
  });

  /**
   * POO-1147. Sentry is a THIRD sink alongside the console and the first-party ingest, and the
   * suppression rule is what keeps it usable: POO-243 wired a global QueryCache/MutationCache
   * onError, so every mock-mode read and every young wallet's 404 arrives here.
   */
  describe("[POO-1147] the Sentry sink", () => {
    beforeEach(() => {
      // `mockReset`, not `mockClear`: the last test installs a throwing implementation.
      sentryCapture.mockReset();
    });

    it("captures the CAUGHT VALUE, not the flattened description, so Sentry can group on the stack", () => {
      const error = new Error("PATCH /users/me failed");
      reportClientError("PP-PROFILE-SAVE failed", error, { surface: "investor" });

      expect(sentryCapture).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: { pp_event: "PP-PROFILE-SAVE failed" },
          extra: expect.objectContaining({
            surface: "investor",
            message: "PATCH /users/me failed",
          }),
        }),
      );
    });

    it("does NOT send mock mode, which is the default state and not an outage", () => {
      reportClientError("query.failed", {
        code: "SYSTEM_NOT_CONFIGURED",
        message: "no PP_API_URL",
      });
      expect(sentryCapture).not.toHaveBeenCalled();
    });

    it("does NOT send a young wallet's 404", () => {
      reportClientError("query.failed", { status: 404, message: "no positions yet" });
      expect(sentryCapture).not.toHaveBeenCalled();
    });

    it("still writes the suppressed failure to the first-party ingest, where a grep can filter it", () => {
      reportClientError("query.failed", { status: 404, message: "no positions yet" });
      expect(beacon).toHaveBeenCalledOnce();
    });

    it("sends a real failure", () => {
      reportClientError("query.failed", { status: 500, message: "upstream down" });
      expect(sentryCapture).toHaveBeenCalledOnce();
    });

    it("does not throw when the tracker itself fails", () => {
      sentryCapture.mockImplementation(() => {
        throw new Error("sdk exploded");
      });
      expect(() => reportClientError("a.b", new Error("boom"))).not.toThrow();
      // ...and the first-party ingest still received it.
      expect(beacon).toHaveBeenCalledOnce();
    });
  });

  /**
   * POO-1713 rules v1: the transport can carry a Sentry fingerprint, and does nothing with it
   * unless a caller asks.
   *
   * This function has 44 call sites and almost all of them pass a genuinely caught error whose
   * stack is real and distinct, so Sentry's default stack grouping is already right for them.
   * Fingerprinting unconditionally would flatten `boundary.render_failed` and the auth reports
   * into per-event buckets. The one caller that NEEDS it manufactures its Error at a single
   * shared line, which is why 21 unrelated codes collapse into one issue there.
   */
  describe("fingerprint (POO-1713)", () => {
    // @rule POO-1713 R1: forwarded to the SDK when supplied.
    it("[R1] forwards a supplied fingerprint to captureException", () => {
      reportClientError("tx.error_shown", new Error("X: boom"), {}, {}, [
        "tx.error_shown",
        "manager",
        "MOVE_RANGE_FAILED",
      ]);

      expect(sentryCapture).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          fingerprint: ["tx.error_shown", "manager", "MOVE_RANGE_FAILED"],
        }),
      );
    });

    // @rule POO-1713 R1/R5: the 43 other call sites keep stack grouping. This is the whole safety
    // argument for the change, so it is pinned rather than reasoned about.
    it("[R5] sends NO fingerprint when the caller does not supply one", () => {
      reportClientError("boundary.render_failed", new Error("boom"));

      const context = sentryCapture.mock.calls.at(-1)?.[1] as Record<string, unknown>;
      expect(context).not.toHaveProperty("fingerprint");
    });

    // @rule POO-1713 R1: the fingerprint rides ALONGSIDE tags and extra, never instead of them.
    it("[R1] keeps tags and extra intact when a fingerprint is supplied", () => {
      reportClientError(
        "tx.error_shown",
        new Error("X: boom"),
        { surface: "deposit" },
        { pp_reference: "abc" },
        ["tx.error_shown", "deposit", "X"],
      );

      expect(sentryCapture).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          fingerprint: ["tx.error_shown", "deposit", "X"],
          tags: expect.objectContaining({ pp_event: "tx.error_shown", pp_reference: "abc" }),
          extra: expect.objectContaining({ surface: "deposit" }),
        }),
      );
    });
  });
});
