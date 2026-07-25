/**
 * @id PP-STR-LIB-017 (POO-1036)
 * @name buildPlanSteps (provisioning execution rail)
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The seam the Universal Funding epic converges on: it turns a priced {@link ProvisioningPlan} into
 * the ordered {@link FlowStep}s that {@link useWalletSignFlow} already knows how to run.
 *
 * ## We did not build an execution engine
 *
 * This repository already has one. `useWalletSignFlow` gives per-step status, per-step hashes,
 * resume-from-the-failed-step retry, `retryFrom(key)`, and a `{ skipped: true }` no-op, and
 * `executeBuiltTransaction` is the single broadcast choke point that asserts the wallet's chain (with
 * ONE corrective switch and a re-verify, `WRONG_CHAIN`) and its active account (`WRONG_ACCOUNT`).
 * So this file is an adapter, not a runtime: **cross-chain leg-to-leg chain switching needs no new
 * switching logic at all** ([R1]), it falls out of routing every broadcast through that choke point
 * with the leg's own chain as the target.
 *
 * ## What a leg costs at the wallet
 *
 * Per leg, in order: an ERC-20 approval (its own step, so it can render as skipped), then a re-quote,
 * then an optional Permit2 signature, then the broadcast.
 *
 *   approve:<key>   `/check_approval` → no calldata means the allowance already covers it ([R2])
 *   <key>           `/quote` → (sign) → `/swap` → executeBuiltTransaction ([R1], [R3], [R4], [R5])
 *
 * A native `tokenIn` gets no approval step at all: there is no ERC-20 allowance to grant, and asking
 * anyway spends an upstream call to be told so.
 *
 * ## Why the quote is taken here and not in the planner
 *
 * The planner's figures are for PRICING ([R8] of POO-1034). A quote for leg N+1 taken before leg N
 * executes is a guess: the realized output differs from the quoted one and a quote expires long
 * before a bridge settles. So a leg the planner flagged {@link ProvisioningLeg.requoteAtExecution} is
 * re-sized here from the balance the previous leg ACTUALLY produced ([R6]), measured as a delta
 * against a baseline recorded before that leg broadcast. The delta matters: an absolute balance read
 * would spend the user's pre-existing holding of the same token, which they never allocated to this
 * route.
 *
 * ## Money convention
 *
 * Token amounts are base-unit decimal STRINGS and every comparison is `BigInt`. `tx.value` is the one
 * field the live API returns as HEX (`"0x00"`), so it is normalised through `BigInt()` before it
 * reaches anything that reads it as decimal ([R5]).
 *
 * ## Deliberately NOT here
 *
 * - **Bridge settlement (POO-1037).** A source receipt proves only that the funds LEFT. Arrival is a
 *   separate observation on the destination chain, minutes later. The baseline this rail records is
 *   exactly the `destBalanceBefore` that test needs; the polling itself is the next issue.
 * - **The recovery journal (POO-1038).** The rail carries in-flight facts forward through the flow
 *   context; persisting them to `localStorage` and reconciling on reload is that issue.
 * - **The bridge-spender ERC-20 allowance.** `02_BRIDGE_ARCHITECTURE.md` §1.2 claims `/check_approval`
 *   reports only the Permit2 allowance, so a BRIDGE route's own spender may need a separate approval.
 *   The action's cross-chain form (`tokenOut` + `tokenOutChainId`) is passed here, which is the shape
 *   the API documents for exactly that case; whether it covers the bridge spender is unmeasured, and
 *   guessing produces either a redundant wallet prompt or a false failure. See the PP-TODO below.
 *
 * PP-INTEGRATION-POINT: every wallet interaction a funding plan performs is issued from this module,
 * against the Uniswap server-action layer (PP-CORE-LIB-052) injected as {@link PlanRailDeps}.
 */
