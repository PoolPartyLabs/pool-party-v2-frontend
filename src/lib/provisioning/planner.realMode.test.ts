/**
 * @id PP-CORE-LIB-016 (POO-1024)
 * @name computePlan real-mode seam tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The real branch of the `computePlan` seam. It lives in its own file because `isMockMode` is a
 * module-level const read at import time: `vi.mock("@/lib/services")` is hoisted and file-wide, so
 * forcing real mode here would flip the mock-mode assertions in `planner.test.ts` too. Same split as
 * `page.realMode.test.tsx` / `page.test.tsx`.
 *
 * Rules under test (POO-1024 rules v1):
 *   [R5] the real branch delegates to the `"use server"` action and converts its typed failure into
 *        a rejection, with the code on `error.cause.code` (the house contract, `@/lib/tx/actionResult`)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionError } from "@/lib/tx/sendTransaction";
import { mockComputePlan, SCENARIOS } from "./fixtures/mockPlan";
import type { ProvisioningPlanResult } from "./planActions";
import { computePlan } from "./planner";

const { computePlanAction } = vi.hoisted(() => ({
  computePlanAction: vi.fn<() => Promise<ProvisioningPlanResult>>(),
}));

// Real mode: `computePlan` must cross the server boundary instead of calling the mock planner.
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("./planActions", () => ({ computePlanAction }));

describe("computePlan (real mode)", () => {
  beforeEach(() => {
    computePlanAction.mockReset();
  });

  // @rule R5 — a typed action failure becomes a rejection the hook can render as an error state.
  it("rejects with the action's code on error.cause.code when the action fails", async () => {
    computePlanAction.mockResolvedValue({
      ok: false,
      code: "PROVISIONING_BALANCES_UNAVAILABLE",
      message: "The wallet's balances could not be read.",
    });

    const error = await computePlan(SCENARIOS.usdcOnly).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TransactionError);
    expect((error as Error).message).toBe("The wallet's balances could not be read.");
    // POO-1044 [R3]: the operation's chain rides along, so a failure whose copy has to name a
    // network (`PROVISIONING_GAS_BLOCKED`) can, without parsing it back out of the message.
    expect((error as Error).cause).toEqual({
      code: "PROVISIONING_BALANCES_UNAVAILABLE",
      targetChainId: SCENARIOS.usdcOnly.targetChainId,
    });
  });

  // @rule R5 — the happy path returns the action's plan unchanged (R4: the signature is untouched).
  it("delegates to the action and returns its plan on success", async () => {
    // A well-formed ProvisioningPlan to stand in for what the real planner will return (POO-1034).
    const plan = mockComputePlan(SCENARIOS.usdcOnly);
    computePlanAction.mockResolvedValue({ ok: true, plan });

    await expect(computePlan(SCENARIOS.usdcOnly, { presetUsd: null, amountUsd: 30 })).resolves.toBe(
      plan,
    );
    // @rule POO-1085 F2-R4 — the chosen AMOUNT is forwarded, reversing POO-1044 [R6]. It travels as
    // a plain USD number, not the `GasChoice` object: `presetUsd` is a UI concern. The server treats
    // it as a floor-respecting ceiling (`raiseTopUpToUsd`), which is what makes forwarding it safe
    // where POO-1044 was right to refuse to let it SIZE the leg.
    expect(computePlanAction).toHaveBeenCalledWith(SCENARIOS.usdcOnly, undefined, 30);
  });

  // @rule POO-1085 F2-R3 — no choice means the plan is exactly what it was before the parameter
  // existed. `undefined` reaches the action rather than a substituted default.
  it("forwards nothing when the user made no gas choice", async () => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly);
    computePlanAction.mockResolvedValue({ ok: true, plan });

    await computePlan(SCENARIOS.usdcOnly);

    expect(computePlanAction).toHaveBeenCalledWith(SCENARIOS.usdcOnly, undefined, undefined);
  });

  // @rule POO-1042 R7 — the SELECTION is what the real branch forwards, in PICK order, which the
  // planner treats as ROUTE order. Reordering or sorting it here would execute a route the user
  // never reviewed.
  it("forwards the funding selection, in pick order", async () => {
    const plan = mockComputePlan(SCENARIOS.usdcOnly);
    computePlanAction.mockResolvedValue({ ok: true, plan });
    const selection = ["137:0xaaa", "8453:0xbbb"];

    await computePlan(SCENARIOS.usdcOnly, undefined, selection);

    expect(computePlanAction).toHaveBeenCalledWith(SCENARIOS.usdcOnly, selection, undefined);
  });
});
