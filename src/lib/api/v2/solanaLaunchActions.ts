/**
 * @id PP-MGR-ACT-015 (POO-2262)
 * @name v2SolanaLaunchActions
 * @implements-rules-version DEC-188, DEC-190, DEC-191, DEC-195, DEC-203, DEC-204 (founder rulings, unversioned)
 * Server actions for the v6 (Hub Arbitrum + Robinhood + Solana) Fund launch, one per step of
 * pool-party-api `docs/SOLANA_API_CONTRACT.md` §9. The browser never holds the API key: it calls
 * these actions, which check the SIWE session (and, once the Fund exists, that the session wallet is
 * its Manager), validate the request strictly, and return the API's answer or a stable code.
 */
"use server";
import { z } from "zod";
import { isFeatureEnabled } from "@/lib/features";
import { ApiError, ApiParseError } from "../errors";
import { launchManager, launchResult, launchSession } from "./launchAuth";
import { addressSchema, poolIdSchema } from "./schemas";
import { solanaFetch } from "./solanaFetch";
import {
  base58Schema,
  bootstrapRequestSchema,
  bootstrapSchema,
  buildCreationRequestSchema,
  buildCreationSchema,
  creationOptionsSchema,
  raydiumPoolStateSchema,
  reportFreshSchema,
  sendToSolanaSchema,
  signedQuoteSchema,
  solanaBalancesSchema,
  solanaBuildSchema,
  solanaFundDetailSchema,
  solanaTransitSchema,
  solanaVenuesSchema,
  trackTransitSchema,
} from "./solanaSchemas";

const uint = z.string().regex(/^\d{1,78}$/);
const positive = z.string().regex(/^[1-9]\d{0,38}$/);

function requireSolana() {
  if (!isFeatureEnabled("solanaSpoke")) throw new ApiError(404, "SOLANA_DISABLED", "disabled");
}
async function solanaResult<ResponseData>(work: () => Promise<ResponseData>) {
  try {
    return await launchResult(work);
  } catch {
    return { ok: false as const, error: { status: 500, code: "V2_UNAVAILABLE" } };
  }
}
function parseOrRefuse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "V2_INVALID_REQUEST", "invalid request");
  return parsed.data;
}
async function guard<ResponseData>(work: () => Promise<ResponseData>) {
  return solanaResult(async () => {
    requireSolana();
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApiParseError) {
        // Contract drift is an operator problem: log the shape, never a value.
        console.warn(
          JSON.stringify({
            event: "v2_solana_contract_drift",
            path: error.message,
            issues: error.issues.slice(0, 5).map((issue) => issue.path.join(".")),
          }),
        );
        throw new ApiError(502, "V2_INVALID_RESPONSE", "invalid response");
      }
      throw error;
    }
  });
}

/** §3.13 step 0a: admitted assets, venues, fee bounds and fixed Mandate values. */
export async function getSolanaCreationOptionsAction() {
  return guard(async () => {
    await launchSession();
    return solanaFetch("/funds/creation-options", "GET", creationOptionsSchema);
  });
}

/** §3.13 steps 0b/0e: the unsigned plan, then the signed rebuild (createFund + createSpoke). */
export async function buildSolanaCreationAction(input: unknown) {
  return guard(async () => {
    const body = parseOrRefuse(buildCreationRequestSchema, input);
    await launchSession(body.manager);
    const plan = await solanaFetch("/funds/build-creation", "POST", buildCreationSchema, body);
    if (
      plan.solana.managerSolanaKey !== body.managerSolanaKey ||
      Object.values(plan.transactions).some(
        (transaction) =>
          transaction && transaction.from.toLowerCase() !== body.manager.toLowerCase(),
      )
    )
      throw new ApiError(502, "V2_INVALID_RESPONSE", "plan mismatch");
    return plan;
  });
}

