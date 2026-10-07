/**
 * @id PP-CORE-LIB-125
 * @name solanaPreviewStore tests
 * @implements-rules-version v2 (POO-2281)
 * @analytics-events none, store and lifecycle tests.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetSolanaPreviewForTests,
  captureSolanaPreviewExit,
  registerSolanaPreviewHost,
  requestSolanaPreview,
  useSolanaPreviewMode,
} from "./solanaPreviewStore";

afterEach(__resetSolanaPreviewForTests);

function reveal(guard: (proceed: () => void) => void = (proceed) => proceed()) {
  for (const now of [0, 200, 400]) requestSolanaPreview(guard, now);
}

describe("route-scoped local Solana preview", () => {
  // @rule R1: selected presses outside the builder have no registered host.
  it("does nothing without a builder host", () => {
    const guard = vi.fn();
    const { result } = renderHook(useSolanaPreviewMode);
    reveal(guard);
    expect(guard).not.toHaveBeenCalled();
    expect(result.current).toBe("standard");
  });

  // @rule R1/R3: siblings share one in-memory mode, not an EVM storage key.
  it("notifies both readers only after the third press without writing storage", () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    registerSolanaPreviewHost("account-a");
    const first = renderHook(useSolanaPreviewMode);
    const second = renderHook(useSolanaPreviewMode);
    act(() => requestSolanaPreview((proceed) => proceed(), 0));
    act(() => requestSolanaPreview((proceed) => proceed(), 200));
    expect(first.result.current).toBe("standard");
    act(() => requestSolanaPreview((proceed) => proceed(), 400));
    expect(first.result.current).toBe("v2-solana");
    expect(second.result.current).toBe("v2-solana");
    expect(write).not.toHaveBeenCalled();
  });

  // @rule R2: no personal account allowlist or API is needed.
  it.each(["account-a", "account-b", "signed-out"])("allows local editing for %s", (key) => {
    registerSolanaPreviewHost(key);
    const { result } = renderHook(useSolanaPreviewMode);
    act(() => reveal());
    expect(result.current).toBe("v2-solana");
  });

  // @rule R4: only the existing navigation guard can accept the third press.
  it("waits for confirmation, clears the burst after Stay and activates on fresh Leave", () => {
    registerSolanaPreviewHost("account-a");
    const { result } = renderHook(useSolanaPreviewMode);
    const callbacks: (() => void)[] = [];
    const guard = (proceed: () => void) => callbacks.push(proceed);
    act(() => reveal(guard));
    expect(result.current).toBe("standard");
    act(() => requestSolanaPreview(guard, 500));
    act(() => requestSolanaPreview(guard, 600));
    expect(callbacks).toHaveLength(1);
    act(() => requestSolanaPreview(guard, 700));
    act(() => callbacks[0]?.());
    expect(result.current).toBe("standard");
    act(() => callbacks[1]?.());
    expect(result.current).toBe("v2-solana");
  });

  // @rule R4: an old route/account cannot activate a new host after delayed Leave.
  it("invalidates pending confirmation when the account or route host changes", () => {
    const cleanup = registerSolanaPreviewHost("account-a");
    let pending: (() => void) | undefined;
    reveal((proceed) => {
      pending = proceed;
    });
    cleanup();
    registerSolanaPreviewHost("account-b");
    const { result } = renderHook(useSolanaPreviewMode);
    act(() => pending?.());
    expect(result.current).toBe("standard");
    act(() => reveal());
    expect(result.current).toBe("v2-solana");
  });

  // @rule R4: an obsolete cleanup cannot close the new host.
  it("resets on unmount and ignores a previous host cleanup", () => {
    const oldCleanup = registerSolanaPreviewHost("account-a");
    const cleanup = registerSolanaPreviewHost("account-b");
    const { result } = renderHook(useSolanaPreviewMode);
    act(() => reveal());
    act(oldCleanup);
    expect(result.current).toBe("v2-solana");
    act(cleanup);
    expect(result.current).toBe("standard");
  });

  // @rule R4: explicit exit is also generation-scoped and clears the gesture.
  it("exits the current preview and rejects a stale exit callback", () => {
    registerSolanaPreviewHost("account-a");
    const { result } = renderHook(useSolanaPreviewMode);
    act(() => reveal());
    const leave = captureSolanaPreviewExit();
    act(() => leave());
    expect(result.current).toBe("standard");
    const stale = captureSolanaPreviewExit();
    registerSolanaPreviewHost("account-b");
    act(() => reveal());
    act(stale);
    expect(result.current).toBe("v2-solana");
  });
});
