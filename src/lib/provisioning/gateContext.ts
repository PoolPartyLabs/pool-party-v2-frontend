/**
 * @id PP-CORE-LIB-057 (POO-1042)
 * @name provisioning gate context
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Everything the pre-flight gate needs to know about a wallet, read once, server-side.
 *
 * Until now the gate's real branch was a hard-disable stub: `realProvisioningInput` returned a
 * wallet holding a million dollars, so it could never trip, and the whole rail below it was
 * unreachable outside a local mock demo. This file is what replaces the stub — the one place the
 * live reads happen, so the six op modals stay identical and there is nowhere for a second,
 * divergent assembly to grow.
 *
 * Three answers come out of it:
 *
 *   **What is where** ([R1]). Per-chain native and token USD, from the shipped multi-chain holdings
 *   read. Native and token are separated because only the chain's OWN native coin can pay for a
 *   transaction there, which is the fact the whole gas model turns on.
 *
 *   **Can each chain transact** ([R9]). A {@link GasFeasibility} verdict for every candidate source
 *   chain AND for the operation's own chain. POO-1039 treats a chain with no verdict as selectable
 *   with no badge, deliberately erring towards letting a user spend their own money; supplying one
 *   for every chain is what makes that fallback unreachable in production rather than load-bearing.
 *
 *   **What gas actually costs** ([R4]). From a live `POST /quote`, never the `0.5` that
 *   `mapManagerStrategyDetail.ts` still hardcodes. The gate runs BEFORE the operation is built, and
 *   before this epic the only genuine gas figure in the codebase existed only AFTER a build.
 *
 * ## The fail-safe posture ([R6])
 *
 * A degraded read resolves to NO context, and no context means no gate: the operation proceeds
 * exactly as it does today. This is not defensive padding, it is the single most important
 * behavioural rule in the issue. A wallet that is genuinely funded, blocked by a provisioning modal
 * because a balance endpoint blipped, is strictly worse than never having built the feature.
 *
 * Which is also why the USDC-only on-chain fallback that {@link getFundingInventory} uses is
 * deliberately NOT used here. That path carries no native balances at all, so every chain would read
 * as having zero gas and the gate would fire on every operation, for every user, precisely while the
 * backend is unhealthy. Degrading to "we do not know" is honest; degrading to "you have no gas" is a
 * lie that costs the user their transaction.
 *
 * Server-only: it reads the wallet holdings API and quotes through the key-bearing Uniswap layer
 * (ADR 0003). A client surface reaches it through `getProvisioningContextAction` (`planActions.ts`),
 * which derives the wallet from the SIWE session.
 */
import "server-only";

import { fetchWalletHoldings } from "@/lib/balances/fetchWalletHoldings";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import { getFundingInventory, toBaseUnits } from "@/lib/balances/fundingInventory";
import type { TokenBalance } from "@/lib/balances/types";
import { getUsdcAddress } from "@/lib/chains/config";
// PP-INTEGRATION-POINT: per-chain gas pricing ← Uniswap `POST /quote`, through the server-action
// layer (PP-CORE-LIB-052). The only upstream call this module makes on its own account.
import { quoteSwap } from "@/lib/uniswap/actions";
import type {
  GasCandidateChain,
  GasFeasibility,
  GasSourceToken,
  RouteGasQuote,
} from "./gasFeasibility";
import { classifyGasFeasibility, quoteGasUsd } from "./gasFeasibility";
import type { ChainBalancesUsd } from "./types";
import { NATIVE_TOKEN_ADDRESS } from "./types";

/**
 * The size of the gas-pricing probe, in USDC base units: 1 USDC.
 *
 * Gas is a property of the transaction, not of its size, so the probe only has to be an amount that
 * routes. One dollar is small enough to quote on any pool we would ever fund through and large
 * enough not to fall under a minimum. It is never broadcast and never shown; only its `gasFeeUSD`
 * is read.
 */
const GAS_PROBE_USDC = "1000000";

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

