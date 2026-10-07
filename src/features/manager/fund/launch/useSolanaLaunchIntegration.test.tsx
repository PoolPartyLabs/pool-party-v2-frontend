import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, expect, it, vi } from "vitest";
import { createJournal } from "./journal";
import {
  type SolanaLaunchIntegrationOptions,
  useSolanaLaunchIntegration,
} from "./useSolanaLaunchIntegration";

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  estimate: vi.fn(),
  run: vi.fn(),
  enabled: true,
  address: "key",
}));
vi.mock("@/lib/solana/costs", () => ({ estimateSolanaPlanCosts: mocks.estimate }));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => mocks.enabled }),
}));
vi.mock("@/lib/solana/preflight", () => ({ checkSolanaPrelaunch: mocks.check }));
vi.mock("@/lib/solana/useManagerSolanaWallet", () => ({
  readManagerSolanaBalance: vi.fn(),
  useManagerSolanaWallet: () => ({ address: mocks.address, signTransaction: vi.fn() }),
}));
vi.mock("@/lib/solana/rpc", () => ({
  createManagerSolanaRpc: vi.fn(),
  createSolanaCostRpc: vi.fn(),
}));
vi.mock("./lock", () => ({
  withLaunchLock: async (_key: string, action: () => Promise<void>) => action(),
}));
vi.mock("./solanaDriver", () => ({
  createChainLaunchDriver: vi.fn(),
  retrySolanaReceive: vi.fn(),
}));
vi.mock("./solanaPlan", async (original) => ({
  ...(await original<typeof import("./solanaPlan")>()),
  withSolanaLaunchSteps: (steps: unknown[]) => [
    ...steps,
    { id: "solana:init", group: "solana", chainKind: "svm", kind: "init-solana" },
  ],
}));
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
    costEstimator: { transactions: vi.fn(), priorityFeeMarginBps: 2000 },
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
  mocks.estimate.mockResolvedValue([
    { stepId: "solana:init", rentLamports: BigInt(5), feeLamports: BigInt(5) },
  ]);
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
  if (!input.storage) throw new Error("FIXTURE_MISSING");
  const serialized = vi.mocked(input.storage.setItem).mock.calls[0]?.[1];
  if (!serialized) throw new Error("FIXTURE_MISSING");
  const saved = JSON.parse(serialized);
  expect(saved.frozen.solanaSelection).toEqual({
    sharePct: 30,
    kamino: true,
  });
});
it("rejects edited pool/impact choices when resuming a frozen journal", async () => {
  const input = options();
  const previous = createJournal(
    input.draftId,
    input.manager,
    {
      solanaBinding: input.binding,
      solanaSelection: { ...input.selection },
    },
    input.evmSteps,
  );
  if (!input.storage) throw new Error("FIXTURE_MISSING");
  vi.mocked(input.storage.getItem).mockReturnValue(JSON.stringify(previous));
  input.selection.maxPriceImpactBps = 50;
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => {
    await result.current.resume();
  });
  expect(result.current.error).toBe("SOLANA_SELECTION_MISMATCH");
  expect(mocks.run).not.toHaveBeenCalled();
});
it("computes costs from the selected steps and exposes them before balance rejection", async () => {
  const input = options();
  mocks.check.mockRejectedValue(new Error("SOLANA_INSUFFICIENT_SOL"));
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => {
    await result.current.launch();
  });
  expect(mocks.estimate).toHaveBeenCalledWith(
    [{ id: "solana:init", group: "solana", chainKind: "svm", kind: "init-solana" }],
    input.costEstimator,
    undefined,
  );
  expect(result.current.costBreakdown).toEqual(await mocks.estimate.mock.results[0]?.value);
  expect(result.current.preflight).toBeNull();
});
it("refuses missing oracle references before estimating or creating a journal", async () => {
  const input = options();
  input.selection = {
    sharePct: 30,
    kamino: false,
    raydiumPool: "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv",
    maxPriceImpactBps: 0,
  };
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => {
    await result.current.launch();
  });
  expect(result.current.error).toBe("SOLANA_ORACLE_REFERENCE_MISSING");
  expect(mocks.estimate).not.toHaveBeenCalled();
  expect(input.storage?.setItem).not.toHaveBeenCalled();
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
