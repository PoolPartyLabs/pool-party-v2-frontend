/**
 * @id PP-CORE-HOK-029 (POO-1387, POO-1403, POO-1713) — tests
 * @implements-rules-version v2 (POO-1713 rules v1) · v1 (POO-1387 rules v1) · v1 (POO-1403 rules v1)
 *
 * The four decisions a future edit must not quietly reverse: a rendered dialog reports, it reports
 * ONCE per distinct failure, the displayed reference is an INDEXED TAG rather than unindexed extra,
 * and reporting can never throw into the render path it is observing.
 *
 * POO-1403 adds a fifth: an ON-RAMP dialog files the vendor's own `requestId` as a second indexed
 * tag, and every other surface files none, so the tag means "this failure is a Paybis purchase"
 * rather than "this failure was rendered".
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "./reportClientError";
import { type RenderedErrorLike, useReportRenderedError } from "./useReportRenderedError";

vi.mock("./reportClientError", () => ({ reportClientError: vi.fn() }));
const report = vi.mocked(reportClientError);

const TX_ERROR: RenderedErrorLike = {
  code: "ONRAMP_ERROR",
  message: "The purchase did not complete",
  kind: "unknown",
};
const REFERENCE = "a99f6fa428df4fff86f04e1cba8acbb6";
/** POO-1403: the vendor's own purchase id, from the 2026-08-06 report (Paybis invoice PB26086511232TX9). */
const PAYBIS_REQUEST_ID = "19fd7802-cdb0-80b6-b36e-76befd2ee33f";

beforeEach(() => report.mockReset());

describe("useReportRenderedError", () => {
  it("[R1] files an event for an error the app caught and rendered", () => {
    renderHook(() => useReportRenderedError("provisioning", TX_ERROR, REFERENCE));

    expect(report).toHaveBeenCalledTimes(1);
    const [event, error, fields] = report.mock.calls[0] ?? [];
    expect(event).toBe("tx.error_shown");
    expect(error).toBeInstanceOf(Error);
    expect(fields).toMatchObject({ surface: "provisioning", code: "ONRAMP_ERROR" });
  });

  it("[R3] attaches the displayed reference as an INDEXED TAG, not just as extra", () => {
    renderHook(() => useReportRenderedError("provisioning", TX_ERROR, REFERENCE));

    // The 4th argument is the tag bag. `fields` (3rd) becomes Sentry `extra`, which is stored but
    // NOT indexed, so a reference passed only there could never be searched for.
    const tags = report.mock.calls[0]?.[3];
    expect(tags).toEqual({ pp_reference: REFERENCE });
  });

  // @rule POO-1403 R3 — the vendor's own id rides the event as a SECOND indexed tag, so an operator
  // who has a Paybis invoice can pivot to our events, and back, without the user in the loop.
  it("[POO-1403 R3] attaches the Paybis requestId as its own indexed tag", () => {
    renderHook(() =>
      useReportRenderedError("provisioning", TX_ERROR, REFERENCE, PAYBIS_REQUEST_ID),
    );

    expect(report.mock.calls[0]?.[3]).toEqual({
      pp_reference: REFERENCE,
      pp_paybis_request_id: PAYBIS_REQUEST_ID,
    });
  });

  // @rule POO-1403 R4 — the eleven non-on-ramp dialogs pass nothing, and an absent id writes no tag
  // at all rather than an empty one that would match every non-purchase failure in a search.
  it("[POO-1403 R4] writes no Paybis tag for a failure that is not a purchase", () => {
    renderHook(() => useReportRenderedError("invest", TX_ERROR, REFERENCE));

    expect(report.mock.calls[0]?.[3]).toEqual({ pp_reference: REFERENCE });
  });

  it("[R2] reports ONCE across re-renders of the same failure", () => {
    const { rerender } = renderHook(() =>
      useReportRenderedError("provisioning", TX_ERROR, REFERENCE),
    );
    rerender();
    rerender();

    expect(report).toHaveBeenCalledTimes(1);
  });

  it("[R2] but a genuinely DIFFERENT failure in the same dialog is a new fact and reports", () => {
    const { rerender } = renderHook(
      ({ error }) => useReportRenderedError("provisioning", error, REFERENCE),
      { initialProps: { error: TX_ERROR as RenderedErrorLike } },
    );
    rerender({ error: { code: "SLIPPAGE_EXCEEDED", message: "too little received" } });

    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1]?.[2]).toMatchObject({ code: "SLIPPAGE_EXCEEDED" });
  });

  it("reports nothing when the view is displaying no error, which is the normal state", () => {
    renderHook(() => useReportRenderedError("provisioning", null, REFERENCE));
    renderHook(() => useReportRenderedError("provisioning", undefined));

    expect(report).not.toHaveBeenCalled();
  });

  it("writes no reference tag when neither a correlation id nor a trace could be resolved", () => {
    renderHook(() => useReportRenderedError("invest", TX_ERROR, undefined));

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[3]).toEqual({});
    expect(report.mock.calls[0]?.[2]).not.toHaveProperty("reference");
  });

  it("[R5] never throws into the render path, even if reporting itself fails", () => {
    report.mockImplementationOnce(() => {
      throw new Error("vendor down");
    });

    let escaped = false;
    try {
      renderHook(() => useReportRenderedError("provisioning", TX_ERROR, REFERENCE));
    } catch {
      escaped = true;
    }
    expect(escaped).toBe(false);
    expect(report).toHaveBeenCalled();
  });

  it("leads the message with the CODE, so issues group by failure kind not upstream prose", () => {
    renderHook(() => useReportRenderedError("provisioning", TX_ERROR, REFERENCE));

    const error = report.mock.calls[0]?.[1] as Error;
    expect(error.message).toBe("ONRAMP_ERROR: The purchase did not complete");
  });
});

