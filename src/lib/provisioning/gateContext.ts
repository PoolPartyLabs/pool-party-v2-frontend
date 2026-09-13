/**
 * @id PP-CORE-LIB-057 (POO-1042)
 * @name provisioning gate context
 * @implements-rules-version v2
 * @hackathon POO-1022 (Universal Funding)
 *
 * Everything the pre-flight gate needs to know about a wallet, read once, server-side.
 *
 * The gate's real branch was once a hard-disable stub: `realProvisioningInput` returned a wallet
 * holding a million dollars, so it could never trip. This module replaced that stub and remains the
 * single entry point, so the six op modals stay identical and there is nowhere for a second,
 * divergent assembly to grow.
 *
 * ## Where the assembly lives (POO-1098)
 *
 * It is no longer assembled HERE. `GET /api/v1/funding/context` on pool-party-api now does the work
 * this file used to do inline, and the three answers below come back from that one call:
 *
 *   **What is where** ([R1]). Per-chain native and token USD, from the RAW holdings. Native and
 *   token are separated because only the chain's OWN native coin can pay for a transaction there,
 *   which is the fact the whole gas model turns on.
 *
 *   **Can each chain transact** ([R9]). A {@link GasFeasibility} verdict for every candidate source
 *   chain AND for the operation's own chain. POO-1039 treats a chain with no verdict as selectable
 *   with no badge, deliberately erring towards letting a user spend their own money; supplying one
 *   for every chain is what makes that fallback unreachable in production rather than load-bearing.
 *
 *   **What gas actually costs** ([R4]). From a live quote, never the `0.5` that
 *   `mapManagerStrategyDetail.ts` still hardcodes. The gate runs BEFORE the operation is built, and
 *   before this epic the only genuine gas figure in the codebase existed only AFTER a build.
 *
 * What did NOT move is the pure classification and display code ([R4] of POO-1098):
 * `gasFeasibility.ts` and the picker's helpers stay here, so the UI renders without a round trip.
 *
 * ## The fail-safe posture ([R5])
 *
 * A degraded read resolves to NO context, and no context means no gate: the operation proceeds
 * exactly as it does today. This is not defensive padding, it is the single most important
 * behavioural rule in the issue. A wallet that is genuinely funded, blocked by a provisioning modal
 * because a balance endpoint blipped, is strictly worse than never having built the feature.
 *
 * The backend holds the same posture from the other side: it answers 200 with `degraded: true`
 * rather than a 4xx, precisely so no caller can forget to special-case a status and fail CLOSED. It
 * also refuses to fall back to a USDC-only on-chain read on a total outage, because that path
 * carries no native balances at all and every chain would read as having zero gas. Degrading to "we
 * do not know" is honest; degrading to "you have no gas" is a lie that costs the user their
 * transaction.
 *
 * Server-only: it holds the session bearer and the API key boundary. A client surface reaches it
 * through `getProvisioningContextAction` (`planActions.ts`), which derives the wallet from the SIWE
 * session; the address is never a client-supplied parameter, here or on the route.
 */
import "server-only";

import { z } from "zod";
import { apiFetch } from "@/lib/api/client";
import { ApiError, ApiParseError } from "@/lib/api/errors";
import { getAuthHeader } from "@/lib/auth/session";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { logWarn } from "@/lib/observability/logger";
import type { GasFeasibility } from "./gasFeasibility";
import type { ChainBalancesUsd } from "./types";

/** What the pre-flight gate knows about a wallet, for ONE operation. */
export interface ProvisioningGateContext {
  /** The operation's chain. Every route the planner builds has to terminate here ([R2]). */
  targetChainId: number;
  /**
   * Everything the wallet can pay with, most valuable first (POO-1031). Dust-filtered and
   * intersected with Uniswap's routable set, so a row here is a row that can actually execute.
   */
  sources: FundingSource[];
  /** A verdict for every source chain and for {@link targetChainId} ([R9]), keyed by chain id. */
  gasByChain: Record<number, GasFeasibility>;
  /**
   * Per-chain native / token USD, from the RAW holdings ([R1]).
   *
   * Not derived from {@link sources}: the inventory filters sub-$1 dust because dust cannot be
   * SPENT, while gas is measured in cents, so a $0.40 native balance is the difference between "you
   * can transact here" and a gate that fires on a funded wallet.
   */
  balancesByChain: Record<number, ChainBalancesUsd>;
  /**
   * Every NATIVE holding, straight from the raw balances and NOT dust-filtered (POO-1076).
   *
   * The same reasoning {@link balancesByChain} already states, applied one step further. The
   * inventory drops sub-$1 rows because dust cannot be usefully SPENT, but a gas bridge is not a
   * spend: at ~$1,900/ETH its 0.0003 ETH floor is about $0.56, so a holding that can genuinely
   * donate gas sits below a threshold that was never about donating. Sourcing donors from the
   * filtered list made a funded wallet read as having nothing to send.
   *
   * Routability is deliberately not consulted: the gas leg is quoted directly, native to native, so
   * a `/swappable_tokens` round trip per chain would buy nothing.
   *
   * Optional so a fixture need not restate it; absent degrades to the filtered list, which is the
   * behaviour before this field existed. The real builder always populates it.
   */
  nativeHoldings?: FundingSource[];
  /**
   * What the operation's own transaction needs on {@link targetChainId}, in USD, from a live quote
   * plus the classifier's headroom ([R4]).
   */
  gasEstimateUsd: number;
}

