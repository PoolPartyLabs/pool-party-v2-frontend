/**
 * @id PP-CORE-HOK-015
 * @name useWalletSignFlow tests
 * @implements-rules-version v1
 *
 * The runner advances activeStep + per-step status as ordered async steps settle, merges returned
 * context into later steps, records hashes, marks skips, and on a thrown step stops in an error state
 * whose retry() resumes from the failed step (done steps are not re-run). reset() returns to idle.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type FlowStep, useWalletSignFlow } from "./useWalletSignFlow";

type Ctx = Record<string, unknown>;

function step(key: string, run: FlowStep<Ctx>["run"] = async () => ({})): FlowStep<Ctx> {
  return { key, run: vi.fn(run) };
}

describe("useWalletSignFlow", () => {
  it("advances through steps and ends in success with the terminal hash", async () => {
    const steps = [step("a"), step("b"), step("c", async () => ({ txHash: "0xabc" }))];
    const { result } = renderHook(() => useWalletSignFlow(steps));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.status).toBe("success");
    expect(result.current.statuses).toEqual(["done", "done", "done"]);
    expect(result.current.txHash).toBe("0xabc");
    expect(result.current.txHashes[2]).toBe("0xabc");
  });

  it("marks a step skipped and still advances", async () => {
    const steps = [step("a", async () => ({ skipped: true })), step("b")];
    const { result } = renderHook(() => useWalletSignFlow(steps));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.statuses).toEqual(["skipped", "done"]);
    expect(result.current.status).toBe("success");
  });

  it("stops at a thrown step in an error state with the mapped provider code", async () => {
    const cRun = vi.fn(async () => ({}));
    const steps: FlowStep<Ctx>[] = [
      step("a"),
      step("b", async () => {
        throw Object.assign(new Error("boom"), { code: 4001 });
      }),
      { key: "c", run: cRun },
    ];
    const { result } = renderHook(() =>
      useWalletSignFlow(steps, { fallbackErrorCode: "X_FAILED" }),
    );
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.statuses).toEqual(["done", "error", "idle"]);
    // toMatchObject: the flow also attaches TxError.kind (POO-473); this test only asserts the
    // code/message mapping — the kind classification is covered by diagnostics.test.ts.
    expect(result.current.error).toMatchObject({ code: "4001", message: "boom" });
    expect(cRun).not.toHaveBeenCalled();
  });

  it("falls back to the configured error code when the error carries none", async () => {
    const steps = [
      step("a", async () => {
        throw new Error("no code");
      }),
    ];
    const { result } = renderHook(() =>
      useWalletSignFlow(steps, { fallbackErrorCode: "X_FAILED" }),
    );
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.error).toMatchObject({ code: "X_FAILED", message: "no code" });
  });

  it("retry() resumes from the failed step without re-running done steps", async () => {
    let failFirst = true;
    const aRun = vi.fn(async () => ({}));
    const bRun = vi.fn(async () => {
      if (failFirst) {
        failFirst = false;
        throw new Error("transient");
      }
      return {};
    });
    const cRun = vi.fn(async () => ({}));
    const steps: FlowStep<Ctx>[] = [
      { key: "a", run: aRun },
      { key: "b", run: bRun },
      { key: "c", run: cRun },
    ];
    const { result } = renderHook(() => useWalletSignFlow(steps));
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.status).toBe("error");
    expect(aRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.status).toBe("success");
    expect(aRun).toHaveBeenCalledTimes(1); // done step not re-run
    expect(bRun).toHaveBeenCalledTimes(2); // failed step retried
    expect(cRun).toHaveBeenCalledTimes(1);
  });

  it("merges a step's returned context into later steps", async () => {
    const seen: unknown[] = [];
    const steps: FlowStep<{ v?: number }>[] = [
      { key: "a", run: async () => ({ v: 42 }) },
      {
        key: "b",
        run: async (ctx) => {
          seen.push(ctx.v);
          return {};
        },
      },
    ];
    const { result } = renderHook(() => useWalletSignFlow<{ v?: number }>(steps));
    await act(async () => {
      await result.current.run();
    });
    expect(seen).toEqual([42]);
  });

  it("reset() mid-run cancels the in-flight run so it never reaches success", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const steps: FlowStep<Ctx>[] = [
      // Hangs until released, leaving the run parked inside the first step's await.
      {
        key: "a",
        run: vi.fn(async () => {
          await gate;
          return {};
        }),
      },
      step("b"),
    ];
    const { result } = renderHook(() => useWalletSignFlow(steps));

    let runPromise: Promise<void> = Promise.resolve();
    act(() => {
      runPromise = result.current.run();
    });
    // Cancel while step "a" is still awaiting; reset() bumps the run-id guard.
    act(() => {
      result.current.reset();
    });
    // Release the parked step: the post-await run-id check must abandon the stale run.
    await act(async () => {
      release();
      await runPromise;
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.statuses).toEqual(["idle", "idle"]);
  });

  it("reset() returns the flow to idle", async () => {
    const steps = [step("a"), step("b")];
    const { result } = renderHook(() => useWalletSignFlow(steps));
    await act(async () => {
      await result.current.run();
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.activeStep).toBe(0);
    expect(result.current.statuses).toEqual(["idle", "idle"]);
    expect(result.current.txHash).toBeNull();
  });

  // POO-499 R2a: retryFrom(key) resumes the run from the step whose key matches, so a slippage
  // retry re-runs the build (backend re-quotes minOut) without re-signing approve/permit.
  describe("retryFrom (POO-499 R2a)", () => {
    // @rule R2a — retryFrom re-runs from the keyed step, preserving earlier statuses + context.
    it("re-runs from the step with the given key, preserving earlier statuses and context", async () => {
      let failConfirm = true;
      const approveRun = vi.fn(async () => ({ approved: true }));
      const buildRun = vi.fn(async () => ({ built: true }));
      const seenBuildCtx: unknown[] = [];
      const confirmRun = vi.fn(async (ctx: Ctx) => {
        seenBuildCtx.push(ctx.approved);
        if (failConfirm) {
          failConfirm = false;
          throw Object.assign(new Error("slippage tolerance exceeded"), { code: "-32603" });
        }
        return { txHash: "0xok" };
      });
      const steps: FlowStep<Ctx>[] = [
        { key: "approve:USDC", run: approveRun },
        { key: "build", run: buildRun },
        { key: "confirm:invest", run: confirmRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("error");

      await act(async () => {
        await result.current.retryFrom("build");
      });
      expect(result.current.status).toBe("success");
      // approve is NEVER re-run (its done status is preserved).
      expect(approveRun).toHaveBeenCalledTimes(1);
      // build is re-run (the re-quote), confirm runs the second time to success.
      expect(buildRun).toHaveBeenCalledTimes(2);
      expect(confirmRun).toHaveBeenCalledTimes(2);
      // The accumulated approve context survives the retry (build saw it both times).
      expect(seenBuildCtx).toEqual([true, true]);
      expect(result.current.statuses).toEqual(["done", "done", "done"]);
    });

    // @rule R2a — approve/permit steps are never re-run or re-signed on a build-keyed retry.
    it("never re-runs approve/permit steps on a build-keyed retry", async () => {
      let failFirst = true;
      const approveRun = vi.fn(async () => ({}));
      const permitRun = vi.fn(async () => ({}));
      const buildRun = vi.fn(async () => {
        if (failFirst) {
          failFirst = false;
          throw new Error("slippage");
        }
        return {};
      });
      const steps: FlowStep<Ctx>[] = [
        { key: "approve:USDC", run: approveRun },
        { key: "permit", run: permitRun },
        { key: "build", run: buildRun },
        { key: "confirm:invest", run: vi.fn(async () => ({ txHash: "0xok" })) },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("error");
      await act(async () => {
        await result.current.retryFrom("build");
      });
      expect(result.current.status).toBe("success");
      expect(approveRun).toHaveBeenCalledTimes(1);
      expect(permitRun).toHaveBeenCalledTimes(1);
      expect(buildRun).toHaveBeenCalledTimes(2);
    });

    // @rule R2a — statuses at/after the target reset (the prior confirm "error" never lingers): a
    // retry that re-runs build then fails confirm AGAIN lands back on ["done","error"], not a stale
    // ["error","error"] — proving confirm was reset to idle before re-running.
    it("resets statuses at/after the target so a prior error does not linger", async () => {
      let failCount = 0;
      const buildRun = vi.fn(async () => ({}));
      const confirmRun = vi.fn(async () => {
        failCount += 1;
        throw new Error("slippage");
      });
      const steps: FlowStep<Ctx>[] = [
        { key: "build", run: buildRun },
        { key: "confirm:invest", run: confirmRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.statuses).toEqual(["done", "error"]);

      await act(async () => {
        await result.current.retryFrom("build");
      });
      // build re-ran (done again), confirm failed again — the array is clean, build is not "error".
      expect(result.current.statuses).toEqual(["done", "error"]);
      expect(buildRun).toHaveBeenCalledTimes(2);
      expect(failCount).toBe(2);
    });

    // @rule R2a — a successful retry from build clears the earlier error (no stale idle/error).
    it("clears the target's prior status on a successful retry from build", async () => {
      let failFirst = true;
      const buildRun = vi.fn(async () => ({}));
      const confirmRun = vi.fn(async () => {
        if (failFirst) {
          failFirst = false;
          throw new Error("slippage");
        }
        return { txHash: "0xok" };
      });
      const steps: FlowStep<Ctx>[] = [
        { key: "build", run: buildRun },
        { key: "confirm:invest", run: confirmRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.statuses).toEqual(["done", "error"]);
      await act(async () => {
        await result.current.retryFrom("build");
      });
      expect(result.current.status).toBe("success");
      expect(result.current.statuses).toEqual(["done", "done"]);
    });

    // @rule R2a — an unknown key falls back to today's resume-from-failed-step semantics.
    it("falls back to the failed step when the key is unknown", async () => {
      let failFirst = true;
      const aRun = vi.fn(async () => ({}));
      const bRun = vi.fn(async () => {
        if (failFirst) {
          failFirst = false;
          throw new Error("boom");
        }
        return {};
      });
      const steps: FlowStep<Ctx>[] = [
        { key: "a", run: aRun },
        { key: "b", run: bRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("error");
      await act(async () => {
        await result.current.retryFrom("build"); // no such key → resume from failed step "b"
      });
      expect(result.current.status).toBe("success");
      expect(aRun).toHaveBeenCalledTimes(1); // done step not re-run
      expect(bRun).toHaveBeenCalledTimes(2);
    });

    // @rule R3 — retryFrom picks up a rebuilt steps array (a new slippage closure) on re-run.
    it("picks up a rebuilt steps array on re-run", async () => {
      const firstConfirm = vi.fn(async () => {
        throw new Error("slippage");
      });
      const secondConfirm = vi.fn(async () => ({ txHash: "0xnew" }));
      const buildRun = vi.fn(async () => ({}));
      const initialSteps: FlowStep<Ctx>[] = [
        { key: "build", run: buildRun },
        { key: "confirm:invest", run: firstConfirm },
      ];
      const { result, rerender } = renderHook(
        (props: { steps: FlowStep<Ctx>[] }) => useWalletSignFlow(props.steps),
        { initialProps: { steps: initialSteps } },
      );
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("error");

      // Simulate the modal rebuilding steps after the slippage change (new confirm closure).
      const rebuiltSteps: FlowStep<Ctx>[] = [
        { key: "build", run: buildRun },
        { key: "confirm:invest", run: secondConfirm },
      ];
      rerender({ steps: rebuiltSteps });
      await act(async () => {
        await result.current.retryFrom("build");
      });
      expect(result.current.status).toBe("success");
      expect(secondConfirm).toHaveBeenCalledTimes(1);
      expect(result.current.txHash).toBe("0xnew");
    });
  });

  // POO-574: an opt-in `pauseAfterKey` holds the flow in an `awaiting` state after the keyed step
  // (build → review), exposing the accumulated context; `resume()` continues to signing and
  // `rebuild()` re-runs the keyed step (re-quote) and pauses again. Default (no key) is unchanged.
  describe("pause / resume / rebuild (POO-574)", () => {
    // @rule R1 — pauses after the keyed step in `awaiting`, exposes context, does not run later steps.
    it("pauses after the keyed step, exposes context, and resume() continues to success", async () => {
      const buildRun = vi.fn(async () => ({ built: { estimatedGasInUsd: 1.5 } }));
      const confirmRun = vi.fn(async () => ({ txHash: "0xok" }));
      const steps: FlowStep<Ctx>[] = [
        { key: "build", run: buildRun },
        { key: "confirm", run: confirmRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("awaiting");
      expect(result.current.statuses).toEqual(["done", "idle"]);
      expect(result.current.context).toMatchObject({ built: { estimatedGasInUsd: 1.5 } });
      expect(confirmRun).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.resume();
      });
      expect(result.current.status).toBe("success");
      expect(result.current.txHash).toBe("0xok");
      expect(buildRun).toHaveBeenCalledTimes(1);
      expect(confirmRun).toHaveBeenCalledTimes(1);
    });

    // @rule R3 — rebuild() re-runs the keyed step (re-quote), refreshes context, and pauses again.
    it("rebuild() re-runs the keyed step and pauses again with fresh context", async () => {
      let gas = 1;
      const buildRun = vi.fn(async () => ({ built: { estimatedGasInUsd: gas } }));
      const confirmRun = vi.fn(async () => ({ txHash: "0xok" }));
      const steps: FlowStep<Ctx>[] = [
        { key: "build", run: buildRun },
        { key: "confirm", run: confirmRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.context).toMatchObject({ built: { estimatedGasInUsd: 1 } });

      gas = 2;
      await act(async () => {
        await result.current.rebuild();
      });
      expect(result.current.status).toBe("awaiting");
      expect(result.current.context).toMatchObject({ built: { estimatedGasInUsd: 2 } });
      expect(buildRun).toHaveBeenCalledTimes(2);
      expect(confirmRun).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.resume();
      });
      expect(result.current.status).toBe("success");
    });

    // @rule R1 — with no pauseAfterKey the flow runs straight through (existing behavior intact).
    it("does not pause when pauseAfterKey is not set", async () => {
      const steps = [step("build"), step("confirm", async () => ({ txHash: "0x1" }))];
      const { result } = renderHook(() => useWalletSignFlow(steps));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("success");
    });

    // @rule R1 — a throw in the paused step is an error, never an awaiting pause.
    it("goes to error (not awaiting) when the keyed step throws", async () => {
      const steps: FlowStep<Ctx>[] = [
        {
          key: "build",
          run: async () => {
            throw new Error("build failed");
          },
        },
        step("confirm"),
      ];
      const { result } = renderHook(() =>
        useWalletSignFlow(steps, { pauseAfterKey: "build", fallbackErrorCode: "X" }),
      );
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("error");
    });

    // @rule R4 — after approval (resume), a slippage retryFrom("build") re-quotes and signs WITHOUT
    // re-pausing at the review (the user already approved; the auto-retry runs through).
    it("retryFrom the pause key runs through without re-pausing", async () => {
      let failFirst = true;
      const buildRun = vi.fn(async () => ({ built: {} }));
      const confirmRun = vi.fn(async () => {
        if (failFirst) {
          failFirst = false;
          throw new Error("slippage");
        }
        return { txHash: "0xok" };
      });
      const steps: FlowStep<Ctx>[] = [
        { key: "build", run: buildRun },
        { key: "confirm", run: confirmRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("awaiting");
      await act(async () => {
        await result.current.resume();
      });
      expect(result.current.status).toBe("error");

      await act(async () => {
        await result.current.retryFrom("build");
      });
      expect(result.current.status).toBe("success");
      expect(buildRun).toHaveBeenCalledTimes(2);
      expect(confirmRun).toHaveBeenCalledTimes(2);
    });

    // @rule R1 — reset() clears the awaiting pause and context back to idle.
    it("reset() clears an awaiting pause and its context", async () => {
      const steps: FlowStep<Ctx>[] = [
        { key: "build", run: async () => ({ built: { estimatedGasInUsd: 3 } }) },
        step("confirm"),
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("awaiting");
      act(() => {
        result.current.reset();
      });
      expect(result.current.status).toBe("idle");
      expect(result.current.context).toEqual({});
      expect(result.current.statuses).toEqual(["idle", "idle"]);
    });
  });

  // POO-887: the retry gate. [R1] a retry whose failed step sits at or before the pause re-honors
  // the Review pause (the pause was never consumed this run, so the user must land on the Review
  // before any money-moving signature); post-Review retries keep their run-through semantics.
  // [R3] a post-Review retry never reuses a built tx older than its freshness window - it rebuilds
  // first. `retryWillPause` tells the host which phase to enter ("building" vs "pending").
  describe("retry gate (POO-887)", () => {
    function failOnceStep(key: string) {
      let failed = false;
      const run = vi.fn(async () => {
        if (!failed) {
          failed = true;
          throw new Error(`${key} rejected`);
        }
        return {};
      });
      return { key, run } as FlowStep<Ctx>;
    }

    // @rule R1 - a pre-Review failure (permit cancel) retried re-honors the pause: the flow lands
    // back in `awaiting` (the Review) instead of running straight into the send.
    it("retry() after a pre-pause failure pauses at the review again before the send", async () => {
      const permit = failOnceStep("permit");
      const buildRun = vi.fn(async () => ({ built: { quote: 1 } }));
      const confirmRun = vi.fn(async () => ({ txHash: "0xok" }));
      const steps: FlowStep<Ctx>[] = [
        permit,
        { key: "build", run: buildRun },
        { key: "confirm", run: confirmRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("error");
      expect(result.current.retryWillPause).toBe(true);

      await act(async () => {
        await result.current.retry();
      });
      // The retry stops at the Review pause - the send is NOT reached.
      expect(result.current.status).toBe("awaiting");
      expect(confirmRun).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.resume();
      });
      expect(result.current.status).toBe("success");
      expect(confirmRun).toHaveBeenCalledTimes(1);
    });

    // @rule R1 - a failed build itself (at the pause index) retried also re-pauses at the Review.
    it("retry() after a failed build pauses at the review, not straight into the send", async () => {
      const build = failOnceStep("build");
      const confirmRun = vi.fn(async () => ({ txHash: "0xok" }));
      const steps: FlowStep<Ctx>[] = [build, { key: "confirm", run: confirmRun }];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("error");
      await act(async () => {
        await result.current.retry();
      });
      expect(result.current.status).toBe("awaiting");
      expect(confirmRun).not.toHaveBeenCalled();
    });

    // @rule R1 - retryFrom() with a pre-pause failed step re-honors the pause too.
    it("retryFrom('build') after a pre-pause failure re-honors the pause", async () => {
      const permit = failOnceStep("permit");
      const confirmRun = vi.fn(async () => ({ txHash: "0xok" }));
      const steps: FlowStep<Ctx>[] = [
        permit,
        { key: "build", run: vi.fn(async () => ({ built: {} })) },
        { key: "confirm", run: confirmRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      await act(async () => {
        await result.current.retryFrom("build");
      });
      expect(result.current.status).toBe("awaiting");
      expect(confirmRun).not.toHaveBeenCalled();
    });

    // @rule R2 - a post-Review failure keeps the run-through retry (the pause WAS consumed), and
    // `retryWillPause` reads false so the host stays on its pending phase.
    it("retry() after a post-pause failure runs through without re-pausing", async () => {
      const buildRun = vi.fn(async () => ({ built: {} }));
      const confirm = failOnceStep("confirm");
      const steps: FlowStep<Ctx>[] = [{ key: "build", run: buildRun }, confirm];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      await act(async () => {
        await result.current.resume();
      });
      expect(result.current.status).toBe("error");
      expect(result.current.retryWillPause).toBe(false);

      await act(async () => {
        await result.current.retry();
      });
      expect(result.current.status).toBe("success");
      // The build was fresh, so it was not re-run (POO-499 semantics preserved).
      expect(buildRun).toHaveBeenCalledTimes(1);
    });

    // @rule R3 - a post-Review retry with a built tx past its freshness window rebuilds FIRST (the
    // 5-min secParams sigDeadline would guarantee a revert), then runs through to the send.
    it("retry() rebuilds a stale built tx before re-running the send", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const buildRun = vi.fn(async () => ({ built: { quote: Date.now() } }));
        const confirm = failOnceStep("confirm");
        const steps: FlowStep<Ctx>[] = [{ key: "build", run: buildRun }, confirm];
        const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
        await act(async () => {
          await result.current.run();
        });
        await act(async () => {
          await result.current.resume();
        });
        expect(result.current.status).toBe("error");

        // The user sits on the error screen past the built tx's freshness window (4 min).
        vi.setSystemTime(Date.now() + 4 * 60_000 + 1);
        await act(async () => {
          await result.current.retry();
        });
        expect(result.current.status).toBe("success");
        // The stale build was re-run before the send - never reused past its deadline.
        expect(buildRun).toHaveBeenCalledTimes(2);
        expect(confirm.run).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // POO-885: background re-quote failures are non-fatal. [R1] a failed background rebuild keeps the
  // last good quote and returns to `awaiting` (the flow never terminates); [R2] `quoteStale` flips
  // after 3 consecutive background failures (cleared by a successful rebuild) and a build older than
  // 4 minutes is never sent - Confirm forces a rebuild first; [R3] only user-action failures surface
  // as errors (a queued Confirm turns a rebuild failure fatal).
  describe("background re-quote failures (POO-885)", () => {
    /** Build step that succeeds on the first call, then follows the given per-call outcomes. */
    function flakyBuild(outcomes: ("ok" | "fail")[]) {
      let call = 0;
      const run = vi.fn(async () => {
        call += 1;
        if (call === 1) return { built: { quote: 1 } };
        const outcome = outcomes[call - 2] ?? "ok";
        if (outcome === "fail") throw new Error("re-quote 500");
        return { built: { quote: call } };
      });
      return { key: "build", run } as FlowStep<Ctx>;
    }

    // @rule R1 - a failed background rebuild keeps the last good quote and returns to awaiting.
    it("a failed background rebuild keeps the last good quote and stays awaiting", async () => {
      const build = flakyBuild(["fail"]);
      const confirmRun = vi.fn(async () => ({ txHash: "0xok" }));
      const steps: FlowStep<Ctx>[] = [build, { key: "confirm", run: confirmRun }];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("awaiting");

      await act(async () => {
        await result.current.rebuild();
      });
      // Non-fatal: still awaiting on the Review, no error, the last good quote intact.
      expect(result.current.status).toBe("awaiting");
      expect(result.current.error).toBeNull();
      expect(result.current.context).toMatchObject({ built: { quote: 1 } });
      expect(result.current.statuses).toEqual(["done", "idle"]);
      // The user can still confirm with the last good build.
      await act(async () => {
        await result.current.resume();
      });
      expect(result.current.status).toBe("success");
      expect(confirmRun).toHaveBeenCalledTimes(1);
    });

    // @rule R2 - quoteStale flips only after 3 consecutive background failures and a successful
    // rebuild clears it (and refreshes the quote).
    it("flags quoteStale after 3 consecutive background failures and clears on success", async () => {
      const build = flakyBuild(["fail", "fail", "fail", "ok"]);
      const steps: FlowStep<Ctx>[] = [build, step("confirm")];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      await act(async () => {
        await result.current.rebuild();
      });
      await act(async () => {
        await result.current.rebuild();
      });
      expect(result.current.quoteStale).toBe(false); // two failures: not yet
      await act(async () => {
        await result.current.rebuild();
      });
      expect(result.current.quoteStale).toBe(true); // third consecutive failure
      expect(result.current.status).toBe("awaiting"); // still non-fatal
      await act(async () => {
        await result.current.rebuild();
      });
      // The next window's successful rebuild refreshes the quote and clears the hint.
      expect(result.current.quoteStale).toBe(false);
      expect(result.current.context).toMatchObject({ built: { quote: 5 } });
    });

    // @rule R2 - the hard ceiling: a build older than 4 minutes is never sent; Confirm rebuilds
    // first (run-through), so the send always signs a build inside the sigDeadline.
    it("resume() with a build older than 4 minutes rebuilds before the send", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const buildRun = vi.fn(async () => ({ built: { at: Date.now() } }));
        const seen: unknown[] = [];
        const confirmRun = vi.fn(async (ctx: Ctx) => {
          seen.push((ctx.built as { at: number }).at);
          return { txHash: "0xok" };
        });
        const steps: FlowStep<Ctx>[] = [
          { key: "build", run: buildRun },
          { key: "confirm", run: confirmRun },
        ];
        const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
        await act(async () => {
          await result.current.run();
        });
        const staleAt = Date.now();
        vi.setSystemTime(staleAt + 4 * 60_000 + 1);
        await act(async () => {
          await result.current.resume();
        });
        expect(result.current.status).toBe("success");
        expect(buildRun).toHaveBeenCalledTimes(2);
        // The send signed the REBUILT tx, not the stale one.
        expect(seen).toEqual([staleAt + 4 * 60_000 + 1]);
      } finally {
        vi.useRealTimers();
      }
    });

    // @rule R3 - a rebuild failure with a QUEUED Confirm is a user-action failure: it surfaces as a
    // real error (the host's failure analytics fire only on this path, never on background ones).
    it("a rebuild failure with a queued Confirm surfaces as an error", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let call = 0;
      const buildRun = vi.fn(async () => {
        call += 1;
        if (call === 1) return { built: { quote: 1 } };
        await gate;
        throw new Error("re-quote 500");
      });
      const steps: FlowStep<Ctx>[] = [{ key: "build", run: buildRun }, step("confirm")];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      let rebuildPromise: Promise<void> = Promise.resolve();
      act(() => {
        rebuildPromise = result.current.rebuild();
      });
      let resumePromise: Promise<void> = Promise.resolve();
      act(() => {
        resumePromise = result.current.resume(); // Confirm clicked mid-rebuild
      });
      await act(async () => {
        release();
        await Promise.all([rebuildPromise, resumePromise]);
      });
      expect(result.current.status).toBe("error");
    });
  });

  // POO-888: the re-quote vs Confirm races. [R1] at most one step is ever "active" and a new runFrom
  // reconciles statuses orphaned by a cancelled run; [R2] resume() during an in-flight rebuild
  // serializes behind it and the send signs the FRESH build; [R4] once the send step is running,
  // rebuild() never cancels it - its outcome (success or failure) is always consumed.
  describe("re-quote vs Confirm races (POO-888)", () => {
    /** A step whose run() parks on a gate the test releases. */
    function gatedStep<T extends object>(key: string, result: () => T) {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const run = vi.fn(async () => {
        await gate;
        return result();
      });
      return { step: { key, run } as FlowStep<Ctx>, run, release: () => release() };
    }

    // @rule R2 - Confirm during an in-flight rebuild serializes behind it and signs the fresh build.
    it("resume() during an in-flight rebuild waits for it and the send signs the FRESH build", async () => {
      let buildCalls = 0;
      const gated = gatedStep("noop", () => ({}));
      const buildRun = vi.fn(async () => {
        buildCalls += 1;
        if (buildCalls > 1) await (gated.step.run as () => Promise<unknown>)();
        return { built: { quote: buildCalls } };
      });
      const seenBuilt: unknown[] = [];
      const confirmRun = vi.fn(async (ctx: Ctx) => {
        seenBuilt.push((ctx.built as { quote: number }).quote);
        return { txHash: "0xfresh" };
      });
      const steps: FlowStep<Ctx>[] = [
        { key: "build", run: buildRun },
        { key: "confirm", run: confirmRun },
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("awaiting");

      // The 10s countdown fires a rebuild that parks server-side...
      let rebuildPromise: Promise<void> = Promise.resolve();
      act(() => {
        rebuildPromise = result.current.rebuild();
      });
      // ...and the user clicks Confirm while it is still in flight.
      let resumePromise: Promise<void> = Promise.resolve();
      act(() => {
        resumePromise = result.current.resume();
      });
      // The queued Confirm must NOT have cancelled the rebuild or dispatched the stale build.
      expect(confirmRun).not.toHaveBeenCalled();
      await act(async () => {
        gated.release();
        await Promise.all([rebuildPromise, resumePromise]);
      });
      expect(result.current.status).toBe("success");
      // The send saw the SECOND (fresh) quote, never the stale one, and ran exactly once.
      expect(seenBuilt).toEqual([2]);
      expect(confirmRun).toHaveBeenCalledTimes(1);
      // [R1] no orphaned "active" spinner anywhere.
      expect(result.current.statuses).toEqual(["done", "done"]);
    });

    // @rule R4 - a countdown rebuild() landing after the send was dispatched neither cancels the
    // send nor re-runs the build; the send's outcome is consumed (success phase, hash recorded).
    it("rebuild() during an in-flight send is a no-op and the send outcome is still consumed", async () => {
      const buildRun = vi.fn(async () => ({ built: { quote: 1 } }));
      const gated = gatedStep("confirm", () => ({ txHash: "0xdispatched" }));
      const steps: FlowStep<Ctx>[] = [{ key: "build", run: buildRun }, gated.step];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      expect(result.current.status).toBe("awaiting");

      // Confirm dispatches the send (parked inside the wallet)...
      let resumePromise: Promise<void> = Promise.resolve();
      act(() => {
        resumePromise = result.current.resume();
      });
      // ...and the countdown zero-crossing fires a rebuild in the same tick.
      let rebuildPromise: Promise<void> = Promise.resolve();
      act(() => {
        rebuildPromise = result.current.rebuild();
      });
      await act(async () => {
        gated.release();
        await Promise.all([resumePromise, rebuildPromise]);
      });
      // The send's outcome was consumed: success, hash recorded, build never re-ran.
      expect(result.current.status).toBe("success");
      expect(result.current.txHash).toBe("0xdispatched");
      expect(buildRun).toHaveBeenCalledTimes(1);
      expect(result.current.statuses).toEqual(["done", "done"]);
    });

    // @rule R4 - double-clicking Confirm never dispatches the send twice.
    it("a second resume() while the send is in flight does not dispatch it again", async () => {
      const gated = gatedStep("confirm", () => ({ txHash: "0xonce" }));
      const steps: FlowStep<Ctx>[] = [
        { key: "build", run: async () => ({ built: {} }) },
        gated.step,
      ];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      let first: Promise<void> = Promise.resolve();
      let second: Promise<void> = Promise.resolve();
      act(() => {
        first = result.current.resume();
      });
      act(() => {
        second = result.current.resume();
      });
      await act(async () => {
        gated.release();
        await Promise.all([first, second]);
      });
      expect(result.current.status).toBe("success");
      expect(gated.run).toHaveBeenCalledTimes(1);
    });

    // @rule R1 - a new runFrom reconciles a cancelled run's orphaned "active" status: never two
    // spinners at once (the reported "Preparing transaction" + "Confirm deposit" screen).
    it("reconciles an orphaned active status when a new run starts (at most one active)", async () => {
      let buildCalls = 0;
      const gated = gatedStep("noop", () => ({}));
      const buildRun = vi.fn(async () => {
        buildCalls += 1;
        if (buildCalls > 1) await (gated.step.run as () => Promise<unknown>)();
        return { built: {} };
      });
      const confirmGated = gatedStep("confirm", () => ({ txHash: "0xok" }));
      const steps: FlowStep<Ctx>[] = [{ key: "build", run: buildRun }, confirmGated.step];
      const { result } = renderHook(() => useWalletSignFlow(steps, { pauseAfterKey: "build" }));
      await act(async () => {
        await result.current.run();
      });
      // A rebuild parks with the build step "active"...
      act(() => {
        void result.current.rebuild();
      });
      expect(result.current.statuses[0]).toBe("active");
      // ...then a cancelling re-run starts from the send step (synthetic stand-in for any
      // cancelled-run orphan). The build's orphaned "active" must be reconciled, not spin forever.
      let retryPromise: Promise<void> = Promise.resolve();
      act(() => {
        retryPromise = result.current.retry();
      });
      expect(result.current.statuses.filter((s) => s === "active")).toHaveLength(1);
      expect(result.current.statuses[0]).toBe("done");
      await act(async () => {
        gated.release();
        confirmGated.release();
        await retryPromise;
      });
      expect(result.current.status).toBe("success");
    });
  });
});