/**
 * POO-1387 review, B3. The guarantee is per-MOUNT, and four artefacts used to claim it was stronger.
 * Rafael's decision (2026-08-06): one event per FAILED ATTEMPT is the intent. These pin both edges so
 * a change in either direction fails a test rather than quietly contradicting the docs.
 */
describe("[POO-1387] the dedupe guarantee, stated precisely", () => {
  it("re-files after a REMOUNT, because 'Try again' unmounts the dialog subtree", () => {
    const first = renderHook(() => useReportRenderedError("provisioning", TX_ERROR, REFERENCE));
    expect(report).toHaveBeenCalledTimes(1);
    first.unmount();

    renderHook(() => useReportRenderedError("provisioning", TX_ERROR, REFERENCE));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("re-files when only the REFERENCE changed, since a backend correlationId is per-request", () => {
    const { rerender } = renderHook(
      ({ reference }) => useReportRenderedError("provisioning", TX_ERROR, reference),
      { initialProps: { reference: REFERENCE } },
    );
    rerender({ reference: "b00b6fa428df4fff86f04e1cba8acbb7" });

    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1]?.[3]).toEqual({ pp_reference: "b00b6fa428df4fff86f04e1cba8acbb7" });
  });
});

/**
 * POO-1713 rules v1: one Sentry issue per failure KIND, not one per reporter.
 *
 * Every event this hook files is built from `new Error(...)` on one shared line, so every event
 * carries the same stack, and Sentry groups a JavaScript exception by its stack whenever one
 * exists. The message is never consulted. That is why `POOL-PARTY-FRONTEND-1H` held **289 events,
 * 21 distinct error codes and 4 routes** in a single issue, titled by whichever event arrived last:
 * `TX_SLIPPAGE_EXCEEDED` (127 events) sat invisible underneath `MOVE_RANGE_FAILED` (38).
 *
 * The consequences were not cosmetic. Three separate issues quoted that group's headline as one
 * defect's blast radius, a new failure mode joined a group with a 13-day-old `firstSeen` and
 * therefore never alerted, and resolving the group after fixing one code reopened it on the next
 * unrelated error.
 */
describe("[POO-1713] Sentry grouping", () => {
  // @rule POO-1713 R2 — the key is what the failure IS: event, surface, code.
  it("[R2] fingerprints on event + surface + code", () => {
    renderHook(() => useReportRenderedError("provisioning", TX_ERROR, REFERENCE));

    expect(report.mock.calls[0]?.[4]).toEqual(["tx.error_shown", "provisioning", "ONRAMP_ERROR"]);
  });

  // @rule POO-1713 R2 — the same code on two surfaces is two issues. `surface` is in the key
  // because the same failure in two flows usually needs two different fixes.
  it("[R2] separates the same code raised on different surfaces", () => {
    renderHook(() => useReportRenderedError("provisioning", TX_ERROR, REFERENCE));
    renderHook(() => useReportRenderedError("invest", TX_ERROR, REFERENCE));

    expect(report.mock.calls[0]?.[4]).not.toEqual(report.mock.calls[1]?.[4]);
  });

  // @rule POO-1713 R2 — and two codes on ONE surface are two issues. This is the exact collapse
  // that produced the 289-event group.
  it("[R2] separates different codes raised on the same surface", () => {
    renderHook(() => useReportRenderedError("manager", TX_ERROR, REFERENCE));
    renderHook(() =>
      useReportRenderedError(
        "manager",
        { code: "MOVE_RANGE_FAILED", message: "No rebalance is possible" },
        REFERENCE,
      ),
    );

    expect(report.mock.calls[0]?.[4]).not.toEqual(report.mock.calls[1]?.[4]);
  });

  /**
   * @rule POO-1713 R3 — a missing code contributes `"unknown"`, never nothing.
   *
   * An array that silently loses an element re-collapses the groups this exists to separate, and it
   * does so invisibly: the fingerprint still "works", it just groups more than it should.
   */
  it("[R3] substitutes 'unknown' for an empty code rather than dropping the element", () => {
    renderHook(() =>
      useReportRenderedError("deposit", { code: "", message: "something" }, REFERENCE),
    );

    expect(report.mock.calls[0]?.[4]).toEqual(["tx.error_shown", "deposit", "unknown"]);
  });

  /**
   * @rule POO-1713 R2 — the reference is NOT in the key.
   *
   * It is per-pageload or per-request, so including it would give every single occurrence its own
   * Sentry issue: the opposite failure to the one being fixed, and a far more annoying one.
   */
  it("[R2] does not put the per-occurrence reference in the fingerprint", () => {
    renderHook(() => useReportRenderedError("provisioning", TX_ERROR, REFERENCE));
    renderHook(() =>
      useReportRenderedError("provisioning", TX_ERROR, "b00b6fa428df4fff86f04e1cba8acbb7"),
    );

    // Asserted as a VALUE first, not only as an equality. Comparing the two calls to each other is
    // a real differential pin (it fails the moment `reference` joins the key), but on its own it
    // also passes when there is no fingerprint at all, because `undefined` equals `undefined`. The
    // literal is what makes this test evidence that the key EXISTS as well as evidence of what it
    // omits.
    expect(report.mock.calls[0]?.[4]).toEqual(["tx.error_shown", "provisioning", "ONRAMP_ERROR"]);
    expect(report.mock.calls[0]?.[4]).toEqual(report.mock.calls[1]?.[4]);
  });
});
