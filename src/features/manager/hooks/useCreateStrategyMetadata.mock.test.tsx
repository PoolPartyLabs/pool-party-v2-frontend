/**
 * @id PP-MGR-HOK-001 (POO-308)
 * @name useCreateStrategyMetadata tests (mock branch)
 * @implements-rules-version v1
 *
 * Mock mode is a no-op: the mock launch persists via managerService (POO-599 R5), so this writer never
 * signs or POSTs — `create` resolves null, `confirm`/`retryConfirm` do nothing, status stays idle. It
 * must not touch Privy (no PrivyProvider in mock/Storybook), which the top-of-hook mock-mode return
 * guarantees.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services", () => ({ isMockMode: true }));
// If the mock branch ever reached Privy, this would throw "useWallets outside PrivyProvider".
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => {
    throw new Error("Privy must not be called in mock mode");
  },
}));

import { useCreateStrategyMetadata } from "./useCreateStrategyMetadata";

describe("useCreateStrategyMetadata (mock mode)", () => {
  it("is an inert no-op writer that never signs or POSTs", async () => {
    const { result } = renderHook(() => useCreateStrategyMetadata());

    expect(result.current.confirmStatus).toBe("idle");
    await expect(
      result.current.create({
        name: "n",
        description: null,
        category: "stable",
        objectiveTags: ["income"],
        riskLevel: "steady",
        managerFee: 2000,
        access: "public",
      }),
    ).resolves.toBeNull();

    act(() => {
      result.current.confirm({ strategyId: "s", txHash: "0x", network: "arbitrum" });
      result.current.retryConfirm();
    });
    expect(result.current.confirmStatus).toBe("idle");
  });
});
