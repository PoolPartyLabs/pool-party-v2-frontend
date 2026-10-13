/**
 * @id PP-CORE-SEC-004 (POO-2262)
 * @name Solana RPC proxy route
 * @implements-rules-version DEC-190 (founder ruling, unversioned)
 * @analytics-events none: a transport endpoint, not a product surface.
 *
 * The Manager's Solana reads, block-height checks and sends go through this same-origin route:
 * the public mainnet RPC answers 403 to browser origins (sweep F2, 2026-10-09) and a keyed provider
 * URL (`SOLANA_RPC_URL`, server-only) must never reach the client bundle.
 *
 * PP-SECURITY:
 *   1. VERIFIED sessions only. The session cookie is decoded locally without a signature check, so
 *      the bearer is verified against the API (`users/me`), as the launch server actions do; a
 *      verified token is cached for 60 s under its SHA-256. A forged cookie never reaches the RPC.
 *   2. Per-wallet budget (40 calls per 10 s) so one session cannot spend the provider's quota.
 *   3. One JSON-RPC call per request (no batches), methods allow-listed, body capped at 8 KiB
 *      (Content-Length first, then the real byte length).
 *   4. The upstream is a server constant: nothing in the request chooses the host. No redirects.
 *   5. Only `{jsonrpc, id, result}` or `{jsonrpc, id, error: {code, message}}` goes back: the client
 *      needs the node's error code to tell a preflight refusal from a network failure.
 *
 * PP-INTEGRATION-POINT: SOLANA_RPC_URL (server env). Falls back to the public RPC, which accepts
 * server-side requests without an Origin header.
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { addressSchema } from "@/lib/api/v2/schemas";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/features";

const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const MAX_BODY_BYTES = 8 * 1024;
const VERIFIED_TTL_MS = 60_000;
const BUDGET = { calls: 40, windowMs: 10_000 };
/** Exactly the methods this app calls (`src/lib/solana/rpc.ts`, `useManagerSolanaWallet.ts`). */
const ALLOWED_METHODS = new Set([
  "getGenesisHash",
  "getBlockHeight",
  "getBalance",
  "getSignatureStatuses",
  "sendTransaction",
  "getAccountInfo",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
]);

const verified = new Map<string, { wallet: string; at: number }>();
const budgets = new Map<string, { start: number; calls: number }>();

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

/** The session wallet, only once the API has accepted its bearer token. */
async function verifiedWallet(): Promise<string | null> {
  const wallet = await getSessionWallet();
  if (!wallet) return null;
  const headers = await getAuthHeader();
  if (!headers.Authorization) return null;
  const key = createHash("sha256").update(headers.Authorization).digest("hex");
  const now = Date.now();
  const hit = verified.get(key);
  if (hit && now - hit.at < VERIFIED_TTL_MS && hit.wallet === wallet) return wallet;
  try {
    const owner = await apiFetch("users/me", {
      headers,
      schema: z.object({ walletAddress: addressSchema }),
    });
    if (!owner || owner.walletAddress.toLowerCase() !== wallet.toLowerCase()) return null;
  } catch {
    return null;
  }
  for (const [entry, value] of verified)
    if (now - value.at >= VERIFIED_TTL_MS) verified.delete(entry);
  if (verified.size >= 1000) verified.delete(verified.keys().next().value as string);
  verified.set(key, { wallet, at: now });
  return wallet;
}

function withinBudget(wallet: string): boolean {
  const now = Date.now();
  const current = budgets.get(wallet);
  if (!current || now - current.start >= BUDGET.windowMs) {
    if (budgets.size >= 1000) budgets.delete(budgets.keys().next().value as string);
    budgets.set(wallet, { start: now, calls: 1 });
    return true;
  }
  current.calls += 1;
  return current.calls <= BUDGET.calls;
}

export async function POST(request: Request) {
  if (!isFeatureEnabled("solanaSpoke")) return refusal(404, "SOLANA_DISABLED");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return refusal(413, "BODY_TOO_LARGE");
  const wallet = await verifiedWallet();
  if (!wallet) return refusal(401, "UNAUTHORIZED");
  if (!withinBudget(wallet.toLowerCase())) return refusal(429, "RATE_LIMITED");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return refusal(413, "BODY_TOO_LARGE");
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
  const callId = typeof id === "number" || typeof id === "string" ? id : 1;
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(upstream(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: callId, method, params: params ?? [] }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    payload = await response.json();
  } catch {
    return refusal(502, "SOLANA_RPC_UNAVAILABLE");
  }
  if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload))
    return refusal(502, "SOLANA_RPC_UNAVAILABLE");
  const answer = payload as { result?: unknown; error?: { code?: unknown; message?: unknown } };
  const headers = { "cache-control": "no-store" };
  if (answer.error && typeof answer.error === "object")
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: callId,
        error: {
          code: typeof answer.error.code === "number" ? answer.error.code : -32000,
          message:
            typeof answer.error.message === "string"
              ? answer.error.message.slice(0, 300)
              : "RPC error",
        },
      },
      { headers },
    );
  if (!("result" in answer)) return refusal(502, "SOLANA_RPC_UNAVAILABLE");
  return NextResponse.json({ jsonrpc: "2.0", id: callId, result: answer.result }, { headers });
}
