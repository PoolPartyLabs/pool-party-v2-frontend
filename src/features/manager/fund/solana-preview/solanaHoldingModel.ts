/**
 * @id PP-MGR-LIB-070
 * @name solanaHoldingModel
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, pure injected presentation
 */
import { z } from "zod";
import { type JupiterInspection, jupiterInspectionSchema } from "./solanaCatalog";
import {
  type SolanaAmount,
  type SolanaReadState,
  type SolanaSource,
  type SolanaToken,
  solanaAddressSchema,
  solanaAmountSchema,
  solanaClusterSchema,
  solanaDecimalSchema,
  solanaRawAmountSchema,
  solanaReadStateSchema,
  solanaSourceSchema,
  solanaTokenSchema,
  WSOL_MINT,
} from "./solanaSchemas";
export interface HoldingOrigin {
  localId: string;
  cluster: SolanaToken["cluster"];
  asset: SolanaToken;
  custody: { program: string; authority: string; account: string; positionId: string | null };
}
export interface HoldingRead {
  origin: HoldingOrigin;
  snapshotId: string;
  quantity: SolanaReadState<SolanaAmount>;
  valueUsd: SolanaReadState<{ usd: string }>;
  allocation: SolanaReadState<{ bps: number }>;
}
export interface HoldingIntent {
  id: string;
  revision: string;
  origin: HoldingOrigin;
  side: "buy" | "sell";
  input: SolanaAmount;
  outputToken: SolanaToken;
  destination:
    | { kind: "holding"; account: string }
    | { kind: "idle-output"; idleId: string; account: string; principalBridgeId: string | null };
  wrapPlan: {
    kind: "wrap" | "unwrap";
    program: string;
    sourceAccount: string;
    destinationAccount: string;
  } | null;
}
export interface JupiterQuote {
  intentId: string;
  intentRevision: string;
  origin: HoldingOrigin;
  status: "available" | "stale";
  source: SolanaSource;
  quoteId: string;
  input: SolanaAmount;
  output: SolanaAmount;
  minimumReceived: SolanaAmount;
  route: string[];
  costs: Array<{
    id: string;
    category: "platform" | "integrator" | "amm" | "network" | "rent" | "priority" | "tip";
    amount: SolanaAmount;
    inclusion: "included-in-input" | "included-in-output" | "additional" | "unknown";
  }>;
  inspection: JupiterInspection;
}

const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);
const id = z.string().min(1).max(128);
const amount = solanaAmountSchema.refine(
  (value) => BigInt(value.raw) <= U64_MAX,
  "Token amount exceeds u64",
);
export const holdingOriginSchema = z
  .object({
    localId: id,
    cluster: solanaClusterSchema,
    asset: solanaTokenSchema,
    custody: z
      .object({
        program: solanaAddressSchema,
        authority: solanaAddressSchema,
        account: solanaAddressSchema,
        positionId: solanaAddressSchema.nullable(),
      })
      .strict(),
  })
  .strict()
  .refine((value) => value.asset.cluster === value.cluster, "Asset cluster mismatch");
