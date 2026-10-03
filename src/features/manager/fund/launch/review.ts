/**
 * @id PP-MGR-LIB-025 (POO-2172)
 * @name fundReview
 * @implements-rules-version v1
 * Review validation and integer seed accounting.
 */
import { z } from "zod";

const plainText = z.string().refine(
  (value) =>
    !/[<>]/.test(value) &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return (code >= 32 && code !== 127) || [9, 10, 13].includes(code);
    }),
);
const usdc = z.string().regex(/^\d{1,71}(\.\d{1,6})?$/);
const https = z
  .string()
  .max(2048)
  .refine((value) => value === "" || /^https:\/\//.test(value));

export const reviewSchema = z.object({
  name: plainText.transform((value) => value.trim()).pipe(z.string().min(10).max(50)),
  description: plainText.pipe(z.string().max(280)),
  imageUrl: https,
  performanceFeeBps: z.number().int().min(1000).max(9000),
  managementFeeBps: z.number().int().min(0).max(500),
  payoutFeeBps: z.number().int().min(0).max(1000),
  minimum: usdc,
  seed: usdc,
});
export type FundReview = z.infer<typeof reviewSchema>;

export function rawUsdc(value: string): bigint {
  const validated = usdc.parse(value);
  const [whole = "0", fraction = ""] = validated.split(".");
  return BigInt(whole) * BigInt("1000000") + BigInt(fraction.padEnd(6, "0"));
}

export function previewSeed(gross: bigint) {
  if (gross <= BigInt("0")) throw new Error("INVALID_SEED");
  const fee = (gross * BigInt("25")) / BigInt("10000");
  const shares = (gross - fee) / BigInt("1000000");
  const principal = shares * BigInt("1000000");
  return { fee, shares, principal, charged: principal + fee, remainder: gross - principal - fee };
}

export function validateReview(value: unknown, balance: bigint): FundReview {
  const review = reviewSchema.parse(value);
  const seed = rawUsdc(review.seed);
  const minimum = rawUsdc(review.minimum);
  if (
    minimum <= BigInt("0") ||
    seed < minimum ||
    seed > balance ||
    previewSeed(seed).shares < BigInt("1")
  )
    throw new Error("INVALID_DEPOSIT");
  return review;
}

export function validateLogo(file: Pick<File, "size" | "type">): void {
  if (
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 10 * 1024 * 1024 ||
    file.size === 0
  )
    throw new Error("INVALID_LOGO");
}