import type { ProvisioningLeg, ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/provisioning";
import type { BuiltTx } from "@/lib/tx/builtTxSchema";
import {
  type Eip1193Provider,
  executeBuiltTransaction,
  TransactionError,
} from "@/lib/tx/sendTransaction";
import type { UniswapQuoteResponse, UniswapTransactionRequest } from "@/lib/uniswap/schemas";
import type { FlowStep, FlowStepResult } from "../hooks/useWalletSignFlow";

/**
 * The accumulating context, typed as the panel types it. `ProvisioningPanel` runs the rail with
 * `FlowStep<Record<string, unknown>>`, so anything narrower here would not be assignable to the prop
 * it exists to satisfy. The rail's own state therefore lives under ONE well-known key and is narrowed
 * on read ({@link readRailState}) rather than trusted.
 */
export type PlanRailCtx = Record<string, unknown>;

/** Where {@link PlanRailState} lives inside {@link PlanRailCtx}. */
export const PLAN_RAIL_STATE_KEY = "provisioningRail";

/**
 * What the rail carries from one leg to the next. All maps are keyed by {@link ProvisioningLeg.index}
 * (stringified, as object keys are), and every value is a base-unit decimal string.
 *
 * PP-INTEGRATION-POINT (POO-1038): this is the in-memory shape of the recovery journal. Persisting it
 * before each broadcast, and reconciling it against on-chain receipts on reload, is that issue's work.
 */
export interface PlanRailState {
  /** Balance of a leg's `tokenOut`, on its destination chain, read BEFORE that leg broadcast. */
  outBaselines: Record<string, string>;
  /** The amount a leg really spends, resolved once and reused so its approval cannot disagree. */
  legAmountsIn: Record<string, string>;
  /** The broadcast hash per leg. */
  legHashes: Record<string, string>;
}

/** The result shape every injected server action returns (mirrors `UniswapActionResult`). */
export type RailActionResult<TPayload> =
  | ({ ok: true } & TPayload)
  | { ok: false; code: string; message: string };

/** `POST /quote` input, structurally identical to the action's `QuoteSwapInput`. */
export interface RailQuoteInput {
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string;
  type?: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance?: number;
}

/** `POST /check_approval` input, structurally identical to the action's `CheckApprovalInput`. */
export interface RailApprovalInput {
  token: string;
  amount: string;
  chainId: number;
  tokenOut?: string;
  tokenOutChainId?: number;
}

/** An EIP-712 payload in the shape a wallet signer takes. Never carries a native bigint ([R3]). */
export interface RailTypedData {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * Everything the rail needs from the outside, injected rather than imported.
 *
 * The three Uniswap calls are parameters on purpose. They are `"use server"` actions whose transport
 * reads `UNISWAP_API_KEY` (ADR 0003), so importing them here would tie this module to the server
 * graph for no gain, and the suite would have to mock a module boundary instead of passing functions.
 */
export interface PlanRailDeps {
  /** The wallet address the plan was priced for. Derived from the SIWE session by the caller. */
  owner: string;
  /** The connected wallet's provider. Chain switching is the choke point's job, not the caller's. */
  provider: Eip1193Provider;
  /** Sign EIP-712 typed data (Privy's `useSignTypedData`), resolving with the signature. */
  signTypedData: (data: RailTypedData) => Promise<string>;
  /** Base-unit balance of `token` for `owner` on `chainId`, as a decimal string. */
  readTokenBalance: (args: { chainId: number; token: string; owner: string }) => Promise<string>;
  quoteSwap: (input: RailQuoteInput) => Promise<RailActionResult<{ quote: UniswapQuoteResponse }>>;
  checkApproval: (input: RailApprovalInput) => Promise<
    RailActionResult<{
      approval: UniswapTransactionRequest | null;
      cancel: UniswapTransactionRequest | null;
    }>
  >;
  buildSwapTx: (input: {
    quote: UniswapQuoteResponse;
    signature?: string;
  }) => Promise<RailActionResult<{ swap: UniswapTransactionRequest }>>;
  /** Max slippage in percent. Falls back to the plan's own echoed figure. AMM legs only. */
  slippagePct?: number;
}

/** Whether a rail step grants an allowance or executes the route leg itself. */
export type PlanRailStepKind = "approve" | "leg";

/**
 * One step of the rail. Exported because it is the plan's EXECUTION shape, which the plan card
 * (POO-1041) has to render: the rail emits an approval step per leg that the plan itself does not
 * contain, so a view built only from `plan.steps` would silently omit rows the user is signing.
 */
export type PlanRailStep =
  | {
      key: string;
      kind: "approve";
      planStep: ProvisioningStep;
      leg: ProvisioningLeg;
      previousLeg?: ProvisioningLeg;
    }
  | {
      key: string;
      kind: "leg";
      planStep: ProvisioningStep;
      leg?: ProvisioningLeg;
      previousLeg?: ProvisioningLeg;
    };

/** Calldata: 0x-prefixed and NON-EMPTY. `"0x"` fails this, which is the point ([R4]). */
const CALLDATA_PATTERN = /^0x[0-9a-fA-F]+$/;

/** A frozen empty state, so a context that carries none can never be written through. */
const EMPTY_RAIL_STATE: PlanRailState = Object.freeze({
  outBaselines: Object.freeze({}) as Record<string, string>,
  legAmountsIn: Object.freeze({}) as Record<string, string>,
  legHashes: Object.freeze({}) as Record<string, string>,
});

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Read the rail's own state out of the accumulating context, tolerating an absent/foreign shape. */
export function readRailState(ctx: PlanRailCtx): PlanRailState {
  const raw = ctx[PLAN_RAIL_STATE_KEY];
  if (!raw || typeof raw !== "object") return EMPTY_RAIL_STATE;
  const state = raw as Partial<PlanRailState>;
  return {
    outBaselines: state.outBaselines ?? {},
    legAmountsIn: state.legAmountsIn ?? {},
    legHashes: state.legHashes ?? {},
  };
}

/**
 * The rail steps a plan expands into, in execution order.
 *
 * Pure and exported so the same decomposition drives the UI. Three shapes it deliberately produces:
 * no approval for a native `tokenIn`, no approval for a step whose `method` this rail cannot execute
 * (never prompt for an allowance a step will not use), and a leg-less step for a plan step the rail
 * cannot run at all, which fails legibly instead of being dropped. Dropping it would let a plan
 * silently execute fewer steps than the user approved.
 */
export function planRailSteps(plan: ProvisioningPlan): PlanRailStep[] {
  const rail: PlanRailStep[] = [];
  let previousLeg: ProvisioningLeg | undefined;

  for (const planStep of plan.steps) {
    // The trailing anchor is a display marker for the operation itself, not a route leg.
    if (planStep.type === "op") continue;
    const leg = planStep.leg;
    if (!leg) {
      rail.push({ key: planStep.key, kind: "leg", planStep });
      continue;
    }
    if (isExecutable(planStep) && !sameAddress(leg.tokenIn.address, NATIVE_TOKEN_ADDRESS)) {
      rail.push({ key: `approve:${planStep.key}`, kind: "approve", planStep, leg, previousLeg });
    }
    rail.push({ key: planStep.key, kind: "leg", planStep, leg, previousLeg });
    previousLeg = leg;
  }
  return rail;
}

/**
 * Map a priced plan onto the wallet-sign rail.
 *
 * This is the function `ProvisioningPanel`'s `buildPlanSteps` prop has been typed for since the epic
 * was designed and, until now, passed by no production caller (its fallback settles a `0xMOCK…MOCK`
 * hash after 900 ms). Bind the deps in a closure at the call site:
 * `buildPlanSteps={(plan) => buildPlanSteps(plan, deps)}`.
 */
export function buildPlanSteps(
  plan: ProvisioningPlan,
  deps: PlanRailDeps,
): FlowStep<PlanRailCtx>[] {
  const slippagePct = deps.slippagePct ?? plan.slippagePct;
  return planRailSteps(plan).map((railStep) => ({
    key: railStep.key,
    run: (ctx: PlanRailCtx) =>
      railStep.kind === "approve"
        ? runApprovalStep(railStep, ctx, deps)
        : runLegStep(railStep, ctx, deps, slippagePct),
  }));
}

/**
 * Grant the allowance this leg needs, or declare there is nothing to grant ([R2]).
 *
 * The amount is resolved HERE and carried forward, so the approval and the leg cannot disagree about
 * what is being spent: an allowance sized to one figure and a swap sized to a larger one reverts.
 * Approvals are sized to the plan, never unbounded (UF-28 R3).
 */
async function runApprovalStep(
  railStep: Extract<PlanRailStep, { kind: "approve" }>,
  ctx: PlanRailCtx,
  deps: PlanRailDeps,
): Promise<FlowStepResult<PlanRailCtx>> {
  const { leg } = railStep;
  const { amount, state } = await resolveAmountIn(leg, railStep.previousLeg, ctx, deps);
  const crossChain = leg.tokenIn.chainId !== leg.tokenOut.chainId;

  // PP-TODO(POO-1043): verify against the live API whether the cross-chain form also reports the
  // BRIDGE route's own spender allowance (`02_BRIDGE_ARCHITECTURE.md` §1.2 says it does not, in
  // which case a bridge leg needs an `allowance(owner, swap.to)` read and its own approval).
  const result = await deps.checkApproval({
    token: leg.tokenIn.address,
    amount,
    chainId: leg.chainId,
    ...(crossChain
      ? { tokenOut: leg.tokenOut.address, tokenOutChainId: leg.tokenOut.chainId }
      : {}),
  });
  if (!result.ok) throw actionError(result);

  // [R7] A new context partial, never a write into the one this step was handed.
  const carried = { [PLAN_RAIL_STATE_KEY]: state };
  // [R2] No calldata means the allowance already covers this amount. The flow renders it skipped.
  // Checked BEFORE the cancel below: a zeroing transaction with no approval to follow it would spend
  // the user's gas to lower an allowance nothing asked us to change.
  if (!result.approval) return { ...carried, skipped: true };
  // Some tokens (USDT-class) reject a non-zero allowance being raised; the API returns the zeroing
  // transaction alongside, and skipping it makes the approval itself revert.
  if (result.cancel) await broadcast(result.cancel, leg.chainId, deps);
  return { ...carried, txHash: await broadcast(result.approval, leg.chainId, deps) };
}

/**
 * Execute one route leg: re-quote, record the destination baseline, sign any permit, build, broadcast.
 *
 * The baseline read sits before ANY wallet prompt on purpose (`02_BRIDGE_ARCHITECTURE.md` §3.4): it is
 * the "before" side of the arrival test for a bridge, and the divisor of the next leg's sizing, and
 * neither is measurable once the transaction is in flight.
 */
async function runLegStep(
  railStep: Extract<PlanRailStep, { kind: "leg" }>,
  ctx: PlanRailCtx,
  deps: PlanRailDeps,
  slippagePct: number | undefined,
): Promise<FlowStepResult<PlanRailCtx>> {
  const { planStep, leg } = railStep;
  if (!leg) throw unsupportedStep(planStep, "carries no executable route leg");
  if (!isExecutable(planStep)) throw unsupportedStep(planStep, `uses ${planStep.method}`);

  const { amount, state } = await resolveAmountIn(leg, railStep.previousLeg, ctx, deps);

  // [R6] The quote that actually gets signed is taken now, at the size this leg really spends.
  // EXACT_INPUT because at execution time the known quantity is what we hold, not what we want.
  const quoted = await deps.quoteSwap({
    tokenIn: leg.tokenIn.address,
    tokenOut: leg.tokenOut.address,
    tokenInChainId: leg.tokenIn.chainId,
    tokenOutChainId: leg.tokenOut.chainId,
    amount,
    type: "EXACT_INPUT",
    ...(slippagePct === undefined ? {} : { slippageTolerance: slippagePct }),
  });
  if (!quoted.ok) throw actionError(quoted);

  // PP-INTEGRATION-POINT (POO-1037/POO-1038): the pre-broadcast destination balance. A bridge settles
  // when `balanceOf(tokenOut) - this >= minAmountOut` on the destination chain, which is an
  // observation this rail records but does not yet poll for.
  const baseline = await deps.readTokenBalance({
    chainId: leg.tokenOut.chainId,
    token: leg.tokenOut.address,
    owner: deps.owner,
  });
  const withBaseline: PlanRailState = {
    ...state,
    outBaselines: { ...state.outBaselines, [leg.index]: baseline },
  };

  // [R3] A quote that carries `permitData` needs it signed before `/swap` will build anything.
  const permitData = quoted.quote.permitData;
  const signature = permitData
    ? await deps.signTypedData(toSignableTypedData(permitData))
    : undefined;

  const built = await deps.buildSwapTx({
    quote: quoted.quote,
    ...(signature === undefined ? {} : { signature }),
  });
  if (!built.ok) throw actionError(built);

  // [R1] The single broadcast choke point: chain assertion (one corrective switch, then re-verify)
  // and account assertion, inherited rather than re-implemented.
  const txHash = await broadcast(built.swap, leg.chainId, deps);
  // PP-TODO(POO-1037): for a bridge leg this hash proves only that the funds LEFT the source chain.
  // Arrival is a destination-chain observation, minutes later, and is that issue's polling loop.
  return {
    [PLAN_RAIL_STATE_KEY]: {
      ...withBaseline,
      legHashes: { ...withBaseline.legHashes, [leg.index]: txHash },
    },
    txHash,
  };
}

/**
 * How much this leg spends, in base units ([R6]).
 *
 * Resolved once per leg and memoised into the context, because the approval step and the leg step
 * both need it and a second on-chain read between them could return a different number.
 *
 * A leg the planner did NOT flag spends a balance that already exists, so its planned figure is
 * exact. A flagged leg is fed by the previous one, and is sized from the DELTA against the baseline
 * recorded before that leg broadcast: an absolute read would sweep in the user's pre-existing holding
 * of the same token, which they never allocated to this route.
 */
async function resolveAmountIn(
  leg: ProvisioningLeg,
  previousLeg: ProvisioningLeg | undefined,
  ctx: PlanRailCtx,
  deps: PlanRailDeps,
): Promise<{ amount: string; state: PlanRailState }> {
  const state = readRailState(ctx);
  const memoised = state.legAmountsIn[String(leg.index)];
  if (memoised) return { amount: memoised, state };

  const amount = leg.requoteAtExecution
    ? await sizeFromRealBalance(leg, previousLeg, state, deps)
    : leg.amountIn;
  return {
    amount,
    state: { ...state, legAmountsIn: { ...state.legAmountsIn, [leg.index]: amount } },
  };
}

/** The realized output of the leg that feeds this one, read on-chain as a delta ([R6]). */
async function sizeFromRealBalance(
  leg: ProvisioningLeg,
  previousLeg: ProvisioningLeg | undefined,
  state: PlanRailState,
  deps: PlanRailDeps,
): Promise<string> {
  const balance = toBigInt(
    await deps.readTokenBalance({
      chainId: leg.chainId,
      token: leg.tokenIn.address,
      owner: deps.owner,
    }),
    "balance",
  );

  const feeds =
    previousLeg !== undefined &&
    previousLeg.tokenOut.chainId === leg.tokenIn.chainId &&
    sameAddress(previousLeg.tokenOut.address, leg.tokenIn.address);
  const baseline = feeds ? state.outBaselines[String(previousLeg.index)] : undefined;

  // No baseline means nothing in this run produced this token, so there is no delta to measure.
  // Fall back to the smaller of what the user approved and what is actually there: the first never
  // spends beyond the reviewed plan, the second never builds a transaction that cannot settle.
  const planned = toBigInt(leg.amountIn, "amount");
  const amount =
    baseline === undefined
      ? planned < balance
        ? planned
        : balance
      : balance - toBigInt(baseline, "balance");

  if (amount <= BigInt(0)) {
    throw new TransactionError("The previous funding step delivered nothing to continue with", {
      code: "PROVISIONING_LEG_EMPTY",
    });
  }
  return amount.toString();
}

/** Send a provider-built transaction through the shipped choke point and wait for its receipt. */
function broadcast(
  request: UniswapTransactionRequest,
  targetChainId: number,
  deps: PlanRailDeps,
): Promise<`0x${string}`> {
  return executeBuiltTransaction(
    deps.provider,
    toBuiltTx(request, deps.owner),
    deps.owner,
    targetChainId,
  );
}

/**
 * Adapt a Uniswap `TransactionRequest` into the {@link BuiltTx} the send path takes, asserting the
 * two fields that are wrong in ways a wallet will not catch.
 *
 * [R4] `data` must be non-empty hex. The schema already enforces it, and it is re-asserted here
 * because the cost of being wrong is a mined transaction that reverts and burns the gas. A stale
 * quote is exactly how `/swap` returns empty calldata, and a stale quote is normal on this rail.
 *
 * [R5] `value` arrives as HEX from the live API. `request.chainId` rides along so the choke point's
 * build-vs-target check (`BUILD_TARGET_MISMATCH`) cross-checks the route's own chain for free.
 */
function toBuiltTx(request: UniswapTransactionRequest, owner: string): BuiltTx {
  if (!CALLDATA_PATTERN.test(request.data)) {
    throw new TransactionError(
      "The funding route returned empty calldata, which would revert on-chain",
      { code: "PROVISIONING_EMPTY_CALLDATA" },
    );
  }
  return {
    tx: {
      to: request.to,
      from: request.from ?? owner,
      data: request.data,
      value: normaliseWeiValue(request.value),
    },
    chainId: request.chainId,
  };
}

/**
 * A wei amount as a decimal string, from either the hex the API sends or a decimal ([R5]).
 *
 * Explicitly NOT the silent-zero fallback `toHexValue` uses: a value it cannot parse becomes `0x0`
 * there, which for a `WRAP` route would drop the native amount and mine a transaction that does
 * nothing. Refusing to send is the only safe reading of an amount we cannot understand.
 */
function normaliseWeiValue(value: string | undefined): string {
  if (value === undefined || value.trim() === "") return "0";
  return toBigInt(value, "value").toString();
}

/** Parse a base-unit amount (decimal or hex). Rejects anything unparseable or negative. */
function toBigInt(value: string, label: string): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value.trim());
  } catch {
    throw new TransactionError(`The funding route's ${label} is not a valid amount: ${value}`, {
      code: "PROVISIONING_INVALID_AMOUNT",
    });
  }
  if (parsed < BigInt(0)) {
    throw new TransactionError(`The funding route's ${label} is negative: ${value}`, {
      code: "PROVISIONING_INVALID_AMOUNT",
    });
  }
  return parsed;
}