const destination = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("holding"), account: solanaAddressSchema }).strict(),
  z
    .object({
      kind: z.literal("idle-output"),
      idleId: id,
      account: solanaAddressSchema,
      principalBridgeId: id.nullable(),
    })
    .strict(),
]);
export const holdingIntentSchema = z
  .object({
    id,
    revision: id,
    origin: holdingOriginSchema,
    side: z.enum(["buy", "sell"]),
    input: amount,
    outputToken: solanaTokenSchema,
    destination,
    wrapPlan: z
      .object({
        kind: z.enum(["wrap", "unwrap"]),
        program: solanaAddressSchema,
        sourceAccount: solanaAddressSchema,
        destinationAccount: solanaAddressSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export function holdingTokenKey(token: SolanaToken): string {
  return `${token.cluster}:${token.kind}:${token.kind === "spl" ? token.mint : "native-SOL"}:${token.decimals}:${token.unit}`;
}
export function holdingOriginKey(origin: HoldingOrigin): string {
  return JSON.stringify([
    origin.localId,
    origin.cluster,
    holdingTokenKey(origin.asset),
    origin.custody.program,
    origin.custody.authority,
    origin.custody.account,
    origin.custody.positionId,
  ]);
}
function sameToken(a: SolanaToken, b: SolanaToken) {
  return holdingTokenKey(a) === holdingTokenKey(b);
}
function confirmed(source: SolanaSource) {
  return source.kind === "observed" && source.commitment !== "processed";
}
function sameSource(a: SolanaSource, b: SolanaSource) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export interface HoldingReadView {
  quantity: SolanaAmount | null;
  quantityStatus: "available" | "stale" | "confirmed-zero" | "unavailable";
  valueUsd: string | null;
  allocationBps: number | null;
  source: SolanaSource | null;
  origin: HoldingOrigin | null;
  snapshotId: string | null;
}
export function inspectHoldingRead(originInput: unknown, readInput: unknown): HoldingReadView {
  const empty: HoldingReadView = {
    quantity: null,
    quantityStatus: "unavailable",
    valueUsd: null,
    allocationBps: null,
    source: null,
    origin: null,
    snapshotId: null,
  };
  const origin = holdingOriginSchema.safeParse(originInput);
  const shape = z
    .object({
      origin: holdingOriginSchema,
      snapshotId: id,
      quantity: z.unknown(),
      valueUsd: z.unknown(),
      allocation: z.unknown(),
    })
    .strict()
    .safeParse(readInput);
  if (
    !origin.success ||
    !shape.success ||
    holdingOriginKey(origin.data) !== holdingOriginKey(shape.data.origin)
  )
    return empty;
  const quantity = solanaReadStateSchema(amount).safeParse(shape.data.quantity);
  if (!quantity.success)
    return { ...empty, origin: origin.data, snapshotId: shape.data.snapshotId };
  const q = quantity.data;
  if (!("value" in q))
    return { ...empty, origin: origin.data, snapshotId: shape.data.snapshotId, source: q.source };
  if (
    !sameToken(q.value.token, origin.data.asset) ||
    (q.source.kind === "observed" && !confirmed(q.source))
  )
    return { ...empty, origin: origin.data, snapshotId: shape.data.snapshotId, source: q.source };
  if (q.value.raw === "0" && !confirmed(q.source))
    return { ...empty, origin: origin.data, snapshotId: shape.data.snapshotId, source: q.source };
  const valuation = solanaReadStateSchema(
    z.object({ usd: solanaDecimalSchema }).strict(),
  ).safeParse(shape.data.valueUsd);
  const allocation = solanaReadStateSchema(
    z.object({ bps: z.number().int().min(0).max(10000) }).strict(),
  ).safeParse(shape.data.allocation);
  const available = q.status !== "stale";
  return {
    origin: origin.data,
    snapshotId: shape.data.snapshotId,
    quantity: q.value,
    quantityStatus:
      q.status === "stale" ? "stale" : q.value.raw === "0" ? "confirmed-zero" : q.status,
    source: q.source,
    valueUsd:
      available &&
      valuation.success &&
      valuation.data.status === "available" &&
      sameSource(q.source, valuation.data.source)
        ? valuation.data.value.usd
        : null,
    allocationBps:
      available &&
      allocation.success &&
      allocation.data.status === "available" &&
      sameSource(q.source, allocation.data.source)
        ? allocation.data.value.bps
        : null,
  };
}
export function validateHoldingIntent(
  originInput: unknown,
  intentInput: unknown,
): HoldingIntent | null {
  const origin = holdingOriginSchema.safeParse(originInput);
  const intent = holdingIntentSchema.safeParse(intentInput);
  if (
    !origin.success ||
    !intent.success ||
    holdingOriginKey(origin.data) !== holdingOriginKey(intent.data.origin)
  )
    return null;
  const value = intent.data;
  if (
    value.input.raw === "0" ||
    value.input.token.cluster !== origin.data.cluster ||
    value.outputToken.cluster !== origin.data.cluster
  )
    return null;
  if (
    value.side === "buy" &&
    (!sameToken(value.outputToken, origin.data.asset) ||
      value.destination.kind !== "holding" ||
      value.destination.account !== origin.data.custody.account)
  )
    return null;
  if (
    value.side === "sell" &&
    (!sameToken(value.input.token, origin.data.asset) || value.destination.kind !== "idle-output")
  )
    return null;
  return value;
}
export function classifyHoldingConversion(
  intentInput: unknown,
): "bypass" | "wrap" | "unwrap" | "swap" | "unavailable" {
  const base = holdingIntentSchema.safeParse(intentInput);
  if (!base.success) return "unavailable";
  const intent = validateHoldingIntent(base.data.origin, base.data);
  if (!intent) return "unavailable";
  const a = intent.input.token,
    b = intent.outputToken;
  if (sameToken(a, b)) return intent.wrapPlan ? "unavailable" : "bypass";
  if (a.kind === "native" || b.kind === "native") {
    const plan = intent.wrapPlan;
    if (!plan) return "unavailable";
    if (
      a.kind === "native" &&
      b.kind === "spl" &&
      b.mint === WSOL_MINT &&
      plan.kind === "wrap" &&
      plan.destinationAccount === intent.destination.account
    )
      return "wrap";
    if (
      a.kind === "spl" &&
      a.mint === WSOL_MINT &&
      b.kind === "native" &&
      plan.kind === "unwrap" &&
      plan.sourceAccount === intent.origin.custody.account &&
      plan.destinationAccount === intent.destination.account
    )
      return "unwrap";
    return "unavailable";
  }
  return intent.wrapPlan ? "unavailable" : "swap";
}
const cost = z
  .object({
    id,
    category: z.enum(["platform", "integrator", "amm", "network", "rent", "priority", "tip"]),
    amount,
    inclusion: z.enum(["included-in-input", "included-in-output", "additional", "unknown"]),
  })
  .strict();
export const jupiterQuoteSchema = z
  .object({
    intentId: id,
    intentRevision: id,
    origin: holdingOriginSchema,
    status: z.enum(["available", "stale"]),
    source: solanaSourceSchema,
    quoteId: id,
    input: amount,
    output: amount,
    minimumReceived: amount,
    route: z.array(z.string().min(1).max(128)).min(1).max(64),
    costs: z.array(cost).max(64),
    inspection: jupiterInspectionSchema,
  })
  .strict();
export interface HoldingClock {
  now: string | null;
  blockHeight: string | null;
}
export interface JupiterQuoteView {
  quote: JupiterQuote | null;
  quoteValidity: "valid" | "expired" | "unknown";
  transactionValidity: "valid" | "expired" | "unknown";
  execution: "unavailable";
}
/** Quote/transaction times come from the host's clock/read. Navigation does not renew either validity.
 * PP-INTEGRATION-POINT: POO-2261/2262 must verify authority, routing, quote and transaction data;
 * no signing/building/landing capability follows from this inspection contract.
 */
export function inspectJupiterQuote(
  intentInput: unknown,
  quoteInput: unknown,
  clock: HoldingClock,
): JupiterQuoteView {
  const empty: JupiterQuoteView = {
    quote: null,
    quoteValidity: "unknown",
    transactionValidity: "unknown",
    execution: "unavailable",
  };
  const base = holdingIntentSchema.safeParse(intentInput);
  if (!base.success) return empty;
  const intent = validateHoldingIntent(base.data.origin, base.data);
  const parsed = jupiterQuoteSchema.safeParse(quoteInput);
  if (!intent || !parsed.success || classifyHoldingConversion(intent) !== "swap") return empty;
  const q = parsed.data;
  if (
    q.intentId !== intent.id ||
    q.intentRevision !== intent.revision ||
    holdingOriginKey(q.origin) !== holdingOriginKey(intent.origin) ||
    !sameToken(q.input.token, intent.input.token) ||
    q.input.raw !== intent.input.raw ||
    !sameToken(q.output.token, intent.outputToken) ||
    !sameToken(q.minimumReceived.token, q.output.token) ||
    BigInt(q.minimumReceived.raw) > BigInt(q.output.raw) ||
    q.output.raw === "0" ||
    q.minimumReceived.raw === "0" ||
    q.input.token.kind !== "spl" ||
    q.output.token.kind !== "spl" ||
    q.inspection.inputMint !== q.input.token.mint ||
    q.inspection.outputMint !== q.output.token.mint ||
    q.inspection.rawInput !== q.input.raw
  )
    return empty;
  if (
    new Set(q.costs.map((c) => c.id)).size !== q.costs.length ||
    q.costs.some(
      (c) =>
        c.amount.token.cluster !== intent.origin.cluster ||
        (c.inclusion === "included-in-input" && !sameToken(c.amount.token, q.input.token)) ||
        (c.inclusion === "included-in-output" && !sameToken(c.amount.token, q.output.token)),
    )
  )
    return empty;
  const includedInput = q.costs.reduce(
    (total, entry) =>
      entry.inclusion === "included-in-input" ? total + BigInt(entry.amount.raw) : total,
    BigInt(0),
  );
  if (includedInput > BigInt(q.input.raw)) return empty;
  const view: JupiterQuoteView = { ...empty, quote: q };
  if (q.status !== "available" || !confirmed(q.source)) return view;
  const expiry = q.inspection.quoteValidity;
  if (
    expiry.status === "available" &&
    confirmed(expiry.source) &&
    sameSource(expiry.source, q.source) &&
    z.string().datetime({ offset: true }).safeParse(clock.now).success
  ) {
    const now = Date.parse(clock.now as string),
      expires = Date.parse(expiry.value.expiresAt);
    if (now >= Date.parse(q.source.sourceAsOf))
      view.quoteValidity = now < expires ? "valid" : "expired";
  }
  const tx = q.inspection.transactionValidity;
  if (
    tx.status === "available" &&
    confirmed(tx.source) &&
    z.string().datetime({ offset: true }).safeParse(clock.now).success &&
    Date.parse(tx.source.sourceAsOf) <= Date.parse(clock.now as string) &&
    solanaRawAmountSchema.safeParse(clock.blockHeight).success
  )
    view.transactionValidity =
      BigInt(clock.blockHeight as string) <= BigInt(tx.value.lastValidBlockHeight)
        ? "valid"
        : "expired";
  return view;
}
