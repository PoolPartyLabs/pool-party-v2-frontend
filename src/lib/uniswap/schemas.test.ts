/**
 * @id PP-CORE-LIB-051 (POO-1028)
 * @name Uniswap schema tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1028 rules v1):
 *   [R1] `routing` is a closed set; an unrecognized value fails loudly
 *   [R2] `TransactionRequest.data` must be non-empty hex
 *   [R3] a chained quote's `permitData` is null, and parses as such
 *   [R4] cross-chain quotes are EXACT_INPUT only
 *   [R5] plan steps carry `method` and `stepIndex`
 *   [R6] token-native amounts are decimal strings
 *   [R7] display-only blocks are tolerant: malformed degrades, never rejects
 */
import { describe, expect, it } from "vitest";
import {
  checkApprovalResponseSchema,
  isCrossChainQuote,
  isUniswapXRouting,
  planResponseSchema,
  quoteRequestSchema,
  quoteResponseSchema,
  swapResponseSchema,
  transactionRequestSchema,
} from "./schemas";

const TX = {
  to: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  from: "0x3e5E7b5565331B5B891fE4293B4bc6164687B705",
  data: "0x3593564c000000000000000000000000",
  value: "0",
  chainId: 42161,
};

describe("Uniswap schemas (POO-1028)", () => {
  // [R1] An unknown route must not fall through to the classic path.
  it("accepts every documented routing and rejects an unknown one", () => {
    for (const routing of [
      "CLASSIC",
      "WRAP",
      "UNWRAP",
      "BRIDGE",
      "CHAINED",
      "DUTCH_V2",
      "DUTCH_V3",
      "PRIORITY",
    ]) {
      const parsed = quoteResponseSchema.safeParse({ routing, quote: {}, permitData: null });
      expect(parsed.success, routing).toBe(true);
    }
    expect(quoteResponseSchema.safeParse({ routing: "SOMETHING_NEW", quote: {} }).success).toBe(
      false,
    );
  });

  // [R2] The assertion that saves a wasted gas fee.
  it.each([
    ["empty string", ""],
    ["bare 0x", "0x"],
    ["not hex", "hello"],
  ])("rejects calldata that is %s", (_label, data) => {
    expect(transactionRequestSchema.safeParse({ ...TX, data }).success).toBe(false);
  });

  it("accepts non-empty hex calldata", () => {
    expect(transactionRequestSchema.safeParse(TX).success).toBe(true);
  });

  // [R2] Same guard where it actually matters: the tx we are about to broadcast.
  it("rejects a swap response carrying empty calldata", () => {
    expect(swapResponseSchema.safeParse({ swap: { ...TX, data: "0x" } }).success).toBe(false);
    expect(swapResponseSchema.safeParse({ swap: TX }).success).toBe(true);
  });

  // [R3] A chained quote has no permit to sign; both null and absent must parse.
  it.each([
    ["explicit null", null],
    ["absent", undefined],
  ])("parses a chained quote whose permitData is %s", (_label, permitData) => {
    const parsed = quoteResponseSchema.safeParse({
      routing: "CHAINED",
      quote: { tokenInChainId: 137, tokenOutChainId: 42161 },
      ...(permitData === null ? { permitData: null } : {}),
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.permitData).toBeFalsy();
  });

  // [R4] Enforced before the request leaves us, not discovered as an upstream 400.
  it("rejects a cross-chain EXACT_OUTPUT quote request", () => {
    const base = {
      tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      tokenOut: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      amount: "1000000",
      swapper: "0x3e5E7b5565331B5B891fE4293B4bc6164687B705",
    };
    const crossChain = { ...base, tokenInChainId: 137, tokenOutChainId: 42161 };

    expect(quoteRequestSchema.safeParse({ ...crossChain, type: "EXACT_OUTPUT" }).success).toBe(
      false,
    );
    expect(quoteRequestSchema.safeParse({ ...crossChain, type: "EXACT_INPUT" }).success).toBe(true);
    // Same-chain keeps both directions.
    expect(
      quoteRequestSchema.safeParse({
        ...base,
        tokenInChainId: 42161,
        tokenOutChainId: 42161,
        type: "EXACT_OUTPUT",
      }).success,
    ).toBe(true);
  });

  // [R5] The plan's shape is what the rail executes against.
  it("parses a chained plan with its resume point and steps", () => {
    const parsed = planResponseSchema.safeParse({
      planId: "plan-uuid",
      currentStepIndex: 1,
      steps: [
        { stepIndex: 0, method: "SEND_TX", status: "COMPLETE", chainId: 137 },
        { stepIndex: 1, method: "SIGN_MSG", status: "AWAITING_ACTION" },
        { stepIndex: 2, method: "SEND_TX", status: "NOT_STARTED", etaSeconds: 180 },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.currentStepIndex).toBe(1);
    expect(parsed.success && parsed.data.steps[2]?.etaSeconds).toBe(180);
  });

  it("rejects a plan step with an unknown method", () => {
    expect(
      planResponseSchema.safeParse({
        planId: "p",
        currentStepIndex: 0,
        steps: [{ stepIndex: 0, method: "TELEPORT" }],
      }).success,
    ).toBe(false);
  });

  // [R6] A number here loses precision above 2^53 and drifts under arithmetic.
  it("requires token amounts as decimal strings, not numbers", () => {
    const base = {
      tokenIn: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      tokenOut: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      tokenInChainId: 42161,
      tokenOutChainId: 42161,
      type: "EXACT_INPUT",
      swapper: "0x3e5E7b5565331B5B891fE4293B4bc6164687B705",
    };
    expect(quoteRequestSchema.safeParse({ ...base, amount: 1000000 }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ ...base, amount: "1000000" }).success).toBe(true);
  });

  // [R7] A bad gas figure hides a row; it must not reject the quote it rides on.
  it("tolerates a malformed gas block rather than rejecting the quote", () => {
    const parsed = quoteResponseSchema.safeParse({
      routing: "CLASSIC",
      quote: { gasInfo: "not-an-object" },
      permitData: null,
    });
    expect(parsed.success).toBe(true);
  });

  // The quote is forwarded VERBATIM to /swap and /plan, so unknown keys must survive parsing.
  it("preserves unknown quote fields for verbatim forwarding", () => {
    const parsed = quoteResponseSchema.safeParse({
      routing: "CLASSIC",
      quote: { quoteId: "q1", someFutureField: { nested: true } },
      permitData: null,
    });
    expect(parsed.success).toBe(true);
    expect(
      parsed.success && (parsed.data.quote as Record<string, unknown>).someFutureField,
    ).toEqual({
      nested: true,
    });
  });

  // No approval calldata means the allowance already covers it, which is a success not a failure.
  it("parses a check_approval response with no approval required", () => {
    const parsed = checkApprovalResponseSchema.safeParse({ requestId: "r1" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.approval).toBeFalsy();
  });

  it("parses a check_approval response carrying approval calldata", () => {
    const parsed = checkApprovalResponseSchema.safeParse({ approval: TX });
    expect(parsed.success && parsed.data.approval?.to).toBe(TX.to);
  });

  // Helpers the planner and rail branch on.
  it("identifies UniswapX routes, which the rail does not model", () => {
    expect(isUniswapXRouting("DUTCH_V2")).toBe(true);
    expect(isUniswapXRouting("PRIORITY")).toBe(true);
    expect(isUniswapXRouting("CLASSIC")).toBe(false);
    expect(isUniswapXRouting("BRIDGE")).toBe(false);
  });

  it("identifies a cross-chain quote by its chain ids, falling back to routing", () => {
    const parse = (input: unknown) => quoteResponseSchema.parse(input);
    expect(
      isCrossChainQuote(
        parse({ routing: "CHAINED", quote: { tokenInChainId: 137, tokenOutChainId: 42161 } }),
      ),
    ).toBe(true);
    expect(
      isCrossChainQuote(
        parse({ routing: "CLASSIC", quote: { tokenInChainId: 8453, tokenOutChainId: 8453 } }),
      ),
    ).toBe(false);
    // Chain ids absent: routing decides.
    expect(isCrossChainQuote(parse({ routing: "CHAINED", quote: {} }))).toBe(true);
  });
});
