/**
 * @id PP-AUTH-CMP-003
 * @name EmbeddedWalletActivator tests
 * @implements-rules-version v1
 *
 * POO-1003: after an external wallet (Rabby) is disconnected and the user logs in with Google,
 * Privy authenticates but wagmi never surfaces the embedded wallet as the active account, so the
 * app hangs on skeleton loading forever. The activator binds the Privy embedded wallet as wagmi's
 * active account via useSetActiveWallet whenever it exists and wagmi is not already on it.
 *
 * The critical guard for [R2]: the activator only ever acts when an embedded (walletClientType
 * "privy") wallet is present, so external-only sessions (Rabby et al.) are never touched — they
 * connect, disconnect and reconnect through the unchanged Privy/wagmi path.
 */
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TestWallet = { address: string; walletClientType: string };

const mocks = vi.hoisted(() => ({
  authenticated: true,
  ready: true,
  wallets: [] as TestWallet[],
  address: undefined as `0x${string}` | undefined,
  setActiveWallet: vi.fn(async (_wallet: TestWallet) => {}),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ authenticated: mocks.authenticated }),
  // Fresh array reference each render to mirror Privy rebuilding its context every render (POO-899);
  // the activator's one-shot latch must survive that churn without re-firing.
  useWallets: () => ({ wallets: [...mocks.wallets], ready: mocks.ready }),
}));
vi.mock("@privy-io/wagmi", () => ({
  useSetActiveWallet: () => ({ setActiveWallet: mocks.setActiveWallet }),
}));
vi.mock("wagmi", () => ({ useAccount: () => ({ address: mocks.address }) }));

import { EmbeddedWalletActivator, shouldActivateEmbeddedWallet } from "./EmbeddedWalletActivator";

const EMBEDDED: TestWallet = {
  address: "0xEEee567890123456789012345678901234567890",
  walletClientType: "privy",
};
const EXTERNAL: TestWallet = {
  address: "0xAbCd567890123456789012345678901234567890",
  walletClientType: "injected",
};

/** Flush the activator's async setActiveWallet chain. */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("shouldActivateEmbeddedWallet [R2]", () => {
  it("does not activate when there is no embedded wallet", () => {
    expect(shouldActivateEmbeddedWallet(undefined, undefined)).toBe(false);
    expect(shouldActivateEmbeddedWallet(undefined, "0xA")).toBe(false);
  });

  it("activates when the embedded wallet exists but wagmi is on no account (the stuck state)", () => {
    expect(shouldActivateEmbeddedWallet(EMBEDDED.address, undefined)).toBe(true);
  });

  it("activates when wagmi is on a different (stale external) account", () => {
    expect(shouldActivateEmbeddedWallet(EMBEDDED.address, EXTERNAL.address)).toBe(true);
  });

  it("does not activate when wagmi is already on the embedded wallet", () => {
    expect(shouldActivateEmbeddedWallet(EMBEDDED.address, EMBEDDED.address)).toBe(false);
  });

  it("treats a casing-only difference as already active", () => {
    expect(shouldActivateEmbeddedWallet(EMBEDDED.address, EMBEDDED.address.toLowerCase())).toBe(
      false,
    );
  });
});

describe("EmbeddedWalletActivator", () => {
  beforeEach(() => {
    mocks.authenticated = true;
    mocks.ready = true;
    mocks.wallets = [];
    mocks.address = undefined;
    mocks.setActiveWallet.mockClear();
    mocks.setActiveWallet.mockImplementation(async () => {});
  });

  // @rule R2 - the reported bug: Google after a Rabby disconnect leaves wagmi on no account.
  it("[R2] activates the embedded wallet when it exists but wagmi is not connected to it", async () => {
    mocks.wallets = [EMBEDDED];
    mocks.address = undefined;
    render(<EmbeddedWalletActivator />);
    await waitFor(() => expect(mocks.setActiveWallet).toHaveBeenCalledTimes(1));
    expect(mocks.setActiveWallet).toHaveBeenCalledWith(EMBEDDED);
  });

  // @rule R2 - a stale external account still owning wagmi is corrected to the embedded wallet.
  it("[R2] activates the embedded wallet when wagmi is on a stale external account", async () => {
    mocks.wallets = [EMBEDDED];
    mocks.address = EXTERNAL.address as `0x${string}`;
    render(<EmbeddedWalletActivator />);
    await waitFor(() => expect(mocks.setActiveWallet).toHaveBeenCalledWith(EMBEDDED));
  });

  // @rule R2 - once wagmi is already on the embedded wallet there is nothing to do (no loop).
  it("[R2] does nothing when wagmi is already on the embedded wallet", async () => {
    mocks.wallets = [EMBEDDED];
    mocks.address = EMBEDDED.address as `0x${string}`;
    render(<EmbeddedWalletActivator />);
    await flush();
    expect(mocks.setActiveWallet).not.toHaveBeenCalled();
  });

  // @rule R2 - THE Rabby guarantee: an external-only session has no embedded wallet, so the
  // activator must never touch it. Rabby connects/disconnects through the unchanged path.
  it("[R2] never touches an external-only session (no embedded wallet present)", async () => {
    mocks.wallets = [EXTERNAL];
    mocks.address = EXTERNAL.address as `0x${string}`;
    render(<EmbeddedWalletActivator />);
    await flush();
    expect(mocks.setActiveWallet).not.toHaveBeenCalled();
  });

  // @rule R2 - external wallet connected, no embedded created (createOnLogin users-without-wallets).
  it("[R2] does nothing while an external wallet is connecting and no embedded wallet exists", async () => {
    mocks.wallets = [EXTERNAL];
    mocks.address = undefined;
    render(<EmbeddedWalletActivator />);
    await flush();
    expect(mocks.setActiveWallet).not.toHaveBeenCalled();
  });

  // @rule R2 - do not act before Privy has authenticated.
  it("[R2] does nothing when not authenticated", async () => {
    mocks.authenticated = false;
    mocks.wallets = [EMBEDDED];
    mocks.address = undefined;
    render(<EmbeddedWalletActivator />);
    await flush();
    expect(mocks.setActiveWallet).not.toHaveBeenCalled();
  });

  // @rule R2 - wait until Privy's wallet list is ready before reading it.
  it("[R2] does nothing until the wallet list is ready", async () => {
    mocks.ready = false;
    mocks.wallets = [EMBEDDED];
    mocks.address = undefined;
    render(<EmbeddedWalletActivator />);
    await flush();
    expect(mocks.setActiveWallet).not.toHaveBeenCalled();
  });

  // @rule R2 - a failed activation must not wedge the guard; it clears its in-flight latch so a
  // later render can retry (the embedded connector may not have been registered on the first pass).
  it("[R2] retries after a failed activation attempt", async () => {
    mocks.wallets = [EMBEDDED];
    mocks.address = undefined;
    mocks.setActiveWallet.mockRejectedValueOnce(new Error("connector not ready"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<EmbeddedWalletActivator />);
    await waitFor(() => expect(mocks.setActiveWallet).toHaveBeenCalledTimes(1));
    // A subsequent render (Privy churns the wallets identity every render) re-attempts.
    rerender(<EmbeddedWalletActivator />);
    await waitFor(() => expect(mocks.setActiveWallet).toHaveBeenCalledTimes(2));
    errorSpy.mockRestore();
  });
});
