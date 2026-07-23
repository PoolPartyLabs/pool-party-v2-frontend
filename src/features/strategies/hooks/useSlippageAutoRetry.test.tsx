/**
 * @id PP-STR-HOK-001
 * @name useSlippageAutoRetry tests
 * @implements-rules-version v2
 *
 * POO-499 (POO-467 rules v2): the shared orchestration that turns a wallet-sign flow's slippage
 * failures into a one-shot automatic retry, then a slippage-specific error view + settings auto-open.
 * The hook owns the retry/auto-open bookkeeping; the six modals contribute only their gear slippage
 * value + a settings opener. Tests drive a stub `WalletSignFlow` through its status sequence.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TxError, TxErrorKind } from "@/lib/tx/diagnostics";
import { useSlippageAutoRetry } from "./useSlippageAutoRetry";
import type { FlowStatus, WalletSignFlow } from "./useWalletSignFlow";

const track = vi.fn();
vi.mock("@/lib/analytics/useAnalytics", () => ({
  useAnalytics: () => ({ track }),
}));

/**
 * A minimal, mutable stub of the flow surface the hook reads (status + error) and calls (retryFrom).
 * `retryFrom` mirrors the real runner: it moves the flow into "running" and clears the error the
 * instant it is called, so the hook never re-reads the SAME error as a phantom second failure (the
 * real `useWalletSignFlow.retryFrom` sets status to running synchronously before re-running steps).
 */
function makeFlow(): WalletSignFlow & { retryFrom: ReturnType<typeof vi.fn> } {
  const flow = {
    activeStep: 0,
    statuses: [],
    txHashes: [],
    status: "idle" as FlowStatus,
    error: null as TxError | null,
    txHash: null,
    run: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    retryFrom: vi.fn(() => {
      flow.status = "running";
      flow.error = null;
    }),
    reset: vi.fn(),
  };
  return flow as unknown as WalletSignFlow & { retryFrom: ReturnType<typeof vi.fn> };
}

function txError(kind: TxErrorKind): TxError {
  return { code: "-32603", message: "boom", kind };
}

const onOpenSettings = vi.fn();

function setup(flow: WalletSignFlow) {
  const view = renderHook(
    (props: { flow: WalletSignFlow }) =>
      useSlippageAutoRetry({
        flow: props.flow,
        flowName: "invest",
        strategyId: "s1",
        slippagePct: 2,
        onOpenSettings,
      }),
    { initialProps: { flow } },
  );
  /** Move the stub flow to a status/error and flush the render + effects (mirrors a real transition). */
  function advance(status: FlowStatus, error: TxError | null = null) {
    act(() => {
      (flow as { status: FlowStatus }).status = status;
      (flow as { error: TxError | null }).error = error;
      view.rerender({ flow });
    });
  }
  return { ...view, advance };
}

