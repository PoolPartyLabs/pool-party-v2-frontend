/**
 * @id PP-MGR-LIB-070
 * @name solanaHoldingModel tests
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, injected custody/quote contracts
 */
import { describe, expect, it } from "vitest";
import {
  classifyHoldingConversion,
  type HoldingIntent,
  type HoldingOrigin,
  type HoldingRead,
  inspectHoldingRead,
  inspectJupiterQuote,
  type JupiterQuote,
  validateHoldingIntent,
} from "./solanaHoldingModel";
import { type SolanaSource, type SolanaToken, USDC_MINT, WSOL_MINT } from "./solanaSchemas";

const source: SolanaSource = {
  kind: "observed",
  source: "verified-adapter",
  sourceAsOf: "2026-10-07T00:00:00Z",
  slot: "9007199254740993",
  commitment: "confirmed",
};
const usdc: SolanaToken = {
  kind: "spl",
  network: "solana",
  cluster: "mainnet-beta",
  mint: USDC_MINT,
  decimals: 6,
  symbol: "USDC",
  unit: "base-units",
};
const wsol: SolanaToken = { ...usdc, mint: WSOL_MINT, decimals: 9, symbol: "WSOL" };
const sol: SolanaToken = {
  kind: "native",
  network: "solana",
  cluster: "mainnet-beta",
  symbol: "SOL",
  decimals: 9,
  unit: "lamports",
};
const origin: HoldingOrigin = {
  localId: "holding-a",
  cluster: "mainnet-beta",
  asset: wsol,
  custody: {
    program: WSOL_MINT,
    authority: USDC_MINT,
    account: "11111111111111111111111111111111",
    positionId: USDC_MINT,
  },
};
const absent = { status: "unavailable" as const, source: null, reason: "not-integrated" };
function read(): HoldingRead {
  return {
    origin,
    snapshotId: "read-a",
    quantity: { status: "available", value: { token: wsol, raw: "9007199254740993" }, source },
    valueUsd: absent,
    allocation: absent,
  };
}
function buy(): HoldingIntent {
  return {
    id: "buy-a",
    revision: "1",
    origin,
    side: "buy",
    input: { token: usdc, raw: "1500000000" },
    outputToken: wsol,
    destination: { kind: "holding", account: origin.custody.account },
    wrapPlan: null,
  };
}
function quote(): JupiterQuote {
  const intent = buy();
  return {
    intentId: intent.id,
    intentRevision: intent.revision,
    origin,
    status: "available",
    source,
    quoteId: "quote-a",
    input: intent.input,
    output: { token: wsol, raw: "10000000000" },
    minimumReceived: { token: wsol, raw: "9900000000" },
    route: ["Verified venue"],
    costs: [
      {
        id: "network-a",
        category: "network",
        amount: { token: sol, raw: "5000" },
        inclusion: "additional",
      },
    ],
    inspection: {
      mode: "managed-order-execute",
      requestId: "request-a",
      inputMint: USDC_MINT,
      outputMint: WSOL_MINT,
      rawInput: intent.input.raw,
      quoteValidity: { status: "available", value: { expiresAt: "2026-10-07T00:05:00Z" }, source },
      transactionValidity: {
        status: "available",
        value: { blockhash: WSOL_MINT, lastValidBlockHeight: "9007199254740999" },
        source,
      },
      execution: { status: "unavailable", reason: "local-preview-only" },
    },
  };
}
const at = { now: "2026-10-07T00:01:00Z", blockHeight: "9007199254740998" };

