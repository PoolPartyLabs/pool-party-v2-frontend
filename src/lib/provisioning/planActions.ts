/**
 * @id PP-CORE-LIB-016 (POO-1024, POO-1042, POO-1044)
 * @name provisioning plan server actions
 * @implements-rules-version v3 (POO-1044 rules v1) · v2 (POO-1042 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The server side of the provisioning planner, and the only place plan computation may touch a
 * secret or the network.
 *
 * Why this file exists. `src/lib/provisioning/index.ts` is imported by `"use client"` components, so
 * everything reachable from it ships to the browser. The real planner (POO-1034) calls the Uniswap
 * Trading API with `UNISWAP_API_KEY`, which is server-only (ADR 0003). Putting the planner directly
 * in `planner.ts` would either break the Next build on the `server-only` import, or, if the key were
 * ever given a `NEXT_PUBLIC_` prefix, silently ship a credential to every browser. Neither
 * `typecheck`, `lint`, `test` nor `i18n:check` catches that; only `pnpm build` does, plus the
 * import-graph guard in `serverBoundary.test.ts`.
 *
 * A `"use server"` module is a boundary rather than an edge: Next compiles it to an RPC stub on the
 * client, so a client component may import it freely and the implementation never reaches the bundle.
 *
 * Following the house action contract (`investActions.ts`): an action never throws across the RSC
 * boundary. It returns `{ ok: true, … } | { ok: false, code, message }`, so a failure code lands
 * where callers can act on it instead of surfacing as an opaque rejection.
 *
 * ## POO-1042: the planner is wired
 *
 * `computePlanAction` used to return a hard `PROVISIONING_PLANNER_UNAVAILABLE`, because
 * `ProvisioningNeedInput` is USD-only: it carries no token addresses and no base-unit amounts, so it
 * cannot drive a real quote. What was missing was the assembly in front of it, and that is what
 * POO-1042 adds — the live inventory plus the per-chain gas verdicts, and the user's own selection
 * order.
 *
 * **The client sends KEYS, never money.** A selection arrives as `chainId:address` strings and is
 * resolved against an inventory this action reads server-side, from the SIWE wallet. So no amount,
 * no USD figure and no wallet address a caller supplied can reach `buildPlan`: the fields simply do
 * not exist on the wire. That is stronger than validating them, because there is no check to loosen
 * later.
 */
"use server";

import { getSessionWallet } from "@/lib/auth/session";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { getUsdcAddress } from "@/lib/chains/config";
import { buildPlan } from "./buildPlan";
import type { ProvisioningGateContext } from "./gateContext";
import { buildProvisioningGateContext } from "./gateContext";
import type { ProvisioningNeedInput, ProvisioningPlan } from "./types";

/** The plan action's result. Mirrors `BuildTxResult` in `@/lib/tx/actionResult`. */
export type ProvisioningPlanResult =
  | { ok: true; plan: ProvisioningPlan }
  | { ok: false; code: string; message: string };

/** The context action's result, same contract. */
export type ProvisioningContextResult =
  | { ok: true; context: ProvisioningGateContext }
  | { ok: false; code: string; message: string };

/** USDC has 6 decimals everywhere this app operates, and is priced 1:1 with the dollar. */
const USDC_DECIMALS = 6;

/** Not signed in. Matches the shipped `SESSION_MISSING` contract in `investActions.ts`. */
const sessionMissing = {
  ok: false,
  code: "SESSION_MISSING",
  message: "Wallet session not established",
} as const;

/**
 * Everything the pre-flight gate needs to know about the signed-in wallet, for an operation on
 * `targetChainId`.
 *
 * The wallet is the session's, never the caller's — the parameter does not exist, so there is no
 * path to someone else's holdings for a future change to open. A degraded read is reported as a
 * typed failure and the gate treats it as "do not gate" ([R6]).
 */
export async function getProvisioningContextAction(
  targetChainId: number,
): Promise<ProvisioningContextResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing;

  try {
    const context = await buildProvisioningGateContext(wallet, targetChainId);
    if (!context) {
      return {
        ok: false,
        code: "PROVISIONING_BALANCES_UNAVAILABLE",
        message: "The wallet's balances could not be read.",
      };
    }
    return { ok: true, context };
  } catch (error) {
    return { ok: false, code: "SYSTEM_INTERNAL", message: String(error) };
  }
}

/**
 * USD value of the target chain's USDC the wallet already holds.
 *
 * Derived from the inventory rather than from `balancesByChain.tokenUsd`, which counts every
 * routable token on the chain: a WETH holding there is not USDC and still needs a swap, so counting
 * it would under-size the requirement and produce a plan that lands short. Sub-$1 USDC dust is
 * filtered out of the inventory and therefore under-counted here, which errs towards asking for
 * slightly more than needed.
 */
