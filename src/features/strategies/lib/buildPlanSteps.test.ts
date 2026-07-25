/**
 * @id PP-STR-LIB-017 (POO-1036)
 * @name buildPlanSteps tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The rail adapter's spec, one describe per business rule. Everything is stubbed: the wallet is an
 * EIP-1193 handler map (so the SHIPPED chain/account assertions in `executeBuiltTransaction` really
 * run, rather than being mocked away), and the three Uniswap server actions are injected. No network.
 */
import { describe, expect, it, vi } from "vitest";
import type { ProvisioningLeg, ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";
import type { Eip1193Provider } from "@/lib/tx/sendTransaction";
import type { UniswapQuoteResponse, UniswapTransactionRequest } from "@/lib/uniswap/schemas";
import type { FlowStep } from "../hooks/useWalletSignFlow";
import {
  buildPlanSteps,
  PLAN_RAIL_STATE_KEY,
  type PlanRailCtx,
  type PlanRailDeps,
  type PlanRailState,
  planRailSteps,
} from "./buildPlanSteps";

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

/** Permit2 typed data as the API returns it, with one uint deliberately a native bigint ([R3]). */
function permitData(): NonNullable<UniswapQuoteResponse["permitData"]> {
  return {
    domain: {
      name: "Permit2",
      chainId: POLYGON,
      verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
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
        expiration: 1_800_000_000,
        nonce: 0,
      },
      spender: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
      sigDeadline: BigInt(1_800_000_000),
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
  approval?: {
    approval: UniswapTransactionRequest | null;
    cancel?: UniswapTransactionRequest | null;
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
  const checkApproval = vi.fn(async () => {
    calls.push("checkApproval");
    return {
      ok: true as const,
      approval: options.approval ? options.approval.approval : null,
      cancel: options.approval?.cancel ?? null,
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
    const h = harness({ approval: { approval: txRequest({ data: "0x095ea7b3aaaa" }) } });
    const { outcomes } = await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(outcomes[0]).toMatchObject({ key: "approve:swap-token-0", skipped: false });
    expect(h.sent[0]?.data).toBe("0x095ea7b3aaaa");
  });

  it("emits { skipped: true } and broadcasts nothing when the allowance already covers it", async () => {
    const h = harness({ approval: { approval: null } });
    const { outcomes } = await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(outcomes[0]).toEqual({ key: "approve:swap-token-0", skipped: true });
    expect(h.sent).toHaveLength(1); // the leg's own broadcast, and nothing else
  });

  it("zeroes a USDT-class allowance first when the API returns a cancel transaction", async () => {
    const h = harness({
      approval: {
        approval: txRequest({ data: "0x095ea7b3aaaa" }),
        cancel: txRequest({ data: "0x095ea7b3bbbb" }),
      },
    });
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(h.sent.slice(0, 2).map((tx) => tx.data)).toEqual(["0x095ea7b3bbbb", "0x095ea7b3aaaa"]);
  });

  it("never spends gas zeroing an allowance when there is no approval to follow it", async () => {
    const h = harness({
      approval: { approval: null, cancel: txRequest({ data: "0x095ea7b3bbbb" }) },
    });
    const { outcomes } = await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(outcomes[0]).toEqual({ key: "approve:swap-token-0", skipped: true });
    expect(h.sent.map((tx) => tx.data)).not.toContain("0x095ea7b3bbbb");
  });

  it("sizes the approval to the leg's amount, never unbounded", async () => {
    const h = harness();
    await runRail(buildPlanSteps(planOf([swapLeg()]), h.deps));
    expect(h.checkApproval).toHaveBeenCalledWith(
      expect.objectContaining({ amount: "1000000000000000000", chainId: POLYGON }),
    );
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
    expect(message.sigDeadline).toBe("1800000000");
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
    const h = harness({ approval: { approval: txRequest({ data: "0x" }) } });
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
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: ["0"],
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
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: ["0"],
      },
      approval: { approval: txRequest({ data: "0x095ea7b3aaaa" }) },
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
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: ["0"],
      },
    });
    const steps = buildPlanSteps(planOf([swapLeg(), bridgeLeg()]), h.deps);
    await expect(runRail(steps)).rejects.toThrow(/delivered nothing/i);
  });
});

describe("buildPlanSteps — [R7] run() never mutates the accumulating context", () => {
  it("returns a fresh context partial instead of writing into the one it was given", async () => {
    const h = harness({
      balances: {
        [`${POLYGON}:${USDC_POLYGON.address.toLowerCase()}`]: ["1000000", "2951000000"],
        [`${ARBITRUM}:${USDC_ARBITRUM.address.toLowerCase()}`]: ["0"],
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
