import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type FundView, fundViewSchema } from "@/lib/api/v2/fundSchemas";
import { mockFund, mockHolder } from "@/mocks/data/v2Funds";
import fund6 from "./fixtures/fund6Detail.json";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  build: vi.fn(),
  refresh: vi.fn(),
  start: vi.fn(),
  send: vi.fn(),
  wallet: "",
  provider: { request: vi.fn() },
}));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.wallet }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({ useSiweSession: () => ({ isSignedIn: true }) }));
vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({
    wallets: [
      {
        address: mocks.wallet,
        switchChain: vi.fn(),
        getEthereumProvider: async () => mocks.provider,
      },
    ],
  }),
}));
vi.mock("./fundActions", () => ({
  loadFundAction: mocks.load,
  buildFundAction: mocks.build,
  refreshSolanaReportAction: mocks.refresh,
  startFundReportAction: mocks.start,
  pollFundReportAction: vi.fn(),
}));
vi.mock("./fundTransactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fundTransactions")>()),
  sendFundTransaction: mocks.send,
}));

import { useFundInvest } from "./useFundInvest";

describe("POO-2248 controller", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.wallet = mockFund.manager;
    mocks.load.mockResolvedValue({
      ok: true,
      data: {
        wallet: mocks.wallet,
        holder: mockHolder,
        fund: { ...mockFund, mandate: { ...mockFund.mandate, spokes: [] } },
      },
    });
  });
  it("[R7] refuses invalid raw amount without calling the builder", async () => {
    const { result } = renderHook(() => useFundInvest({ core: mockFund.coreVault, enabled: true }));
    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    await act(async () => result.current.prepare("0"));
    expect(result.current.errorCode).toBe("V2_INVALID_AMOUNT");
    expect(mocks.build).not.toHaveBeenCalled();
  });
});

it("[R6] restores an unknown hash and refuses a duplicate prepare after reopening", async () => {
  localStorage.setItem(
    `pp:v2:invest:1:${mocks.wallet.toLowerCase()}:${mockFund.coreVault.toLowerCase()}`,
    JSON.stringify({
      core: mockFund.coreVault,
      wallet: mocks.wallet,
      budget: "15000000",
      kind: "deposit",
      state: "unknown",
      record: {
        chainId: 42161,
        hash: `0x${"a".repeat(64)}`,
        action: "deposit",
        status: "pending",
        uncertain: true,
      },
    }),
  );
  mocks.build.mockClear();
  const { result } = renderHook(() => useFundInvest({ core: mockFund.coreVault, enabled: true }));
  await waitFor(() => expect(result.current.phase).toBe("unknown"));
  await act(async () => result.current.prepare("15000000"));
  expect(mocks.build).not.toHaveBeenCalled();
  expect(result.current.records[0]?.hash).toBe(`0x${"a".repeat(64)}`);
});

it("[R5,R6] never submits the zero-minimum simulation and serializes protected confirm", async () => {
  localStorage.clear();
  mocks.wallet = mockFund.manager;
  mocks.load.mockResolvedValue({
    ok: true,
    data: {
      wallet: mocks.wallet,
      holder: mockHolder,
      fund: { ...mockFund, mandate: { ...mockFund.mandate, spokes: [] } },
    },
  });
  const { encodeFunctionData } = await import("viem");
  const { depositAbi } = await import("./fundInvestModel");
  const preview = {
    sharesMinted: "1000000000000000000",
    usdcCharged: "1005000",
    flowFee: "5000",
    refundToCaller: "995000",
    sharePrice: "1000000000000000000000000",
  };
  mocks.build.mockImplementation(async (_core, intent) => ({
    ok: true,
    data: {
      protocolVersion: "v2",
      transactions: [
        {
          protocolVersion: "v2",
          chainId: 42161,
          to: mockFund.coreVault,
          from: mocks.wallet,
          value: "0",
          data: encodeFunctionData({
            abi: depositAbi,
            functionName: "deposit",
            args: [BigInt(intent.amount), BigInt(intent.minShares)],
          }),
        },
      ],
      preview,
    },
  }));
  mocks.send.mockImplementation(async (_p, _tx, _w, _kind, observe) => {
    observe({
      chainId: 42161,
      hash: `0x${"b".repeat(64)}`,
      action: "deposit",
      status: "confirmed",
    });
  });
  const settled = vi.fn();
  const { result } = renderHook(() =>
    useFundInvest({ core: mockFund.coreVault, enabled: true, onSettled: settled }),
  );
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  await act(async () => result.current.prepare("2000000"));
  expect(mocks.send).not.toHaveBeenCalled();
  await act(async () => Promise.all([result.current.confirm(), result.current.confirm()]));
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledTimes(1);
  expect(mocks.build.mock.calls.at(-1)?.[1].minShares).toBe("1000000000000000000");
});