/** §3.8 step 1: immediate discovery of the new Core (works before Arbitrum finality). */
export async function discoverSolanaFundAction(core: string) {
  return guard(async () => {
    const parsed = parseOrRefuse(addressSchema, core);
    await launchSession();
    return solanaFetch(
      "/funds/discover",
      "POST",
      z.object({ chains: z.array(z.unknown()).optional() }).passthrough(),
      { core: parsed },
    );
  });
}

/** §3.8/§3.9 step 2: the Fund with its three chains and per-spoke report freshness. */
export async function readSolanaFundAction(core: string) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    return solanaFetch(`/funds/${core}`, "GET", solanaFundDetailSchema);
  });
}

/** §3.7 step 0h: the ordered stage chunks and `initialize_fund` (remaining ones on resume). */
export async function buildSolanaBootstrapAction(core: string, input: unknown) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    const body = parseOrRefuse(bootstrapRequestSchema, input);
    const built = await solanaFetch(
      `/funds/${core}/solana/bootstrap`,
      "POST",
      bootstrapSchema,
      body,
    );
    if (built.transactions.some((tx) => tx.requiredSigners[0] !== body.manager))
      throw new ApiError(502, "V2_INVALID_RESPONSE", "fee payer mismatch");
    return built;
  });
}

const builderBodies = {
  "initialize-adapter": z.union([
    z.object({ manager: base58Schema, reserve: base58Schema }).strict(),
    z.object({ manager: base58Schema, pool: base58Schema }).strict(),
  ]),
  "kamino-supply": z.object({ manager: base58Schema, amount: positive }).strict(),
  "raydium-open": z
    .object({
      manager: base58Schema,
      pool: base58Schema,
      nftMint: base58Schema,
      tickLower: z.number().int(),
      tickUpper: z.number().int(),
      amount0: uint,
      amount1: uint,
      slippageBps: z.number().int().min(0).max(5000).optional(),
    })
    .strict(),
} as const;
export type SolanaBuilderAction = keyof typeof builderBodies;

/** §3.2 steps 6, 7, 8b: Manager-signed Solana builders (the Manager's Solana key is the fee payer). */
export async function buildSolanaManagerAction(
  core: string,
  action: SolanaBuilderAction,
  input: unknown,
) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    const schema = builderBodies[action];
    if (!schema) throw new ApiError(400, "V2_INVALID_REQUEST", "unknown action");
    const body = parseOrRefuse(schema as z.ZodType<{ manager: string }>, input);
    const built = await solanaFetch(
      `/funds/${core}/solana/build/${action}`,
      "POST",
      solanaBuildSchema,
      body,
    );
    if (built.requiredSigners[0] !== body.manager)
      throw new ApiError(502, "V2_INVALID_RESPONSE", "fee payer mismatch");
    return built;
  });
}

/** §3.10 step 4: Hub -> Solana capital send, signed by the Manager's EVM wallet (send `gas`). */
export async function buildSendToSolanaAction(core: string, input: unknown) {
  return guard(async () => {
    const wallet = await launchManager(parseOrRefuse(addressSchema, core));
    const body = parseOrRefuse(
      z
        .object({ amount: positive, feeBps: z.number().int().min(0).max(50_000).optional() })
        .strict(),
      input,
    );
    const built = await solanaFetch(`/funds/${core}/build`, "POST", sendToSolanaSchema, {
      action: "send-to-solana",
      from: wallet,
      side: "hub",
      ...body,
    });
    const [transaction] = built.transactions;
    if (
      !transaction ||
      transaction.chainId !== 42161 ||
      transaction.from.toLowerCase() !== wallet ||
      transaction.to.toLowerCase() !== core.toLowerCase()
    )
      throw new ApiError(502, "V2_INVALID_RESPONSE", "transaction mismatch");
    return built;
  });
}