function usdcHeldOnChain(sources: readonly FundingSource[], chainId: number): number {
  const usdc = getUsdcAddress(chainId)?.toLowerCase();
  if (!usdc) return 0;
  return sources
    .filter((source) => source.chainId === chainId && source.address.toLowerCase() === usdc)
    .reduce((total, source) => total + (Number.isFinite(source.usd) ? source.usd : 0), 0);
}

/** A USD figure as USDC base units, truncated: never claim more than the dollar figure covers. */
function toUsdcBaseUnits(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return "0";
  return BigInt(Math.floor(amountUsd * 10 ** USDC_DECIMALS)).toString();
}

/**
 * Compute a provisioning plan server-side.
 *
 * `selection` is the user's picks in PICK ORDER, which `buildPlan` treats as route order ([R4] of
 * POO-1034): the plan the user reviewed is the plan that executes, so this must not sort. An empty
 * selection is legitimate, not an error: a gas-only operation on a chain that must buy its own gas
 * produces a one-step plan with no funding source at all.
 *
 * Sources that cannot route to the operation's chain are dropped here as well as in the UI ([R8]).
 * The UI filter is what stops a user picking one; this is what stops a stale selection, or anything
 * that bypassed the UI, reaching a quote that would 404.
 *
 * **No `gasChoice` parameter, and POO-1044 [R6] settled that there will not be one.** In mock mode
 * the inline gas selector resizes the plan through {@link computePlan}'s own mock branch. In real
 * mode the top-up is sized by the gas classifier from a live quote: the chain's shortfall, plus
 * headroom, plus the top-up transaction's own cost. A typed amount cannot improve on that figure,
 * and the selector's [$10, $200] bounds are the PAYBIS FIAT MINIMUM, which a token swap does not
 * have. Honouring them would spend $10 of a user's holding buying native on a chain that needs six
 * cents of it. Taking the parameter and ignoring it would be worse still: the signature would
 * promise something the plan does not honour. The panel renders the selector in mock mode only.
 */
export async function computePlanAction(
  input: ProvisioningNeedInput,
  selection?: readonly string[],
): Promise<ProvisioningPlanResult> {
  const wallet = await getSessionWallet();
  if (!wallet) return sessionMissing;

  try {
    const context = await buildProvisioningGateContext(wallet, input.targetChainId);
    if (!context) {
      return {
        ok: false,
        code: "PROVISIONING_BALANCES_UNAVAILABLE",
        message: "The wallet's balances could not be read.",
      };
    }

    const byKey = new Map(
      context.sources.map((source) => [
        `${source.chainId}:${source.address.toLowerCase()}`,
        source,
      ]),
    );
    const picked: FundingSource[] = [];
    for (const key of selection ?? []) {
      const source = byKey.get(key);
      // A key naming no current source is a selection that outlived its inventory (the holding was
      // spent or moved). Dropping it is right: re-deriving the plan from fresh balances is what
      // makes it safe to re-run at all.
      if (!source || picked.includes(source)) continue;
      if (!source.reachableChainIds.includes(context.targetChainId)) continue;
      picked.push(source);
    }

    // What must LAND on the operation's chain: the operation's USDC requirement, less the USDC
    // already sitting there. `gasChoice` does not enter here — a gas top-up is sized by the gas
    // classifier and emitted as its own leg, not as part of the funding requirement.
    const stillNeededUsd = Math.max(
      0,
      input.opRequiredUsdc - usdcHeldOnChain(context.sources, context.targetChainId),
    );

    return await buildPlan({
      targetChainId: context.targetChainId,
      requiredAmount: toUsdcBaseUnits(stillNeededUsd),
      requiredUsd: stillNeededUsd,
      sources: picked,
      // What the user elected to SPEND is `picked`; gas is not a spend choice. A wallet holding USDC
      // and ETH on Base, funding an Arbitrum strategy from the USDC, still has ETH to send over for
      // Arbitrum's gas, and should not have to select it to make that happen (POO-1075 [R1]). Same
      // inventory the gas TOP-UP classifier already draws from.
      // Both lists: the routable inventory, plus every native holding unfiltered. The gas donor
      // must not be gated by the picker's sub-$1 dust rule, which is about what can be SPENT
      // (POO-1076). Dedup is not needed, the donor lookup takes the first match.
      inventory: [...(context.nativeHoldings ?? []), ...context.sources],
      gasByChain: context.gasByChain,
      ...(input.slippagePct === undefined ? {} : { slippagePct: input.slippagePct }),
    });
  } catch (error) {
    return { ok: false, code: "SYSTEM_INTERNAL", message: String(error) };
  }
}
