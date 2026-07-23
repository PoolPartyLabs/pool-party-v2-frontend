/**
 * Headless wallet for E2E: a viem-backed EIP-1193 + EIP-6963 provider injected into the page.
 *
 * The app connects wallets through Privy (EIP-6963 discovery + Privy modal) and signs via Privy's
 * hooks — it never reads `window.ethereum` directly and never uses wagmi's `useWalletClient`. So we
 * announce an EIP-6963 provider Privy can detect, and answer every `request()` from Node:
 *   - the PRIVATE KEY lives only here in Node (never shipped to the page),
 *   - signing (`personal_sign`, `eth_signTypedData_v4`) and sends (`eth_sendTransaction`) use viem,
 *   - all other JSON-RPC is proxied to the chain's RPC.
 * The in-page shim is a thin forwarder to a `page.exposeFunction` bridge + the EIP-6963 announce.
 */
import type { Page } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  http,
  isHex,
  type PublicClient,
  toHex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, type ChainKey, rpcUrl } from "../config";

export interface MockWallet {
  address: `0x${string}`;
  /** Force the Node signer/broadcaster onto a chain (the app also drives this via `switchChain`). */
  setChain: (key: ChainKey) => void;
  currentChain: () => ChainKey;
}

const BRIDGE = "__ppWalletBridge";

export async function installMockWallet(
  page: Page,
  opts: { privateKey: `0x${string}`; chainKey: ChainKey },
): Promise<MockWallet> {
  const account = privateKeyToAccount(opts.privateKey);
  let current: ChainKey = opts.chainKey;

  const publicClients = new Map<ChainKey, PublicClient>();
  const walletClients = new Map<ChainKey, WalletClient>();
  const publicClient = (k: ChainKey): PublicClient => {
    let c = publicClients.get(k);
    if (!c) {
      c = createPublicClient({ chain: CHAINS[k], transport: http(rpcUrl(k)) });
      publicClients.set(k, c);
    }
    return c;
  };
  const walletClient = (k: ChainKey): WalletClient => {
    let c = walletClients.get(k);
    if (!c) {
      c = createWalletClient({ account, chain: CHAINS[k], transport: http(rpcUrl(k)) });
      walletClients.set(k, c);
    }
    return c;
  };
  const chainKeyById = (id: number): ChainKey | undefined =>
    (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].id === id);

  // Node-side JSON-RPC handler. The private key never leaves this process.
  // biome-ignore lint/suspicious/noExplicitAny: JSON-RPC params/return are heterogeneous
  const bridge = async (req: { method: string; params?: any[] }): Promise<any> => {
    const method = req.method;
    const params = req.params ?? [];
    if (process.env.E2E_DEBUG) {
      // biome-ignore lint/suspicious/noConsole: harness diagnostics
      console.error(`[wallet:req] ${method}`);
    }
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "wallet_requestPermissions":
      case "wallet_getPermissions":
        return [{ parentCapability: "eth_accounts" }];
      case "eth_chainId":
        return toHex(CHAINS[current].id);
      case "net_version":
        return String(CHAINS[current].id);
      case "wallet_switchEthereumChain": {
        const target = Number(params[0]?.chainId);
        const found = chainKeyById(target);
        if (!found)
          throw { code: 4902, message: `chain ${target} not configured in the e2e harness` };
        current = found;
        return null;
      }
      case "wallet_addEthereumChain":
      case "wallet_watchAsset":
        return null;
      case "personal_sign": {
        const raw = params[0] as string; // [message, address]
        return account.signMessage({ message: isHex(raw) ? { raw } : raw });
      }
      case "eth_sign": {
        const raw = params[1] as string; // [address, message]
        return account.signMessage({ message: isHex(raw) ? { raw } : raw });
      }
      case "eth_signTypedData":
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4": {
        const data = params[1]; // [address, typedDataJson]
        const typed = typeof data === "string" ? JSON.parse(data) : data;
        const { EIP712Domain, ...types } = typed.types ?? {};
        void EIP712Domain;
        const domain = { ...typed.domain };
        if (domain.chainId != null) domain.chainId = Number(domain.chainId);
        return account.signTypedData({
          domain,
          types,
          primaryType: typed.primaryType,
          message: typed.message,
        });
      }
      case "eth_sendTransaction": {
        const tx = params[0] ?? {};
        return walletClient(current).sendTransaction({
          account,
          chain: CHAINS[current],
          to: tx.to,
          data: tx.data,
          value: tx.value != null ? BigInt(tx.value) : undefined,
          gas: tx.gas != null ? BigInt(tx.gas) : undefined,
        });
      }
      default:
        // Never proxy wallet_/metamask_ control methods to the RPC (it rejects them → connect fails).
        if (method.startsWith("wallet_") || method.startsWith("metamask_")) return null;
        // Everything else (eth_call, eth_getBalance, eth_getTransactionReceipt, gas/fee, …) → RPC.
        return publicClient(current).request({ method, params });
    }
  };

  await page.exposeFunction(BRIDGE, bridge);
  await page.addInitScript(injectProvider, {
    bridge: BRIDGE,
    address: account.address,
    chainIdHex: toHex(CHAINS[current].id),
  });

  return {
    address: account.address,
    setChain: (k) => {
      current = k;
    },
    currentChain: () => current,
  };
}

