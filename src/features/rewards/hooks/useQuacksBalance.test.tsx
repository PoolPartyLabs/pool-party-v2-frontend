/**
 * @id PP-CORE-HOK-014 (POO-209)
 * @name useQuacksBalance tests
 * @implements-rules-version v1
 *
 * Mock mode: the hook loads the Quacks balance from getQuacksBalanceAction immediately (no SIWE
 * gate) and falls back to 0 on failure. Real mode: it waits on the SIWE session, returning null
 * while the handshake is pending (no wallet yet) and 0 once it errors, and the action value once
 * the wallet is signed in.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiweSession } from "@/lib/auth/useSiweSession";

const mocks = vi.hoisted(() => ({
  getQuacks: vi.fn(),
  isMockMode: true,
  session: { status: "idle", isSignedIn: false, error: null } as SiweSession,
}));

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.isMockMode;
  },
}));
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => mocks.session,
}));
vi.mock("../actions", () => ({ getQuacksBalanceAction: mocks.getQuacks }));

import { useQuacksBalance } from "./useQuacksBalance";

afterEach(() => {
  mocks.getQuacks.mockReset();
  mocks.isMockMode = true;
  mocks.session = { status: "idle", isSignedIn: false, error: null };
});

describe("useQuacksBalance (mock mode)", () => {
  it("loads the real Quacks balance from the action", async () => {
    mocks.getQuacks.mockResolvedValueOnce(15_021);
    const { result } = renderHook(() => useQuacksBalance());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(15_021));
  });

  it("falls back to 0 when the action fails", async () => {
    mocks.getQuacks.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useQuacksBalance());
    await waitFor(() => expect(result.current).toBe(0));
  });
});

describe("useQuacksBalance (real mode)", () => {
  it("stays null while the SIWE session is still resolving (no wallet yet)", async () => {
    mocks.isMockMode = false;
    mocks.session = { status: "signing", isSignedIn: false, error: null };
    const { result } = renderHook(() => useQuacksBalance());
    expect(result.current).toBeNull();
    // No fetch is attempted before the wallet is known.
    expect(mocks.getQuacks).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("returns 0 when the SIWE handshake errors, without fetching", async () => {
    mocks.isMockMode = false;
    mocks.session = { status: "error", isSignedIn: false, error: new Error("siwe") };
    const { result } = renderHook(() => useQuacksBalance());
    await waitFor(() => expect(result.current).toBe(0));
    expect(mocks.getQuacks).not.toHaveBeenCalled();
  });

  it("fetches the balance once the wallet is signed in", async () => {
    mocks.isMockMode = false;
    mocks.session = { status: "signed-in", isSignedIn: true, error: null };
    mocks.getQuacks.mockResolvedValueOnce(15_021);
    const { result } = renderHook(() => useQuacksBalance());
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(15_021));
    expect(mocks.getQuacks).toHaveBeenCalledTimes(1);
  });

  it("falls back to 0 when the signed-in fetch fails", async () => {
    mocks.isMockMode = false;
    mocks.session = { status: "signed-in", isSignedIn: true, error: null };
    mocks.getQuacks.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useQuacksBalance());
    await waitFor(() => expect(result.current).toBe(0));
  });
});