/**
 * Uniswap's `permitData` as a signable EIP-712 payload, with **every uint as a decimal string** ([R3]).
 *
 * Twice-learned in this codebase (POO-1001, then POO-1002's create-pool twin): Privy's embedded
 * (social-login) wallet signer `JSON.stringify`s typed data, and `JSON.stringify` throws
 * "Do not know how to serialize a BigInt". External wallets tolerate a native bigint through a
 * different path, so this fails for social-login users only, which is the worst way to find out.
 * Decimal strings are the canonical EIP-712 JSON encoding for uints and hash identically, so the
 * signature is unchanged and both wallet types sign.
 *
 * `domain.chainId` is the one field kept NUMERIC, mirroring the shipped `permitTypedData`: viem's
 * signer types it as a number.
 */
export function toSignableTypedData(permitData: {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  values: Record<string, unknown>;
}): RailTypedData {
  const domain = normaliseTypedValue(permitData.domain) as Record<string, unknown>;
  const chainId = domain.chainId;
  return {
    domain:
      typeof chainId === "string" && /^\d+$/.test(chainId)
        ? { ...domain, chainId: Number(chainId) }
        : domain,
    types: normaliseTypedValue(permitData.types) as Record<string, unknown>,
    primaryType: resolvePrimaryType(permitData.types),
    message: normaliseTypedValue(permitData.values) as Record<string, unknown>,
  };
}

