/**
 * @id PP-MGR-LIB-072 (POO-2291)
 * @name solanaKaminoReadModel
 * @implements-rules-version v1
 * @analytics-events none, pure injected read contracts
 * Source-preserving Kamino Supply USDC presentation. Validation is not an external attestation.
 */
import { z } from "zod";
import {
  type SolanaAmount,
  type SolanaReadState,
  type SolanaToken,
  solanaAddressSchema,
  solanaAmountSchema,
  solanaDecimalSchema,
  solanaRawAmountSchema,
  solanaReadStateSchema,
  solanaSourceSchema,
  solanaTokenSchema,
  USDC_MINT,
} from "./solanaSchemas";

export interface KaminoReadIdentity {
  localId: string;
  cluster: SolanaToken["cluster"];
  program: string;
  market: string;
  reserve: string;
  asset: SolanaToken;
  positionId: string | null;
  obligation: string | null;
}
export interface KaminoMetric {
  quantity: SolanaReadState<SolanaAmount> | null;
  /** Independently sourced USD valuation, never derived from quantity or a USDC label. */
  valueUsd: SolanaReadState<{ usd: string }> | null;
}
export interface KaminoReadSnapshot {
  identity: KaminoReadIdentity;
  /** The host supplies metadata as a declared read, separately from its selected origin. */
  metadata: SolanaReadState<KaminoReadIdentity> | null;
  supplied: KaminoMetric | null;
  principal: KaminoMetric | null;
  interest: KaminoMetric | null;
  rewards: KaminoMetric[] | null;
  supplyApy: SolanaReadState<{ percent: string }> | null;
  availableLiquidity: KaminoMetric | null;
  depositCapacity: KaminoMetric | null;
  availableToWithdraw: KaminoMetric | null;
}
const supplyUsdc = solanaTokenSchema.refine(
  (token) =>
    token.kind === "spl" &&
    token.cluster === "mainnet-beta" &&
    token.mint === USDC_MINT &&
    token.decimals === 6 &&
    token.symbol === "USDC",
  "Kamino Supply requires mainnet USDC",
);
const identitySchema = z
  .object({
    localId: z.string().min(1).max(128),
    cluster: z.literal("mainnet-beta"),
    program: solanaAddressSchema,
    market: solanaAddressSchema,
    reserve: solanaAddressSchema,
    asset: supplyUsdc,
    positionId: solanaAddressSchema.nullable(),
    obligation: solanaAddressSchema.nullable(),
  })
  .strict()
  .refine(
    (identity) =>
      identity.reserve !== USDC_MINT &&
      identity.market !== USDC_MINT &&
      identity.program !== USDC_MINT,
    "A token mint is not a Kamino reserve, market or program",
  );
const amountSchema = solanaAmountSchema.refine(
  (amount) =>
    solanaRawAmountSchema.safeParse(amount.raw).success &&
    BigInt(amount.raw) <= BigInt("18446744073709551615"),
  "Physical quantity exceeds u64",
);
/** Decimal zero belongs to its own value shape; physical raw-unit zero is a different contract. */
function decimalReadSchema<Key extends "usd" | "percent">(key: Key) {
  const value = z.object({ [key]: solanaDecimalSchema }).strict();
  const source = solanaSourceSchema;
  const reason = z.string().min(1).max(128);
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), value, source }).strict(),
    z.object({ status: z.literal("stale"), value, source, reason }).strict(),
    z.object({ status: z.literal("unavailable"), source: source.nullable(), reason }).strict(),
    z.object({ status: z.literal("not-applicable"), source, reason }).strict(),
    z
      .object({
        status: z.literal("confirmed-zero"),
        value: value.refine(
          (entry) => /^0(?:\.0+)?$/.test(entry[key] ?? ""),
          "Confirmed decimal zero requires zero",
        ),
        source: source.refine(
          (entry) =>
            entry.kind === "observed" &&
            (entry.commitment === "confirmed" || entry.commitment === "finalized"),
          "Confirmed zero requires an observed confirmed source",
        ),
      })
      .strict(),
  ]);
}
const quantityReadSchema = solanaReadStateSchema(amountSchema);
const usdReadSchema = decimalReadSchema("usd");
const apyReadSchema = decimalReadSchema("percent");
const metadataReadSchema = solanaReadStateSchema(identitySchema);
const metricEnvelopeSchema = z
  .object({ quantity: z.unknown().optional(), valueUsd: z.unknown().optional() })
  .strict();
