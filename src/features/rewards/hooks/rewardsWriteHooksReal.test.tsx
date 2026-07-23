/**
 * @id PP-REW (POO-210)
 * @name Rewards write hooks tests (real branch)
 * @implements-rules-version v1
 *
 * [R2] In real mode useSayQuack signs the exact daily message with the connected
 * wallet (Privy personal_sign) and forwards it to the action; usePlayDuckShoot
 * forwards the connected address. Covers the no-wallet / rejected-signature paths.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyQuackMessage, todayUtc } from "@/lib/rewards/quackMessage";

const mocks = vi.hoisted(() => ({
  address: "0xWALLET" as string | undefined,
  wallets: [] as Array<{ address: string; getEthereumProvider: () => Promise<unknown> }>,
  request: vi.fn(),
  sayQuackAction: vi.fn(),
  playDuckShootAction: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false, rewardsService: {} }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.address }) }));
vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("../actions", () => ({
  sayQuackAction: mocks.sayQuackAction,
  playDuckShootAction: mocks.playDuckShootAction,
}));

import { usePlayDuckShoot } from "./usePlayDuckShoot";
import { useSayQuack } from "./useSayQuack";

function connectWallet() {
  mocks.wallets = [
    { address: "0xWALLET", getEthereumProvider: async () => ({ request: mocks.request }) },
  ];
}

describe("useSayQuack (real mode)", () => {
  beforeEach(() => {
    mocks.address = "0xWALLET";
    mocks.wallets = [];
    mocks.request.mockReset();
    mocks.sayQuackAction.mockReset();
  });

  it("[R2] signs the exact message and forwards the signed payload", async () => {
    connectWallet();
    mocks.request.mockResolvedValueOnce("0xsignature");
    mocks.sayQuackAction.mockResolvedValueOnce({ status: "awarded", quacksAwarded: 10 });
    const { result } = renderHook(() => useSayQuack());

    const out = await result.current.sayQuack();

    const date = todayUtc();
    expect(mocks.request).toHaveBeenCalledWith({
      method: "personal_sign",
      params: [buildDailyQuackMessage("0xWALLET", date), "0xWALLET"],
    });
    expect(mocks.sayQuackAction).toHaveBeenCalledWith({
      wallet: "0xWALLET",
      signature: "0xsignature",
      date,
    });
    expect(out).toEqual({ status: "awarded", quacksAwarded: 10 });
  });

  it("returns error when no wallet is connected", async () => {
    mocks.address = undefined;
    const { result } = renderHook(() => useSayQuack());
    expect(await result.current.sayQuack()).toEqual({ status: "error" });
    expect(mocks.sayQuackAction).not.toHaveBeenCalled();
  });

  it("returns error when the user rejects the signature", async () => {
    connectWallet();
    mocks.request.mockRejectedValueOnce(new Error("user rejected"));
    const { result } = renderHook(() => useSayQuack());
    expect(await result.current.sayQuack()).toEqual({ status: "error" });
    expect(mocks.sayQuackAction).not.toHaveBeenCalled();
  });
});

describe("usePlayDuckShoot (real mode)", () => {
  beforeEach(() => {
    mocks.address = "0xWALLET";
    mocks.playDuckShootAction.mockReset();
  });

  it("[R3] forwards the connected address to the action", async () => {
    mocks.playDuckShootAction.mockResolvedValueOnce({ status: "no_tries" });
    const { result } = renderHook(() => usePlayDuckShoot());

    const out = await result.current.play();

    expect(mocks.playDuckShootAction).toHaveBeenCalledWith("0xWALLET");
    expect(out).toEqual({ status: "no_tries" });
  });

  it("returns error when no wallet is connected", async () => {
    mocks.address = undefined;
    const { result } = renderHook(() => usePlayDuckShoot());
    expect(await result.current.play()).toEqual({ status: "error" });
    expect(mocks.playDuckShootAction).not.toHaveBeenCalled();
  });
});