describe("Holding injected custody and intents", () => {
  it("R2/R3 keeps exact quantity when valuation is absent, without zero/USD inference", () => {
    const view = inspectHoldingRead(origin, read());
    expect(view.quantity?.raw).toBe("9007199254740993");
    expect(view.valueUsd).toBeNull();
    expect(view.allocationBps).toBeNull();
    expect(inspectHoldingRead(origin, null).quantity).toBeNull();
  });
  it("R2/R8 rejects other local instances, account, program, mint case and wrong decimals", () => {
    for (const changed of [
      { ...origin, localId: "holding-b" },
      { ...origin, custody: { ...origin.custody, account: USDC_MINT } },
      { ...origin, custody: { ...origin.custody, program: USDC_MINT } },
      { ...origin, asset: { ...wsol, mint: WSOL_MINT.toLowerCase() } },
      { ...origin, asset: { ...wsol, decimals: 6 } },
    ])
      expect(inspectHoldingRead(changed, read()).quantity).toBeNull();
  });
  it("R3 retains stale quantities visibly and requires observed confirmation for zero", () => {
    const current = read();
    expect(
      inspectHoldingRead(origin, {
        ...current,
        quantity: { status: "stale", value: { token: wsol, raw: "10" }, source, reason: "stale" },
      }).quantityStatus,
    ).toBe("stale");
    expect(
      inspectHoldingRead(origin, {
        ...current,
        quantity: {
          status: "available",
          value: { token: wsol, raw: "0" },
          source: { ...source, kind: "fixture", fixtureId: "zero", slot: null },
        },
      }).quantity,
    ).toBeNull();
    expect(
      inspectHoldingRead(origin, {
        ...current,
        quantity: { status: "confirmed-zero", value: { token: wsol, raw: "0" }, source },
      }).quantity?.raw,
    ).toBe("0");
  });
  it("R6 compatible tokens bypass Jupiter while native SOL is separate from WSOL", () => {
    const intent = buy();
    expect(classifyHoldingConversion({ ...intent, input: { token: wsol, raw: "1" } })).toBe(
      "bypass",
    );
    expect(classifyHoldingConversion(intent)).toBe("swap");
    expect(classifyHoldingConversion({ ...intent, input: { token: sol, raw: "1" } })).toBe(
      "unavailable",
    );
    const wrapped = {
      ...intent,
      input: { token: sol, raw: "1" },
      wrapPlan: {
        kind: "wrap" as const,
        program: WSOL_MINT,
        sourceAccount: USDC_MINT,
        destinationAccount: origin.custody.account,
      },
    };
    expect(classifyHoldingConversion(wrapped)).toBe("wrap");
    expect(
      classifyHoldingConversion({ ...wrapped, wrapPlan: { ...wrapped.wrapPlan, kind: "unwrap" } }),
    ).toBe("unavailable");
  });
  it("R6/R9 allows Sell only to explicit Idle or gray principal Bridge and never cash/Income", () => {
    const sell = {
      ...buy(),
      side: "sell" as const,
      input: { token: wsol, raw: "1" },
      outputToken: usdc,
      destination: {
        kind: "idle-output" as const,
        idleId: "idle-a",
        account: USDC_MINT,
        principalBridgeId: null,
      },
    };
    expect(validateHoldingIntent(origin, sell)).not.toBeNull();
    expect(
      validateHoldingIntent(origin, {
        ...sell,
        destination: { ...sell.destination, principalBridgeId: "bridge-a" },
      }),
    ).not.toBeNull();
    expect(
      validateHoldingIntent(origin, {
        ...sell,
        destination: { ...sell.destination, kind: "operating-cash" },
      }),
    ).toBeNull();
    expect(validateHoldingIntent(origin, { ...sell, input: { token: usdc, raw: "1" } })).toBeNull();
  });
});
describe("Jupiter quote inspection is not execution", () => {
  // @rule R7: a fee already included in total input cannot exceed that input, alone or in aggregate.
  it.each([
    "single",
    "aggregate",
  ] as const)("rejects %s included fees above total input", (kind) => {
    const q = quote();
    const cost = (id: string, raw: string) => ({
      id,
      category: "platform" as const,
      amount: { token: q.input.token, raw },
      inclusion: "included-in-input" as const,
    });
    q.costs =
      kind === "single"
        ? [cost("fee-a", "1500000001")]
        : [cost("fee-a", "1000000000"), cost("fee-b", "500000001")];
    expect(inspectJupiterQuote(buy(), q, at).quote).toBeNull();
  });
  it("keeps explicit included fees up to input total separate from additional network cost", () => {
    const q = quote();
    q.costs.push({
      id: "fee-a",
      category: "platform",
      amount: { token: q.input.token, raw: q.input.raw },
      inclusion: "included-in-input",
    });
    expect(inspectJupiterQuote(buy(), q, at).quote).not.toBeNull();
  });
  it("R7 keeps quote time and BigInt blockhash validity independent at exact expiry", () => {
    const q = quote();
    expect(inspectJupiterQuote(buy(), q, at)).toMatchObject({
      quoteValidity: "valid",
      transactionValidity: "valid",
      execution: "unavailable",
    });
    expect(inspectJupiterQuote(buy(), q, { ...at, now: "2026-10-07T00:05:00Z" })).toMatchObject({
      quoteValidity: "expired",
      transactionValidity: "valid",
    });
    expect(inspectJupiterQuote(buy(), q, { ...at, blockHeight: "9007199254741000" })).toMatchObject(
      { quoteValidity: "valid", transactionValidity: "expired" },
    );
    expect(inspectJupiterQuote(buy(), q, { now: null, blockHeight: null })).toMatchObject({
      quoteValidity: "unknown",
      transactionValidity: "unknown",
    });
  });
  // @rule R3/R7: a transaction read from the future cannot establish blockhash validity.
  it("keeps blockhash validity unknown when its source timestamp is ahead of the host clock", () => {
    const q = quote();
    const tx = q.inspection.transactionValidity;
    if (tx.status !== "available") throw new Error("test transaction unavailable");
    const future = {
      ...q,
      inspection: {
        ...q.inspection,
        transactionValidity: {
          ...tx,
          source: { ...source, sourceAsOf: "2026-10-07T00:02:00Z" },
        },
      },
    };
    expect(inspectJupiterQuote(buy(), future, at)).toMatchObject({
      quoteValidity: "valid",
      transactionValidity: "unknown",
      execution: "unavailable",
    });
  });
  it("R2/R7 rejects mismatched intent revision, amounts, min-out, origin and ExactOut", () => {
    const q = quote();
    for (const changed of [
      { ...q, intentRevision: "2" },
      { ...q, input: { ...q.input, raw: "1" } },
      { ...q, minimumReceived: { ...q.minimumReceived, raw: "11000000000" } },
      { ...q, origin: { ...origin, localId: "other" } },
      { ...q, inspection: { ...q.inspection, swapMode: "ExactOut" } },
    ])
      expect(inspectJupiterQuote(buy(), changed, at).quote).toBeNull();
  });
  it("R7 keeps managed/order-execute and composable/build as distinct contracts", () => {
    const q = quote();
    expect(inspectJupiterQuote(buy(), q, at).quote?.inspection.mode).toBe("managed-order-execute");
    const { requestId: _request, ...base } = q.inspection as Extract<
      JupiterQuote["inspection"],
      { mode: "managed-order-execute" }
    >;
    const composed = {
      ...q,
      inspection: { ...base, mode: "composable-build", instructionPrograms: [WSOL_MINT] },
    };
    expect(inspectJupiterQuote(buy(), composed, at).quote?.inspection.mode).toBe(
      "composable-build",
    );
    expect(
      inspectJupiterQuote(
        buy(),
        { ...composed, inspection: { ...composed.inspection, requestId: "cannot-execute" } },
        at,
      ).quote,
    ).toBeNull();
  });
  it("R3/R7 keeps cost categories/inclusion separate, labels fixtures and rejects duplicates", () => {
    const q = quote();
    const fixture = {
      ...q,
      source: {
        kind: "fixture",
        fixtureId: "quote-example",
        sourceAsOf: source.sourceAsOf,
        slot: null,
      },
    };
    expect(inspectJupiterQuote(buy(), fixture, at)).toMatchObject({
      quoteValidity: "unknown",
      transactionValidity: "unknown",
      execution: "unavailable",
    });
    expect(inspectJupiterQuote(buy(), q, at).quote?.costs[0]?.inclusion).toBe("additional");
    expect(
      inspectJupiterQuote(buy(), { ...q, costs: [...q.costs, ...q.costs] }, at).quote,
    ).toBeNull();
    expect(
      inspectJupiterQuote({ ...buy(), input: { token: wsol, raw: "1" } }, q, at).quote,
    ).toBeNull();
  });
});

