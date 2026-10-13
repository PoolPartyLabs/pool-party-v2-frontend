/**
 * @tests PP-MGR-HOK-025 (POO-2262)
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildPlan } from "../build/plan/buildPlan";
import { LIVE_KAMINO_BUILD, LIVE_UNSIGNED_PLAN } from "./solanaV6Launch.fixture";

const MANAGER = "0x000000000000000000000000000000000000dead";
const SOLANA_KEY = "6VTveiPVZVM7H9BWEsUsu4ivsrPjKw9ePrLQqHaFgJaA";
const PLAN_FOR_KEY = {
  ...LIVE_UNSIGNED_PLAN,
  solana: { ...LIVE_UNSIGNED_PLAN.solana, managerSolanaKey: SOLANA_KEY },
};
const mocks = vi.hoisted(() => ({
  actions: {
    buildSolanaCreationAction: vi.fn(),
    discoverSolanaFundAction: vi.fn(),
    buildSolanaBootstrapAction: vi.fn(),
    readSolanaFundAction: vi.fn(),
  },
  send: vi.fn(),
  receipt: vi.fn(),
  nonce: vi.fn(),
  signTypedData: vi.fn(),
  solanaSend: vi.fn(),
  confirmation: vi.fn(),
  draft: null as unknown,
}));
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({
    wallets: [{ address: "0x00000000000000000000000000000000000000ee" }, { address: MANAGER }],
  }),
}));
vi.mock("@/lib/tx/useEnsureWalletChain", () => ({
  useEnsureWalletChain: () => async () => ({ request: vi.fn() }),
}));
vi.mock("@/lib/tx/sendTransaction", () => ({
  sendBuiltTransaction: mocks.send,
  isUserRejection: (error: unknown) => error instanceof Error && error.message === "rejected",
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createWalletClient: () => ({ signTypedData: mocks.signTypedData }),
  createPublicClient: () => ({
    getTransactionReceipt: mocks.receipt,
    getTransactionCount: mocks.nonce,
  }),
}));
vi.mock("@/features/auth/siweActions", () => ({ getSessionAction: async () => MANAGER }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: vi.fn() }) }));
vi.mock("@/lib/api/v2/solanaLaunchActions", () => mocks.actions);
vi.mock("@/lib/solana/useManagerSolanaWallet", () => ({
  useManagerSolanaWallet: () => ({
    address: SOLANA_KEY,
    ready: true,
    balanceLamports: BigInt(1),
    connect: vi.fn(),
    signTransaction: vi.fn(),
  }),
}));
vi.mock("@/lib/solana/rpc", () => ({
  createManagerSolanaRpc: () => ({ blockHeight: async () => BigInt(1) }),
  readSolanaConfirmation: mocks.confirmation,
}));
vi.mock("@/lib/solana/transaction", async (original) => ({
  ...(await original<typeof import("@/lib/solana/transaction")>()),
  sendSolanaTransaction: mocks.solanaSend,
}));
vi.mock("./solanaV6Launch", async (original) => ({
  ...(await original<typeof import("./solanaV6Launch")>()),
  // The recorded plan is for a throwaway key; its consents are not what this hook test checks.
  verifyCreationPlan: () => {},
}));
vi.mock("../mandateDraftStore", () => ({
  getDraft: () => mocks.draft,
  subscribe: () => () => {},
}));

import { loadSolanaLaunch, solanaLaunchKey } from "./solanaV6Launch";
import { useSolanaV6Launch } from "./useSolanaV6Launch";

const plan: BuildPlan = {
  version: 1,
  hub: { chains: [] },
  spokes: [{ network: "solana", sharePct: 50, chains: [] }],
};
const amounts = { seedAmount: "20000000", minFirstDeposit: "20000000", spokeCap: "20000000" };
const ok = <T,>(data: T) => ({ ok: true as const, data });
const evmTx = (chainId: 42161 | 4663, to: string, gas: string | null) => ({
  chainId,
  to,
  from: MANAGER,
  data: "0x095ea7b3",
  value: "0",
  gas,
});
function plans() {
  const factory = LIVE_UNSIGNED_PLAN.factory;
  const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const base = {
    ...PLAN_FOR_KEY,
    transactions: { approve: null, createFund: null, createSpoke: null },
  };
  return {
    unsigned: {
      ...base,
      transactions: { ...base.transactions, approve: evmTx(42161, usdc, "70642") },
    },
    readyApprove: {
      ...base,
      status: "ready",
      seed: { ...base.seed, balanceSufficient: true, approveRequired: true },
      transactions: { ...base.transactions, approve: evmTx(42161, usdc, "70642") },
    },
    readyCreate: {
      ...base,
      status: "ready",
      seed: { ...base.seed, balanceSufficient: true, approveRequired: false },
      transactions: { ...base.transactions, createFund: evmTx(42161, factory, "30695065") },
    },
    created: {
      ...base,
      status: "created",
      transactions: { ...base.transactions, createSpoke: evmTx(4663, factory, "15447690") },
    },
    spokeDone: { ...base, status: "created", robinhoodSpokeCreated: true },
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.draft = {
    id: "d1",
    plan,
    review: {
      name: "Solana Demo Fund",
      description: "",
      imageUrl: "",
      performanceFeeBps: 1000,
      managementFeeBps: 200,
      payoutFeeBps: 100,
      minimum: "20",
      seed: "20",
    },
  };
  mocks.signTypedData.mockResolvedValue(`0x${"11".repeat(65)}`);
  mocks.receipt.mockResolvedValue({ status: "success" });
  mocks.nonce.mockResolvedValue(7);
  mocks.confirmation.mockResolvedValue("finalized");
  mocks.solanaSend.mockImplementation(async (input: { persist: (signature: string) => void }) => {
    input.persist(
      "5u1hNcBHWAYuYh5vcby62yhrk91HXVrPS6DZ5MbxFqyzXLyyDvXRxmNffvV7yF2PR372BwHpRapa4p7aJAp6ahuB",
    );
    return "sig";
  });
});

describe("useSolanaV6Launch", () => {
  it("runs the creation in API order and sends each EVM build with its gas from the Manager wallet", async () => {
    const p = plans();
    mocks.actions.buildSolanaCreationAction
      .mockResolvedValueOnce(ok(p.unsigned))
      .mockResolvedValueOnce(ok(p.readyApprove))
      .mockResolvedValueOnce(ok(p.readyCreate))
      .mockResolvedValueOnce(ok(p.created));
    mocks.send
      .mockResolvedValueOnce(`0x${"a1".repeat(32)}`)
      .mockResolvedValueOnce(`0x${"b2".repeat(32)}`)
      .mockResolvedValueOnce(`0x${"c3".repeat(32)}`);
    mocks.actions.discoverSolanaFundAction.mockResolvedValue(ok({}));
    mocks.actions.buildSolanaBootstrapAction
      .mockResolvedValueOnce(
        ok({
          policyHash: `0x${"00".repeat(32)}`,
          bindingDigest: `0x${"00".repeat(32)}`,
          fund: SOLANA_KEY,
          ordered: true,
          transactions: [LIVE_KAMINO_BUILD],
        }),
      )
      .mockResolvedValueOnce({ ok: false, error: { status: 400, code: "BAD_REQUEST" } });
    mocks.actions.readSolanaFundAction.mockResolvedValue(
      ok({
        coreVault: LIVE_UNSIGNED_PLAN.core,
        manager: MANAGER,
        chains: [
          { chainId: "42161", status: "created" },
          { chainId: "4663", status: "created" },
          { chainId: "1", status: "created", solana: {} },
        ],
      }),
    );
    const { result } = renderHook(() => useSolanaV6Launch("d1"));
    await waitFor(() => expect(result.current.manager).toBe(MANAGER));
    act(() => result.current.start(amounts));
    await waitFor(() => expect(result.current.state?.steps.verify?.status).toBe("done"), {
      timeout: 10_000,
    });
    const state = loadSolanaLaunch(localStorage, MANAGER, "d1");
    expect(
      Object.fromEntries(Object.entries(state?.steps ?? {}).map(([k, v]) => [k, v.status])),
    ).toMatchObject({
      plan: "done",
      "sign-binding": "done",
      "sign-policy": "done",
      "approve-seed": "done",
      "create-fund": "done",
      "create-spoke": "done",
      discover: "done",
      bootstrap: "done",
      verify: "done",
    });
    expect(mocks.signTypedData).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(mocks.send.mock.calls.map((call) => [call[1].chainId, call[1].tx.gas, call[2]])).toEqual(
      [
        [42161, "70642", MANAGER],
        [42161, "30695065", MANAGER],
        [4663, "15447690", MANAGER],
      ],
    );
    // The signed rebuild carries the five pins, both signatures and the typed amounts.
    expect(mocks.actions.buildSolanaCreationAction.mock.calls[1]?.[0]).toMatchObject({
      manager: MANAGER,
      managerSolanaKey: SOLANA_KEY,
      seedAmount: "20000000",
      spokeCap: "20000000",
      creationNumber: LIVE_UNSIGNED_PLAN.creationNumber,
      bindingSignature: `0x${"11".repeat(65)}`,
      swapPolicySignature: `0x${"11".repeat(65)}`,
    });
    expect(state?.steps.bootstrap?.signatures).toHaveLength(1);
  });

  it("resumes a submitted Fund creation from its hash and never sends it again", async () => {
    const p = plans();
    const key = solanaLaunchKey(MANAGER, "d1");
    const { initialSolanaLaunch } = await import("./solanaV6Launch");
    const state = initialSolanaLaunch({
      draftId: "d1",
      manager: MANAGER,
      solanaKey: SOLANA_KEY,
      plan,
      review: (mocks.draft as { review: never }).review,
      amounts,
    });
    state.plan = {
      core: LIVE_UNSIGNED_PLAN.core,
      fundId: LIVE_UNSIGNED_PLAN.fundId,
      creationNumber: LIVE_UNSIGNED_PLAN.creationNumber,
      bindingNonce: "0",
      bindingExpiry: "1791871620",
      expiresAt: "2026-10-13T06:07:00.000Z",
      fundPda: SOLANA_KEY,
      vault: SOLANA_KEY,
      usdcAta: SOLANA_KEY,
      robinhoodSpokeVault: MANAGER,
    };
    state.signatures = { binding: `0x${"11".repeat(65)}`, swapPolicy: `0x${"11".repeat(65)}` };
    for (const step of ["plan", "sign-binding", "sign-policy", "approve-seed"] as const)
      state.steps[step] = { status: "done" };
    state.steps["create-fund"] = {
      status: "submitted",
      txHash: `0x${"b2".repeat(32)}`,
      chain: 42161,
    };
    localStorage.setItem(key, JSON.stringify(state));
    mocks.actions.buildSolanaCreationAction
      .mockResolvedValueOnce(ok(p.created))
      .mockResolvedValueOnce(ok(p.spokeDone));
    mocks.receipt.mockResolvedValue({ status: "success" });
    mocks.actions.discoverSolanaFundAction.mockResolvedValue({
      ok: false,
      error: { status: 400, code: "INVALID_TEST_STOP" },
    });
    const { result } = renderHook(() => useSolanaV6Launch("d1"));
    await waitFor(() => expect(result.current.state?.plan?.core).toBe(LIVE_UNSIGNED_PLAN.core));
    act(() => result.current.runCreation());
    await waitFor(() => expect(result.current.error).toBe("INVALID_TEST_STOP"), {
      timeout: 10_000,
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.current.state?.steps["create-fund"]?.status).toBe("done");
    expect(result.current.state?.steps["create-spoke"]?.status).toBe("done");
  });

  function resumedAt(step: "approve-seed" | "create-fund", patch: Record<string, unknown>) {
    return import("./solanaV6Launch").then(({ initialSolanaLaunch }) => {
      const state = initialSolanaLaunch({
        draftId: "d1",
        manager: MANAGER,
        solanaKey: SOLANA_KEY,
        plan,
        review: (mocks.draft as { review: never }).review,
        amounts,
      });
      state.plan = {
        core: LIVE_UNSIGNED_PLAN.core,
        fundId: LIVE_UNSIGNED_PLAN.fundId,
        creationNumber: LIVE_UNSIGNED_PLAN.creationNumber,
        bindingNonce: "0",
        bindingExpiry: "1791871620",
        expiresAt: "2026-10-13T06:07:00.000Z",
        fundPda: SOLANA_KEY,
        vault: SOLANA_KEY,
        usdcAta: SOLANA_KEY,
        robinhoodSpokeVault: MANAGER,
      };
      state.signatures = { binding: `0x${"11".repeat(65)}`, swapPolicy: `0x${"11".repeat(65)}` };
      for (const done of ["plan", "sign-binding", "sign-policy", "approve-seed"] as const)
        if (done !== step) state.steps[done] = { status: "done" };
      state.steps[step] = { status: "failed", ...patch } as never;
      localStorage.setItem(solanaLaunchKey(MANAGER, "d1"), JSON.stringify(state));
    });
  }

  it("never resends a Fund creation whose wallet prompt ended without a hash while a nonce is pending", async () => {
    const p = plans();
    await resumedAt("create-fund", { attempted: true, nonce: "7" });
    mocks.actions.buildSolanaCreationAction.mockResolvedValue(ok(p.readyCreate));
    // latest 7 (nothing mined from nonce 7), pending 8 (something in the mempool): wait, never resend.
    mocks.nonce.mockImplementation(async ({ blockTag }: { blockTag: string }) =>
      blockTag === "pending" ? 8 : 7,
    );
    const { result } = renderHook(() => useSolanaV6Launch("d1"));
    await waitFor(() => expect(result.current.state?.plan?.core).toBeDefined());
    act(() => result.current.runCreation());
    await waitFor(() => expect(result.current.state?.steps["create-fund"]?.status).toBe("waiting"));
    act(() => result.current.stop());
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("treats a creation found on the Hub as landed after an ambiguous prompt", async () => {
    const p = plans();
    await resumedAt("create-fund", { attempted: true, nonce: "7" });
    mocks.actions.buildSolanaCreationAction
      .mockResolvedValueOnce(ok(p.readyCreate))
      .mockResolvedValueOnce(ok(p.created))
      .mockResolvedValue(ok(p.spokeDone));
    mocks.nonce.mockResolvedValue(8);
    mocks.actions.discoverSolanaFundAction.mockResolvedValue({
      ok: false,
      error: { status: 400, code: "INVALID_TEST_STOP" },
    });
    const { result } = renderHook(() => useSolanaV6Launch("d1"));
    await waitFor(() => expect(result.current.state?.plan?.core).toBeDefined());
    act(() => result.current.runCreation());
    await waitFor(() => expect(result.current.error).toBe("INVALID_TEST_STOP"), {
      timeout: 10_000,
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.current.state?.steps["create-fund"]?.status).toBe("done");
  });

  it("forgets a reverted hash so the step can be rebuilt, and keeps restart off once a hash exists", async () => {
    const p = plans();
    await resumedAt("create-fund", {
      status: "submitted",
      txHash: `0x${"b2".repeat(32)}`,
      chain: 42161,
    });
    mocks.actions.buildSolanaCreationAction.mockResolvedValue(ok(p.readyCreate));
    mocks.receipt.mockResolvedValue({ status: "reverted" });
    const { result } = renderHook(() => useSolanaV6Launch("d1"));
    await waitFor(() => expect(result.current.state?.plan?.core).toBeDefined());
    const { creationLanded } = await import("./solanaV6Launch");
    expect(creationLanded(result.current.state as never)).toBe(true);
    act(() => result.current.restartCreation());
    expect(result.current.state).not.toBeNull();
    act(() => result.current.runCreation());
    await waitFor(() => expect(result.current.error).toBe("TRANSACTION_REVERTED"), {
      timeout: 10_000,
    });
    expect(result.current.state?.steps["create-fund"]?.txHash).toBeUndefined();
    expect(creationLanded(result.current.state as never)).toBe(false);
  });
});
