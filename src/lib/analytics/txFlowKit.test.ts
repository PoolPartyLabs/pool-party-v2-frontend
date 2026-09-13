/**
 * @id PP-CORE-HOK-028 (POO-1172)
 * @name transaction flow instrumentation kit, spec
 * @implements-rules-version v1
 *
 * The abandonment observer's whole value is the arithmetic it protects: `started` must equal
 * `completed + failed + abandoned`, and every test here is really about one of the four ways that
 * identity breaks. Double-counting, missing the unmount, counting a conclusion as an abandonment,
 * and counting a re-render as a close.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_TX_EXITS,
  ANALYTICS_TX_STEPS,
  analyticsTxStepOf,
  isAnalyticsTxStep,
  useTxAmountBlocked,
  useTxFlowAbandonment,
  useTxSignatureObserver,
} from "./txFlowKit";

function pushed(): Record<string, unknown>[] {
  return (window.dataLayer ?? []) as Record<string, unknown>[];
}

function eventsNamed(name: string): Record<string, unknown>[] {
  return pushed().filter((row) => row.event === name);
}

beforeEach(() => {
  window.dataLayer = [];
  vi.restoreAllMocks();
});

describe("useTxFlowAbandonment", () => {
  it("reports the exit the user was actually at, resolved on unmount", () => {
    let phase = "amount";
    const { unmount } = renderHook(() =>
      useTxFlowAbandonment({ flow: "invest", strategyId: "s-1" }, () => phase as never),
    );
    // The user moves on before leaving; capturing at mount would have reported "amount".
    phase = "review";
    unmount();

    const fired = eventsNamed("tx_flow_abandoned");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ flow: "invest", strategy_id: "s-1", tx_exit: "review" });
  });

  /** The property the funnel arithmetic rests on. A concluded session is not an abandonment. */
  it("stays silent when the session concluded", () => {
    const { result, unmount } = renderHook(() =>
      useTxFlowAbandonment({ flow: "withdraw" }, () => "pending"),
    );
    result.current.conclude();
    unmount();
    expect(eventsNamed("tx_flow_abandoned")).toHaveLength(0);
  });

  it("treats a FAILED session as concluded, not abandoned", () => {
    // A flow that failed was answered. Counting it twice would make failures inflate churn.
    const { result, unmount } = renderHook(() =>
      useTxFlowAbandonment({ flow: "collect" }, () => "review"),
    );
    result.current.conclude(); // the host calls this on error too
    unmount();
    expect(eventsNamed("tx_flow_abandoned")).toHaveLength(0);
  });

  it("does not fire on a re-render, only on the real unmount", () => {
    const { rerender, unmount } = renderHook(() =>
      useTxFlowAbandonment({ flow: "invest" }, () => "review"),
    );
    rerender();
    rerender();
    expect(eventsNamed("tx_flow_abandoned")).toHaveLength(0);
    unmount();
    expect(eventsNamed("tx_flow_abandoned")).toHaveLength(1);
  });

  it("lets a host suppress a close that is not an abandonment", () => {
    // Returning null is how a modal says "I closed myself", e.g. a programmatic route change.
    const { unmount } = renderHook(() => useTxFlowAbandonment({ flow: "invest" }, () => null));
    unmount();
    expect(eventsNamed("tx_flow_abandoned")).toHaveLength(0);
  });

  it("omits strategy_id rather than sending an empty one", () => {
    const { unmount } = renderHook(() =>
      useTxFlowAbandonment({ flow: "moveRange" }, () => "amount"),
    );
    unmount();
    expect(eventsNamed("tx_flow_abandoned")[0]).not.toHaveProperty("strategy_id");
  });
});

