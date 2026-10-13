/**
 * The browser never calls a Solana RPC provider directly: the public mainnet RPC answers 403 to every
 * browser origin (F2 of the 2026-10-09 sweep) and a keyed provider URL must never reach the client.
 * Every Solana read and send goes through the same-origin proxy `src/app/api/solana-rpc/route.ts`,
 * which holds the provider URL server-side (`SOLANA_RPC_URL`) and allow-lists the JSON-RPC methods.
 */
export const SOLANA_RPC_PROXY_PATH = "/api/solana-rpc";

export function solanaRpcUrl(): string {
  if (typeof window !== "undefined")
    return new URL(SOLANA_RPC_PROXY_PATH, window.location.origin).toString();
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
  return `${origin}${SOLANA_RPC_PROXY_PATH}`;
}
