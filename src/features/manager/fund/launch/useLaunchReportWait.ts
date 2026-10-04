/**
 * @id PP-MGR-HOK-022 (POO-2233)
 * @name useLaunchReportWait
 * @description Device-local report wait metadata and an isolated 19-minute display clock
 * @figma Provisioning reference 6550:615; owner launch screenshot 2026-10-04
 * @linear POO-2233
 * @i18n-namespace none: numeric timing only
 * @implements-rules-version v1
 * @analytics-events none: local display timing only; execution events belong to the runner
 */
"use client";
import { useEffect, useState } from "react";

export const REPORT_WAIT_MS = 19 * 60 * 1000;
const memoryStarts = new Map<string, number>();
type ReportStep = { id: string; kind: string; status: string };
const metadataKey = (manager: string, draftId: string, stepId: string) =>
  `pp:v2-launch:report-wait:${JSON.stringify([manager, draftId, stepId])}`;

function readStart(key: string, now: number): number | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (typeof value === "object" && value !== null && "startedAt" in value) {
        const startedAt = value.startedAt;
        if (
          typeof startedAt === "number" &&
          Number.isSafeInteger(startedAt) &&
          startedAt > 0 &&
          startedAt <= now
        ) {
          memoryStarts.set(key, startedAt);
          return startedAt;
        }
      }
    }
  } catch {
    // Storage may be disabled or contain malformed legacy metadata.
  }
  return memoryStarts.get(key);
}

/** Metadata is separate from the execution journal and never changes executor readiness. */
export function useLaunchReportWait(
  manager: string | null | undefined,
  draftId: string | undefined,
  steps: readonly ReportStep[],
): Readonly<Record<string, number>> {
  const normalizedManager = manager?.toLowerCase();
  const identity =
    normalizedManager && draftId ? JSON.stringify([normalizedManager, draftId]) : null;
  const [observed, setObserved] = useState<{
    identity: string | null;
    starts: Record<string, number>;
  }>({ identity: null, starts: {} });
  // Depend on report state, not the polling runner's freshly allocated step objects.
  const reportStates = JSON.stringify(
    steps.filter((step) => step.kind === "report").map((step) => [step.id, step.status]),
  );
  useEffect(() => {
    if (!identity || !normalizedManager || !draftId) {
      setObserved((previous) =>
        previous.identity === null ? previous : { identity: null, starts: {} },
      );
      return;
    }
    const starts: Record<string, number> = {};
    const now = Date.now();
    for (const [stepId, status] of JSON.parse(reportStates) as [string, string][]) {
      const key = metadataKey(normalizedManager, draftId, stepId);
      let startedAt = readStart(key, now);
      if (startedAt === undefined && (status === "building" || status === "waiting")) {
        startedAt = now;
        memoryStarts.set(key, startedAt);
        try {
          localStorage.setItem(key, JSON.stringify({ startedAt }));
        } catch {
          // The memory entry preserves retries/remounts when browser storage is unavailable.
        }
      }
      if (startedAt !== undefined) starts[stepId] = startedAt;
    }
    setObserved((previous) =>
      previous.identity === identity && JSON.stringify(previous.starts) === JSON.stringify(starts)
        ? previous
        : { identity, starts },
    );
  }, [identity, normalizedManager, draftId, reportStates]);
  return observed.identity === identity ? observed.starts : {};
}

function remainingSeconds(startedAt: number | undefined): number | null {
  if (startedAt === undefined || !Number.isFinite(startedAt)) return null;
  return Math.max(
    0,
    Math.min(REPORT_WAIT_MS / 1000, Math.ceil((startedAt + REPORT_WAIT_MS - Date.now()) / 1000)),
  );
}

/** Isolated display clock. No signing, polling, retry or settlement side effects. */
export function useLaunchReportCountdown(startedAt: number | undefined): number | null {
  const [clock, setClock] = useState(() => ({ startedAt, remaining: remainingSeconds(startedAt) }));
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      const remaining = remainingSeconds(startedAt);
      setClock((previous) =>
        previous.startedAt === startedAt && previous.remaining === remaining
          ? previous
          : { startedAt, remaining },
      );
      if (remaining === null || remaining === 0) {
        if (interval !== undefined) clearInterval(interval);
        interval = undefined;
      } else if (interval === undefined) {
        interval = setInterval(update, 1000);
      }
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      if (interval !== undefined) clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, [startedAt]);
  return clock.startedAt === startedAt ? clock.remaining : remainingSeconds(startedAt);
}