// @rule R3: unavailable price does not change quantity; stale zero is a retained observation, not no holdings.
it("retains stale zero and distinct source states without asserting confirmed zero", () => {
  const current = read();
  const view = inspectHoldingRead(origin, {
    ...current,
    quantity: { status: "stale", value: { token: wsol, raw: "0" }, source, reason: "stale" },
  });
  expect(view.quantity?.raw).toBe("0");
  expect(view.quantityStatus).toBe("stale");
  const missing = inspectHoldingRead(origin, {
    ...current,
    quantity: { status: "unavailable", source, reason: "timeout" },
  });
  expect(missing.source).toEqual(source);
  expect(
    inspectHoldingRead(origin, {
      ...current,
      quantity: {
        status: "available",
        value: { token: wsol, raw: "1" },
        source: { ...source, commitment: "processed" },
      },
    }).quantityStatus,
  ).toBe("unavailable");
});
// @rule R7: validity from another snapshot or unsupported included-cost attribution stays unknown.
it("rejects misleading validity provenance and included-cost token attribution", () => {
  const q = quote();
  const expiry = q.inspection.quoteValidity;
  if (expiry.status !== "available") throw new Error("test expiry unavailable");
  const wrong = {
    ...q,
    inspection: {
      ...q.inspection,
      quoteValidity: { ...expiry, source: { ...source, slot: "9007199254740994" } },
    },
  };
  expect(inspectJupiterQuote(buy(), wrong, at)).toMatchObject({
    quote: { quoteId: q.quoteId },
    quoteValidity: "unknown",
    transactionValidity: "valid",
  });
  const processed = { ...q, source: { ...source, commitment: "processed" as const } };
  expect(inspectJupiterQuote(buy(), processed, at).quoteValidity).toBe("unknown");
  expect(
    inspectJupiterQuote(
      buy(),
      {
        ...q,
        costs: [
          { ...q.costs[0], inclusion: "included-in-output", amount: { token: sol, raw: "1" } },
        ],
      },
      at,
    ).quote,
  ).toBeNull();
});
