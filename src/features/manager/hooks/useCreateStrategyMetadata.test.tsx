/**
 * @id PP-MGR-HOK-001 (POO-308)
 * @name useCreateStrategyMetadata tests (real branch)
 * @implements-rules-version v1
 *
 * Real mode: the pre-tx metadata create signs `strategy.create` and forwards the envelope (R1/R4,
 * returns the strategyId; null when it declines/errors — R5); the post-mine confirm POSTs the plain
 * txHash body with NO signature (R3 · POO-868: the mint tx was already signed on-chain), then
 * observes POO-638 convergence to clear the pending badge -> live (R6). A confirm error surfaces
 * `confirmStatus: "error"` with a working retry (R5). The real `signWrite` runs on the create path
 * so the signed message's action tag is asserted end to end.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StrategyMetadataInput } from "@/lib/strategies/v2/strategyMetadataSchema";

const mocks = vi.hoisted(() => ({
  wallets: [] as Array<{
    address: string;
    getEthereumProvider: () => Promise<{
      request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
    }>;
  }>,
  signedMessages: [] as string[],
  create: vi.fn(),
  confirm: vi.fn(),
  readBlocks: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("@/lib/strategies/v2/strategiesV2Actions", () => ({
  createStrategyMetadataAction: (...a: unknown[]) => mocks.create(...a),
  confirmStrategyOnchainAction: (...a: unknown[]) => mocks.confirm(...a),
  readStrategyOnchainBlocksAction: (...a: unknown[]) => mocks.readBlocks(...a),
}));

import { useCreateStrategyMetadata } from "./useCreateStrategyMetadata";

const metadata: StrategyMetadataInput = {
  name: "Blue Chip ETH",
  description: "thesis",
  category: "blueChip",
  objectiveTags: ["income"],
  riskLevel: "dynamic",
  managerFee: 2000,
  access: "public",
};

/** Connect a wallet whose provider records every personal_sign message and returns a signature. */
function connectWallet(sign: (message: string) => string | Promise<string> = () => "0xsignature") {
  mocks.wallets = [
    {
      address: "0xWALLET",
      getEthereumProvider: async () => ({
        request: async ({ method, params }) => {
          if (method === "personal_sign") {
            const message = (params?.[0] as string) ?? "";
            mocks.signedMessages.push(message);
            return sign(message);
          }
          throw new Error(`unexpected method ${method}`);
        },
      }),
    },
  ];
}

beforeEach(() => {
  mocks.wallets = [];
  mocks.signedMessages = [];
  mocks.create.mockReset();
  mocks.confirm.mockReset();
  mocks.readBlocks.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useCreateStrategyMetadata.create", () => {
  it("posts the plain metadata via the session-authenticated action with NO signature (POO-868)", async () => {
    // @rule R1 @rule R4 @rule R6
    connectWallet();
    mocks.create.mockResolvedValue("str-1");
    const { result } = renderHook(() => useCreateStrategyMetadata());

    const id = await result.current.create(metadata);

    expect(id).toBe("str-1");
    expect(mocks.create).toHaveBeenCalledWith(metadata);
    // POO-868 regression lock: the create path never asks the wallet for a signature.
    expect(mocks.signedMessages).toHaveLength(0);
  });

  it("creates even with no wallet connected (session identity, not a client signature)", async () => {
    mocks.wallets = [];
    mocks.create.mockResolvedValue("str-1");
    const { result } = renderHook(() => useCreateStrategyMetadata());
    expect(await result.current.create(metadata)).toBe("str-1");
  });

  it("returns null when the write fails (expired session / API error)", async () => {
    // @rule R5 — nothing is on-chain yet, so the caller aborts + offers an inline retry.
    connectWallet();
    mocks.create.mockRejectedValue(new Error("500"));
    const { result } = renderHook(() => useCreateStrategyMetadata());
    expect(await result.current.create(metadata)).toBeNull();
  });
});