it("[R7] hides snapshot immediately when the authenticated account changes", async () => {
  localStorage.clear();
  mocks.wallet = mockFund.manager;
  mocks.load.mockResolvedValue({
    ok: true,
    data: { wallet: mocks.wallet, holder: mockHolder, fund: mockFund },
  });
  const { result, rerender } = renderHook(() =>
    useFundInvest({ core: mockFund.coreVault, enabled: true }),
  );
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  mocks.wallet = `0x${"9".repeat(40)}`;
  mocks.load.mockImplementation(() => new Promise(() => {}));
  rerender();
  expect(result.current.snapshot).toBeNull();
  expect(result.current.preview).toBeNull();
  expect(result.current.records).toEqual([]);
});

it("[R4,R5] requires another review when deposit rebuild becomes approval", async () => {
  localStorage.clear();
  mocks.wallet = mockFund.manager;
  mocks.send.mockClear();
  mocks.load.mockResolvedValue({
    ok: true,
    data: {
      wallet: mocks.wallet,
      holder: mockHolder,
      fund: { ...mockFund, mandate: { ...mockFund.mandate, spokes: [] } },
    },
  });
  const { encodeFunctionData, erc20Abi } = await import("viem");
  const { depositAbi } = await import("./fundInvestModel");
  const preview = {
    sharesMinted: "1000000000000000000",
    usdcCharged: "1005000",
    flowFee: "5000",
    refundToCaller: "995000",
    sharePrice: "1000000000000000000000000",
  };
  const tx = {
    protocolVersion: "v2",
    chainId: 42161,
    to: mockFund.coreVault,
    from: mocks.wallet,
    value: "0",
    data: encodeFunctionData({
      abi: depositAbi,
      functionName: "deposit",
      args: [BigInt("2000000"), BigInt("0")],
    }),
  };
  mocks.build
    .mockReset()
    .mockResolvedValueOnce({
      ok: true,
      data: { protocolVersion: "v2", transactions: [tx], preview },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        protocolVersion: "v2",
        transactions: [
          {
            ...tx,
            to: mockFund.mandate.usdc,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [mockFund.coreVault as `0x${string}`, BigInt("2000000")],
            }),
          },
        ],
        preview: null,
        nextAction: "approve",
      },
    });
  const { result } = renderHook(() => useFundInvest({ core: mockFund.coreVault, enabled: true }));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  await act(async () => result.current.prepare("2000000"));
  await act(async () => result.current.confirm());
  expect(result.current.phase).toBe("review");
  expect(result.current.approvalRequired).toBe(true);
  expect(mocks.send).not.toHaveBeenCalled();
});