describe("useSlippageAutoRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // @rule R2 — the first slippage-kind error triggers exactly one retryFrom("build") and no error view.
  it("first slippage error triggers exactly one retryFrom('build') and no error phase", () => {
    const flow = makeFlow();
    const { result, advance } = setup(flow);
    expect(result.current.autoRetrying).toBe(false);
    expect(result.current.slippageError).toBe(false);

    advance("error", txError("slippage"));

    // Auto-retry fired once, from the build step, the error view is suppressed, settings not opened.
    expect(flow.retryFrom).toHaveBeenCalledTimes(1);
    expect(flow.retryFrom).toHaveBeenCalledWith("build");
    expect(result.current.autoRetrying).toBe(true);
    expect(result.current.slippageError).toBe(false);
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  // @rule R2 — the hook echoes the gear slippage so the modal can interpolate it into the notice copy.
  it("echoes the gear slippage while auto-retrying (the modal renders the notice via t())", () => {
    const flow = makeFlow();
    const { result, advance } = setup(flow);
    advance("error", txError("slippage"));
    expect(result.current.autoRetrying).toBe(true);
    expect(result.current.slippagePct).toBe(2);
  });

  // @rule R2 — the notice persists through the whole re-run (build then confirm), not just one frame.
  it("keeps autoRetrying true while the retry re-runs", () => {
    const flow = makeFlow();
    const { result, advance } = setup(flow);
    advance("error", txError("slippage")); // first failure → retry fires
    advance("running", null); // the retry re-runs (build → confirm)
    expect(result.current.autoRetrying).toBe(true);
    expect(result.current.slippageError).toBe(false);
  });

  // @rule R3 — a SECOND slippage error surfaces slippageError=true and opens settings exactly once.
  it("second slippage error surfaces slippageError and opens settings exactly once", () => {
    const flow = makeFlow();
    const { result, advance } = setup(flow);
    advance("error", txError("slippage")); // first failure → auto-retry
    expect(result.current.autoRetrying).toBe(true);
    advance("running", null); // retry re-runs
    advance("error", txError("slippage")); // second failure of the SAME run

    expect(flow.retryFrom).toHaveBeenCalledTimes(1); // no second auto-retry
    expect(result.current.slippageError).toBe(true);
    expect(result.current.autoRetrying).toBe(false);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);

    // A benign re-render (e.g. the user closes the settings sheet) must NOT re-open it.
    advance("error", txError("slippage"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  // @rule R2 — the auto-retry that resolves to success shows no error view and drops the notice.
  it("clears the notice when the retry resolves to success", () => {
    const flow = makeFlow();
    const { result, advance } = setup(flow);
    advance("error", txError("slippage"));
    advance("running", null);
    advance("success", null);
    expect(result.current.autoRetrying).toBe(false);
    expect(result.current.slippageError).toBe(false);
  });

  // @rule R4 — non-slippage kinds pass through untouched (no auto-retry, no auto-open).
  it("leaves non-slippage kinds untouched", () => {
    const flow = makeFlow();
    const { result, advance } = setup(flow);
    advance("error", txError("insufficientFunds"));
    expect(flow.retryFrom).not.toHaveBeenCalled();
    expect(result.current.autoRetrying).toBe(false);
    expect(result.current.slippageError).toBe(false);
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  // @rule R1 — an undefined/unknown kind is never auto-retried.
  it("never auto-retries an unknown/undefined kind", () => {
    const flow = makeFlow();
    const { result, advance } = setup(flow);
    advance("error", { code: "X", message: "boom" }); // no kind
    expect(flow.retryFrom).not.toHaveBeenCalled();
    expect(result.current.autoRetrying).toBe(false);

    advance("error", txError("unknown"));
    expect(flow.retryFrom).not.toHaveBeenCalled();
  });

  // @rule R2 — the counter re-arms on a new user-initiated run.
  it("re-arms the one-shot retry on a new run", () => {
    const flow = makeFlow();
    const { advance } = setup(flow);

    // Run 1: slippage → auto-retry once, then a second failure → slippage view (no new retry).
    advance("error", txError("slippage"));
    advance("running", null);
    advance("error", txError("slippage"));
    expect(flow.retryFrom).toHaveBeenCalledTimes(1);

    // A brand-new user run starts (the dialog reset to idle, then run() → running).
    advance("idle", null);
    advance("running", null);

    // Run 2: a slippage failure auto-retries again (the one-shot re-armed).
    advance("error", txError("slippage"));
    expect(flow.retryFrom).toHaveBeenCalledTimes(2);
  });

  // @rule R8 — the automatic retry fires tx_slippage_retry exactly once with { flow, strategy_id }.
  it("fires tx_slippage_retry once on the automatic retry with { flow, strategy_id }", () => {
    const flow = makeFlow();
    const { advance } = setup(flow);
    advance("error", txError("slippage"));
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("tx_slippage_retry", { flow: "invest", strategy_id: "s1" });

    // The second slippage failure must NOT fire the event again (it is not an automatic retry).
    advance("running", null);
    advance("error", txError("slippage"));
    expect(track).toHaveBeenCalledTimes(1);
  });
});