/** One thing the wallet can pay with, exactly as `FundingSource` is served. */
const servedFundingSourceSchema = z.object({
  address: z.string(),
  chainId: z.number(),
  symbol: z.string(),
  decimals: z.number(),
  amount: z.string(),
  usd: z.number(),
  reachableChainIds: z.array(z.number()),
  isNative: z.boolean(),
  logoUrl: z.string(),
});

/**
 * The gas verdict, validated on every scalar the gate acts on.
 *
 * Not a passthrough. This decides whether a user is told a chain cannot pay for its own transaction,
 * so a missing `verdict` or a `requiredGasUsd` that arrived as a string is exactly the drift worth
 * failing on. `topUp` and `escapes` are structurally optional (present only for TOP_UP and BLOCKED)
 * and are passed through as-is: they are consumed by pure display helpers that already tolerate a
 * partial, and re-declaring their internals here would be a second copy of a contract that lives in
 * `gasFeasibility.ts`.
 */
const servedGasFeasibilitySchema = z.object({
  chainId: z.number(),
  verdict: z.enum(["OK", "TOP_UP", "BLOCKED"]),
  quotedGasUsd: z.number(),
  requiredGasUsd: z.number(),
  shortfallUsd: z.number(),
  surplusUsd: z.number(),
  reasonKey: z.string(),
  topUp: z.unknown().optional(),
  escapes: z.unknown().optional(),
});

/**
 * What `GET /api/v1/funding/context` returns.
 *
 * Validated rather than trusted: this is the shape the ENTIRE pre-flight gate reads, and a contract
 * drift that slipped through would surface as a wallet that looks empty, which is the one reading
 * this module exists to prevent. Money stays in its wire form here (token amounts as decimal
 * strings, USD as numbers) because that is what `ProvisioningGateContext` already speaks.
 *
 * Deliberately NOT `.strict()`: the backend may add fields, and failing the gate closed over an
 * unknown key would be exactly the fail-closed behaviour [R5] forbids.
 */
const servedFundingContextSchema = z.object({
  targetChainId: z.number(),
  sources: z.array(servedFundingSourceSchema),
  gasByChain: z.record(z.string(), servedGasFeasibilitySchema),
  balancesByChain: z.record(z.string(), z.object({ nativeUsd: z.number(), tokenUsd: z.number() })),
  nativeHoldings: z.array(servedFundingSourceSchema),
  gasEstimateUsd: z.number(),
  degraded: z.boolean(),
  degradedReason: z.string().optional(),
});

/** Exactly what comes off the wire. `z.record` keys are strings there; the context uses numbers. */
type ServedContextWire = z.infer<typeof servedFundingContextSchema>;

/**
 * Record, once, that a context read produced no context.
 *
 * The fail-open posture below is correct and non-negotiable, but it has the cost `observeFailure.ts`
 * (PP-REW, POO-567) already names for the analytics fetchers: a degrade that is indistinguishable
 * from a legitimate answer is invisible. Here it is worse than invisible. The catch is deliberately
 * catch-all, so a schema drift, a permanently misrouted endpoint, or a plain TypeError in the
 * mapping below all disable the gate for EVERY user, silently and indefinitely, while every request
 * still returns 200 to the browser. Nothing else in the stack would ever report it.
 *
 * Never throws, and deliberately carries no wallet address: a warning must not turn a degraded gate
 * fatal, and this path is not a place to start writing identities to server logs.
 *
 * POO-243: emits through the platform structured logger this file asked for. It also carries the
 * upstream `requestId` when `apiFetch` captured one, which is what closes the loop the docblock
 * above complains about: a silently disabled gate can now be matched to the exact pool-party-api
 * request that disabled it, in the other repo's logs.
 */
