/**
 * @id PP-STR-LIB-017 (POO-1036) · PP-STR-LIB-018 (POO-1037)
 * @name buildPlanSteps tests
 * @implements-rules-version v2 (POO-1037 rules v1) · v1 (POO-1036 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The rail adapter's spec, one describe per business rule. Everything is stubbed: the wallet is an
 * EIP-1193 handler map (so the SHIPPED chain/account assertions in `executeBuiltTransaction` really
 * run, rather than being mocked away), and the three Uniswap server actions are injected. No network.
 *
 * POO-1037 adds the settlement half: a bridge leg's source receipt proves only that the funds LEFT,
 * so the leg step now stays open until the DESTINATION balance clears the leg's floor. Every bridge
 * fixture here therefore has to deliver on the destination chain, or the leg legitimately waits.
 */
import { describe, expect, it, vi } from "vitest";
import type { ProvisioningLeg, ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";
import type { Eip1193Provider } from "@/lib/tx/sendTransaction";
import type { UniswapQuoteResponse, UniswapTransactionRequest } from "@/lib/uniswap/schemas";
import type { FlowStep } from "../hooks/useWalletSignFlow";
import {
  BRIDGE_PENDING_CODE,
  BRIDGE_POLL_MAX_DELAY_MS,
  BRIDGE_SETTLE_CEILING_MS,
} from "./awaitBridgeSettlement";
import {
  buildPlanSteps,
  PLAN_RAIL_STATE_KEY,
  type PlanRailCtx,
  type PlanRailDeps,
  type PlanRailState,
  planRailSteps,
} from "./buildPlanSteps";
import { decodeErc20Approval, encodeErc20Approval } from "./fundingAuthorisation";

const OWNER = "0xC3673ADc0000000000000000000000000000BEEF";
const POLYGON = 137;
const ARBITRUM = 42161;
const POLYGON_HEX = "0x89";
const ARBITRUM_HEX = "0xa4b1";

const WETH_POLYGON = {
  address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  symbol: "WETH",
  decimals: 18,
  chainId: POLYGON,
};
const USDC_POLYGON = {
  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  symbol: "USDC",
  decimals: 6,
  chainId: POLYGON,
};
const USDC_ARBITRUM = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  symbol: "USDC",
  decimals: 6,
  chainId: ARBITRUM,
};
const NATIVE_POLYGON = {
  address: "0x0000000000000000000000000000000000000000",
  symbol: "POL",
  decimals: 18,
  chainId: POLYGON,
};

/** A swap leg: 1 WETH on Polygon into Polygon USDC. Its input is a balance that already exists. */
function swapLeg(overrides: Partial<ProvisioningLeg> = {}): ProvisioningLeg {
  return {
    index: 0,
    kind: "swap-token",
    chainId: POLYGON,
    tokenIn: WETH_POLYGON,
    tokenOut: USDC_POLYGON,
    amountIn: "1000000000000000000",
    amountOutQuoted: "3000000000",
    minAmountOut: "2940000000",
    routing: "CLASSIC",
    gasUsd: 0.04,
    requoteAtExecution: false,
    ...overrides,
  };
}

/**
 * The destination-chain balance queue of a bridge that lands: nothing when the baseline is taken
 * (POO-1037 [R1] reads it BEFORE the broadcast), then the floor delivered on the first observation.
 * A queue of `["0"]` would be a bridge that never arrives, which the leg now waits for on purpose.
 */
const bridgeArrives = () => ["0", "2996000000"];

/** A bridge leg fed by the swap above, so it is re-sized at execution time ([R6]). */
function bridgeLeg(overrides: Partial<ProvisioningLeg> = {}): ProvisioningLeg {
  return {
    index: 1,
    kind: "bridge",
    chainId: POLYGON,
    tokenIn: USDC_POLYGON,
    tokenOut: USDC_ARBITRUM,
    amountIn: "3000000000",
    amountOutQuoted: "2996000000",
    minAmountOut: "2996000000",
    routing: "BRIDGE",
    gasUsd: 0.02,
    etaSeconds: 2,
    requoteAtExecution: true,
    ...overrides,
  };
}

function stepFor(leg: ProvisioningLeg): ProvisioningStep {
  return {
    type: leg.kind,
    key: `${leg.kind}-${leg.index}`,
    labelKey: `provisioning.steps.${leg.kind}`,
    fromToken: leg.tokenIn.symbol,
    toToken: leg.tokenOut.symbol,
    fromChainId: leg.tokenIn.chainId,
    toChainId: leg.tokenOut.chainId,
    chainId: leg.chainId,
    amountUsd: 3000,
    method: "SEND_TX",
    leg,
  };
}

