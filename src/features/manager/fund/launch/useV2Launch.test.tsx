import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FrozenLaunch, LaunchWallet } from "./driver";
import { createJournal, journalKey } from "./journal";
import { useV2LaunchBinding } from "./useV2LaunchBinding";

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
  it("honors Pause for hydrated receipt polling until explicit resume", async () => {
    const journal = createJournal("draft", manager, frozen, [
      { id: "aave", kind: "open", chain: 42161, dependencies: [] },
    ]);
    journal.checkpoints.aave = {
      stepId: "aave",
      chain: 42161,
      status: "waiting",
      txHash: "0xknown",
      receiptStatus: "unknown",
    };
    localStorage.setItem(journalKey("draft", manager), JSON.stringify(journal));
    const { result } = renderHook(() => useV2LaunchBinding({ ...options(), pollInterval: 50 }));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    act(() => result.current.pause());
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(mocks.receipt).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.checkpoints.aave?.status).toBe("confirmed");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("automatically polls a hydrated unknown receipt despite a failed sibling, without signing", async () => {
    const journal = createJournal("draft", manager, frozen, [
      { id: "bad", kind: "open", chain: 42161, dependencies: [] },
      { id: "aave", kind: "open", chain: 42161, dependencies: [] },
    ]);
    journal.checkpoints.bad = {
      stepId: "bad",
      chain: 42161,
      status: "failed",
      error: "V2_REQUEST_FAILED",
    };
    journal.checkpoints.aave = {
      stepId: "aave",
      chain: 42161,
      status: "waiting",
      txHash: "0xknown",
      receiptStatus: "unknown",
    };
    localStorage.setItem(journalKey("draft", manager), JSON.stringify(journal));
    mocks.receipt
      .mockResolvedValueOnce({ status: "unknown" })
      .mockResolvedValue({ status: "success" });
    const { result } = renderHook(() => useV2LaunchBinding(options()));
    await waitFor(() => expect(result.current.checkpoints.aave?.status).toBe("confirmed"));
    expect(result.current.checkpoints.bad?.status).toBe("failed");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });
  it("polls an explicitly advanced report until accepted, without signing the following bridge", async () => {
    const journal = createJournal("draft", manager, frozen, [
      { id: "report", kind: "report", chain: 42161, dependencies: [] },
      { id: "bridge", kind: "bridge", chain: 42161, dependencies: ["report"] },
    ]);
    localStorage.setItem(journalKey("draft", manager), JSON.stringify(journal));
    mocks.build
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ complete: true });
    const { result } = renderHook(() => useV2LaunchBinding(options()));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    await act(async () => {
      await result.current.sign();
    });
    expect(mocks.build).toHaveBeenCalledTimes(3);
    expect(result.current.checkpoints.report?.status).toBe("confirmed");
    expect(result.current.checkpoints.bridge).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.build.mockResolvedValue({ complete: true });
    mocks.send.mockResolvedValue(`0x${"ab".repeat(32)}`);
    mocks.receipt.mockResolvedValue({ status: "success" });
    window.dataLayer = [];
  });
  it("R9 emits completion once and failure with no identifying payload", async () => {
    const { result } = renderHook(() => useV2LaunchBinding(options()));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    await act(async () => {
      await result.current.launch();
      await result.current.resume();
    });
    expect(
      window.dataLayer?.filter((entry) => entry.event === "builder_launch_completed"),
    ).toHaveLength(1);
    expect(window.dataLayer).not.toContainEqual(
      expect.objectContaining({ event: "builder_launch_clicked" }),
    );
  });
  it("R9 emits a sanitized launch failure for the failing step", async () => {
    mocks.build.mockRejectedValue(new Error("BUILD_TICK_ALIGNMENT"));
    const { result } = renderHook(() => useV2LaunchBinding(options()));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    await act(async () => {
      await result.current.launch();
    });
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "builder_launch_failed",
        step_kind: "approve",
        error_code: "BUILD_TICK_ALIGNMENT",
      }),
    );
    expect(JSON.stringify(window.dataLayer)).not.toContain(manager);
  });
  it("exposes dynamic chain signatures and starts only after explicit launch", async () => {
    const { result } = renderHook(() => useV2LaunchBinding(options()));
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
    const { result } = renderHook(() => useV2LaunchBinding(options()));
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
    const { result, unmount } = renderHook(() => useV2LaunchBinding(options()));
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
    const corrupt = renderHook(() => useV2LaunchBinding(options()));
    await waitFor(() => expect(corrupt.result.current.error?.code).toBe("INVALID_JOURNAL"));
    corrupt.unmount();
    localStorage.clear();
    mocks.enabled = false;
    const disabled = renderHook(() => useV2LaunchBinding(options()));
    await act(async () => {
      await disabled.result.current.launch();
    });
    expect(disabled.result.current.error?.code).toBe("V2_UNAVAILABLE");
  });
  it("advances exactly one ready step for next and sign without running the full plan", async () => {
    const { result } = renderHook(() => useV2LaunchBinding(options()));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    await act(async () => {
      await result.current.next();
    });
    expect(mocks.build).toHaveBeenCalledTimes(1);
    expect(result.current.currentStep?.kind).toBe("create");
    await act(async () => {
      await result.current.sign();
    });
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(result.current.currentStep?.kind).toBe("discover");
  });
  it("exposes honest waits, polls and pauses without rebuilding confirmed work", async () => {
    mocks.build.mockResolvedValue({});
    const { result } = renderHook(() => useV2LaunchBinding({ ...options(), pollInterval: 1 }));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    let pending: Promise<void>;
    await act(async () => {
      pending = result.current.launch();
    });
    await waitFor(() => expect(mocks.build.mock.calls.length).toBeGreaterThan(1));
    expect(result.current.checkpoints.approve?.status).toBe("waiting");
    await act(async () => {
      result.current.pause();
      await pending;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.status).toBe("paused");
  });
  it("refuses missing wallet/plan and missing or mismatched frozen review", async () => {
    const missingWallet = renderHook(() =>
      useV2LaunchBinding({ ...options(), manager: null, wallet: null }),
    );
    await act(async () => {
      await missingWallet.result.current.launch();
    });
    expect(missingWallet.result.current.error?.messageKey).toBe("fundLaunch.walletOrJournal");
    missingWallet.unmount();
    const noPlan = renderHook(() => useV2LaunchBinding({ ...options(), plan: undefined }));
    await waitFor(() => expect(noPlan.result.current.hydrated).toBe(true));
    await act(async () => {
      await noPlan.result.current.launch();
    });
    expect(noPlan.result.current.error?.code).toBe("BUILD_EXECUTION_GAP");
    noPlan.unmount();
    const noReview = renderHook(() => useV2LaunchBinding({ ...options(), frozen: undefined }));
    await waitFor(() => expect(noReview.result.current.hydrated).toBe(true));
    await act(async () => {
      await noReview.result.current.resume();
    });
    expect(noReview.result.current.error?.code).toBe("INVALID_JOURNAL");
    await act(async () => {
      await noReview.result.current.launch();
    });
    expect(noReview.result.current.error?.code).toBe("INVALID_REVIEW");
    noReview.unmount();
    const prepare = vi.fn(() => ({ ...frozen, request: { ...frozen.request, manager: base } }));
    const mismatch = renderHook(() => useV2LaunchBinding({ ...options(), prepare }));
    await waitFor(() => expect(mismatch.result.current.hydrated).toBe(true));
    expect(prepare).not.toHaveBeenCalled();
    await act(async () => {
      await mismatch.result.current.launch();
    });
    expect(mismatch.result.current.error?.code).toBe("INVALID_REVIEW");
  });
  it("validates unreadable plan and redacts non-code prepare errors", async () => {
    const badPlan = renderHook(() =>
      useV2LaunchBinding({ ...options(), plan: { ...plan, version: 2 } as unknown as typeof plan }),
    );
    await waitFor(() => expect(badPlan.result.current.hydrated).toBe(true));
    expect(badPlan.result.current.gap).toBe(true);
    badPlan.unmount();
    const invalid = renderHook(() =>
      useV2LaunchBinding({
        ...options(),
        prepare: () => {
          throw new Error("sensitive private data");
        },
      }),
    );
    await waitFor(() => expect(invalid.result.current.hydrated).toBe(true));
    await act(async () => {
      await invalid.result.current.launch();
    });
    expect(invalid.result.current.error?.code).toBe("LAUNCH_STEP_FAILED");
  });
});
