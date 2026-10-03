import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FrozenLaunch, LaunchWallet } from "./driver";
import { createJournal, journalKey } from "./journal";
import { useV2Launch } from "./useV2Launch";

const mocks = vi.hoisted(() => ({
  enabled: true,
  build: vi.fn(),
  send: vi.fn(),
  receipt: vi.fn(),
}));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => mocks.enabled }),
}));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("./lock", () => ({
  withLaunchLock: async (_key: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("./driver", () => ({
  createLaunchDriver: () => ({
    build: mocks.build,
    send: mocks.send,
    receipt: mocks.receipt,
    reconcile: async () => false,
    complete: async () => {},
  }),
}));
const manager = `0x${"34".repeat(20)}`;
const base = `0x${"12".repeat(20)}`;
const plan = {
  version: 1 as const,
  hub: {
    chains: [
      {
        id: "leaf",
        sharePct: 100,
        steps: [
          {
            id: "aave",
            family: "position" as const,
            kind: "aaveSupply",
            config: { assetKey: `arbitrum:${base}` },
          },
        ],
      },
    ],
  },
  spokes: [],
};
const frozen: FrozenLaunch = {
  plan,
  review: {
    name: "Income fund demo",
    description: "",
    imageUrl: "",
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 200,
    minimum: "100",
    seed: "100",
  },
  request: {
    manager,
    chains: [{ chainId: 42161, tokens: [base], uniswapV4PoolIds: [] }],
    aaveV3Reserves: [],
    spokeCapPercent: null,
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 200,
    minFirstDeposit: "100000000",
    seedAmount: "100000000",
  },
};
const options = () => ({
  draftId: "draft",
  manager,
  plan,
  frozen,
  spoke: false,
  wallet: {} as LaunchWallet,
  pollInterval: 1,
});
describe("headless launch binding [R3, R4, R6]", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.build.mockResolvedValue({ complete: true });
    mocks.send.mockResolvedValue(`0x${"ab".repeat(32)}`);
    mocks.receipt.mockResolvedValue({ status: "success" });
  });
  it("exposes dynamic chain signatures and starts only after explicit launch", async () => {
    const { result } = renderHook(() => useV2Launch(options()));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(mocks.build).not.toHaveBeenCalled();
    expect(result.current.signatures.some((entry) => entry.type === "message")).toBe(true);
    await act(async () => {
      await result.current.launch();
    });
    expect(result.current.status).toBe("complete");
    expect(result.current.journal?.draftId).toBe("draft");
  });
  it("reloads successful creation and resumes only unfinished work", async () => {
    const journal = createJournal("draft", manager, frozen, [
      { id: "create", kind: "create", chain: 42161, dependencies: [] },
      { id: "discover", kind: "discover", chain: 42161, dependencies: ["create"] },
    ]);
    journal.checkpoints.create = {
      stepId: "create",
      chain: 42161,
      status: "confirmed",
      receiptStatus: "success",
    };
    localStorage.setItem(journalKey("draft", manager), JSON.stringify(journal));
    const { result } = renderHook(() => useV2Launch(options()));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.currentStep?.id).toBe("discover");
    await act(async () => {
      await result.current.resume();
    });
    expect(mocks.build.mock.calls.every(([step]) => step.id !== "create")).toBe(true);
    expect(result.current.status).toBe("complete");
  });
  it("keeps partial failure resumable and refuses corrupt journals and disabled flags", async () => {
    mocks.build.mockRejectedValueOnce(new Error("BALANCE_CHANGED"));
    const { result, unmount } = renderHook(() => useV2Launch(options()));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    await act(async () => {
      await result.current.launch();
    });
    expect(result.current.status).toBe("failed");
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.status).toBe("complete");
    unmount();
    localStorage.setItem(journalKey("draft", manager), "corrupt");
    const corrupt = renderHook(() => useV2Launch(options()));
    await waitFor(() => expect(corrupt.result.current.error?.code).toBe("INVALID_JOURNAL"));
    corrupt.unmount();
    localStorage.clear();
    mocks.enabled = false;
    const disabled = renderHook(() => useV2Launch(options()));
    await act(async () => {
      await disabled.result.current.launch();
    });
    expect(disabled.result.current.error?.code).toBe("V2_UNAVAILABLE");
  });
});