function planOf(legs: ProvisioningLeg[]): ProvisioningPlan {
  return {
    needed: true,
    reason: ["usdc"],
    variant: "multi",
    steps: [
      ...legs.map(stepFor),
      { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 3000 },
    ],
    quote: {
      shortfallUsd: 3000,
      bufferUsd: 60,
      feesUsd: 4,
      totalPayUsd: 3064,
      quotedAt: "2026-07-25T00:00:00.000Z",
      ttlMs: 30_000,
    },
    slippagePct: 2,
  };
}

/** A transaction request in the shape the live API returns it: `value` as HEX ([R5]). */
function txRequest(overrides: Partial<UniswapTransactionRequest> = {}): UniswapTransactionRequest {
  return {
    to: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
    from: OWNER,
    data: "0x24856bc3deadbeef",
    value: "0x00",
    chainId: POLYGON,
    ...overrides,
  };
}

function quoteResponse(overrides: Partial<UniswapQuoteResponse> = {}): UniswapQuoteResponse {
  return {
    routing: "CLASSIC",
    quote: {
      input: { amount: "1000000000000000000", token: WETH_POLYGON.address },
      output: { amount: "3000000000", token: USDC_POLYGON.address },
    },
    ...overrides,
  } as UniswapQuoteResponse;
}

/** The canonical Permit2 deployment, the spender an ERC-20 approval on this rail grants. */
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

/**
 * Uniswap's own permit windows: a 30-day allowance expiration and a 30-minute signature deadline,
 * relative to now. Absolute timestamps would drift out of the authorisation guard's 90-day ceiling
 * (PP-CORE-SEC-001) as the clock advances, which is exactly the bound a real permit has to respect.
 */
const NOW_S = Math.floor(Date.now() / 1000);
const PERMIT_EXPIRATION = NOW_S + 30 * 24 * 60 * 60;
const PERMIT_SIG_DEADLINE = NOW_S + 30 * 60;

/** Permit2 typed data as the API returns it, with one uint deliberately a native bigint ([R3]). */
function permitData(): NonNullable<UniswapQuoteResponse["permitData"]> {
  return {
    domain: {
      name: "Permit2",
      chainId: POLYGON,
      verifyingContract: PERMIT2,
    },
    types: {
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
    },
    values: {
      details: {
        token: WETH_POLYGON.address,
        // The exact shape POO-1001 shipped a fix for: a native bigint that JSON.stringify throws on.
        amount: BigInt("1461501637330902918203684832716283019655932542975"),
        expiration: PERMIT_EXPIRATION,
        nonce: 0,
      },
      spender: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
      sigDeadline: BigInt(PERMIT_SIG_DEADLINE),
    },
  } as NonNullable<UniswapQuoteResponse["permitData"]>;
}

interface Harness {
  deps: PlanRailDeps;
  calls: string[];
  sent: { to: string; from: string; data: string; value: string }[];
  switched: string[];
  quoteSwap: ReturnType<typeof vi.fn>;
  checkApproval: ReturnType<typeof vi.fn>;
  buildSwapTx: ReturnType<typeof vi.fn>;
  signTypedData: ReturnType<typeof vi.fn>;
  readTokenBalance: ReturnType<typeof vi.fn>;
}

interface HarnessOptions {
  /** Per `chainId:token` queues of base-unit balances, consumed in call order. */
  balances?: Record<string, string[]>;
  /** The wallet's starting chain, as an eth_chainId hex quantity. */
  startChainHex?: string;
  /**
   * `true` synthesises the transaction the LIVE endpoint returns: an `approve` call on the token the
   * request named, sized to the requested amount (or to zero, for a cancel). An explicit request is
   * for the pathological fixtures. Realistic by default matters here because the rail now DECODES
   * this calldata before broadcasting it, so a hand-waved `0x095ea7b3aaaa` is not a transaction.
   */
  approval?: {
    approval: UniswapTransactionRequest | null | true;
    cancel?: UniswapTransactionRequest | null | true;
  };
  quote?: UniswapQuoteResponse;
  swap?: UniswapTransactionRequest;
}

