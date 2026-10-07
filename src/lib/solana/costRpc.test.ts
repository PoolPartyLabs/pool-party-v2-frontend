import { beforeEach, expect, it, vi } from "vitest";
import { createSolanaCostRpc } from "./rpc";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  rent: vi.fn(),
  fee: vi.fn(),
  priority: vi.fn(),
}));
vi.mock("@solana/kit", () => ({
  address: (value: string) => value,
  createSolanaRpc: () => ({
    getAccountInfo: mocks.account,
    getMinimumBalanceForRentExemption: mocks.rent,
    getFeeForMessage: mocks.fee,
    getRecentPrioritizationFees: mocks.priority,
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.mockReturnValue({ send: async () => ({ value: null }) });
  mocks.rent.mockReturnValue({ send: async () => BigInt(12345) });
  mocks.fee.mockReturnValue({ send: async () => ({ value: BigInt(5000) }) });
  mocks.priority.mockReturnValue({ send: async () => [{ prioritizationFee: BigInt(100) }] });
});
it("uses finalized read-only rent/account/message queries and priority samples", async () => {
  const rpc = createSolanaCostRpc();
  expect(await rpc.accountExists("account")).toBe(false);
  expect(await rpc.minimumBalanceForRentExemption(5105)).toBe(BigInt(12345));
  expect(await rpc.feeForMessage("message")).toBe(BigInt(5000));
  expect(await rpc.recentPriorityFees()).toEqual([BigInt(100)]);
  expect(mocks.rent).toHaveBeenCalledWith(BigInt(5105), { commitment: "finalized" });
  expect(mocks.account).toHaveBeenCalledWith("account", {
    encoding: "base64",
    commitment: "finalized",
  });
  expect(mocks.fee).toHaveBeenCalledWith("message", { commitment: "finalized" });
});
it("preserves unknown message fees for fail-closed estimation", async () => {
  mocks.fee.mockReturnValue({ send: async () => ({ value: null }) });
  expect(await createSolanaCostRpc().feeForMessage("message")).toBeNull();
});
