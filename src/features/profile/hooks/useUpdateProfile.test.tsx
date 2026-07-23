/**
 * @id PP-PROF-HOOK-001 (POO-233 R4, POO-426, POO-637)
 * @name useUpdateProfile tests
 * @implements-rules-version v1
 *
 * The profile-save resolver switches on `isMockMode` at call time:
 *
 * - Mock mode forwards the patch to the mock service action and never touches Privy/wagmi (mirrors
 *   the "Privy hooks never run when the provider is absent" design — asserted by checking the wallet
 *   hooks stay uncalled).
 * - Real mode signs the canonical POO-637 message for the `profile.update` action with the connected
 *   wallet (`personal_sign`) and forwards the exact signed body to `updateMyProfileAction`. Covers the
 *   load-bearing wiring no other test exercises: the `profile.update` action literal, signed-body ===
 *   forwarded-body, wallet selection (address match / `wallets[0]` fallback), the network fallback, the
 *   `personal_sign` param order `[message, address]`, and the three guard throws.
 *
 * Mirrors `rewards/hooks/rewardsWriteHooksReal.test.tsx` (the in-repo precedent for a real-mode signed
 * write hook). `signWrite` + `buildProfileWriteBody` run for real so the signed message is asserted
 * end-to-end; only the wallet provider, the chain resolver, and the actions are mocked.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProfileWriteBody } from "@/lib/profile/buildProfileWriteBody";

const mocks = vi.hoisted(() => ({
  isMockMode: false,
  address: "0xWALLET" as string | undefined,
  chainId: 137,
  wallets: [] as Array<{ address: string; getEthereumProvider: () => Promise<unknown> }>,
  apiNetworkForChain: vi.fn<(id: number) => string | undefined>(),
  useWallets: vi.fn(() => ({ wallets: mocks.wallets })),
  useChainId: vi.fn(() => mocks.chainId),
  updateProfileAction: vi.fn(),
  updateMyProfileAction: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return mocks.isMockMode;
  },
}));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.address }) }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => mocks.useWallets() }));
vi.mock("wagmi", () => ({ useChainId: () => mocks.useChainId() }));
vi.mock("@/lib/chains/config", () => ({
  apiNetworkForChain: (id: number) => mocks.apiNetworkForChain(id),
  defaultChain: { id: 8453 },
}));
vi.mock("../actions", () => ({
  updateProfileAction: mocks.updateProfileAction,
  updateMyProfileAction: mocks.updateMyProfileAction,
}));

import { SIGNED_WRITE_HEADERS } from "@/lib/auth/signedWrite";
import { useUpdateProfile } from "./useUpdateProfile";

/** A wallet whose provider signs with `signature`, recording the `personal_sign` call for assertions. */
function walletThatSigns(address: string, signature: string) {
  const request = vi.fn(async (_arg: { method: string; params: [string, string] }) => signature);
  return {
    request,
    wallet: { address, getEthereumProvider: async () => ({ request }) },
  };
}

/** The headers passed to `updateMyProfileAction` on its first call. */
function forwardedHeaders(): Record<string, string> {
  const call = mocks.updateMyProfileAction.mock.calls[0];
  if (!call) throw new Error("updateMyProfileAction was not called");
  return (call[0] as { headers: Record<string, string> }).headers;
}

/** The body passed to `updateMyProfileAction` on its first call. */
function forwardedBody(): unknown {
  const call = mocks.updateMyProfileAction.mock.calls[0];
  if (!call) throw new Error("updateMyProfileAction was not called");
  return (call[0] as { body: unknown }).body;
}

beforeEach(() => {
  mocks.isMockMode = false;
  mocks.address = "0xWALLET";
  mocks.chainId = 137;
  mocks.wallets = [];
  mocks.apiNetworkForChain.mockReset();
  mocks.apiNetworkForChain.mockImplementation((id) =>
    id === 137 ? "polygon" : id === 8453 ? "base" : undefined,
  );
  mocks.useWallets.mockClear();
  mocks.useChainId.mockClear();
  mocks.updateProfileAction.mockReset();
  mocks.updateMyProfileAction.mockReset();
});