/**
 * Runs in the browser (serialized by Playwright — must be self-contained). Installs an EIP-1193
 * provider that forwards to the Node bridge, and announces it via EIP-6963 so Privy discovers it.
 */
function injectProvider(cfg: { bridge: string; address: string; chainIdHex: string }): void {
  // biome-ignore lint/suspicious/noExplicitAny: page-side window shims
  const w = window as any;
  const listeners: Record<string, ((data?: unknown) => void)[]> = {};
  const emit = (event: string, data?: unknown) => {
    for (const cb of listeners[event] ?? []) {
      try {
        cb(data);
      } catch {
        /* listener errors are not ours to surface */
      }
    }
  };
  // biome-ignore lint/suspicious/noExplicitAny: EIP-1193 provider shape
  const provider: any = {
    // NOT MetaMask: impersonating it made Privy route to its curated MetaMask (QR/deep-link) instead
    // of our injected provider on a detection race. A distinct EIP-6963 identity is always injected.
    isMetaMask: false,
    isConnected: () => true,
    request: (args: { method: string; params?: unknown[] }) =>
      w[cfg.bridge](args).then((res: unknown) => {
        if (args.method === "wallet_switchEthereumChain") {
          const id = (args.params?.[0] as { chainId?: string })?.chainId;
          if (id) emit("chainChanged", id);
        }
        return res;
      }),
    on: (event: string, cb: (data?: unknown) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
      return provider;
    },
    removeListener: (event: string, cb: (data?: unknown) => void) => {
      listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      return provider;
    },
    addListener: (event: string, cb: (data?: unknown) => void) => provider.on(event, cb),
    removeAllListeners: () => {
      for (const k of Object.keys(listeners)) listeners[k] = [];
      return provider;
    },
    enable: () => provider.request({ method: "eth_requestAccounts" }),
  };
  w.ethereum = provider;

  // Distinct EIP-6963 identity — Privy lists it under "detected wallets" and always connects the
  // INJECTED provider (no curated MetaMask QR/deep-link path, no name-collapse). Select it by name.
  const info = {
    uuid: w.crypto?.randomUUID?.() || `e2e-${Math.random().toString(16).slice(2)}`,
    name: "E2E Mock Wallet",
    icon: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='96'%20height='96'%3E%3Crect%20width='96'%20height='96'%20fill='%23627eea'/%3E%3C/svg%3E",
    rdns: "xyz.poolparty.e2e",
  };
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  setTimeout(() => emit("connect", { chainId: cfg.chainIdHex }), 0);
}