/** Deep-copy, turning every native bigint into its decimal string. Everything else passes through. */
function normaliseTypedValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normaliseTypedValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        normaliseTypedValue(nested),
      ]),
    );
  }
  return value;
}

/**
 * The primary type of an EIP-712 type graph: the struct nothing else references.
 *
 * The API sends `{ domain, types, values }` with no `primaryType`, and a wallet needs one. Deriving
 * it beats hardcoding `"PermitSingle"`, which would silently sign the wrong struct the day a route
 * returns a different permit shape. Ambiguity (more than one root) resolves to declaration order,
 * which is the same answer a hardcode would have given for the shape we do see.
 */
function resolvePrimaryType(types: Record<string, unknown>): string {
  const declared = Object.keys(types).filter((name) => name !== "EIP712Domain");
  const referenced = new Set<string>();
  for (const fields of Object.values(types)) {
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      const type = (field as { type?: unknown }).type;
      // Strip an array suffix: `PermitDetails[]` still references `PermitDetails`.
      if (typeof type === "string") referenced.add(type.replace(/\[\d*\]$/, ""));
    }
  }
  return declared.find((name) => !referenced.has(name)) ?? declared[0] ?? "PermitSingle";
}

/** Only a plain broadcast is executable here; EIP-5792 batching (`SEND_CALLS`) is out of scope. */
function isExecutable(planStep: ProvisioningStep): boolean {
  return planStep.method === undefined || planStep.method === "SEND_TX";
}

/** A step this rail cannot run. Fails legibly rather than being silently skipped. */
function unsupportedStep(planStep: ProvisioningStep, detail: string): TransactionError {
  return new TransactionError(
    `Funding step "${planStep.key}" ${detail}, which this rail cannot execute.`,
    { code: "PROVISIONING_STEP_UNSUPPORTED" },
  );
}

/**
 * A typed action failure as the throw the flow expects. The house contract (POO-475 [R3]): the code
 * rides on `error.cause.code`, which is where `toTxError` / `classifyTxError` read it, so a funding
 * failure classifies exactly like every other build-action failure.
 */
function actionError(failure: { code: string; message: string }): TransactionError {
  return new TransactionError(failure.message, { code: failure.code });
}
