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
import { mockComputePlan, SCENARIOS } from "./mockPlanner";
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
      code: "PROVISIONING_PLANNER_UNAVAILABLE",
      message: "The provisioning planner is not wired yet (POO-1034).",
    });

    const error = await computePlan(SCENARIOS.usdcOnly).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TransactionError);
    expect((error as Error).message).toBe("The provisioning planner is not wired yet (POO-1034).");
    expect((error as Error).cause).toEqual({ code: "PROVISIONING_PLANNER_UNAVAILABLE" });
  });

  // @rule R5 — the happy path returns the action's plan unchanged (R4: the signature is untouched).
  it("delegates to the action and returns its plan on success", async () => {
    // A well-formed ProvisioningPlan to stand in for what the real planner will return (POO-1034).
    const plan = mockComputePlan(SCENARIOS.usdcOnly);
    computePlanAction.mockResolvedValue({ ok: true, plan });

    await expect(computePlan(SCENARIOS.usdcOnly, { presetUsd: null, amountUsd: 30 })).resolves.toBe(
      plan,
    );
    expect(computePlanAction).toHaveBeenCalledWith(SCENARIOS.usdcOnly, {
      presetUsd: null,
      amountUsd: 30,
    });
  });
});
