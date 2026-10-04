import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REPORT_WAIT_MS,
  useLaunchReportCountdown,
  useLaunchReportWait,
} from "./useLaunchReportWait";

const report = (status = "waiting", id = "report") => ({ id, kind: "report", status });
let identity = 0;
let draft: string;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  localStorage.clear();
  draft = `timing-${identity++}`;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("report wait metadata", () => {
  // @rule R2
  it("starts only observed building/waiting reports, even alongside a signing step", () => {
    const { result, rerender } = renderHook(
      ({ status }) =>
        useLaunchReportWait("MANAGER", draft, [
          report(status),
          report("idle", "future"),
          { id: "sign", kind: "approve", status: "signing" },
        ]),
      { initialProps: { status: "idle" } },
    );
    expect(result.current.report).toBeUndefined();
    rerender({ status: "building" });
    expect(result.current.report).toBe(Date.now());
    expect(result.current.future).toBeUndefined();
  });
  // @rule R3
  it("preserves legacy first observation across polling, error/retry and remount", () => {
    const first = Date.now();
    const { result, rerender, unmount } = renderHook(
      ({ status }) => useLaunchReportWait("Manager", draft, [report(status)]),
      { initialProps: { status: "waiting" } },
    );
    expect(result.current.report).toBe(first);
    act(() => vi.advanceTimersByTime(60_000));
    rerender({ status: "failed" });
    rerender({ status: "building" });
    expect(result.current.report).toBe(first);
    unmount();
    const next = renderHook(() => useLaunchReportWait("manager", draft, [report()]));
    expect(next.result.current.report).toBe(first);
    expect(localStorage.length).toBe(1);
  });
  // @rule R2
  it("partitions manager, draft and report and clears projected starts on identity changes", () => {
    const { result, rerender } = renderHook(
      ({ manager, draftId, steps }) => useLaunchReportWait(manager, draftId, steps),
      { initialProps: { manager: "a", draftId: draft, steps: [report()] } },
    );
    const first = Date.now();
    act(() => vi.advanceTimersByTime(1000));
    rerender({ manager: "b", draftId: draft, steps: [report()] });
    expect(result.current.report).toBe(first + 1000);
    rerender({ manager: "a", draftId: `${draft}-other`, steps: [report("idle")] });
    expect(result.current.report).toBeUndefined();
    rerender({ manager: "a", draftId: draft, steps: [report(), report("waiting", "other")] });
    expect(result.current.report).toBe(first);
    expect(result.current.other).toBe(first + 1000);
  });
  // @rule R3
  it("rejects malformed/future metadata and uses memory when storage throws", () => {
    const key = `pp:v2-launch:report-wait:${JSON.stringify(["a", draft, "report"])}`;
    localStorage.setItem(key, JSON.stringify({ startedAt: Date.now() + 1000 }));
    const first = renderHook(() => useLaunchReportWait("a", draft, [report()]));
    expect(first.result.current.report).toBe(Date.now());
    first.unmount();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const memory = renderHook(() => useLaunchReportWait("b", draft, [report()]));
    const start = memory.result.current.report;
    memory.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(
      renderHook(() => useLaunchReportWait("b", draft, [report()])).result.current.report,
    ).toBe(start);
  });
  // @rule R3
  it("rejects nonnumeric metadata and persists in memory when only writes fail", () => {
    const key = `pp:v2-launch:report-wait:${JSON.stringify(["a", draft, "report"])}`;
    localStorage.setItem(key, JSON.stringify({ startedAt: "yesterday" }));
    const invalid = renderHook(() => useLaunchReportWait("a", draft, [report()]));
    expect(invalid.result.current.report).toBe(Date.now());
    invalid.unmount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const first = renderHook(() => useLaunchReportWait("write-only", draft, [report()]));
    const startedAt = first.result.current.report;
    first.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(
      renderHook(() => useLaunchReportWait("write-only", draft, [report()])).result.current.report,
    ).toBe(startedAt);
  });
});

describe("isolated countdown", () => {
  // @rule R4
  it("uses an absolute 19-minute deadline, reaches zero and stops ticking", () => {
    const start = Date.now();
    const clock = renderHook(() => useLaunchReportCountdown(start));
    expect(clock.result.current).toBe(1140);
    act(() => vi.advanceTimersByTime(1000));
    expect(clock.result.current).toBe(1139);
    act(() => vi.advanceTimersByTime(REPORT_WAIT_MS));
    expect(clock.result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  // @rule R4
  it("clamps backward time, catches up on visibility change and cleans identity/unmount", () => {
    const start = Date.now();
    const { result, rerender, unmount } = renderHook(
      ({ timestamp }) => useLaunchReportCountdown(timestamp),
      { initialProps: { timestamp: start as number | undefined } },
    );
    vi.setSystemTime(start - 10_000);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(1140);
    vi.setSystemTime(start + REPORT_WAIT_MS + 1000);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(0);
    rerender({ timestamp: undefined });
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    rerender({ timestamp: Date.now() });
    expect(result.current).toBe(1140);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