describe("useTxSignatureObserver", () => {
  const steps = [{ key: "build" }, { key: "approve" }, { key: "permit" }, { key: "confirm" }];

  it("fires when a wallet prompt becomes active", () => {
    renderHook(() =>
      useTxSignatureObserver({ flow: "invest", strategyId: "s-2" }, steps, [
        "done",
        "active",
        "idle",
        "idle",
      ]),
    );
    const fired = eventsNamed("tx_signature_requested");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ flow: "invest", strategy_id: "s-2", tx_step: "approve" });
  });

  /**
   * `build` is the SERVER build and raises no prompt. Counting it would inflate every
   * prompts-per-flow figure with a step the user never sees.
   */
  it("ignores the server build step", () => {
    renderHook(() =>
      useTxSignatureObserver({ flow: "invest" }, steps, ["active", "idle", "idle", "idle"]),
    );
    expect(eventsNamed("tx_signature_requested")).toHaveLength(0);
  });

  it("does not double count while a prompt stays active across re-renders", () => {
    const { rerender } = renderHook(
      ({ s }) => useTxSignatureObserver({ flow: "invest" }, steps, s),
      { initialProps: { s: ["done", "active", "idle", "idle"] } },
    );
    rerender({ s: ["done", "active", "idle", "idle"] });
    rerender({ s: ["done", "active", "idle", "idle"] });
    expect(eventsNamed("tx_signature_requested")).toHaveLength(1);
  });

  /** A retry really did prompt the user a second time, so it really is a second request. */
  it("counts a retry as a second prompt", () => {
    const { rerender } = renderHook(
      ({ s }) => useTxSignatureObserver({ flow: "invest" }, steps, s),
      { initialProps: { s: ["done", "active", "idle", "idle"] } },
    );
    rerender({ s: ["done", "error", "idle", "idle"] });
    rerender({ s: ["done", "active", "idle", "idle"] });
    expect(eventsNamed("tx_signature_requested")).toHaveLength(2);
  });

  it("counts each distinct prompt in a multi-signature flow", () => {
    const { rerender } = renderHook(
      ({ s }) => useTxSignatureObserver({ flow: "invest" }, steps, s),
      { initialProps: { s: ["done", "active", "idle", "idle"] } },
    );
    rerender({ s: ["done", "done", "active", "idle"] });
    rerender({ s: ["done", "done", "done", "active"] });
    expect(eventsNamed("tx_signature_requested").map((e) => e.tx_step)).toEqual([
      "approve",
      "permit",
      "confirm",
    ]);
  });

  /** `approve` self-skips when the allowance covers, so 2 and 3 prompts are both correct. */
  it("reports two prompts when the approval was skipped", () => {
    const { rerender } = renderHook(
      ({ s }) => useTxSignatureObserver({ flow: "invest" }, steps, s),
      { initialProps: { s: ["done", "skipped", "active", "idle"] } },
    );
    rerender({ s: ["done", "skipped", "done", "active"] });
    expect(eventsNamed("tx_signature_requested").map((e) => e.tx_step)).toEqual([
      "permit",
      "confirm",
    ]);
  });

  /**
   * The keys the money hooks actually build are SUFFIXED (`"confirm:collect"`, `"approve:USDC"`),
   * and the exact matcher this replaces made `tx_signature_requested` a declared-but-dead event:
   * not one real step key ever matched. The emitted `tx_step` stays the BASE name, which is what
   * `AnalyticsParams.tx_step` accepts.
   */
  it("matches the suffixed keys real flows use and emits the base step name", () => {
    const realSteps = [{ key: "build" }, { key: "approve:USDC" }, { key: "confirm:collect" }];
    const { rerender } = renderHook(
      ({ s }) => useTxSignatureObserver({ flow: "collect" }, realSteps, s),
      { initialProps: { s: ["done", "active", "idle"] } },
    );
    rerender({ s: ["done", "done", "active"] });
    expect(eventsNamed("tx_signature_requested").map((e) => e.tx_step)).toEqual([
      "approve",
      "confirm",
    ]);
  });
});

