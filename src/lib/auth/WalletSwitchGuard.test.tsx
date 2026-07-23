/**
 * @id PP-AUTH-CMP-002
 * @name WalletSwitchGuard tests
 * @implements-rules-version v1
 *
 * POO-892: [R1] the switch predicate fires only on a genuine A-to-B address flip (first connect,
 * disconnect and an unchanged address never trigger); [R2] a switch clears the stale SIWE session
 * then redirects to home with a fresh RSC render; [R3] a rejected re-SIWE handshake forces a clean
 * logout to /sign-in instead of the stuck blank state.
 */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SiweStatus = "idle" | "signing" | "signed-in" | "error";

const mocks = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  status: "idle" as "idle" | "signing" | "signed-in" | "error",
  push: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  signOut: vi.fn(async () => {}),
}));

vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address }) }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/features/auth/siweActions", () => ({ signOutAction: mocks.signOut }));
vi.mock("./useSiweSession", () => ({
  useSiweSession: () => ({
    status: mocks.status,
    isSignedIn: mocks.status === "signed-in",
    error: null,
  }),
}));
vi.mock("./useAuth", () => ({ useAuth: () => ({ logout: mocks.logout }) }));

import { isWalletSwitch, WalletSwitchGuard } from "./WalletSwitchGuard";

/** Flush the guard's async signOut-then-navigate chain. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("isWalletSwitch [R1]", () => {
  it("does not fire on the first connect (prev null)", () => {
    expect(isWalletSwitch(null, "0xA")).toBe(false);
  });

  it("does not fire on a disconnect (next null)", () => {
    expect(isWalletSwitch("0xA", null)).toBe(false);
  });

  it("does not fire while both sides are disconnected", () => {
    expect(isWalletSwitch(null, null)).toBe(false);
  });

  it("fires on a genuine A-to-B flip", () => {
    expect(isWalletSwitch("0xA", "0xB")).toBe(true);
  });

  it("does not fire on an unchanged address (embedded wallets cannot switch)", () => {
    expect(isWalletSwitch("0xA", "0xA")).toBe(false);
  });

  it("treats a casing-only difference as the same wallet", () => {
    expect(isWalletSwitch("0xAbC1", "0xabc1")).toBe(false);
  });
});

describe("WalletSwitchGuard", () => {
  beforeEach(() => {
    mocks.address = undefined;
    mocks.status = "idle";
    mocks.push.mockClear();
    mocks.refresh.mockClear();
    mocks.logout.mockClear();
    mocks.signOut.mockClear();
    mocks.signOut.mockImplementation(async () => {});
  });

  function setAddress(rerender: (ui: React.ReactElement) => void, address?: `0x${string}`) {
    mocks.address = address;
    rerender(<WalletSwitchGuard />);
  }

  function setStatus(rerender: (ui: React.ReactElement) => void, status: SiweStatus) {
    mocks.status = status;
    rerender(<WalletSwitchGuard />);
  }

  // @rule POO-892 R1 - first connect must not trigger the guard.
  it("[R1] does nothing on the first connect", async () => {
    const { rerender } = render(<WalletSwitchGuard />);
    setAddress(rerender, "0xA");
    await flush();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  // @rule POO-892 R1 - disconnect stays with AuthGuard, the guard must not react.
  it("[R1] does nothing on a disconnect", async () => {
    const { rerender } = render(<WalletSwitchGuard />);
    setAddress(rerender, "0xA");
    setAddress(rerender, undefined);
    await flush();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  // @rule POO-892 R1 - a reconnect after a disconnect is a fresh connect, not a switch.
  it("[R1] does nothing when a different wallet connects after a disconnect", async () => {
    const { rerender } = render(<WalletSwitchGuard />);
    setAddress(rerender, "0xA");
    setAddress(rerender, undefined);
    setAddress(rerender, "0xB");
    await flush();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  // @rule POO-892 R2 - switch kills the stale Bearer, then localized home + fresh RSC.
  it("[R1/R2] on an A-to-B switch clears the session, then redirects home and refreshes", async () => {
    const { rerender } = render(<WalletSwitchGuard />);
    setAddress(rerender, "0xA");
    setAddress(rerender, "0xB");
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    // The stale cookie dies before the fresh RSC render is requested.
    expect(Number(mocks.signOut.mock.invocationCallOrder[0])).toBeLessThan(
      Number(mocks.push.mock.invocationCallOrder[0]),
    );
    // A switch is not a logout: wallet B stays connected for the re-SIWE handshake.
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  // @rule POO-892 R2 - a failing session clear must not block the redirect.
  it("[R2] still redirects home when the session clear fails", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("network"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<WalletSwitchGuard />);
    setAddress(rerender, "0xA");
    setAddress(rerender, "0xB");
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  // @rule POO-892 R3 - a rejected handshake forces a clean logout, never a stuck blank state.
  it("[R3] forces logout to /sign-in when the SIWE handshake errors", async () => {
    mocks.address = "0xB";
    const { rerender } = render(<WalletSwitchGuard />);
    setStatus(rerender, "signing");
    setStatus(rerender, "error");
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/sign-in"));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    // The stale cookie (wallet A's session) dies with the forced logout.
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  // @rule POO-892 R3 - only the error status forces the logout.
  it("[R3] does not force logout while signing or once signed in", async () => {
    mocks.address = "0xB";
    const { rerender } = render(<WalletSwitchGuard />);
    setStatus(rerender, "signing");
    setStatus(rerender, "signed-in");
    await flush();
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
