/** @id PP-CP-PROV-001 @name Cash+ isolated wallet and query providers @implements-rules-version v1 */
"use client";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type Address, isAddress } from "viem";
import { useAccount } from "wagmi";
import {
  type CashPlusDeployment,
  cashPlusMode,
  getCashPlusDeployment,
} from "@/lib/cash-plus/config/deployments";
import type { CashPlusMode } from "@/lib/cash-plus/types";
import { isMockMode } from "@/lib/services";
import type { Eip1193Provider } from "@/lib/tx/sendTransaction";
import { CASH_PLUS_PREVIEW_OWNER } from "@/mocks/data/cashPlus";

interface WalletAccess {
  connected: boolean;
  address?: Address;
  correctChain: boolean;
  getProvider(): Promise<Eip1193Provider>;
  connect(): void;
  switchNetwork(): Promise<void>;
}
interface Environment {
  mode: CashPlusMode;
  deployment: CashPlusDeployment | null;
  error?: string;
  wallet: WalletAccess;
}
const Context = createContext<Environment | null>(null);
const disabled: WalletAccess = {
  connected: false,
  correctChain: false,
  async getProvider() {
    throw new Error("WALLET_CHANGED");
  },
  connect() {},
  async switchNetwork() {},
};
export function useCashPlusEnvironment() {
  const value = useContext(Context);
  if (!value) throw new Error("CashPlusProvider is required");
  return value;
}
function configuration(): Omit<Environment, "wallet"> {
  try {
    return { mode: cashPlusMode(), deployment: getCashPlusDeployment() };
  } catch {
    return { mode: "preview", deployment: null, error: "DEPLOYMENT_INVALID" };
  }
}

export function CashPlusProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, retryDelay: 3000, refetchOnWindowFocus: false } },
      }),
  );
  const [config] = useState(configuration);
  let content: ReactNode;
  if (config.error)
    content = (
      <Context.Provider value={{ ...config, wallet: disabled }}>{children}</Context.Provider>
    );
  else if (config.mode === "preview")
    content = (
      <Context.Provider
        value={{
          ...config,
          wallet: {
            ...disabled,
            connected: true,
            correctChain: true,
            address: CASH_PLUS_PREVIEW_OWNER,
          },
        }}
      >
        {children}
      </Context.Provider>
    );
  else if (config.mode === "fork")
    content = <InjectedEnvironment config={config}>{children}</InjectedEnvironment>;
  else if (!isMockMode) content = <PrivyEnvironment config={config}>{children}</PrivyEnvironment>;
  else
    content = (
      <Context.Provider value={{ ...config, error: "DEPLOYMENT_INVALID", wallet: disabled }}>
        {children}
      </Context.Provider>
    );
  return <QueryClientProvider client={queryClient}>{content}</QueryClientProvider>;
}
type Config = Omit<Environment, "wallet">;
type Injected = Eip1193Provider & {
  on?(event: string, handler: () => void): void;
  removeListener?(event: string, handler: () => void): void;
};
function injected(): Injected | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as Window & { ethereum?: Injected }).ethereum;
}
function InjectedEnvironment({ config, children }: { config: Config; children: ReactNode }) {
  const [address, setAddress] = useState<Address>();
  const [chain, setChain] = useState<number>();
  const sync = useCallback(async () => {
    try {
      const provider = injected();
      if (!provider) {
        setAddress(undefined);
        return;
      }
      const [accounts, id] = await Promise.all([
        provider.request({ method: "eth_accounts" }),
        provider.request({ method: "eth_chainId" }),
      ]);
      setAddress(
        Array.isArray(accounts) && typeof accounts[0] === "string" && isAddress(accounts[0])
          ? accounts[0]
          : undefined,
      );
      setChain(typeof id === "string" ? Number(BigInt(id)) : undefined);
    } catch {
      setAddress(undefined);
      setChain(undefined);
    }
  }, []);
  useEffect(() => {
    const provider = injected();
    const changed = () => {
      void sync();
    };
    changed();
    provider?.on?.("accountsChanged", changed);
    provider?.on?.("chainChanged", changed);
    const timer = setInterval(changed, 5000);
    return () => {
      clearInterval(timer);
      provider?.removeListener?.("accountsChanged", changed);
      provider?.removeListener?.("chainChanged", changed);
    };
  }, [sync]);
  const wallet = useMemo<WalletAccess>(
    () => ({
      connected: Boolean(address),
      address,
      correctChain: chain === config.deployment?.chainId,
      async getProvider() {
        const provider = injected();
        if (!provider) throw new Error("WALLET_CHANGED");
        return provider;
      },
      connect() {
        const provider = injected();
        if (provider)
          void provider
            .request({ method: "eth_requestAccounts" })
            .then(sync)
            .catch(() => {});
      },
      async switchNetwork() {
        const provider = injected(),
          deployment = config.deployment;
        if (!provider || !deployment) return;
        const chainId = `0x${deployment.chainId.toString(16)}`;
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === 4902) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId,
                  chainName: deployment.networkName,
                  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                  rpcUrls: [deployment.rpcUrl],
                },
              ],
            });
            await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
          } else throw error;
        }
        await sync();
      },
    }),
    [address, chain, config.deployment, sync],
  );
  return <Context.Provider value={{ ...config, wallet }}>{children}</Context.Provider>;
}
function PrivyEnvironment({ config, children }: { config: Config; children: ReactNode }) {
  const { wallets } = useWallets();
  const { login } = usePrivy();
  const { address, chainId, isConnected } = useAccount();
  const wallet = useMemo<WalletAccess>(
    () => ({
      connected: isConnected,
      address,
      correctChain: chainId === config.deployment?.chainId,
      async getProvider() {
        const selected = wallets.find(
          (wallet) => wallet.address.toLowerCase() === address?.toLowerCase(),
        );
        if (!selected) throw new Error("WALLET_CHANGED");
        return selected.getEthereumProvider();
      },
      connect() {
        login();
      },
      async switchNetwork() {
        const selected = wallets.find(
          (wallet) => wallet.address.toLowerCase() === address?.toLowerCase(),
        );
        if (!selected || !config.deployment) throw new Error("WALLET_CHANGED");
        await selected.switchChain(config.deployment.chainId);
      },
    }),
    [address, chainId, isConnected, config.deployment, wallets, login],
  );
  return <Context.Provider value={{ ...config, wallet }}>{children}</Context.Provider>;
}