/** A USD figure we are willing to add up: finite and not negative. */
function usd(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Per-chain native / token USD from the raw holdings ([R1]). */
function balancesByChain(holdings: readonly TokenBalance[]): Record<number, ChainBalancesUsd> {
  const byChain: Record<number, ChainBalancesUsd> = {};
  for (const holding of holdings) {
    const chain = byChain[holding.chainId] ?? { nativeUsd: 0, tokenUsd: 0 };
    if (holding.isNative) chain.nativeUsd += usd(holding.usd);
    else chain.tokenUsd += usd(holding.usd);
    byChain[holding.chainId] = chain;
  }
  return byChain;
}

/**
 * Live gas for one chain's transactions, in USD ([R4]).
 *
 * The probe is a USDC → native swap on that chain, which is not an arbitrary choice: it is the exact
 * shape of the `swap-gas` leg the planner prepends on a TOP_UP chain, so the figure prices the
 * cheapest real transaction this rail can put on that chain.
 *
 * The same figure fills three fields, for three stated reasons rather than as a shortcut:
 *
 *   `swapUsd`       this chain's own transaction, which is what was measured;
 *   `topUpSwapUsd`  a gas top-up IS this swap, so it costs this;
 *   `bridgeUsd`     only off-target, where the chain must also originate a bridge. Across's deposit
 *                   is cheaper than an AMM swap, so this over-states it. That is the safe direction:
 *                   over-stating asks for slightly more native headroom, under-stating strands the
 *                   user mid-route with a transaction they cannot pay for.
 *
 * `approvalUsd` is deliberately absent: `POST /check_approval` returns calldata and no gas figure,
 * so there is nothing to read, and inventing one is exactly what [R4] forbids. The classifier's 25%
 * proportional headroom plus its $0.05 floor is what covers it.
 *
 * An unquotable chain returns `{}` rather than a guess. The classifier then degrades to its bare
 * floor, which still refuses to promise that an empty wallet can transact but does not block a
 * funded one.
 */
async function quoteChainGas(chainId: number, targetChainId: number): Promise<RouteGasQuote> {
  const usdc = getUsdcAddress(chainId);
  if (!usdc) return {};

  const result = await quoteSwap({
    tokenIn: usdc,
    tokenOut: NATIVE_TOKEN_ADDRESS,
    tokenInChainId: chainId,
    tokenOutChainId: chainId,
    amount: GAS_PROBE_USDC,
    type: "EXACT_INPUT",
  });
  if (!result.ok) return {};

  const gasUsd = quoteGasUsd(result.quote);
  if (gasUsd === undefined) return {};

  return {
    swapUsd: gasUsd,
    topUpSwapUsd: gasUsd,
    ...(chainId === targetChainId ? {} : { bridgeUsd: gasUsd }),
  };
}

/** The non-native, routable holdings on `chainId`: what a gas top-up there could be sliced from. */
function gasSources(sources: readonly FundingSource[], chainId: number): GasSourceToken[] {
  return sources
    .filter((source) => source.chainId === chainId && !source.isNative)
    .map((source) => ({
      symbol: source.symbol,
      address: source.address,
      decimals: source.decimals,
      balanceRaw: source.amount,
      balanceUsd: source.usd,
    }));
}

/**
 * Assemble the gate context for `address` running an operation on `targetChainId`.
 *
 * Returns `null` when the wallet cannot be read ([R6]). Never throws: the caller is a server action
 * whose contract is a typed result, and a rejection here would surface to the browser as an opaque
 * failure that the gate would have no way to distinguish from "you are short".
 */
export async function buildProvisioningGateContext(
  address: `0x${string}`,
  targetChainId: number,
): Promise<ProvisioningGateContext | null> {
  if (!address) return null;

  let holdings: TokenBalance[];
  try {
    // Throws only when EVERY network failed. See the header for why the USDC-only fallback that
    // `getFundingInventory` uses is not acceptable HERE: it carries no native balances.
    holdings = await fetchWalletHoldings(address);
  } catch {
    return null;
  }

  // A routability outage costs the user the picker, not the gate: the balances are still known, so
  // the verdicts below are still true, and the panel renders an honest empty list.
  const sources = await getFundingInventory(address, holdings).catch(() => [] as FundingSource[]);

  // [R9] Every chain the user could spend FROM, plus the chain the operation runs ON, which needs
  // gas even when it funds nothing (the operation itself is a transaction there).
  const candidateChainIds = [
    ...new Set([...sources.map((source) => source.chainId), targetChainId]),
  ].sort((a, b) => a - b);

  const balances = balancesByChain(holdings);

  const candidates: GasCandidateChain[] = await Promise.all(
    candidateChainIds.map(async (chainId) => ({
      chainId,
      nativeBalanceUsd: balances[chainId]?.nativeUsd ?? 0,
      gas: await quoteChainGas(chainId, targetChainId),
      sources: gasSources(sources, chainId),
    })),
  );

  // Unfiltered, so a native balance under the picker's dust threshold can still donate gas.
  const nativeHoldings: FundingSource[] = holdings.flatMap((holding) => {
    if (!holding.isNative || !holding.address) return [];
    const amount = toBaseUnits(holding);
    if (amount === null) return [];
    return [
      {
        address: holding.address,
        chainId: holding.chainId,
        symbol: holding.symbol,
        decimals: holding.decimals,
        amount,
        usd: holding.usd,
        // Never used for gas donation, and an empty list must not read as "reaches everywhere".
        reachableChainIds: [],
        isNative: true,
        logoUrl: holding.logoUrl,
      },
    ];
  });

  const gasByChain: Record<number, GasFeasibility> = {};
  for (const verdict of classifyGasFeasibility(candidates)) {
    gasByChain[verdict.chainId] = verdict;
  }

  return {
    targetChainId,
    sources,
    nativeHoldings,
    gasByChain,
    balancesByChain: balances,
    // [R4] What the operation's chain must hold for the operation to run: quoted, plus headroom,
    // plus the gas swap's own cost when that chain has to buy its gas first.
    gasEstimateUsd: gasByChain[targetChainId]?.requiredGasUsd ?? 0,
  };
}
