/**
 * E2E harness configuration — all env-driven so the same specs run against any chain / key.
 *
 * Primary chains are Arbitrum + Base (Polygon is secondary). Pick with `E2E_CHAIN`.
 * The signing key comes from `E2E_PRIVATE_KEY`; when unset we mint an EPHEMERAL key, which is
 * fine for connect / SIWE / portfolio (read) specs — those cost nothing — but WRITE ops will
 * fail for lack of funds. Point RPCs at your own nodes via `E2E_<CHAIN>_RPC_URL` for reliability.
 */
import type { Chain } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { arbitrum, base, polygon } from "viem/chains";

export type ChainKey = "arbitrum" | "base" | "polygon";

export const CHAINS: Record<ChainKey, Chain> = { arbitrum, base, polygon };

/** Public fallbacks; override per chain with E2E_ARBITRUM_RPC_URL / E2E_BASE_RPC_URL / E2E_POLYGON_RPC_URL. */
const RPC_FALLBACK: Record<ChainKey, string> = {
  arbitrum: "https://arb1.arbitrum.io/rpc",
  base: "https://mainnet.base.org",
  polygon: "https://polygon-bor-rpc.publicnode.com",
};

export function rpcUrl(key: ChainKey): string {
  const fromEnv = process.env[`E2E_${key.toUpperCase()}_RPC_URL`];
  return fromEnv && fromEnv.length > 0 ? fromEnv : RPC_FALLBACK[key];
}

/** The chain a spec targets by default. */
export function chainKey(): ChainKey {
  const k = (process.env.E2E_CHAIN ?? "arbitrum").toLowerCase();
  if (k === "arbitrum" || k === "base" || k === "polygon") return k;
  throw new Error(`E2E_CHAIN must be arbitrum|base|polygon, got "${k}"`);
}

let ephemeral: `0x${string}` | null = null;

/** Signing key: the funded `E2E_PRIVATE_KEY`, or a per-run ephemeral key for read-only specs. */
export function privateKey(): `0x${string}` {
  const pk = process.env.E2E_PRIVATE_KEY;
  if (pk) return (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`;
  if (!ephemeral) {
    ephemeral = generatePrivateKey();
    // biome-ignore lint/suspicious/noConsole: harness diagnostics
    console.warn(
      `[e2e] E2E_PRIVATE_KEY not set — using an ephemeral key (${ephemeral.slice(0, 10)}…). ` +
        "OK for connect/portfolio/read specs; WRITE ops will fail (no funds).",
    );
  }
  return ephemeral;
}

/** True only when a real (assumed-funded) key was supplied — write specs guard on this. */
export const hasFundedKey = (): boolean => Boolean(process.env.E2E_PRIVATE_KEY);

export const baseUrl = (): string => process.env.E2E_BASE_URL ?? "http://localhost:3000";