function harness(options: HarnessOptions = {}): Harness {
  const calls: string[] = [];
  const sent: { to: string; from: string; data: string; value: string }[] = [];
  const switched: string[] = [];
  let chainHex = options.startChainHex ?? POLYGON_HEX;
  const balanceQueues = { ...(options.balances ?? {}) };

  const provider: Eip1193Provider = {
    request: async ({ method, params }) => {
      switch (method) {
        case "eth_accounts":
          return [OWNER];
        case "eth_chainId":
          return chainHex;
        case "wallet_switchEthereumChain": {
          const next = (params?.[0] as { chainId: string }).chainId;
          switched.push(next);
          chainHex = next;
          return null;
        }
        case "eth_sendTransaction": {
          calls.push("send");
          sent.push(params?.[0] as (typeof sent)[number]);
          return `0xhash${sent.length}`;
        }
        case "eth_getTransactionReceipt":
          return { status: "0x1", blockNumber: "0x1", logs: [] };
        default:
          return null;
      }
    },
  };

  const quoteSwap = vi.fn(async () => {
    calls.push("quote");
    return { ok: true as const, quote: options.quote ?? quoteResponse() };
  });
  /** `true` → the live shape: `approve(Permit2, amount)` on the token the request named. */
  const asApproval = (
    fixture: UniswapTransactionRequest | null | true | undefined,
    input: { token: string; amount: string },
    amount: bigint,
  ): UniswapTransactionRequest | null =>
    fixture === true
      ? txRequest({ to: input.token, data: encodeErc20Approval(PERMIT2, amount) })
      : (fixture ?? null);

  const checkApproval = vi.fn(async (input: { token: string; amount: string }) => {
    calls.push("checkApproval");
    return {
      ok: true as const,
      approval: options.approval
        ? asApproval(options.approval.approval, input, BigInt(input.amount))
        : null,
      cancel: asApproval(options.approval?.cancel, input, BigInt(0)),
    };
  });
  const buildSwapTx = vi.fn(async () => {
    calls.push("buildSwapTx");
    return { ok: true as const, swap: options.swap ?? txRequest() };
  });
  const signTypedData = vi.fn(async () => {
    calls.push("sign");
    return "0xsignature";
  });
  const readTokenBalance = vi.fn(async ({ chainId, token }: { chainId: number; token: string }) => {
    calls.push("readBalance");
    const queue = balanceQueues[`${chainId}:${token.toLowerCase()}`];
    return queue && queue.length > 1 ? (queue.shift() as string) : (queue?.[0] ?? "0");
  });

  return {
    calls,
    sent,
    switched,
    quoteSwap,
    checkApproval,
    buildSwapTx,
    signTypedData,
    readTokenBalance,
    deps: {
      owner: OWNER,
      provider,
      signTypedData,
      readTokenBalance,
      quoteSwap,
      checkApproval,
      buildSwapTx,
      slippagePct: 2,
    },
  };
}

/** Run the rail the way `useWalletSignFlow` does: merge each partial, never re-use a mutated ctx. */
async function runRail(steps: FlowStep<PlanRailCtx>[]) {
  let ctx: PlanRailCtx = {};
  const outcomes: { key: string; skipped: boolean; txHash?: string }[] = [];
  for (const step of steps) {
    const result = (await step.run(deepFreeze(ctx))) ?? {};
    const { txHash, skipped, ...partial } = result;
    outcomes.push({ key: step.key, skipped: skipped === true, ...(txHash ? { txHash } : {}) });
    ctx = { ...ctx, ...(partial as PlanRailCtx) };
  }
  return { ctx, outcomes };
}

