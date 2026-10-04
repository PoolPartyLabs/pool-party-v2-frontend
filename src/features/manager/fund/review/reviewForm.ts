/**
 * @id PP-MGR-LIB-033 (POO-2188)
 * @name reviewForm
 * @implements-rules-version v1
 * @analytics-events none: pure helpers, the Review page emits.
 * Integer fee/USDC input handling and field-specific launch reasons in screen order.
 */
import type { ReviewDraft } from "../launch/review";
import { rawUsdc } from "../launch/review";

export const FEE_BOUNDS_PCT = {
  performanceFeeBps: { min: 10, max: 90 },
  managementFeeBps: { min: 0, max: 5 },
  payoutFeeBps: { min: 0, max: 10 },
} as const;
export type FeeField = keyof typeof FEE_BOUNDS_PCT;
export type SeedPreview = {
  fee: bigint;
  shares: bigint;
  principal: bigint;
  charged: bigint;
  remainder: bigint;
};

function sanitizeDecimal(text: string, places: number, wholeLimit: number): string {
  const clean = text.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = clean.split(".");
  return whole.slice(0, wholeLimit) + (rest.length ? `.${rest.join("").slice(0, places)}` : "");
}
export const sanitizeFeeInput = (text: string) => sanitizeDecimal(text, 2, 3);
export const sanitizeUsdcInput = (text: string) => sanitizeDecimal(text, 6, 71);
export function normalizeUsdcInput(text: string): string {
  const clean = sanitizeUsdcInput(text);
  if (!/\d/.test(clean)) return "";
  const [whole = "", fraction = ""] = clean.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${BigInt(whole || "0")}${trimmed ? `.${trimmed}` : ""}`;
}
export function parseUsdc(text: string): bigint | null {
  try {
    return rawUsdc(text);
  } catch {
    return null;
  }
}
export function percentTextToBps(text: string): number | null {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  return Number(BigInt(whole) * BigInt("100") + BigInt(fraction.padEnd(2, "0")));
}
export function bpsToPercentText(bps: number): string {
  const value = Math.round(bps);
  const fraction = String(Math.abs(value) % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${Math.trunc(value / 100)}${fraction ? `.${fraction}` : ""}`;
}
export function clampFeeBps(field: FeeField, value: number): number {
  const bounds = FEE_BOUNDS_PCT[field];
  return Math.max(bounds.min * 100, Math.min(bounds.max * 100, Math.round(value)));
}
export function liveFeeInput(field: FeeField, text: string): string | null {
  const bps = percentTextToBps(text);
  return bps !== null && bps === clampFeeBps(field, bps) ? bpsToPercentText(bps) : null;
}
export function commitFeeInput(field: FeeField, text: string): string | null {
  const clean = normalizeUsdcInput(sanitizeFeeInput(text));
  const bps = percentTextToBps(clean);
  return bps === null ? null : bpsToPercentText(clampFeeBps(field, bps));
}
export function stepFee(field: FeeField, bps: number, direction: -1 | 1): string {
  return bpsToPercentText(clampFeeBps(field, bps + direction * 100));
}
export function canStepFee(field: FeeField, bps: number, direction: -1 | 1): boolean {
  return clampFeeBps(field, bps + direction * 100) !== bps;
}
export function formatUsdc(raw: bigint, locale = "en-US"): string {
  const negative = raw < BigInt("0");
  const value = negative ? -raw : raw;
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    value / BigInt("1000000"),
  );
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  const fraction = (value % BigInt("1000000")).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? decimal + fraction : ""}`;
}
export const formatShares = (shares: bigint, locale = "en-US") =>
  new Intl.NumberFormat(locale).format(shares);
export const nameLength = (name: string) => name.trim().length;
export const isNameLengthValid = (name: string) => nameLength(name) >= 10 && nameLength(name) <= 50;

export function dataUrlToFile(url: string): File | null {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) return null;
  try {
    const bytes = Uint8Array.from(atob(url.split(",")[1] ?? ""), (character) =>
      character.charCodeAt(0),
    );
    return bytes.length ? new File([bytes], "logo.png", { type: "image/png" }) : null;
  } catch {
    return null;
  }
}

export const REVIEW_REASON_KEYS = {
  nameLength: "fundBuilder.review.validation.nameLength",
  nameCharacters: "fundBuilder.review.validation.nameCharacters",
  descriptionLength: "fundBuilder.review.validation.descriptionLength",
  descriptionCharacters: "fundBuilder.review.validation.descriptionCharacters",
  logoUploading: "mandate.logoUploading",
  logoInvalid: "fundBuilder.review.validation.logoInvalid",
  performanceFee: "fundBuilder.review.validation.performanceFee",
  managementFee: "fundBuilder.review.validation.managementFee",
  minimum: "fundBuilder.review.validation.minimum",
  instantFee: "fundBuilder.review.validation.instantFee",
  seedInvalid: "fundBuilder.review.validation.seedInvalid",
  seedUnderMinimum: "fundBuilder.review.validation.seedUnderMinimum",
  seedOverBalance: "fundBuilder.review.validation.seedOverBalance",
  seedNoShare: "fundBuilder.review.validation.seedNoShare",
  balanceUnread: "fundBuilder.review.validation.balanceUnread",
} as const;
export type FormReasonCode = keyof typeof REVIEW_REASON_KEYS;
export interface ReviewReason {
  code: FormReasonCode | "build" | "draft";
  field: string;
  messageKey: string;
  detail?: string;
}
export interface ReviewReasonsInput {
  review: ReviewDraft;
  errors: { field?: string }[];
  launchBlockers: { code: string; field?: string; messageKey: string }[];
  balance: bigint | null;
  preview: SeedPreview | null;
  uploading: boolean;
  buildReason: { code: string; messageKey: string } | null;
}
export function seedReason(
  input: Pick<ReviewReasonsInput, "balance" | "preview"> & { seed: string; minimum: string },
): FormReasonCode | null {
  const minimum = parseUsdc(input.minimum);
  if (minimum === null || minimum <= BigInt("0")) return null;
  const seed = parseUsdc(input.seed);
  if (seed === null) return "seedInvalid";
  if (seed < minimum) return "seedUnderMinimum";
  if (input.balance !== null && seed > input.balance) return "seedOverBalance";
  if (input.preview && input.preview.shares < BigInt("1")) return "seedNoShare";
  if (input.balance === null) return "balanceUnread";
  return null;
}
export function listReviewReasons(input: ReviewReasonsInput): ReviewReason[] {
  const { review } = input;
  const reasons: ReviewReason[] = [];
  const flagged = (field: string) =>
    input.errors.some((error) => error.field === field) ||
    input.launchBlockers.some((error) => error.field === field && error.code === "INVALID_REVIEW");
  const add = (code: FormReasonCode, field: string) =>
    reasons.push({ code, field, messageKey: REVIEW_REASON_KEYS[code] });
  if (!isNameLengthValid(review.name)) add("nameLength", "name");
  else if (flagged("name")) add("nameCharacters", "name");
  if (review.description.length > 280) add("descriptionLength", "description");
  else if (flagged("description")) add("descriptionCharacters", "description");
  if (input.uploading || input.launchBlockers.some((error) => error.code === "LOGO_UPLOADING"))
    add("logoUploading", "imageUrl");
  else if (flagged("imageUrl")) add("logoInvalid", "imageUrl");
  for (const [field, code] of [
    ["performanceFeeBps", "performanceFee"],
    ["managementFeeBps", "managementFee"],
  ] as const)
    if (
      !Number.isInteger(review[field]) ||
      review[field] !== clampFeeBps(field, review[field]) ||
      flagged(field)
    )
      add(code, field);
  const minimum = parseUsdc(review.minimum);
  if (minimum === null || minimum <= BigInt("0") || flagged("minimum")) add("minimum", "minimum");
  if (
    !Number.isInteger(review.payoutFeeBps) ||
    review.payoutFeeBps !== clampFeeBps("payoutFeeBps", review.payoutFeeBps) ||
    flagged("payoutFeeBps")
  )
    add("instantFee", "payoutFeeBps");
  const seed = seedReason({
    ...input,
    seed: review.seed,
    minimum: minimum === null || minimum <= BigInt("0") ? "0.000001" : review.minimum,
  });
  if (seed) add(seed, "seed");
  else if (flagged("seed")) add("seedNoShare", "seed");
  const build =
    input.buildReason ??
    input.launchBlockers.find(
      (error) =>
        error.code === "BUILD_EXECUTION_GAP" ||
        error.code.startsWith("BUILD_") ||
        error.code === "UNSUPPORTED_POSITION",
    );
  if (build)
    reasons.push({
      code: "build",
      field: "build",
      messageKey: build.messageKey,
      detail: build.code,
    });
  const draft = input.launchBlockers.find((error) =>
    ["STORAGE_UNAVAILABLE", "DRAFT_UNAVAILABLE"].includes(error.code),
  );
  if (draft)
    reasons.push({
      code: "draft",
      field: "draft",
      messageKey: draft.messageKey,
      detail: draft.code,
    });
  return reasons;
}
export const reviewReasons = (input: ReviewReasonsInput): ReviewReason | null =>
  listReviewReasons(input)[0] ?? null;