function observeGateContextFailure(cause: unknown): void {
  const typed = cause instanceof ApiError || cause instanceof ApiParseError ? cause : null;
  logWarn("provisioning.gate_context_unavailable", {
    reason: "gate disabled for this operation",
    endpoint: "funding/context",
    status: typed?.status ?? 0,
    code: typed?.code ?? (cause instanceof Error ? cause.name : "DEGRADED"),
    requestId: typed?.requestId,
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

/** Re-key a wire record of chain ids, dropping any key that is not an INTEGER rather than NaN-ing it. */
function byChainId<T>(wire: Record<string, T>): Record<number, T> {
  const out: Record<number, T> = {};
  for (const [key, value] of Object.entries(wire)) {
    const chainId = Number(key);
    if (Number.isInteger(chainId)) out[chainId] = value;
  }
  return out;
}

/**
 * The context, assembled by pool-party-api (POO-1098).
 *
 * This used to fan out from here: three wallet-holdings reads, up to 25 routability lookups, and a
 * gas quote per candidate chain. Roughly thirty upstream calls, and the gate builds twice per plan,
 * so a single invest modal cost around sixty. Once POO-1097 put the Uniswap transport behind our own
 * backend, every one of those also started consuming pool-party-api's shared per-API-key bucket.
 * Collapsing the fan-out is the fix; the two builds now cost one request each.
 *
 * [R1 v2]: NOT deduped by passing the context back from the browser, which is what the issue
 * originally asked for. `planActions` deliberately resolves the client's selection KEYS against a
 * server-read inventory so no client-supplied amount ever reaches `buildPlan`; handing the context
 * to the client and taking it back would make `usableBalance` and `gasByChain` user-controlled, and
 * `buildPlan`'s per-source cap would then be capping against a number the user chose. One request
 * per build, twice, is cheap enough that a server-side memo would be invalidation complexity buying
 * very little.
 *
 * [R5]: returns `null` on ANY failure, not only on the backend's `degraded` flag. The route can
 * answer 401 for an expired session, 400, 408, and 429 for either the per-wallet Uniswap quota or
 * the global throttle. `null` means no context and therefore NO GATE, so a funded wallet is never
 * blocked behind a modal because a backend was busy. An absent answer is not a measurement: a
 * consumer that read an empty `balancesByChain` as "this wallet holds nothing" would tell a funded
 * user they have no gas.
 */
export async function buildProvisioningGateContext(
  address: `0x${string}`,
  targetChainId: number,
): Promise<ProvisioningGateContext | null> {
  if (!address) return null;
  // `targetChainId` is typed but reaches us from a `"use server"` argument, which Next does not
  // runtime-check. Validate before interpolating so a non-integer cannot smuggle a second query
  // param onto the URL. The backend's `@IsInt()` would reject it anyway; refusing here spends no
  // request on it, and refusing means `null`, which is the same fail-open answer as any other
  // unreadable input ([R5]).
  if (!Number.isInteger(targetChainId) || targetChainId <= 0) return null;

  try {
    // PP-INTEGRATION-POINT: the provisioning gate context, assembled server-side (POO-1098).
    const context = await apiFetch<ServedContextWire>(
      `funding/context?targetChainId=${targetChainId}`,
      { headers: await getAuthHeader(), schema: servedFundingContextSchema },
    );

    // A 204, or anything that parsed to nothing. Not an empty wallet.
    if (!context) {
      observeGateContextFailure("empty body");
      return null;
    }
    // The backend's own "I could not read this honestly" signal.
    if (context.degraded) {
      observeGateContextFailure(context.degradedReason ?? "degraded");
      return null;
    }

    return {
      targetChainId: context.targetChainId,
      sources: context.sources,
      nativeHoldings: context.nativeHoldings,
      // `topUp` / `escapes` stay `unknown` in the schema by design (see above); every scalar the
      // gate acts on is validated, so the cast is over the two structurally-optional display fields.
      gasByChain: byChainId(context.gasByChain) as Record<number, GasFeasibility>,
      balancesByChain: byChainId(context.balancesByChain),
      gasEstimateUsd: context.gasEstimateUsd,
    };
  } catch (error) {
    // [R5]. Deliberately catch-all: every failure mode here means the same thing to the caller, and
    // enumerating statuses would leave the next one to be added failing CLOSED. Logged rather than
    // swallowed silently, for the reason below.
    observeGateContextFailure(error);
    return null;
  }
}