describe("useUpdateProfile (real mode)", () => {
  it("[R4] signs the profile.update message and forwards the exact signed body", async () => {
    const { request, wallet } = walletThatSigns("0xWALLET", "0xsignature");
    mocks.wallets = [wallet];
    mocks.updateMyProfileAction.mockResolvedValueOnce({ name: "Ana Invests" });

    const { result } = renderHook(() => useUpdateProfile());
    const patch = { name: "Ana Invests", email: "ana@b.com", country: "US" };
    const out = await result.current(patch);

    // country has no backend target, so the signed body is the mapped write body (displayName+email).
    const body = buildProfileWriteBody(patch);

    // personal_sign param order is [message, address], and the message carries the profile.update
    // action + the sha256 of the exact body that is forwarded (signed-body === forwarded-body).
    expect(request).toHaveBeenCalledTimes(1);
    const arg = request.mock.calls[0]?.[0];
    if (!arg) throw new Error("wallet was not asked to sign");
    expect(arg.method).toBe("personal_sign");
    const [message, signer] = arg.params;
    expect(signer).toBe("0xWALLET");
    expect(message).toContain("Action: profile.update");

    expect(forwardedBody()).toEqual(body);
    expect(forwardedHeaders()).toMatchObject({
      [SIGNED_WRITE_HEADERS.WALLET]: "0xWALLET",
      [SIGNED_WRITE_HEADERS.SIGNATURE]: "0xsignature",
      [SIGNED_WRITE_HEADERS.NETWORK]: "polygon",
    });
    expect(forwardedHeaders()[SIGNED_WRITE_HEADERS.NONCE]).toBeTruthy();
    expect(forwardedHeaders()[SIGNED_WRITE_HEADERS.TIMESTAMP]).toBeTruthy();
    expect(out).toEqual({ name: "Ana Invests" });
  });

  it("prefers the wallet whose address matches the connected account (case-insensitive)", async () => {
    const other = walletThatSigns("0xOTHER", "0xother");
    const match = walletThatSigns("0xwallet", "0xmatch"); // lowercase, still matches 0xWALLET
    mocks.wallets = [other.wallet, match.wallet];
    mocks.updateMyProfileAction.mockResolvedValueOnce({});

    const { result } = renderHook(() => useUpdateProfile());
    await result.current({ name: "Ana" });

    expect(match.request).toHaveBeenCalledTimes(1);
    expect(other.request).not.toHaveBeenCalled();
    expect(forwardedHeaders()[SIGNED_WRITE_HEADERS.SIGNATURE]).toBe("0xmatch");
  });

  it("falls back to wallets[0] when no wallet matches the connected account", async () => {
    const first = walletThatSigns("0xAAA", "0xfirst");
    const second = walletThatSigns("0xBBB", "0xsecond");
    mocks.address = "0xZZZ"; // matches neither
    mocks.wallets = [first.wallet, second.wallet];
    mocks.updateMyProfileAction.mockResolvedValueOnce({});

    const { result } = renderHook(() => useUpdateProfile());
    await result.current({ name: "Ana" });

    expect(first.request).toHaveBeenCalledTimes(1);
    expect(second.request).not.toHaveBeenCalled();
  });

  it("falls back to the default network when the active chain is unsupported", async () => {
    const { wallet } = walletThatSigns("0xWALLET", "0xsig");
    mocks.chainId = 1; // mainnet: unsupported -> apiNetworkForChain(1) is undefined
    mocks.wallets = [wallet];
    mocks.updateMyProfileAction.mockResolvedValueOnce({});

    const { result } = renderHook(() => useUpdateProfile());
    await result.current({ name: "Ana" });

    expect(mocks.apiNetworkForChain).toHaveBeenCalledWith(1);
    expect(mocks.apiNetworkForChain).toHaveBeenCalledWith(8453);
    expect(forwardedHeaders()[SIGNED_WRITE_HEADERS.NETWORK]).toBe("base");
  });

  it("throws when no wallet is connected", async () => {
    mocks.address = undefined;
    const { result } = renderHook(() => useUpdateProfile());
    await expect(result.current({ name: "Ana" })).rejects.toThrow("no connected wallet");
    expect(mocks.updateMyProfileAction).not.toHaveBeenCalled();
  });

  it("throws when the connected account has no wallet provider", async () => {
    mocks.wallets = [];
    const { result } = renderHook(() => useUpdateProfile());
    await expect(result.current({ name: "Ana" })).rejects.toThrow("no wallet provider");
    expect(mocks.updateMyProfileAction).not.toHaveBeenCalled();
  });

  it("throws when no supported network resolves for signing", async () => {
    const { request, wallet } = walletThatSigns("0xWALLET", "0xsig");
    mocks.apiNetworkForChain.mockReturnValue(undefined); // neither active nor default resolves
    mocks.wallets = [wallet];

    const { result } = renderHook(() => useUpdateProfile());
    await expect(result.current({ name: "Ana" })).rejects.toThrow("no supported network");
    expect(request).not.toHaveBeenCalled(); // throws before signing
    expect(mocks.updateMyProfileAction).not.toHaveBeenCalled();
  });
});

describe("useUpdateProfile (mock mode)", () => {
  beforeEach(() => {
    mocks.isMockMode = true;
  });

  it("forwards the patch to the mock service action without signing or touching Privy/wagmi", async () => {
    mocks.updateProfileAction.mockResolvedValueOnce({ name: "Ana" });
    const patch = { name: "Ana", email: "ana@b.com", country: "US" };

    const { result } = renderHook(() => useUpdateProfile());
    const out = await result.current(patch);

    expect(mocks.updateProfileAction).toHaveBeenCalledWith(patch);
    expect(mocks.updateMyProfileAction).not.toHaveBeenCalled();
    // The whole point of the split: mock mode never resolves the connected wallet.
    expect(mocks.useWallets).not.toHaveBeenCalled();
    expect(mocks.useChainId).not.toHaveBeenCalled();
    expect(out).toEqual({ name: "Ana" });
  });
});