/** §3.11 step 5a: register the mined send so the keeper relays it before Arbitrum finality. */
export async function trackSolanaTransitAction(core: string, txHash: string) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    return solanaFetch(`/funds/${core}/solana/transits/track`, "POST", trackTransitSchema, {
      txHash: parseOrRefuse(poolIdSchema, txHash),
    });
  });
}

/** §3.11 step 5b: transit stage and credit evidence (credited = funds in the Solana vault). */
export async function readSolanaTransitAction(core: string, transitId: string) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    return solanaFetch(
      `/funds/${core}/solana/transits/${parseOrRefuse(poolIdSchema, transitId)}`,
      "GET",
      solanaTransitSchema,
    );
  });
}

/** §3.6 step 5c: manual receive, only when the keeper cannot relay. */
export async function buildSolanaReceiveAction(core: string, transitId: string, payer: string) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    const built = await solanaFetch(
      `/funds/${core}/solana/transits/${parseOrRefuse(poolIdSchema, transitId)}/build-receive`,
      "POST",
      solanaBuildSchema,
      { payer: parseOrRefuse(base58Schema, payer) },
    );
    if (built.requiredSigners[0] !== payer)
      throw new ApiError(502, "V2_INVALID_RESPONSE", "fee payer mismatch");
    return built;
  });
}

/** §3.12: admitted venues and whether each adapter is initialized. */
export async function readSolanaVenuesAction(core: string) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    return solanaFetch(`/funds/${core}/solana/venues`, "GET", solanaVenuesSchema);
  });
}

/** §3.12: the Solana vault's spendable ledger principal per admitted mint. */
export async function readSolanaBalancesAction(core: string) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    return solanaFetch(`/funds/${core}/spokes/1/balances`, "GET", solanaBalancesSchema);
  });
}

/** §3.12: tick, spacing and price of an admitted Raydium pool. */
export async function readSolanaRaydiumPoolAction(core: string, pool: string) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    return solanaFetch(
      `/funds/${core}/solana/raydium/${parseOrRefuse(base58Schema, pool)}`,
      "GET",
      raydiumPoolStateSchema,
    );
  });
}

/** §3.4 step 8a: API-signed USDC <-> WSOL route with the unsigned `swap_to_ratio` (DEC-203/204). */
export async function quoteSolanaSwapAction(core: string, input: unknown) {
  return guard(async () => {
    await launchManager(parseOrRefuse(addressSchema, core));
    const body = parseOrRefuse(
      z
        .object({
          inputMint: base58Schema,
          outputMint: base58Schema,
          amount: positive,
          slippageBps: z.number().int().min(0).max(9999),
          maxPriceImpactBps: z.number().int().min(0).max(65535),
          poolId: base58Schema.optional(),
        })
        .strict(),
      input,
    );
    return solanaFetch(`/funds/${core}/solana/signed-quote`, "POST", signedQuoteSchema, body);
  });
}

const freshCalls = new Map<string, number>();
/** §3.9 step 9: start (or re-attempt) the keeper-paid Solana report; poll the detail after. */
export async function refreshSolanaLaunchReportAction(core: string) {
  return guard(async () => {
    const wallet = await launchManager(parseOrRefuse(addressSchema, core));
    const key = `${wallet}:${core.toLowerCase()}`;
    const now = Date.now();
    for (const [entry, at] of freshCalls) if (now - at > 60_000) freshCalls.delete(entry);
    const previous = freshCalls.get(key);
    if ((previous && now - previous < 10_000) || freshCalls.size >= 1000)
      throw new ApiError(429, "V2_RATE_LIMITED", "rate limited");
    freshCalls.set(key, now);
    return solanaFetch(`/funds/${core}/solana/reports/fresh`, "POST", reportFreshSchema, {});
  });
}

/** Typed result of every action above; `error.code` is a stable machine code. */
export type SolanaActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        status: number;
        code: string;
        retryAfterSeconds?: number;
        jobId?: string;
        revert?: string;
      };
    };
