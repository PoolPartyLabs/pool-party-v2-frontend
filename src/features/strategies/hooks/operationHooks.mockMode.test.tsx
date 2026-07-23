/**
 * @id PP-STR-MOD-001 / PP-STR-MOD-003 / PP-STR-MOD-004 (POO-392)
 * @name strategies operation hooks tests (mock branch)
 * @implements-rules-version v1
 *
 * Mirror of the real-branch suites for the mock-mode path each operation hook guards with
 * `isMockMode`. In mock mode every on-chain operation hook returns a stub executor whose
 * `buildSteps()` yields no wallet-sign steps (the modals use the mock settle path instead).
 * useInvest / useWithdraw still expose a folded `execute()` that throws its "<op> is mocked in mock
 * mode" TransactionError; useCollectFees dropped `execute` in POO-802, so only its empty buildSteps
 * is asserted. The real-branch suites pin `isMockMode: false` in their own files; this one pins it on.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Position, Strategy } from "@/lib/schemas";

// Pin mock mode on; the per-hook real-branch suites pin it off in their own files.
vi.mock("@/lib/services", () => ({ isMockMode: true }));
// The hooks import these at module load but never call them in mock mode (early return); stub
// them so the test does not pull in the real Privy provider.
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: [] }),
  useSignTypedData: () => ({ signTypedData: vi.fn() }),
}));

import { useCollectFees } from "./useCollectFees";
import { useInvest } from "./useInvest";
import { useWithdraw } from "./useWithdraw";

const strategy = { id: "s1", network: "polygon", pool: "0xpool" } as unknown as Strategy;
const position = { id: "0xpos", currentValue: 100, status: "active" } as Position;

describe("strategies operation hooks (mock mode)", () => {
  it("useInvest: buildSteps is empty and execute throws the mocked error", async () => {
    const { result } = renderHook(() => useInvest());
    expect(result.current.buildSteps(strategy, 100)).toEqual([]);
    await expect(result.current.execute(strategy, 100)).rejects.toThrow(
      /Invest is mocked in mock mode/,
    );
  });

  it("useWithdraw: buildSteps is empty and execute throws the mocked error", async () => {
    const { result } = renderHook(() => useWithdraw());
    expect(result.current.buildSteps(strategy, position, 25)).toEqual([]);
    await expect(result.current.execute(strategy, position, 25)).rejects.toThrow(
      /Withdraw is mocked in mock mode/,
    );
  });

  it("useCollectFees: buildSteps is empty in mock mode", () => {
    const { result } = renderHook(() => useCollectFees());
    expect(result.current.buildSteps(strategy, position)).toEqual([]);
  });
});