const readEnvelopeSchema = z
  .object({
    identity: identitySchema,
    metadata: z.unknown().optional(),
    supplied: z.unknown().optional(),
    principal: z.unknown().optional(),
    interest: z.unknown().optional(),
    rewards: z.unknown().optional(),
    supplyApy: z.unknown().optional(),
    availableLiquidity: z.unknown().optional(),
    depositCapacity: z.unknown().optional(),
    availableToWithdraw: z.unknown().optional(),
  })
  .strict();
/** Every field parse returns null on failure, without copying raw input or an unbounded reason. */
function parseField<T>(schema: z.ZodTypeAny, input: unknown): T | null {
  const parsed = schema.safeParse(input);
  return parsed.success ? (structuredClone(parsed.data) as T) : null;
}
function parseMetric(
  input: unknown,
  identity: KaminoReadIdentity,
  reward = false,
): KaminoMetric | null {
  const envelope = metricEnvelopeSchema.safeParse(input);
  if (!envelope.success) return null;
  let quantity = parseField<SolanaReadState<SolanaAmount>>(
    quantityReadSchema,
    envelope.data.quantity,
  );
  if (quantity && "value" in quantity) {
    const token = quantity.value.token;
    if (reward ? token.cluster !== identity.cluster : !supplyUsdc.safeParse(token).success)
      quantity = null;
  }
  return {
    quantity,
    valueUsd: parseField<SolanaReadState<{ usd: string }>>(usdReadSchema, envelope.data.valueUsd),
  };
}
/** Canonical origin validation is independent of market metrics and does not attest external reads. */
export function inspectKaminoOrigin(input: unknown): KaminoReadIdentity | null {
  return parseField<KaminoReadIdentity>(identitySchema, input);
}
function sameIdentity(a: KaminoReadIdentity, b: KaminoReadIdentity) {
  return (
    a.localId === b.localId &&
    a.cluster === b.cluster &&
    a.program === b.program &&
    a.market === b.market &&
    a.reserve === b.reserve &&
    a.positionId === b.positionId &&
    a.obligation === b.obligation
  );
}
/** Origin/envelope mismatch fails closed globally. Independent malformed fields remain unavailable. */
export function inspectKaminoRead(
  origin: KaminoReadIdentity | null,
  input: unknown,
): KaminoReadSnapshot | null {
  const identity = inspectKaminoOrigin(origin),
    envelope = readEnvelopeSchema.safeParse(input);
  if (!identity || !envelope.success || !sameIdentity(identity, envelope.data.identity))
    return null;
  const inputRead = envelope.data;
  let metadata = parseField<SolanaReadState<KaminoReadIdentity>>(
    metadataReadSchema,
    inputRead.metadata,
  );
  if (metadata && "value" in metadata && !sameIdentity(identity, metadata.value)) metadata = null;
  const rewardStreams = z.array(z.unknown()).max(64).safeParse(inputRead.rewards);
  return {
    identity,
    metadata,
    supplied: parseMetric(inputRead.supplied, identity),
    principal: parseMetric(inputRead.principal, identity),
    interest: parseMetric(inputRead.interest, identity),
    rewards: rewardStreams.success
      ? rewardStreams.data.map(
          (stream) => parseMetric(stream, identity, true) ?? { quantity: null, valueUsd: null },
        )
      : null,
    supplyApy: parseField<SolanaReadState<{ percent: string }>>(apyReadSchema, inputRead.supplyApy),
    availableLiquidity: parseMetric(inputRead.availableLiquidity, identity),
    depositCapacity: parseMetric(inputRead.depositCapacity, identity),
    availableToWithdraw: parseMetric(inputRead.availableToWithdraw, identity),
  };
}
/** Exact independent USD text, en-US grouping and at least two decimal places; no money floats. */
export function formatKaminoUsd(value: string): string {
  const [whole = "0", fraction = ""] = solanaDecimalSchema.parse(value).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}
