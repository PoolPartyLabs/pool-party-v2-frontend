/**
 * @id PP-CORE-SEC-004 (POO-2262)
 * @name Solana RPC proxy route
 * @implements-rules-version DEC-190 (founder ruling, unversioned)
 * @analytics-events none: a transport endpoint, not a product surface.
 *
 * The Manager's Solana reads, blockhash checks and sends go through this same-origin route:
 * the public mainnet RPC answers 403 to browser origins (sweep F2, 2026-10-09) and a keyed provider
 * URL (`SOLANA_RPC_URL`, server-only) must never reach the client bundle.
 *
 * PP-SECURITY:
 *   1. Signed-in callers only (SIWE session cookie), so this is not an open relay for our RPC budget.
 *   2. One JSON-RPC call per request (no batches), methods allow-listed, body capped at 8 KiB.
 *   3. The upstream is a server constant: nothing in the request chooses the host. No redirects.
 *   4. Upstream errors keep the JSON-RPC `error` object (code/message from the node) so the client
 *      can tell a preflight refusal from a network failure; transport failures become a 502.
 *
 * PP-INTEGRATION-POINT: SOLANA_RPC_URL (server env). Falls back to the public RPC, which accepts
 * server-side requests without an Origin header.
 */
import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/features";

const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_METHODS = new Set([
  "getGenesisHash",
  "getLatestBlockhash",
  "getBlockHeight",
  "getSlot",
  "getBalance",
  "getAccountInfo",
  "getMultipleAccounts",
  "getTokenAccountBalance",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "sendTransaction",
]);

function upstream(): string {
  const configured = process.env.SOLANA_RPC_URL?.trim();
  return configured && /^https:\/\//.test(configured) ? configured : PUBLIC_RPC;
}

function refusal(status: number, code: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32600, message: code } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isFeatureEnabled("solanaSpoke")) return refusal(404, "SOLANA_DISABLED");
  if (!(await getSessionWallet())) return refusal(401, "UNAUTHORIZED");
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return refusal(413, "BODY_TOO_LARGE");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return refusal(400, "INVALID_JSON");
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body as { jsonrpc?: unknown }).jsonrpc !== "2.0" ||
    typeof (body as { method?: unknown }).method !== "string" ||
    !ALLOWED_METHODS.has((body as { method: string }).method)
  )
    return refusal(400, "METHOD_NOT_ALLOWED");
  const { id, method, params } = body as { id?: unknown; method: string; params?: unknown };
  if (params !== undefined && !Array.isArray(params)) return refusal(400, "INVALID_PARAMS");
  let response: Response;
  try {
    response = await fetch(upstream(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: id ?? 1, method, params: params ?? [] }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return refusal(502, "SOLANA_RPC_UNAVAILABLE");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return refusal(502, "SOLANA_RPC_UNAVAILABLE");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return refusal(502, "SOLANA_RPC_UNAVAILABLE");
  return NextResponse.json(payload, {
    status: response.ok ? 200 : 502,
    headers: { "cache-control": "no-store" },
  });
}
