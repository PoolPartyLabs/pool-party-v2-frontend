/** @id PP-MGR-LIB-072 @implements-rules-version v1 (POO-2291) @analytics-events none, pure read contract tests */
import { expect, it } from "vitest";
import {
  formatKaminoUsd,
  inspectKaminoRead,
  type KaminoReadIdentity,
  type KaminoReadSnapshot,
} from "./solanaKaminoReadModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

const asset = {
  network: "solana",
  cluster: "mainnet-beta",
  kind: "spl",
  symbol: "USDC",
  mint: USDC_MINT,
  decimals: 6,
  unit: "base-units",
} as const;
const identity: KaminoReadIdentity = {
  localId: "local-supply",
  cluster: "mainnet-beta",
  program: WSOL_MINT,
  market: "11111111111111111111111111111111",
  reserve: "11111111111111111111111111111112",
  asset,
  positionId: null,
  obligation: null,
};
const source = {
  kind: "fixture",
  fixtureId: "illustrative-kamino-read",
  sourceAsOf: "2026-10-07T10:00:00Z",
  slot: null,
} as const;
function read(): KaminoReadSnapshot {
  const absent = { status: "unavailable", source: null, reason: "not-integrated" } as const;
  return structuredClone({
    identity,
    metadata: { status: "available", value: structuredClone(identity), source },
    supplied: {
      quantity: { status: "available", value: { token: asset, raw: "2500000123456" }, source },
      valueUsd: null,
    },
    principal: null,
    interest: null,
    rewards: null,
    supplyApy: { status: "available", value: { percent: "5.42" }, source },
    availableLiquidity: null,
    depositCapacity: { quantity: absent, valueUsd: null },
    availableToWithdraw: null,
  });
}
// @rule R2/R3/R4: no origin/read fallback and no source attestation is invented.
it("requires an explicit origin and preserves separately supplied source states", () => {
  expect(inspectKaminoRead(null, read())).toBeNull();
  expect(inspectKaminoRead(identity, null)).toBeNull();
  const input = read();
  const value = inspectKaminoRead(identity, input);
  expect(value?.metadata?.source).toEqual(source);
  expect(value?.supplied?.quantity?.status).toBe("available");
  expect(value?.principal).toBeNull();
  expect(value?.supplied?.valueUsd).toBeNull();
  expect(value).not.toBe(input);
});
// @rule R2/R4: mainnet USDC identity and reserve identity are not interchangeable with token labels.
it.each([
  "localId",
  "reserve",
  "reserveMint",
  "market",
  "token",
  "decimals",
  "cluster",
])("rejects mismatched or malformed %s", (field) => {
  const input = structuredClone(read());
  if (field === "localId") input.identity.localId = "another-instance";
  if (field === "reserve") input.identity.reserve = "0x123";
  if (field === "reserveMint") input.identity.reserve = USDC_MINT;
  if (field === "market") input.identity.market = USDC_MINT;
  if (field === "token" && input.identity.asset.kind === "spl")
    input.identity.asset.mint = WSOL_MINT;
  if (field === "decimals") input.identity.asset.decimals = 9;
  if (field === "cluster") input.identity.asset.cluster = "devnet";
  expect(inspectKaminoRead(identity, input)).toBeNull();
});
// @rule R2/R3: independent USD valuation formats exact decimal text without money floats.
it("formats a complete independent USD value without losing integer or tiny decimal precision", () => {
  expect(formatKaminoUsd("9007199254740993.123456")).toBe("$9,007,199,254,740,993.123456");
  expect(formatKaminoUsd("0.000001")).toBe("$0.000001");
  expect(formatKaminoUsd("1250")).toBe("$1,250.00");
});
// @rule R2/R3: physical amounts use u64; malformed raw strings fail closed without throwing.
it.each([
  "18446744073709551616",
  "1e18",
  "-1",
])("rejects an invalid physical quantity %s", (raw) => {
  const input = read();
  if (input.supplied?.quantity?.status === "available") input.supplied.quantity.value.raw = raw;
  expect(inspectKaminoRead(identity, input)?.supplied?.quantity).toBeNull();
  expect(inspectKaminoRead(identity, input)?.metadata?.source).toEqual(source);
});
// @rule R3: confirmed zero requires zero plus a confirmed observed source; stale remains stale.
it("retains confirmed zero and stale fields independently", () => {
  const input = read();
  input.principal = {
    quantity: {
      status: "confirmed-zero",
      value: { token: asset, raw: "0" },
      source: {
        kind: "observed",
        source: "injected-account-read",
        sourceAsOf: source.sourceAsOf,
        slot: "123456789",
        commitment: "confirmed",
      },
    },
    valueUsd: null,
  };
  input.interest = {
    quantity: { status: "stale", value: { token: asset, raw: "1250000" }, source, reason: "stale" },
    valueUsd: null,
  };
  expect(inspectKaminoRead(identity, input)?.principal?.quantity?.status).toBe("confirmed-zero");
  expect(inspectKaminoRead(identity, input)?.interest?.quantity?.status).toBe("stale");
  if (input.principal.quantity?.status === "confirmed-zero")
    input.principal.quantity.value.raw = "1";
  expect(inspectKaminoRead(identity, input)?.principal?.quantity).toBeNull();
  expect(inspectKaminoRead(identity, input)?.interest?.quantity?.status).toBe("stale");
});
// @rule R3: USD/APY confirmed zero uses its own decimal shape and observed confirmed source.
it.each([
  "usd",
  "percent",
] as const)("accepts a confirmed %s zero without inventing raw amounts", (field) => {
  const input = read();
  const confirmedSource = {
    kind: "observed",
    source: "confirmed-metric-read",
    sourceAsOf: source.sourceAsOf,
    slot: "123456789",
    commitment: "confirmed",
  } as const;
  if (field === "usd")
    input.supplied = {
      quantity: null,
      valueUsd: { status: "confirmed-zero", value: { usd: "0" }, source: confirmedSource },
    };
  else
    input.supplyApy = {
      status: "confirmed-zero",
      value: { percent: "0" },
      source: confirmedSource,
    };
  const result = inspectKaminoRead(identity, input);
  expect(result).not.toBeNull();
  const metric = field === "usd" ? result?.supplied?.valueUsd : result?.supplyApy;
  expect(metric).toEqual({
    status: "confirmed-zero",
    value: { [field]: "0" },
    source: confirmedSource,
  });
  expect(result?.metadata?.source).toEqual(source);
});
// @rule R3: zero declarations do not accept nonzero, fixture or unconfirmed sources.
it.each(["usd", "percent"] as const)("rejects invalid confirmed %s declarations", (field) => {
  const confirmedSource = {
    kind: "observed",
    source: "confirmed-metric-read",
    sourceAsOf: source.sourceAsOf,
    slot: "123456789",
    commitment: "finalized",
  } as const;
  for (const [value, declaredSource] of [
    ["0.01", confirmedSource],
    ["0", source],
    ["0", { ...confirmedSource, commitment: "processed" }],
  ] as const) {
    const input = read();
    if (field === "usd")
      Object.assign(input, {
        supplied: {
          quantity: null,
          valueUsd: { status: "confirmed-zero", value: { usd: value }, source: declaredSource },
        },
      });
    else
      Object.assign(input, {
        supplyApy: { status: "confirmed-zero", value: { percent: value }, source: declaredSource },
      });
    const output = inspectKaminoRead(identity, input);
    expect(field === "usd" ? output?.supplied?.valueUsd : output?.supplyApy).toBeNull();
    expect(output?.metadata?.source).toEqual(source);
  }
});
// @rule R3/R4: a sourced APY decimal is preserved; no handoff or contract sets a protocol maximum.
it("preserves a declared APY above 999 without invalidating independent reads", () => {
  const input = read();
  input.supplyApy = { status: "available", value: { percent: "1000.25" }, source };
  expect(inspectKaminoRead(identity, input)?.supplyApy).toEqual(input.supplyApy);
});
// @rule R3: independently sourced metrics fail closed individually, not as one financial envelope.
it.each([
  "apy",
  "usd",
  "quantity",
  "token",
] as const)("isolates invalid %s while preserving valid sibling reads", (field) => {
  const input = read();
  if (input.supplied)
    input.supplied.valueUsd = { status: "available", value: { usd: "2500000.12" }, source };
  if (field === "apy")
    input.supplyApy = { status: "available", value: { percent: "bad-apy" }, source };
  if (field === "usd" && input.supplied?.valueUsd?.status === "available")
    input.supplied.valueUsd.value.usd = "bad-usd";
  if (field === "quantity" && input.supplied?.quantity?.status === "available")
    input.supplied.quantity.value.raw = "18446744073709551616";
  if (field === "token" && input.supplied?.quantity?.status === "available")
    input.supplied.quantity.value.token = { ...asset, mint: WSOL_MINT };
  const output = inspectKaminoRead(identity, input);
  expect(output?.metadata).toEqual(input.metadata);
  if (field === "apy") expect(output?.supplyApy).toBeNull();
  if (field === "usd") expect(output?.supplied?.valueUsd).toBeNull();
  else expect(output?.supplied?.valueUsd).toEqual(input.supplied?.valueUsd);
  if (field === "quantity" || field === "token") expect(output?.supplied?.quantity).toBeNull();
  else expect(output?.supplied?.quantity).toEqual(input.supplied?.quantity);
  expect(JSON.stringify(output)).not.toMatch(/bad-apy|bad-usd|18446744073709551616/);
});
// @rule R3: mismatched metadata is unavailable but canonical origin and other reads remain intact.
it("isolates mismatched metadata and malformed reward streams", () => {
  const input = read();
  if (input.metadata?.status === "available") input.metadata.value.reserve = WSOL_MINT;
  input.rewards = [
    {
      quantity: { status: "available", value: { token: asset, raw: "bad-reward" }, source },
      valueUsd: { status: "available", value: { usd: "10.25" }, source },
    },
    {
      quantity: { status: "available", value: { token: asset, raw: "1250000" }, source },
      valueUsd: null,
    },
  ];
  const output = inspectKaminoRead(identity, input);
  expect(output?.metadata).toBeNull();
  expect(output?.supplyApy).toEqual(input.supplyApy);
  expect(output?.rewards?.[0]?.quantity).toBeNull();
  expect(output?.rewards?.[0]?.valueUsd).toEqual(input.rewards[0]?.valueUsd);
  expect(output?.rewards?.[1]?.quantity).toEqual(input.rewards[1]?.quantity);
});