it("[R6,R7] releases a signing reservation for nested numeric wallet rejection", async () => {
  localStorage.clear();
  mocks.wallet = mockFund.manager;
  mocks.load.mockResolvedValue({
    ok: true,
    data: {
      wallet: mocks.wallet,
      holder: mockHolder,
      fund: { ...mockFund, mandate: { ...mockFund.mandate, spokes: [] } },
    },
  });
  const { encodeFunctionData } = await import("viem");
  const { depositAbi } = await import("./fundInvestModel");
  const preview = {
    sharesMinted: "1000000000000000000",
    usdcCharged: "1005000",
    flowFee: "5000",
    refundToCaller: "995000",
    sharePrice: "1000000000000000000000000",
  };
  mocks.build.mockImplementation(async (_core, intent) => ({
    ok: true,
    data: {
      protocolVersion: "v2",
      transactions: [
        {
          protocolVersion: "v2",
          chainId: 42161,
          to: mockFund.coreVault,
          from: mocks.wallet,
          value: "0",
          data: encodeFunctionData({
            abi: depositAbi,
            functionName: "deposit",
            args: [BigInt(intent.amount), BigInt(intent.minShares)],
          }),
        },
      ],
      preview,
    },
  }));
  mocks.send.mockRejectedValueOnce({ code: "USER_SEND_FAILED", cause: { code: 4001 } });
  const { result } = renderHook(() => useFundInvest({ core: mockFund.coreVault, enabled: true }));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  await act(async () => result.current.prepare("2000000"));
  await act(async () => result.current.confirm());
  expect(result.current.phase).toBe("review");
  expect(result.current.errorCode).toBe("4001");
  expect(
    localStorage.getItem(
      `pp:v2:invest:1:${mocks.wallet.toLowerCase()}:${mockFund.coreVault.toLowerCase()}`,
    ),
  ).toBeNull();
});

it("[R7] times out a hung read and ignores its late success", async () => {
  localStorage.clear();
  mocks.wallet = mockFund.manager;
  let finish: (value: unknown) => void = () => {};
  mocks.load.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() =>
    useFundInvest({ core: mockFund.coreVault, enabled: true }),
  );
  await act(async () => {
    vi.advanceTimersByTime(30000);
  });
  expect(result.current.errorCode).toBe("V2_READ_TIMEOUT");
  await act(async () =>
    finish({ ok: true, data: { wallet: mocks.wallet, holder: mockHolder, fund: mockFund } }),
  );
  expect(result.current.snapshot).toBeNull();
  unmount();
  vi.useRealTimers();
});

it("[R7] refresh recovers a failed read to idle without clearing an unresolved journal", async () => {
  localStorage.clear();
  mocks.wallet = mockFund.manager;
  mocks.load
    .mockResolvedValueOnce({ ok: false, error: { code: "V2_UNAVAILABLE" } })
    .mockResolvedValue({
      ok: true,
      data: { wallet: mocks.wallet, holder: mockHolder, fund: mockFund },
    });
  const { result } = renderHook(() => useFundInvest({ core: mockFund.coreVault, enabled: true }));
  await waitFor(() => expect(result.current.errorCode).toBe("V2_UNAVAILABLE"));
  await act(async () => result.current.refresh());
  expect(result.current.phase).toBe("idle");
  expect(result.current.errorCode).toBeNull();
});

it("[R7] exposes initial failure rather than indefinite loading", async () => {
  localStorage.clear();
  mocks.wallet = mockFund.manager;
  mocks.load.mockResolvedValue({ ok: false, error: { code: "V2_UNAVAILABLE" } });
  const { result } = renderHook(() => useFundInvest({ core: mockFund.coreVault, enabled: true }));
  await waitFor(() => expect(result.current.errorCode).toBe("V2_UNAVAILABLE"));
  expect(result.current.phase).toBe("error");
});

it("[R7] unauthenticated open stays actionable without loading forever", () => {
  mocks.wallet = "";
  const { result } = renderHook(() => useFundInvest({ core: mockFund.coreVault, enabled: true }));
  expect(result.current.phase).toBe("idle");
  expect(result.current.snapshot).toBeNull();
});

