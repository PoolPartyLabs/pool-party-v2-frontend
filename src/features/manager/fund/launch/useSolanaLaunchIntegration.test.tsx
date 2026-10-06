import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, expect, it, vi } from "vitest";
import {
  type SolanaLaunchIntegrationOptions,
  useSolanaLaunchIntegration,
} from "./useSolanaLaunchIntegration";

const mocks = vi.hoisted(() => ({ check: vi.fn(), run: vi.fn(), enabled: true, address: "key" }));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => mocks.enabled }),
}));
vi.mock("@/lib/solana/preflight", () => ({ checkSolanaPrelaunch: mocks.check }));
vi.mock("@/lib/solana/useManagerSolanaWallet", () => ({
  readManagerSolanaBalance: vi.fn(),
  useManagerSolanaWallet: () => ({ address: mocks.address, signTransaction: vi.fn() }),
}));
vi.mock("@/lib/solana/rpc", () => ({ createManagerSolanaRpc: vi.fn() }));
vi.mock("./lock", () => ({
  withLaunchLock: async (_key: string, action: () => Promise<void>) => action(),
}));
vi.mock("./solanaDriver", () => ({
  createChainLaunchDriver: vi.fn(),
  retrySolanaReceive: vi.fn(),
}));
vi.mock("./solanaPlan", () => ({ withSolanaLaunchSteps: (steps: unknown) => steps }));
vi.mock("./journal", async (original) => ({
  ...(await original<typeof import("./journal")>()),
  runLaunch: mocks.run,
}));
function options(): SolanaLaunchIntegrationOptions {
  return {
    draftId: "draft",
    manager: "0x1111111111111111111111111111111111111111" as Address,
    binding: {
      manager: "0x1111111111111111111111111111111111111111",
      solanaAddress: "key",
      fundContext: "draft",
      authorization: {
        hubChainId: 42161,
        factory: "0x1111111111111111111111111111111111111111",
        fund: "0x1111111111111111111111111111111111111111",
        spokeAddress: "key",
        spokeChainId: "1",
        nativeMandateHash: `0x${"00".repeat(32)}`,
        nonce: "0",
        expiry: "2000000000",
      },
      evmSignature: "0x",
      acceptance: [],
    },
    codec: { acceptanceMessage: vi.fn() },
    costs: [],
    evmCode: vi.fn(),
    evmSteps: [{ id: "create", kind: "create", chain: 42161, dependencies: [] }],
    selection: { sharePct: 30, kamino: true },
    frozen: { request: {} },
    evmDriver: {
      build: vi.fn(),
      send: vi.fn(),
      receipt: vi.fn(),
      reconcile: vi.fn(),
      complete: vi.fn(),
    },
    backend: {
      build: vi.fn(),
      credited: vi.fn(),
      reportReady: vi.fn(),
      attestation: vi.fn(),
      receiveAndCredit: vi.fn(),
      complete: vi.fn(),
    },
    storage: { getItem: vi.fn(() => null), setItem: vi.fn() },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled = true;
  mocks.check.mockResolvedValue({ requiredLamports: BigInt(10), balanceLamports: BigInt(20) });
});
it("does not start or persist a launch until funded bound-wallet preflight succeeds", async () => {
  const input = options();
  mocks.check.mockRejectedValue(new Error("SOLANA_INSUFFICIENT_SOL"));
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => {
    await result.current.launch();
  });
  expect(result.current.error).toBe("SOLANA_INSUFFICIENT_SOL");
  expect(input.storage?.setItem).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it("stores binding in the frozen Fund before entering the driver", async () => {
  const input = options();
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => {
    await result.current.launch();
  });
  expect(mocks.check).toHaveBeenCalledBefore(mocks.run);
  expect(input.storage?.setItem).toHaveBeenCalled();
  expect(result.current.error).toBeNull();
});
it("refuses the integration while Solana is off", async () => {
  mocks.enabled = false;
  const input = options();
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => {
    await result.current.launch();
  });
  expect(result.current.error).toBe("SOLANA_DISABLED");
  expect(mocks.run).not.toHaveBeenCalled();
});