/** Recursively freeze, so a `run()` that mutates the accumulating context throws ([R7]). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

describe("planRailSteps", () => {
  it("[R1] emits an approval step then the leg step, in route order", () => {
    const rail = planRailSteps(planOf([swapLeg(), bridgeLeg()]));
    expect(rail.map((step) => step.key)).toEqual([
      "approve:swap-token-0",
      "swap-token-0",
      "approve:bridge-1",
      "bridge-1",
    ]);
    expect(rail.map((step) => step.kind)).toEqual(["approve", "leg", "approve", "leg"]);
  });

  it("[R1] never emits an approval for a native token in, which has no ERC-20 allowance", () => {
    const rail = planRailSteps(
      planOf([swapLeg({ tokenIn: NATIVE_POLYGON, tokenOut: USDC_POLYGON })]),
    );
    expect(rail.map((step) => step.key)).toEqual(["swap-token-0"]);
  });

  it("[R1] ignores the trailing op anchor, which is a display marker and not a leg", () => {
    const plan = planOf([swapLeg()]);
    expect(plan.steps.at(-1)?.type).toBe("op");
    expect(planRailSteps(plan).some((step) => step.key === "op")).toBe(false);
  });
});

describe("buildPlanSteps — [R1] every leg broadcasts through executeBuiltTransaction", () => {
  it("quotes, builds and broadcasts the leg, returning the mined hash", async () => {
    const h = harness();
    const { outcomes } = await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(h.calls).toEqual(["checkApproval", "quote", "readBalance", "buildSwapTx", "send"]);
    expect(outcomes.at(-1)).toMatchObject({ key: "swap-token-0", txHash: "0xhash1" });
  });

  it("inherits the chain assertion: a Polygon leg then an Arbitrum leg switches networks", async () => {
    const h = harness({
      balances: { [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["0", "3000000000"] },
      swap: txRequest({ chainId: POLYGON }),
    });
    // A same-token Arbitrum leg, so the second broadcast targets a chain the wallet is not on.
    const arbLeg = swapLeg({
      index: 1,
      chainId: ARBITRUM,
      tokenIn: USDC_ARBITRUM,
      tokenOut: {
        ...USDC_ARBITRUM,
        address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        symbol: "USDT",
      },
      requoteAtExecution: false,
    });
    h.buildSwapTx
      .mockImplementationOnce(async () => ({ ok: true, swap: txRequest({ chainId: POLYGON }) }))
      .mockImplementationOnce(async () => ({ ok: true, swap: txRequest({ chainId: ARBITRUM }) }));
    await runRail(buildPlanSteps(planOf([swapLeg(), arbLeg]), h.deps));
    expect(h.switched).toEqual([ARBITRUM_HEX]);
    expect(h.sent).toHaveLength(2);
  });

  it("inherits the account assertion: a wallet on another account fails typed", async () => {
    const h = harness();
    h.deps.provider = {
      request: async ({ method }) =>
        method === "eth_accounts"
          ? ["0x0000000000000000000000000000000000000BAD"]
          : method === "eth_chainId"
            ? POLYGON_HEX
            : null,
    };
    const steps = buildPlanSteps(planOf([swapLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toThrow(/does not match/i);
  });

  it("fails legibly on a step the rail cannot execute (SEND_CALLS is out of scope)", async () => {
    const plan = planOf([swapLeg()]);
    const first = plan.steps[0] as ProvisioningStep;
    plan.steps[0] = { ...first, method: "SEND_CALLS" };
    const h = harness();
    const steps = buildPlanSteps(plan, h.deps);
    await expect(runRail(steps)).rejects.toThrow(/SEND_CALLS/);
  });

  it("keeps a leg-less plan step and fails on it, rather than silently running fewer steps", async () => {
    const plan = planOf([swapLeg()]);
    const { leg: _dropped, ...legless } = plan.steps[0] as ProvisioningStep;
    plan.steps[0] = legless;
    const h = harness();
    const steps = buildPlanSteps(plan, h.deps);
    expect(steps.map((step) => step.key)).toEqual(["swap-token-0"]);
    await expect(runRail(steps)).rejects.toThrow(/no executable route leg/);
  });

  it("surfaces a failed server action as a typed TransactionError carrying its code", async () => {
    const h = harness();
    h.quoteSwap.mockResolvedValueOnce({
      ok: false,
      code: "UNISWAP_ROUTING_UNSUPPORTED",
      message: "no route",
    });
    const steps = buildPlanSteps(planOf([swapLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toMatchObject({
      message: "no route",
      cause: { code: "UNISWAP_ROUTING_UNSUPPORTED" },
    });
  });
});

describe("buildPlanSteps — [R2] approval", () => {
  it("broadcasts the approval when /check_approval returns calldata", async () => {
    const h = harness({ approval: { approval: true } });
    const { outcomes } = await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(outcomes[0]).toMatchObject({ key: "approve:swap-token-0", skipped: false });
    expect(h.sent[0]?.to).toBe(WETH_POLYGON.address);
    expect(decodeErc20Approval(h.sent[0]?.data as string)).toEqual({
      spender: PERMIT2.toLowerCase(),
      amount: BigInt("1000000000000000000"),
    });
  });

  it("emits { skipped: true } and broadcasts nothing when the allowance already covers it", async () => {
    const h = harness({ approval: { approval: null } });
    const { outcomes } = await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(outcomes[0]).toEqual({ key: "approve:swap-token-0", skipped: true });
    expect(h.sent).toHaveLength(1); // the leg's own broadcast, and nothing else
  });

  it("zeroes a USDT-class allowance first when the API returns a cancel transaction", async () => {
    const h = harness({ approval: { approval: true, cancel: true } });
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(h.sent.slice(0, 2).map((tx) => decodeErc20Approval(tx.data)?.amount)).toEqual([
      BigInt(0),
      BigInt("1000000000000000000"),
    ]);
  });

  it("never spends gas zeroing an allowance when there is no approval to follow it", async () => {
    const h = harness({ approval: { approval: null, cancel: true } });
    const { outcomes } = await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(outcomes[0]).toEqual({ key: "approve:swap-token-0", skipped: true });
    expect(h.sent.map((tx) => decodeErc20Approval(tx.data)?.amount)).not.toContain(BigInt(0));
  });

  it("sizes the approval to the leg's amount, never unbounded", async () => {
    const h = harness();
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(h.checkApproval).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "1000000000000000000", chainId: POLYGON }),
    );
  });

  // PP-CORE-SEC-001 (POO-1050 [R3]). Asking for a sized amount says nothing about what comes back:
  // Uniswap's documented flow is a one-time INFINITE approval to Permit2, so this is the response the
  // rail actually gets, not a hypothetical. The cap is what bounds the whole authorisation chain,
  // since Permit2 can only move what the token's allowance to Permit2 permits.
  it("[UF-28 R3] caps an unbounded approval to the plan before broadcasting it", async () => {
    const unbounded = (BigInt(1) << BigInt(256)) - BigInt(1);
    const h = harness({
      approval: {
        approval: txRequest({
          to: WETH_POLYGON.address,
          data: encodeErc20Approval(PERMIT2, unbounded),
        }),
      },
    });
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(decodeErc20Approval(h.sent[0]?.data as string)).toEqual({
      spender: PERMIT2.toLowerCase(),
      amount: BigInt("1000000000000000000"),
    });
  });

  it("[UF-28 R3] refuses an approval aimed at a contract that is not the token being spent", async () => {
    const h = harness({
      approval: {
        approval: txRequest({ data: encodeErc20Approval(PERMIT2, BigInt(1)) }), // `to` = the router
      },
    });
    const steps = buildPlanSteps(planOf([swapLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toThrow(/not the token/i);
    expect(h.sent).toHaveLength(0);
  });

  it("[UF-28 R3] refuses a 'cancel' that grants an allowance, before spending gas on it", async () => {
    const h = harness({
      approval: {
        approval: true,
        cancel: txRequest({
          to: WETH_POLYGON.address,
          data: encodeErc20Approval(PERMIT2, BigInt("999999999999999999999")),
        }),
      },
    });
    const steps = buildPlanSteps(planOf([swapLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toThrow(/zero/i);
    expect(h.sent).toHaveLength(0);
  });
});

describe("buildPlanSteps — [R3] Permit2 signature", () => {
  it("signs before it builds, and builds before it sends", async () => {
    const h = harness({ quote: quoteResponse({ permitData: permitData() }) });
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(h.calls).toEqual([
      "checkApproval",
      "quote",
      "readBalance",
      "sign",
      "buildSwapTx",
      "send",
    ]);
    expect(h.buildSwapTx).toHaveBeenCalledWith(
      expect.objectContaining({ signature: "0xsignature" }),
    );
  });

  it("never signs when the quote carries no permit", async () => {
    const h = harness();
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(h.signTypedData).not.toHaveBeenCalled();
    expect(h.buildSwapTx.mock.calls[0]?.[0]).not.toHaveProperty("signature");
  });

  it("emits every uint as a decimal string, so JSON.stringify survives an embedded wallet", async () => {
    const h = harness({ quote: quoteResponse({ permitData: permitData() }) });
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    const payload = h.signTypedData.mock.calls[0]?.[0];
    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(bigintPaths(payload)).toEqual([]);
    const message = payload.message as { details: { amount: unknown }; sigDeadline: unknown };
    expect(message.details.amount).toBe("1461501637330902918203684832716283019655932542975");
    expect(message.sigDeadline).toBe(String(PERMIT_SIG_DEADLINE));
  });

  it("resolves the primary type from the typed-data graph and keeps chainId numeric", async () => {
    const h = harness({ quote: quoteResponse({ permitData: permitData() }) });
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    const payload = h.signTypedData.mock.calls[0]?.[0];
    expect(payload.primaryType).toBe("PermitSingle");
    expect(payload.domain.chainId).toBe(POLYGON);
  });
});

/** Every path in `value` whose leaf is a native bigint. Empty is the assertion ([R3]). */
function bigintPaths(value: unknown, path = "$"): string[] {
  if (typeof value === "bigint") return [path];
  if (Array.isArray(value)) return value.flatMap((item, i) => bigintPaths(item, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => bigintPaths(nested, `${path}.${key}`));
  }
  return [];
}