it("[R4,R5] confirms approval then rebuilds original budget into fresh deposit review", async () => {
  localStorage.clear();
  mocks.wallet = mockFund.manager;
  mocks.send.mockReset();
  mocks.load.mockResolvedValue({
    ok: true,
    data: {
      wallet: mocks.wallet,
      holder: mockHolder,
      fund: { ...mockFund, mandate: { ...mockFund.mandate, spokes: [] } },
    },
  });
  const { encodeFunctionData, erc20Abi } = await import("viem");
  const { depositAbi } = await import("./fundInvestModel");
  const preview = {
    sharesMinted: "1000000000000000000",
    usdcCharged: "1005000",
    flowFee: "5000",
    refundToCaller: "995000",
    sharePrice: "1000000000000000000000000",
  };
  const base = {
    protocolVersion: "v2",
    chainId: 42161,
    to: mockFund.coreVault,
    from: mocks.wallet,
    value: "0",
  };
  const approval = {
    ok: true,
    data: {
      protocolVersion: "v2",
      transactions: [
        {
          ...base,
          to: mockFund.mandate.usdc,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [mockFund.coreVault as `0x${string}`, BigInt("2000000")],
          }),
        },
      ],
      preview: null,
      nextAction: "approve",
    },
  };
  const deposit = {
    ok: true,
    data: {
      protocolVersion: "v2",
      transactions: [
        {
          ...base,
          data: encodeFunctionData({
            abi: depositAbi,
            functionName: "deposit",
            args: [BigInt("2000000"), BigInt("0")],
          }),
        },
      ],
      preview,
    },
  };
  mocks.build
    .mockReset()
    .mockResolvedValueOnce(approval)
    .mockResolvedValueOnce(approval)
    .mockResolvedValueOnce(deposit);
  mocks.send.mockImplementation(async (_provider, _tx, _wallet, action, observe) =>
    observe({ chainId: 42161, hash: `0x${"c".repeat(64)}`, action, status: "confirmed" }),
  );
  const onSettled = vi.fn();
  const { result } = renderHook(() =>
    useFundInvest({ core: mockFund.coreVault, enabled: true, onSettled }),
  );
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  await act(async () => result.current.prepare("2000000"));
  expect(result.current.approvalRequired).toBe(true);
  await act(async () => result.current.confirm());
  expect(result.current.phase).toBe("review");
  expect(result.current.approvalRequired).toBe(false);
  expect(result.current.preview).toEqual(preview);
  expect(result.current.amountRaw).toBe("2000000");
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0]?.[3]).toBe("approve");
  expect(onSettled).not.toHaveBeenCalled();
  expect(mocks.build.mock.calls.every((call) => call[1].amount === "2000000")).toBe(true);
});

it("[R5] reviews a changed same-kind preview before sending with updated exact share protection", async () => {
  localStorage.clear();
  mocks.wallet = mockFund.manager;
  mocks.send.mockReset();
  mocks.load.mockResolvedValue({
    ok: true,
    data: {
      wallet: mocks.wallet,
      holder: mockHolder,
      fund: { ...mockFund, mandate: { ...mockFund.mandate, spokes: [] } },
    },
  });
  const { encodeFunctionData } = await import("viem");
  const { depositAbi } = await import("./fundInvestModel");
  const old = {
    sharesMinted: "1000000000000000000",
    usdcCharged: "1005000",
    flowFee: "5000",
    refundToCaller: "1995000",
    sharePrice: "1000000000000000000000000",
  };
  const next = {
    sharesMinted: "2000000000000000000",
    usdcCharged: "2005000",
    flowFee: "5000",
    refundToCaller: "995000",
    sharePrice: "1000000000000000000000000",
  };
  let call = 0;
  mocks.build.mockReset().mockImplementation(async (_core, intent) => ({
    ok: true,
    data: {
      protocolVersion: "v2",
      transactions: [
        {
          protocolVersion: "v2",
          chainId: 42161,
          to: mockFund.coreVault,
          from: mocks.wallet,
          value: "0",
          data: encodeFunctionData({
            abi: depositAbi,
            functionName: "deposit",
            args: [BigInt("3000000"), BigInt(intent.minShares)],
          }),
        },
      ],
      preview: call++ === 0 ? old : next,
    },
  }));
  mocks.send.mockImplementation(async (_p, _tx, _w, action, observe) =>
    observe({ chainId: 42161, hash: `0x${"d".repeat(64)}`, action, status: "confirmed" }),
  );
  const { result } = renderHook(() => useFundInvest({ core: mockFund.coreVault, enabled: true }));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  await act(async () => result.current.prepare("3000000"));
  await act(async () => result.current.confirm());
  expect(result.current.phase).toBe("review");
  expect(result.current.preview).toEqual(next);
  expect(mocks.send).not.toHaveBeenCalled();
  await act(async () => result.current.confirm());
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.build.mock.calls.at(-1)?.[1].minShares).toBe(next.sharesMinted);
});