describe("useCreateStrategyMetadata.confirm", () => {
  it("POSTs the plain txHash body with NO signature and converges pending -> live", async () => {
    // @rule R3 @rule R6 — POO-868: no personal_sign on the confirm path.
    vi.useFakeTimers();
    connectWallet();
    mocks.confirm.mockResolvedValue(undefined);
    mocks.readBlocks.mockResolvedValue({ "str-1": 100 }); // indexed block >= receipt block
    const { result } = renderHook(() => useCreateStrategyMetadata());

    act(() => {
      result.current.confirm({
        strategyId: "str-1",
        txHash: "0xhash",
        blockNumber: 100,
        network: "arbitrum",
      });
    });

    // The badge shows immediately: `pending` is set synchronously, before the POST await.
    expect(result.current.confirmStatus).toBe("pending");

    // One advance flushes the confirm-POST microtasks AND runs the first convergence tick
    // (scheduled ~1.5s out); the indexed block already meets the receipt block, so it clears to live.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(result.current.confirmStatus).toBe("live");
    const [id, body] = mocks.confirm.mock.calls[0] as [string, unknown];
    expect(id).toBe("str-1");
    // POO-579: the confirm body carries `network` (DTO-required).
    expect(body).toEqual({ txHash: "0xhash", network: "arbitrum" });
    // POO-868 regression lock: the confirm path never asks the wallet for a signature.
    expect(mocks.signedMessages.some((m) => m.includes("Action: strategy.confirm"))).toBe(false);
    expect(mocks.readBlocks).toHaveBeenCalledWith(["str-1"]);
  });

  it("goes live immediately after a successful confirm when no receipt block is known", async () => {
    // @rule R6 — the [R2] fallback: no deterministic block to converge on, so clear the badge on confirm.
    connectWallet();
    mocks.confirm.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCreateStrategyMetadata());

    act(() => {
      result.current.confirm({ strategyId: "str-1", txHash: "0xhash", network: "arbitrum" });
    });

    await waitFor(() => expect(result.current.confirmStatus).toBe("live"));
    expect(mocks.readBlocks).not.toHaveBeenCalled();
  });

  it("surfaces confirmStatus 'error' when the confirm POST fails, and retry re-confirms", async () => {
    // @rule R5 — the on-chain pool exists; a non-blocking retry re-confirms without re-minting.
    connectWallet();
    mocks.confirm.mockRejectedValueOnce(new Error("gateway")).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useCreateStrategyMetadata());

    act(() => {
      result.current.confirm({ strategyId: "str-1", txHash: "0xhash", network: "arbitrum" });
    });
    await waitFor(() => expect(result.current.confirmStatus).toBe("error"));

    act(() => result.current.retryConfirm());
    await waitFor(() => expect(result.current.confirmStatus).toBe("live"));
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
  });

  it("confirms even with no wallet connected (POO-868: nothing to sign)", async () => {
    // The confirm needs no wallet interaction — a dropped wallet connection after the mint must not
    // strand the strategy in pending_onchain.
    mocks.wallets = [];
    mocks.confirm.mockResolvedValue(undefined);
    const { result } = renderHook(() => useCreateStrategyMetadata());

    act(() => {
      result.current.confirm({ strategyId: "str-1", txHash: "0xhash", network: "arbitrum" });
    });

    await waitFor(() => expect(result.current.confirmStatus).toBe("live"));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });

  it("keeps observing while the indexed block lags, then clears to live when it catches up", async () => {
    // @rule R6 — the not-yet-converged tick reschedules with backoff instead of flipping to live.
    vi.useFakeTimers();
    connectWallet();
    mocks.confirm.mockResolvedValue(undefined);
    mocks.readBlocks
      .mockResolvedValueOnce({ "str-1": 90 }) // still lagging (< 100)
      .mockResolvedValueOnce({ "str-1": 100 }); // caught up
    const { result } = renderHook(() => useCreateStrategyMetadata());

    act(() => {
      result.current.confirm({
        strategyId: "str-1",
        txHash: "0xhash",
        blockNumber: 100,
        network: "arbitrum",
      });
    });

    // First tick (~1.5s): lagging → still pending, a second observation is scheduled with backoff.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(result.current.confirmStatus).toBe("pending");

    // Second tick (~3s backoff): the indexed block reached the receipt block → live.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3200);
    });
    expect(result.current.confirmStatus).toBe("live");
    expect(mocks.readBlocks).toHaveBeenCalledTimes(2);
  });

  it("observes through a failed read (never throws) and still converges", async () => {
    // @rule R6 — observe-only: a failed read is "no progress this tick"; the poll continues.
    vi.useFakeTimers();
    connectWallet();
    mocks.confirm.mockResolvedValue(undefined);
    mocks.readBlocks
      .mockRejectedValueOnce(new Error("network")) // failed read → treated as no progress
      .mockResolvedValueOnce({ "str-1": 100 }); // then converged
    const { result } = renderHook(() => useCreateStrategyMetadata());

    act(() => {
      result.current.confirm({
        strategyId: "str-1",
        txHash: "0xhash",
        blockNumber: 100,
        network: "arbitrum",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(result.current.confirmStatus).toBe("pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3200);
    });
    expect(result.current.confirmStatus).toBe("live");
  });

  it("cancels the convergence poll on unmount (no further observations)", async () => {
    // The cleanup bumps the run id + clears timers so a superseded/unmounted tick never fires.
    vi.useFakeTimers();
    connectWallet();
    mocks.confirm.mockResolvedValue(undefined);
    mocks.readBlocks.mockResolvedValue({ "str-1": 50 }); // never reaches the receipt block
    const { result, unmount } = renderHook(() => useCreateStrategyMetadata());

    act(() => {
      result.current.confirm({
        strategyId: "str-1",
        txHash: "0xhash",
        blockNumber: 100,
        network: "arbitrum",
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600); // one tick (still lagging), reschedules
    });
    expect(mocks.readBlocks).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000); // no more ticks run after unmount
    });
    expect(mocks.readBlocks).toHaveBeenCalledTimes(1);
  });

  it("retryConfirm is a no-op before any confirm", () => {
    connectWallet();
    const { result } = renderHook(() => useCreateStrategyMetadata());
    act(() => result.current.retryConfirm());
    expect(result.current.confirmStatus).toBe("idle");
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("ignores a stale confirm success once a newer confirm has superseded it", async () => {
    // A superseded first POST must not flip status back after a newer confirm won the race.
    connectWallet();
    let resolveFirst!: () => void;
    mocks.confirm
      .mockImplementationOnce(() => new Promise<void>((res) => (resolveFirst = res)))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useCreateStrategyMetadata());

    act(() => result.current.confirm({ strategyId: "s1", txHash: "0x1", network: "arbitrum" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    act(() => result.current.confirm({ strategyId: "s2", txHash: "0x2", network: "arbitrum" }));
    await waitFor(() => expect(result.current.confirmStatus).toBe("live"));

    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    expect(result.current.confirmStatus).toBe("live");
  });

  it("ignores a stale confirm error once a newer confirm has superseded it", async () => {
    // A superseded first POST that later REJECTS must not flip status to error.
    connectWallet();
    let rejectFirst!: (error: Error) => void;
    mocks.confirm
      .mockImplementationOnce(() => new Promise<void>((_res, rej) => (rejectFirst = rej)))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useCreateStrategyMetadata());

    act(() => result.current.confirm({ strategyId: "s1", txHash: "0x1", network: "arbitrum" }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    act(() => result.current.confirm({ strategyId: "s2", txHash: "0x2", network: "arbitrum" }));
    await waitFor(() => expect(result.current.confirmStatus).toBe("live"));

    await act(async () => {
      rejectFirst(new Error("late"));
      await Promise.resolve();
    });
    expect(result.current.confirmStatus).toBe("live");
  });
});