describe("useTxAmountBlocked", () => {
  it("reports a block with its reason", () => {
    renderHook(() => useTxAmountBlocked({ flow: "invest", strategyId: "s-3" }, "below_minimum"));
    const fired = eventsNamed("tx_amount_blocked");
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      flow: "invest",
      strategy_id: "s-3",
      block_reason: "below_minimum",
    });
  });

  /** `null` is how a host says "not blocked in a way worth reporting", e.g. an untouched field. */
  it("stays silent on null", () => {
    renderHook(() => useTxAmountBlocked({ flow: "invest" }, null));
    expect(eventsNamed("tx_amount_blocked")).toHaveLength(0);
  });

  /**
   * The semantics most likely to be got wrong. Typing "1", "10", "100" against a $500 minimum is
   * ONE block the user worked their way out of, not three, and per-keystroke counting would make
   * this event's volume a function of typing speed.
   */
  it("counts one engagement while the same reason persists", () => {
    const { rerender } = renderHook(({ r }) => useTxAmountBlocked({ flow: "invest" }, r), {
      initialProps: { r: "below_minimum" as const },
    });
    rerender({ r: "below_minimum" as const });
    rerender({ r: "below_minimum" as const });
    expect(eventsNamed("tx_amount_blocked")).toHaveLength(1);
  });

  it("re-arms once the block clears, so a second attempt is a second block", () => {
    const { rerender } = renderHook(
      ({ r }: { r: "below_minimum" | null }) => useTxAmountBlocked({ flow: "invest" }, r),
      { initialProps: { r: "below_minimum" as "below_minimum" | null } },
    );
    rerender({ r: null });
    rerender({ r: "below_minimum" });
    expect(eventsNamed("tx_amount_blocked")).toHaveLength(2);
  });

  it("reports a change of reason without needing the block to clear first", () => {
    const { rerender } = renderHook(
      ({ r }: { r: "amount_invalid" | "exceeds_balance" }) =>
        useTxAmountBlocked({ flow: "withdraw" }, r),
      { initialProps: { r: "amount_invalid" as "amount_invalid" | "exceeds_balance" } },
    );
    rerender({ r: "exceeds_balance" });
    expect(eventsNamed("tx_amount_blocked").map((e) => e.block_reason)).toEqual([
      "amount_invalid",
      "exceeds_balance",
    ]);
  });
});

describe("the derived unions", () => {
  it("keeps conclusions out of the exit vocabulary", () => {
    // `success` and `error` are conclusions; a session that reached one is not an abandonment.
    expect(ANALYTICS_TX_EXITS).not.toContain("success");
    expect(ANALYTICS_TX_EXITS).not.toContain("error");
  });

  it("keeps the server build and the provisioning legs out of the step vocabulary", () => {
    expect(isAnalyticsTxStep("build")).toBe(false);
    for (const leg of ["op", "swap", "bridge", "buy", "gas"]) {
      expect(isAnalyticsTxStep(leg), leg).toBe(false);
    }
    for (const step of ANALYTICS_TX_STEPS) {
      expect(isAnalyticsTxStep(step), step).toBe(true);
    }
  });

  /**
   * POO-1177: the matcher that made `tx_signature_requested` dead on arrival. Every real wallet
   * step key is suffixed (`"confirm:collect"`, `"approve:USDC"`) and the exact match accepted none
   * of them. The resolver takes both forms and always yields the BASE step name.
   */
  it("resolves bare and suffixed step keys to the base wallet prompt", () => {
    expect(analyticsTxStepOf("confirm")).toBe("confirm");
    expect(analyticsTxStepOf("confirm:collect")).toBe("confirm");
    expect(analyticsTxStepOf("approve:USDC")).toBe("approve");
    expect(analyticsTxStepOf("build")).toBeUndefined();
    expect(analyticsTxStepOf(undefined)).toBeUndefined();
    // A key that merely CONTAINS a step name is not a prompt; only `step` or `step:*` count.
    expect(analyticsTxStepOf("confirmation")).toBeUndefined();
  });
});