// POO-2262 (API contract §3.9): the live v6 Fund, Solana report stale, then a 409 on the build.
it("[POO-2262] refreshes the Solana report, waits out a 409 report wait and reaches review", async () => {
  localStorage.clear();
  const live = fundViewSchema.parse(fund6.data);
  mocks.wallet = mockFund.manager;
  const v6 = (usable: boolean): FundView => ({
    ...live,
    reportsUsable: usable,
    spokes: live.spokes?.map((spoke) =>
      spoke.chainId === "1" && spoke.reportFreshness
        ? { ...spoke, reportFreshness: { ...spoke.reportFreshness, usable } }
        : spoke,
    ),
  });
  // Mount read, prepare read, gate read (stale), gate re-read after the wait (usable, repeats).
  const reads = [v6(false), v6(false), v6(false), v6(true)];
  mocks.load.mockImplementation(async () => ({
    ok: true,
    data: {
      wallet: mocks.wallet,
      holder: mockHolder,
      fund: reads.length > 1 ? reads.shift() : reads[0],
    },
  }));
  mocks.refresh.mockReset().mockResolvedValue({
    ok: true,
    data: { usable: false, refreshing: true, retryAfterSeconds: 15, jobId: null },
  });
  mocks.start.mockReset();
  const { encodeFunctionData } = await import("viem");
  const { depositAbi } = await import("./fundInvestModel");
  mocks.build
    .mockReset()
    .mockResolvedValueOnce({
      ok: false,
      error: { status: 409, code: "SOLANA_REPORT_REFRESHING", retryAfterSeconds: 5 },
    })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        protocolVersion: "v2",
        transactions: [
          {
            protocolVersion: "v2",
            chainId: 42161,
            to: live.coreVault,
            from: mocks.wallet,
            value: "0",
            gas: "1057965",
            data: encodeFunctionData({
              abi: depositAbi,
              functionName: "deposit",
              args: [BigInt("50000000"), BigInt("0")],
            }),
          },
        ],
        preview: {
          sharesMinted: "49000000000000000000",
          usdcCharged: "49100000",
          flowFee: "125000",
          refundToCaller: "900000",
          sharePrice: "1000000000000000000000000",
        },
      },
    });
  const { result, unmount } = renderHook(() =>
    useFundInvest({ core: live.coreVault, enabled: true }),
  );
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  vi.useFakeTimers();
  try {
    let prepared: Promise<void> | undefined;
    await act(async () => {
      prepared = result.current.prepare("50000000");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.phase).toBe("building");
    expect(result.current.reportRefreshing).toBe(true);
    expect(mocks.refresh).toHaveBeenCalledWith(live.coreVault);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(mocks.build).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
      await prepared;
    });
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(result.current.phase).toBe("review");
    expect(result.current.reportRefreshing).toBe(false);
    expect(result.current.errorCode).toBeNull();
    // Never the admin report broker for a v6 Fund.
    expect(mocks.start).not.toHaveBeenCalled();
  } finally {
    unmount();
    vi.useRealTimers();
  }
});