describe("buildPlanSteps — [R4] calldata is asserted before the broadcast", () => {
  it("refuses an empty `0x` data rather than burning gas on a guaranteed revert", async () => {
    const h = harness({ swap: { ...txRequest(), data: "0x" } });
    const steps = buildPlanSteps(planOf([swapLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toThrow(/calldata/i);
    expect(h.sent).toHaveLength(0);
  });

  it("refuses non-hex data", async () => {
    const h = harness({ swap: { ...txRequest(), data: "not-hex" } });
    const steps = buildPlanSteps(planOf([swapLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toThrow(/calldata/i);
    expect(h.sent).toHaveLength(0);
  });

  it("refuses an approval whose calldata is empty", async () => {
    const h = harness({
      approval: { approval: txRequest({ to: WETH_POLYGON.address, data: "0x" }) },
    });
    const steps = buildPlanSteps(planOf([swapLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toThrow(/calldata/i);
    expect(h.sent).toHaveLength(0);
  });
});

describe("buildPlanSteps — [R5] tx.value arrives as hex and is normalised", () => {
  it("normalises a hex `value` to a decimal string before the send path sees it", async () => {
    const h = harness({ swap: txRequest({ value: "0x2386f26fc10000" }) });
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    // sendTransaction re-hexes it; the round trip proves the value was not read as decimal garbage.
    expect(h.sent[0]?.value).toBe("0x2386f26fc10000");
  });

  it("treats the live `0x00` as zero rather than as a malformed amount", async () => {
    const h = harness({ swap: txRequest({ value: "0x00" }) });
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(h.sent[0]?.value).toBe("0x0");
  });

  it("rejects a value that parses as neither hex nor decimal, instead of silently sending 0", async () => {
    const h = harness({ swap: txRequest({ value: "12,5" }) });
    const steps = buildPlanSteps(planOf([swapLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toThrow(/value/i);
    expect(h.sent).toHaveLength(0);
  });
});

describe("buildPlanSteps — [R6] a requoteAtExecution leg is sized from what actually arrived", () => {
  it("re-quotes the bridge from the swap's realised output, not the planned estimate", async () => {
    const h = harness({
      balances: {
        // Pre-existing dust, then dust + the 2_950_000_000 the swap really produced.
        [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["1000000", "2951000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: bridgeArrives(),
      },
    });
    await runRail(buildPlanSteps(planOf([swapLeg(), bridgeLeg()]), h.deps));
    const bridgeQuote = h.quoteSwap.mock.calls[1]?.[0];
    expect(bridgeQuote).toMatchObject({
      tokenIn: USDC_POLYGON.address,
      tokenOutChainId: ARBITRUM,
      amount: "2950000000",
      type: "EXACT_INPUT",
    });
    expect(bridgeQuote.amount).not.toBe("3000000000"); // the planned estimate
  });

  it("sizes the bridge's approval from the same realised amount the leg will spend", async () => {
    const h = harness({
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["1000000", "2951000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: bridgeArrives(),
      },
      approval: { approval: true },
    });
    await runRail(buildPlanSteps(planOf([swapLeg(), bridgeLeg()]), h.deps));
    expect(h.checkApproval.mock.calls[1]?.[0]).toMatchObject({
      amount: "2950000000",
      tokenOutChainId: ARBITRUM,
    });
  });

  it("uses the planned amount verbatim for a leg that spends an existing balance", async () => {
    const h = harness();
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(h.quoteSwap.mock.calls[0]?.[0]).toMatchObject({ amount: "1000000000000000000" });
  });

  it("fails rather than bridging when the previous leg produced nothing", async () => {
    const h = harness({
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["1000000", "1000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: bridgeArrives(),
      },
    });
    const steps = buildPlanSteps(planOf([swapLeg(), bridgeLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toThrow(/delivered nothing/i);
  });
});

describe("buildPlanSteps — POO-1037 a bridge leg settles on the DESTINATION chain", () => {
  /** The bridge-only plan, sized from its planned amount so no previous leg has to run first. */
  const bridgeOnly = () => planOf([bridgeLeg({ index: 0, requoteAtExecution: false })]);

  it("[R1] holds the step open after the source receipt until the funds actually land", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({
        balances: {
          [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["3000000000"],
          // Baseline, one observation with nothing there, then the arrival.
          [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: ["0", "0", "2996000000"],
        },
      });
      const steps = buildPlanSteps(bridgeOnly(), h.deps);
      let settled = false;
      const running = (steps.at(-1) as FlowStep<PlanRailCtx>).run({}).then((result) => {
        settled = true;
        return result;
      });

      await vi.advanceTimersByTimeAsync(1);
      // The source transaction has mined and the step is STILL open: a source receipt proves only
      // that the money left.
      expect(h.sent).toHaveLength(1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(BRIDGE_POLL_MAX_DELAY_MS);
      expect(await running).toMatchObject({ txHash: "0xhash1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("[R1] measures arrival against the baseline recorded BEFORE the broadcast", async () => {
    const h = harness({
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["3000000000"],
        // The user already holds 500 USDC on the destination chain. An absolute test would call
        // this bridge settled before it started.
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: ["500000000", "3496000000"],
      },
    });
    await runRail(buildPlanSteps(bridgeOnly(), h.deps));
    const destinationReads = h.readTokenBalance.mock.calls.filter(
      ([args]) => (args as { chainId: number }).chainId === ARBITRUM,
    );
    // Baseline + at least one settlement observation, both on the destination chain.
    expect(destinationReads.length).toBeGreaterThanOrEqual(2);
  });

  it("[R3] degrades at the ceiling with a typed pending error, and never re-broadcasts", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({
        balances: {
          [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["3000000000"],
          [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: ["0"],
        },
      });
      const steps = buildPlanSteps(bridgeOnly(), h.deps);
      const caught = (steps.at(-1) as FlowStep<PlanRailCtx>).run({}).catch((error) => error);
      await vi.advanceTimersByTimeAsync(BRIDGE_SETTLE_CEILING_MS + BRIDGE_POLL_MAX_DELAY_MS);

      const error = await caught;
      // Not a failure and not a success: the money is still moving, so the hash travels with the
      // error and the UI can keep the transfer verifiable.
      expect(error).toMatchObject({
        cause: { code: BRIDGE_PENDING_CODE, txHash: "0xhash1" },
      });
      expect(h.sent).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("[R1] reports the broadcast hash BEFORE it starts waiting (the POO-1038 journal write)", async () => {
    const order: string[] = [];
    const h = harness({
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["3000000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: bridgeArrives(),
      },
    });
    h.readTokenBalance.mockImplementation(async ({ chainId }: { chainId: number }) => {
      order.push(`read:${chainId}`);
      return chainId === ARBITRUM
        ? order.includes("broadcast")
          ? "2996000000"
          : "0"
        : "3000000000";
    });
    h.deps.onLegBroadcast = vi.fn(() => {
      order.push("broadcast");
    });

    await runRail(buildPlanSteps(bridgeOnly(), h.deps));

    expect(h.deps.onLegBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "0xhash1" }),
    );
    // `02_BRIDGE_ARCHITECTURE.md` §3.4: the hash is recorded the instant it exists, before ANY await.
    expect(order.indexOf("broadcast")).toBeLessThan(order.lastIndexOf(`read:${ARBITRUM}`));
  });

  it("[R1] a same-chain leg settles on its receipt and never polls for arrival", async () => {
    const h = harness();
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    // One balance read: the destination baseline. A same-chain swap has nothing to wait for.
    expect(h.calls.filter((call) => call === "readBalance")).toHaveLength(1);
  });

  it("[R4] a journal callback that throws never fails a leg whose money already moved", async () => {
    const h = harness({
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["3000000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: bridgeArrives(),
      },
    });
    h.deps.onLegBroadcast = vi.fn(() => {
      throw new Error("QuotaExceededError: localStorage is full");
    });
    const { outcomes } = await runRail(buildPlanSteps(bridgeOnly(), h.deps));
    // Failing here would route the flow to an error whose retry re-broadcasts an in-flight bridge.
    expect(outcomes.at(-1)).toMatchObject({ txHash: "0xhash1" });
  });
});

describe("buildPlanSteps — [R7] run() never mutates the accumulating context", () => {
  it("returns a fresh context partial instead of writing into the one it was given", async () => {
    const h = harness({
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["1000000", "2951000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: bridgeArrives(),
      },
    });
    // runRail deep-freezes the context before every run(), so any in-place write throws here.
    const { ctx } = await runRail(buildPlanSteps(planOf([swapLeg(), bridgeLeg()]), h.deps));
    const state = ctx[PLAN_RAIL_STATE_KEY] as PlanRailState;
    // Both legs recorded their destination baseline before broadcasting (the POO-1038 seam), and
    // the amounts each leg really spent were carried forward rather than written in place.
    expect(Object.keys(state.outBaselines)).toEqual(["0", "1"]);
    expect(state.legAmountsIn["1"]).toBe("2950000000");
  });
});

// POO-1075 [R4] — a gas bridge carries native coin into a chain that cannot yet broadcast. The rail
// must treat it exactly like any other bridge and hold the step open until the funds LAND, because
// every later step depends on that chain being transactable. Nothing in the rail keys on the leg's
// kind: settlement is decided by whether the leg crosses chains, which is the property that matters.
describe("buildPlanSteps — POO-1075 a gas bridge settles before anything depends on it", () => {
  const NATIVE_ARBITRUM = {
    address: "0x0000000000000000000000000000000000000000",
    symbol: "ETH",
    decimals: 18,
    chainId: ARBITRUM,
  };

  /** Native POL on Polygon into native ETH on Arbitrum. Both ends native: that is the whole point. */
  const gasBridgeLeg = (overrides: Partial<ProvisioningLeg> = {}): ProvisioningLeg => ({
    index: 0,
    kind: "bridge-gas",
    chainId: POLYGON,
    tokenIn: NATIVE_POLYGON,
    tokenOut: NATIVE_ARBITRUM,
    amountIn: "300000000000000",
    amountOutQuoted: "295000000000000",
    minAmountOut: "295000000000000",
    routing: "BRIDGE",
    gasUsd: 0.01,
    etaSeconds: 2,
    requoteAtExecution: false,
    ...overrides,
  });

  const nativeKey = (chainId: number) => `${chainId}:0x0000000000000000000000000000000000000000`;

  /**
   * The shared harness answers every pair with one USDC-scaled quote, which a native-scale leg reads
   * as a catastrophic adverse move and the re-quote gate rightly rejects. These tests are about
   * settlement ordering, not pricing, so the quote echoes whatever pair it was asked about.
   */
  const echoQuotes = (h: Harness) => {
    h.deps.quoteSwap = vi.fn(
      async (input: { tokenIn: string; tokenOut: string; amount: string }) => ({
        ok: true as const,
        quote: quoteResponse({
          routing: "BRIDGE",
          quote: {
            input: { amount: input.amount, token: input.tokenIn },
            output: { amount: input.amount, token: input.tokenOut },
          },
        }),
      }),
    ) as typeof h.deps.quoteSwap;
  };

  it("[R4] waits for the native coin to arrive, exactly as a funding bridge does", async () => {
    const h = harness({
      balances: {
        [nativeKey(POLYGON)]: ["1000000000000000000"],
        // Baseline, then nothing, then the arrival: the leg must not settle on the middle read.
        [nativeKey(ARBITRUM)]: ["0", "0", "295000000000000"],
      },
    });
    echoQuotes(h);

    const { outcomes } = await runRail(buildPlanSteps(planOf([gasBridgeLeg()]), h.deps));

    expect(outcomes.at(-1)).toMatchObject({ txHash: "0xhash1" });
    // More than the single baseline read a same-chain leg makes: it genuinely polled the far side.
    expect(h.calls.filter((call) => call === "readBalance").length).toBeGreaterThan(1);
  });

  // The rail re-sizes a leg from the previous one's realised output when the two actually connect.
  // A gas bridge lands NATIVE on the TARGET chain while the funding leg spends a different token on
  // a SOURCE chain, so they must not be linked: sizing the funding leg from the gas delta would
  // spend the wrong amount entirely.
  // §3.6 gives the arrival verdict ONE author, `reconcileFundingJournal`, which re-derives it from
  // the chain. The rail writing `settled` for a cross-chain leg would be the "fakes success" failure
  // by another name. The guard read `leg.kind !== "bridge"` while its own comment promised "whatever
  // its kind says", so a gas bridge slipped through it.
  it("[R4] never records the gas bridge settled: that verdict has one author", async () => {
    const h = harness({
      balances: {
        [nativeKey(POLYGON)]: ["1000000000000000000"],
        [nativeKey(ARBITRUM)]: ["0", "295000000000000"],
      },
    });
    echoQuotes(h);
    const recordSettled = vi.fn();
    h.deps.journal = {
      beginLeg: vi.fn(async () => {}),
      recordBroadcast: vi.fn(),
      recordSettled,
      recordFailed: vi.fn(),
    };

    await runRail(buildPlanSteps(planOf([gasBridgeLeg()]), h.deps));

    expect(recordSettled).not.toHaveBeenCalled();
  });

  it("[R4] is never mistaken for the funding leg's feeder", async () => {
    const h = harness({
      balances: {
        [nativeKey(POLYGON)]: ["1000000000000000000"],
        [nativeKey(ARBITRUM)]: ["0", "295000000000000"],
        [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["3000000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: bridgeArrives(),
      },
    });
    echoQuotes(h);

    const { ctx } = await runRail(
      buildPlanSteps(
        planOf([gasBridgeLeg(), bridgeLeg({ index: 1, requoteAtExecution: false })]),
        h.deps,
      ),
    );

    const state = ctx[PLAN_RAIL_STATE_KEY] as PlanRailState;
    // The funding leg spent its own planned amount, NOT the gas bridge's 0.000295 ETH delta.
    expect(state.legAmountsIn["1"]).toBe("3000000000");
  });
});
