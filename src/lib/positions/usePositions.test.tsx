/**
 * @id PP-PORT (POO-299, POO-270, POO-453)
 * @name usePositions tests
 * @implements-rules-version v2
 *
 * Waits for the SIWE session, then fetches via getPositionsAction (discriminated result). [R4] A
 * transient (retryable) failure is retried on a backoff without surfacing an error or blanking the
 * list; [R5] a non-retryable failure (or exhausted retries) surfaces `error`.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PositionsResult } from "@/features/portfolio/actions";
import type { Position } from "@/lib/schemas";
import { usePositions } from "./usePositions";

const mocks = vi.hoisted(() => ({
  session: { isSignedIn: false, status: "idle" as string, error: null as unknown },
  action: vi.fn(),
}));

vi.mock("@/lib/auth/useSiweSession", () => ({ useSiweSession: () => mocks.session }));
vi.mock("@/features/portfolio/actions", () => ({ getPositionsAction: mocks.action }));

function Probe() {
  const { positions, error, isRetrying } = usePositions();
  if (error) return <div data-testid="error" />;
  if (!positions) return <div data-testid="loading">{isRetrying ? "retrying" : ""}</div>;
  return (
    <div data-testid="count" data-retrying={String(isRetrying)}>
      {positions.length}
    </div>
  );
}

const samplePositions = [{ id: "p1", strategyId: "s1" }] as unknown as Position[];
const ok = (positions: Position[]): PositionsResult => ({ ok: true, positions });
const retryable: PositionsResult = { ok: false, retryable: true };
const fatal: PositionsResult = { ok: false, retryable: false };

describe("usePositions", () => {
  beforeEach(() => {
    mocks.session = { isSignedIn: false, status: "idle", error: null };
    mocks.action.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch until the session is signed in", () => {
    render(<Probe />);
    expect(screen.getByTestId("loading")).toBeInTheDocument();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("fetches with no client address once signed in", async () => {
    mocks.session = { isSignedIn: true, status: "signed-in", error: null };
    mocks.action.mockResolvedValue(ok(samplePositions));

    render(<Probe />);

    await waitFor(() => expect(mocks.action).toHaveBeenCalledWith());
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
  });

  it("re-fetches when the tab regains focus (POO-329)", async () => {
    mocks.session = { isSignedIn: true, status: "signed-in", error: null };
    mocks.action.mockResolvedValue(ok(samplePositions));
    render(<Probe />);
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(1));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(mocks.action).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("surfaces a SIWE session failure", () => {
    mocks.session = { isSignedIn: false, status: "error", error: new Error("nope") };
    render(<Probe />);
    expect(screen.getByTestId("error")).toBeInTheDocument();
    expect(mocks.action).not.toHaveBeenCalled();
  });

  it("[R5] surfaces a non-retryable failure immediately", async () => {
    mocks.session = { isSignedIn: true, status: "signed-in", error: null };
    mocks.action.mockResolvedValue(fatal);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId("error")).toBeInTheDocument());
  });

  it("[R4] a retryable failure does NOT surface an error; it retries and recovers", async () => {
    vi.useFakeTimers();
    mocks.session = { isSignedIn: true, status: "signed-in", error: null };
    // First read is throttled (retryable), the retry succeeds.
    mocks.action.mockResolvedValueOnce(retryable).mockResolvedValue(ok(samplePositions));

    render(<Probe />);
    // Flush the first (failed) read: no error, marked retrying, still showing the skeleton.
    await act(async () => {});
    expect(screen.queryByTestId("error")).not.toBeInTheDocument();
    expect(screen.getByTestId("loading")).toHaveTextContent("retrying");

    // Advance past the first backoff (3s): the retry runs and recovers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("count")).toHaveAttribute("data-retrying", "false");
    expect(mocks.action).toHaveBeenCalledTimes(2);
  });

  it("[R4] keeps the last-good positions on a later transient failure (no blank, no error)", async () => {
    vi.useFakeTimers();
    mocks.session = { isSignedIn: true, status: "signed-in", error: null };
    mocks.action.mockResolvedValueOnce(ok(samplePositions)).mockResolvedValue(retryable);

    render(<Probe />);
    await act(async () => {}); // first read ok
    expect(screen.getByTestId("count")).toHaveTextContent("1");

    // A background focus refresh now hits a throttle: the list stays, no error surfaces.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("count")).toHaveAttribute("data-retrying", "true");
    expect(screen.queryByTestId("error")).not.toBeInTheDocument();
  });

  it("[R4] surfaces an error only after the retry budget is exhausted", async () => {
    vi.useFakeTimers();
    mocks.session = { isSignedIn: true, status: "signed-in", error: null };
    mocks.action.mockResolvedValue(retryable); // always throttled

    render(<Probe />);
    await act(async () => {}); // initial failure → schedules retry 1
    expect(screen.queryByTestId("error")).not.toBeInTheDocument();

    // Walk the full backoff schedule (3s, then 8s, then 20s); each step flushes the retry's re-fetch
    // so the chain cascades. The last retry gives up and surfaces the error.
    for (const step of [3000, 8000, 20_000]) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(step);
      });
    }
    expect(screen.getByTestId("error")).toBeInTheDocument();
    // 1 initial + 3 retries.
    expect(mocks.action).toHaveBeenCalledTimes(4);
  });

  it("[R4] a thrown Server Action invocation is treated as transient (retries, no error)", async () => {
    vi.useFakeTimers();
    mocks.session = { isSignedIn: true, status: "signed-in", error: null };
    mocks.action.mockRejectedValueOnce(new Error("network")).mockResolvedValue(ok(samplePositions));

    render(<Probe />);
    await act(async () => {});
    expect(screen.queryByTestId("error")).not.toBeInTheDocument();
    expect(screen.getByTestId("loading")).toHaveTextContent("retrying");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
