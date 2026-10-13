import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { useManagerSolanaWallet } from "./useManagerSolanaWallet";

const state = vi.hoisted(() => ({
  enabled: true,
  wallets: [{ address: "11111111111111111111111111111111" }],
  evmWallet: { address: "0x1111111111111111111111111111111111111111" },
  connect: vi.fn(),
  signMessage: vi.fn(),
  signTransaction: vi.fn(),
}));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => state.enabled }),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ connectWallet: state.connect }),
  useWallets: () => ({ wallets: [state.evmWallet] }),
}));
vi.mock("@privy-io/react-auth/solana", () => ({
  useWallets: () => ({ wallets: state.wallets, ready: true }),
  useSignMessage: () => ({ signMessage: state.signMessage }),
  useSignTransaction: () => ({ signTransaction: state.signTransaction }),
}));
vi.mock("@solana/kit", () => ({
  address: (value: string) => value,
  createSolanaRpc: () => ({
    getBalance: () => ({ send: async () => ({ value: BigInt(1000) }) }),
  }),
}));
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  state.enabled = true;
  state.wallets = [{ address: "11111111111111111111111111111111" }];
  vi.clearAllMocks();
});
it("exposes the Solana signer without changing the connected EVM account", () => {
  const { result } = renderHook(() => useManagerSolanaWallet(), { wrapper });
  expect(result.current.address).toBe(state.wallets[0]?.address);
  result.current.connect();
  expect(state.connect).toHaveBeenCalledWith({ walletChainType: "solana-only" });
  expect(state.evmWallet.address).toBe("0x1111111111111111111111111111111111111111");
});
it("requires the exact bound key on resume", async () => {
  const { result } = renderHook(() => useManagerSolanaWallet("different-key"), { wrapper });
  expect(result.current.address).toBeNull();
  await expect(result.current.signMessage(new Uint8Array())).rejects.toThrow(
    "SOLANA_WALLET_REQUIRED",
  );
});
it("disables connect and signing while the feature is off", async () => {
  state.enabled = false;
  const { result } = renderHook(() => useManagerSolanaWallet(), { wrapper });
  expect(result.current.address).toBeNull();
  expect(() => result.current.connect()).toThrow("SOLANA_DISABLED");
  await expect(result.current.signTransaction(new Uint8Array())).rejects.toThrow(
    "SOLANA_WALLET_REQUIRED",
  );
});
it("does not arbitrarily select a wallet from multiple connected Solana accounts", () => {
  state.wallets.push({ address: "another" });
  const { result } = renderHook(() => useManagerSolanaWallet(), { wrapper });
  expect(result.current.address).toBeNull();
});
it("uses sign-only with an explicit mainnet label", async () => {
  const signedTransaction = new Uint8Array([1]);
  state.signTransaction.mockResolvedValue({ signedTransaction });
  const { result } = renderHook(() => useManagerSolanaWallet(), { wrapper });
  expect(await result.current.signTransaction(new Uint8Array([2]))).toBe(signedTransaction);
  expect(state.signTransaction).toHaveBeenCalledWith({
    wallet: state.wallets[0],
    transaction: new Uint8Array([2]),
    chain: "solana:mainnet",
  });
});
