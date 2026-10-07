/**
 * @id PP-MGR-LIB-063
 * @name solanaSchemas
 * @description Local Solana identity, precision and provenance contracts.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8679-382
 * @linear https://linear.app/yeildbay/issue/POO-2291
 * @implements-rules-version v1 (POO-2291)
 * @analytics-events none, pure contracts; the local preview host owns events.
 */
import { z } from "zod";

/** Official Jupiter V2 OpenAPI InputMint/OutputMint examples and Order and Execute guide,
 * archived in PoolPartyV2Design/exports/solana-protocol-research-2026-10-07 on October 7.
 * https://developers.jup.ag/docs/openapi-spec/swap/v2/swap.yaml
 * https://developers.jup.ag/docs/swap/order-and-execute.md
 * Metadata only: no account, balance, price or execution availability follows from these mints.
 */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Bounded base58 decoding, including leading zero bytes. No case normalization. */
function isAddress(value: string): boolean {
  if (value.length < 32 || value.length > 44 || value.startsWith("0x")) return false;
  let decoded = BigInt(0);
  for (const char of value) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return false;
    decoded = decoded * BigInt(58) + BigInt(digit);
  }
  let bytes = 0;
  for (let rest = decoded; rest > BigInt(0); rest >>= BigInt(8)) bytes++;
  for (const char of value) {
    if (char !== "1") break;
    bytes++;
  }
  return bytes === 32;
}
export const solanaAddressSchema = z
  .string()
  .refine(isAddress, "Expected a 32-byte base58 address");
export const solanaClusterSchema = z.enum(["mainnet-beta", "devnet", "testnet"]);
export const solanaRawAmountSchema = z
  .string()
  .max(78)
  .regex(/^(0|[1-9]\d*)$/);
export const solanaDecimalSchema = z
  .string()
  .max(300)
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/);
export const solanaIdentitySchema = z
  .object({
    network: z.literal("solana"),
    cluster: solanaClusterSchema,
    kind: z.enum(["mint", "program", "pool", "market", "reserve", "position", "obligation"]),
    address: solanaAddressSchema,
  })
  .strict();
export type SolanaIdentity = z.infer<typeof solanaIdentitySchema>;
export function solanaIdentityKey(identity: SolanaIdentity): string {
  const parsed = solanaIdentitySchema.parse(identity);
  return `${parsed.network}:${parsed.cluster}:${parsed.kind}:${parsed.address}`;
}

const tokenContext = { network: z.literal("solana"), cluster: solanaClusterSchema };
export const solanaTokenSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...tokenContext,
        kind: z.literal("native"),
        symbol: z.literal("SOL"),
        decimals: z.literal(9),
        unit: z.literal("lamports"),
      })
      .strict(),
    z
      .object({
        ...tokenContext,
        kind: z.literal("spl"),
        symbol: z.string().min(1).max(32),
        mint: solanaAddressSchema,
        decimals: z.number().int().min(0).max(255),
        unit: z.literal("base-units"),
      })
      .strict(),
  ])
  .superRefine((token, ctx) => {
    if (token.kind !== "spl") return;
    if (
      (token.mint === WSOL_MINT && token.decimals !== 9) ||
      (token.cluster === "mainnet-beta" && token.mint === USDC_MINT && token.decimals !== 6)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decimals"],
        message: "Canonical mint decimals mismatch",
      });
  });
export type SolanaToken = z.infer<typeof solanaTokenSchema>;
export const solanaAmountSchema = z
  .object({ token: solanaTokenSchema, raw: solanaRawAmountSchema })
  .strict();
export type SolanaAmount = z.infer<typeof solanaAmountSchema>;
/** Exact unit conversion for read models; never routes through Number or an EVM formatter. */
export function solanaAmountToDecimal(amount: SolanaAmount): string {
  const { raw, token } = solanaAmountSchema.parse(amount);
  if (token.decimals === 0) return raw;
  const digits = raw.padStart(token.decimals + 1, "0");
  const whole = digits.slice(0, -token.decimals);
  const fraction = digits.slice(-token.decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

const sourceFields = { sourceAsOf: z.string().datetime({ offset: true }) };
const observedSourceSchema = z
  .object({
    ...sourceFields,
    kind: z.literal("observed"),
    source: z.string().min(1).max(128),
    slot: solanaRawAmountSchema,
    commitment: z.enum(["processed", "confirmed", "finalized"]),
  })
  .strict();
const confirmedSourceSchema = observedSourceSchema.extend({
  commitment: z.enum(["confirmed", "finalized"]),
});
export const solanaSourceSchema = z.discriminatedUnion("kind", [
  observedSourceSchema,
  z
    .object({
      ...sourceFields,
      kind: z.literal("fixture"),
      fixtureId: z.string().min(1).max(128),
      slot: z.null(),
    })
    .strict(),
]);
export type SolanaSource = z.infer<typeof solanaSourceSchema>;
const reason = z.string().min(1).max(128);
/** Declared provenance is retained for stale/not-applicable values. This schema is not
 * an attestation of an external read and supplies no missing-data fallback.
 */
export function solanaReadStateSchema<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("status", [
    z.object({ status: z.literal("available"), value, source: solanaSourceSchema }).strict(),
    z.object({ status: z.literal("stale"), value, source: solanaSourceSchema, reason }).strict(),
    z
      .object({ status: z.literal("unavailable"), source: solanaSourceSchema.nullable(), reason })
      .strict(),
    z.object({ status: z.literal("not-applicable"), source: solanaSourceSchema, reason }).strict(),
    z
      .object({
        status: z.literal("confirmed-zero"),
        value: value.refine(
          (entry: unknown) =>
            typeof entry === "object" && entry !== null && "raw" in entry && entry.raw === "0",
          "Confirmed zero requires raw zero",
        ),
        source: confirmedSourceSchema,
      })
      .strict(),
  ]);
}
export type SolanaReadState<T> =
  | { status: "available"; value: T; source: SolanaSource }
  | { status: "stale"; value: T; source: SolanaSource; reason: string }
  | { status: "unavailable"; source: SolanaSource | null; reason: string }
  | { status: "not-applicable"; source: SolanaSource; reason: string }
  | { status: "confirmed-zero"; value: T; source: z.infer<typeof confirmedSourceSchema> };
