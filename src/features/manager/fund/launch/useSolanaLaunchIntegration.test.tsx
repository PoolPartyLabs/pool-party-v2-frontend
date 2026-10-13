import { act, renderHook } from "@testing-library/react";
import type { Address } from "viem";
import { beforeEach, expect, it, vi } from "vitest";
import {
  bootstrapAuthorizationFixture,
  bootstrapManifestFixture,
} from "@/lib/solana/bootstrap.fixture";
import { createJournal } from "./journal";
import { createChainLaunchDriver } from "./solanaDriver";
import { withSolanaLaunchSteps } from "./solanaPlan";
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
  evmAddress: "0x1111111111111111111111111111111111111111" as string | undefined,
  sign: vi.fn(),
}));
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: mocks.evmAddress ? [{ address: mocks.evmAddress }] : [] }),
}));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => mocks.enabled }));
vi.mock("@/lib/solana/costs", () => ({ estimateSolanaPlanCosts: mocks.estimate }));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => mocks.enabled }),
}));
vi.mock("@/lib/solana/preflight", () => ({ checkSolanaPrelaunch: mocks.check }));
vi.mock("@/lib/solana/useManagerSolanaWallet", () => ({
  readManagerSolanaBalance: vi.fn(),
  useManagerSolanaWallet: () => ({ address: mocks.address, signTransaction: mocks.sign }),
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
vi.mock("./journal", async (original) => ({
  ...(await original<typeof import("./journal")>()),
  runLaunch: mocks.run,
}));
function options(): SolanaLaunchIntegrationOptions {
  return {
    draftId: "draft",
    manager: "0x1111111111111111111111111111111111111111" as Address,
    bootstrap: bootstrapManifestFixture,
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
      bootstrapAuthorization: bootstrapAuthorizationFixture,
      bootstrapSignature: "0x01",
    },
    codec: { acceptanceMessage: vi.fn() },
    costEstimator: { transactions: vi.fn(), priorityFeeMarginBps: 2000 },
    evmCode: vi.fn(),
    evmSteps: [
      { id: "create", kind: "create", chain: 42161, dependencies: [] },
      { id: "discover-hub", kind: "discover", chain: 42161, dependencies: ["create"] },
      { id: "profile", kind: "profile", chain: 42161, dependencies: ["discover-hub"] },
    ],
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
      bootstrapState: vi.fn(),
      validateTransactionIntent: vi.fn(),
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
  mocks.address = "key";
  mocks.evmAddress = "0x1111111111111111111111111111111111111111";
  mocks.run.mockReset();
  mocks.estimate.mockReset();
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
    withSolanaLaunchSteps(input.evmSteps, input.selection, input.bootstrap).filter(
      (step) => step.group === "solana",
    ),
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
it("rejects selection changes during asynchronous preflight before journaling", async () => {
  const input = options();
  mocks.estimate.mockImplementation(async () => {
    input.selection.sharePct = 40;
    return [{ stepId: "solana:init", rentLamports: BigInt(5), feeLamports: BigInt(5) }];
  });
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => {
    await result.current.launch();
  });
  expect(result.current.error).toBe("SOLANA_SELECTION_MISMATCH");
  expect(result.current.preflight).toBeNull();
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

it.each([
  "bootstrapState",
  "validateTransactionIntent",
] as const)("rejects missing %s before preflight, journal writes, or execution", async (reader) => {
  const input = options();
  delete input.backend[reader];
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => result.current.launch());
  expect(result.current.error).toBe(
    reader === "bootstrapState"
      ? "SOLANA_BOOTSTRAP_READER_REQUIRED"
      : "SOLANA_TRANSACTION_INTENT_VALIDATOR_REQUIRED",
  );
  expect(mocks.check).not.toHaveBeenCalled();
  expect(input.storage?.setItem).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(input.evmDriver.build).not.toHaveBeenCalled();
  expect(input.evmDriver.send).not.toHaveBeenCalled();
  expect(input.backend.build).not.toHaveBeenCalled();
});

it.each([
  "removed-seal",
  "removed-init",
  "dependencies",
  "chunk",
  "share",
  "kind",
  "chain",
  "group",
  "config",
  "frozen",
])("rejects saved %s tampering without rewriting the journal", async (tampering) => {
  const input = options();
  const previous = createJournal(
    input.draftId,
    input.manager,
    {
      ...input.frozen,
      solanaBinding: input.binding,
      solanaSelection: input.selection,
      solanaBootstrap: input.bootstrap,
    },
    withSolanaLaunchSteps(input.evmSteps, input.selection, input.bootstrap),
  );
  const stage = previous.steps.find((step) => step.id === "solana:stage:0");
  const next = previous.steps.find((step) => step.id === "solana:stage:600");
  if (!stage || !next || stage.chain !== "solana:mainnet" || next.chain !== "solana:mainnet")
    throw new Error("FIXTURE_MISSING");
  if (tampering.startsWith("removed-")) {
    const removed = tampering === "removed-seal" ? "solana:seal" : "solana:init";
    previous.steps = previous.steps.filter((step) => step.id !== removed);
    for (const step of previous.steps)
      step.dependencies = step.dependencies.filter((id) => id !== removed);
  }
  if (tampering === "dependencies") stage.dependencies = [];
  if (tampering === "chunk") stage.bootstrapChunk = next.bootstrapChunk;
  if (tampering === "share") stage.sharePct = 31;
  if (tampering === "kind") stage.kind = "kamino-supply";
  if (tampering === "chain") {
    stage.chain = 42161;
    stage.chainKind = "evm";
  }
  if (tampering === "group") Object.assign(stage, { group: "hub" });
  if (tampering === "config") stage.config = { poolId: "edited" };
  if (tampering === "frozen")
    previous.frozen = { ...(previous.frozen as object), request: { edited: true } };
  previous.checkpoints[stage.id] = {
    stepId: stage.id,
    chain: stage.chain,
    chainKind: stage.chainKind,
    status: "submitted",
    txHash: "original-signature",
    submissionAttempted: true,
  };
  const serialized = JSON.stringify(previous);
  if (!input.storage) throw new Error("FIXTURE_MISSING");
  vi.mocked(input.storage.getItem).mockReturnValue(serialized);
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => result.current.resume());
  expect(result.current.error).toBe(
    tampering === "frozen" ? "SOLANA_FROZEN_MISMATCH" : "SOLANA_PLAN_MISMATCH",
  );
  expect(input.storage.setItem).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
  expect(createChainLaunchDriver).not.toHaveBeenCalled();
  expect(input.backend.build).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
  expect(input.storage.getItem("unused")).toBe(serialized);
});

it.each([
  "changed",
  "disconnected",
  "solana-changed",
])("blocks both wallet prompts after %s identity but permits read-only verification", async (identity) => {
  const input = options();
  const { result, rerender } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => result.current.launch());
  const configured = vi.mocked(createChainLaunchDriver).mock.calls[0]?.[0];
  const saved = result.current.journal;
  if (!configured || !saved || !input.evmSteps[0]) throw new Error("FIXTURE_MISSING");
  if (identity === "changed") mocks.evmAddress = "0x2222222222222222222222222222222222222222";
  if (identity === "disconnected") mocks.evmAddress = undefined;
  if (identity === "solana-changed") mocks.address = "other-key";
  rerender();
  await expect(configured.verifyBinding(saved)).resolves.toBeUndefined();
  await expect(configured.signTransaction(new Uint8Array())).rejects.toThrow(
    "SOLANA_BINDING_MISMATCH",
  );
  await expect(configured.evm.send(input.evmSteps[0], {})).rejects.toThrow(
    "SOLANA_BINDING_MISMATCH",
  );
  expect(mocks.sign).not.toHaveBeenCalled();
  expect(input.evmDriver.send).not.toHaveBeenCalled();
});

it("accepts the canonical manager case-insensitively at both signing boundaries", async () => {
  const input = options();
  mocks.evmAddress = input.manager.toUpperCase();
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => result.current.launch());
  const configured = vi.mocked(createChainLaunchDriver).mock.calls[0]?.[0];
  if (!configured || !input.evmSteps[0]) throw new Error("FIXTURE_MISSING");
  await configured.signTransaction(new Uint8Array());
  await configured.evm.send(input.evmSteps[0], {});
  expect(mocks.sign).toHaveBeenCalledOnce();
  expect(input.evmDriver.send).toHaveBeenCalledOnce();
});

it.each([
  "steps",
  "frozen",
  "selection",
])("rejects in-flight %s edits before a builder or wallet prompt", async (edited) => {
  const input = options();
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => result.current.launch());
  const configured = vi.mocked(createChainLaunchDriver).mock.calls[0]?.[0];
  const saved = mocks.run.mock.calls[0]?.[0];
  if (!configured || !saved || !input.evmSteps[0]) throw new Error("FIXTURE_MISSING");
  if (edited === "steps") saved.steps[0].dependencies = ["solana:seal"];
  if (edited === "frozen") saved.frozen.request = { edited: true };
  if (edited === "selection") input.selection.sharePct = 40;
  const error = edited === "steps" ? "SOLANA_PLAN_MISMATCH" : "SOLANA_FROZEN_MISMATCH";
  await expect(configured.evm.build(input.evmSteps[0], saved)).rejects.toThrow(error);
  await expect(configured.signTransaction(new Uint8Array())).rejects.toThrow(error);
  await expect(configured.evm.send(input.evmSteps[0], {})).rejects.toThrow(error);
  expect(input.evmDriver.build).not.toHaveBeenCalled();
  expect(input.evmDriver.send).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});

it.each([
  "steps",
  "frozen",
])("rejects %s mutation during preflight before journal creation", async (edited) => {
  const input = options();
  mocks.estimate.mockImplementation(async () => {
    if (edited === "steps" && input.evmSteps[0]) input.evmSteps[0].dependencies = ["profile"];
    if (edited === "frozen") input.frozen.request = { edited: true };
    return [];
  });
  const { result } = renderHook(() => useSolanaLaunchIntegration(input));
  await act(async () => result.current.launch());
  expect(result.current.error).toBe(
    edited === "steps" ? "SOLANA_PLAN_MISMATCH" : "SOLANA_FROZEN_MISMATCH",
  );
  expect(input.storage?.setItem).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
