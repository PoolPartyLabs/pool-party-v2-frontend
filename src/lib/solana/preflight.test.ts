import type { Address } from "viem";
import { beforeEach, expect, it, vi } from "vitest";
import { checkSolanaPrelaunch, requiredManagerLamports } from "./preflight";

const verify = vi.hoisted(() => vi.fn());
vi.mock("./binding", () => ({ verifyManagerSolanaBinding: verify }));
const manager = "0x1111111111111111111111111111111111111111" as Address;
function input() {
  return {
    manager,
    fundContext: "draft-1",
    connectedAddress: "solana-key",
    binding: {
      manager,
      solanaAddress: "solana-key",
      fundContext: "draft-1",
      authorization: {
        hubChainId: 42161,
        factory: manager,
        fund: manager,
        spokeAddress: "solana-key",
        spokeChainId: "1",
        nativeMandateHash: `0x${"00".repeat(32)}` as const,
        nonce: "0",
        expiry: "2000000000",
      },
      evmSignature: "0x" as const,
      acceptance: [],
    },
    codec: { acceptanceMessage: vi.fn() },
    costs: [{ stepId: "init", rentLamports: BigInt(200), feeLamports: BigInt(5) }],
    balance: vi.fn().mockResolvedValue(BigInt(205)),
    evmCode: vi.fn().mockResolvedValue(undefined),
  };
}
beforeEach(() => verify.mockResolvedValue(true));
it("computes threshold from each manager step's rent and fees", async () => {
  expect(await checkSolanaPrelaunch(input())).toEqual({
    requiredLamports: BigInt(205),
    balanceLamports: BigInt(205),
  });
});
it.each([
  ["disconnected", { connectedAddress: null }, "SOLANA_WALLET_REQUIRED"],
  ["changed key", { connectedAddress: "other" }, "SOLANA_BINDING_MISMATCH"],
  ["changed fund", { fundContext: "other" }, "SOLANA_BINDING_MISMATCH"],
  ["unfunded", { balance: async () => BigInt(204) }, "SOLANA_INSUFFICIENT_SOL"],
  ["smart wallet", { evmCode: async () => "0xef0100" }, "SOLANA_MANAGER_EOA_REQUIRED"],
] as const)("rejects %s before launching", async (_label, overrides, error) => {
  await expect(checkSolanaPrelaunch({ ...input(), ...overrides })).rejects.toThrow(error);
});
it("fails closed on invalid binding signatures", async () => {
  verify.mockResolvedValue(false);
  await expect(checkSolanaPrelaunch(input())).rejects.toThrow("SOLANA_BINDING_INVALID");
});
it("refuses expired consent before balance reads or launch", async () => {
  const request = input();
  request.binding.authorization.expiry = "1";
  await expect(checkSolanaPrelaunch(request)).rejects.toThrow("SOLANA_BINDING_EXPIRED");
  expect(request.balance).not.toHaveBeenCalled();
});
it("requires real estimates rather than inventing a SOL threshold", () => {
  expect(() => requiredManagerLamports([])).toThrow("SOLANA_COST_ESTIMATE_REQUIRED");
  expect(() =>
    requiredManagerLamports([{ stepId: "init", rentLamports: BigInt(-1), feeLamports: BigInt(5) }]),
  ).toThrow("SOLANA_COST_ESTIMATE_REQUIRED");
});
