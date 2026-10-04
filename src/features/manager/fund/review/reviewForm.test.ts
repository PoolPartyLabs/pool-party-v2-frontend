/**
 * @id PP-MGR-LIB-033
 * @name reviewForm.test
 * @implements-rules-version v1 (POO-2188 rules v1)
 * @analytics-events none, pure helpers under test
 *
 * Slice RB1 of the Review page (POO-2172). Written before `reviewForm.ts`. The rules under test:
 * [R1] name length after trimming, [R2] description length, [R3] the cropped logo as a PNG file,
 * [R4] fees never invalid (sanitise, live commit inside the bounds, snap on blur, clamped steppers),
 * [R6] the protocol fee read from its basis points, [R7] the seed rule that failed, [R9] the first
 * reason in screen order with a field-specific copy key.
 */
import { describe, expect, it } from "vitest";
import enManager from "@/i18n/messages/en/manager.json";
import type { ReviewDraft } from "../launch";
import { previewSeed } from "../launch/review";
import {
  bpsToPercentText,
  canStepFee,
  clampFeeBps,
  commitFeeInput,
  dataUrlToFile,
  FEE_BOUNDS_PCT,
  formatShares,
  formatUsdc,
  isNameLengthValid,
  listReviewReasons,
  liveFeeInput,
  nameLength,
  normalizeUsdcInput,
  parseUsdc,
  percentTextToBps,
  REVIEW_REASON_KEYS,
  type ReviewReasonsInput,
  reviewReasons,
  sanitizeFeeInput,
  sanitizeUsdcInput,
  seedReason,
  stepFee,
} from "./reviewForm";

const USDC = (text: string): bigint => parseUsdc(text) ?? BigInt(-1);

/** The hook's defaults, with a valid name: a review that has no reason at all. */
const VALID: ReviewDraft = {
  name: "ETH and BTC on Arbitrum",
  description: "",
  imageUrl: "",
  performanceFeeBps: 2000,
  managementFeeBps: 0,
  payoutFeeBps: 200,
  minimum: "100",
  seed: "1000",
};

function input(patch: Partial<ReviewReasonsInput> = {}): ReviewReasonsInput {
  const review = patch.review ?? VALID;
  let preview: ReviewReasonsInput["preview"] = null;
  try {
    preview = previewSeed(USDC(review.seed));
  } catch {}
  return {
    review,
    errors: [],
    launchBlockers: [],
    balance: USDC("2500"),
    preview,
    uploading: false,
    buildReason: null,
    ...patch,
  };
}

/** Resolves a `manager`-relative key in the source locale. */
function enValue(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      enManager,
    );
}

describe("fee percent and basis points [R4] [R6]", () => {
  it("writes basis points as the percent text the hook accepts", () => {
    expect(bpsToPercentText(2000)).toBe("20");
    expect(bpsToPercentText(250)).toBe("2.5");
    expect(bpsToPercentText(25)).toBe("0.25");
    expect(bpsToPercentText(0)).toBe("0");
    expect(bpsToPercentText(2055)).toBe("20.55");
  });

  it("reads digits with at most two decimals as basis points, with integer maths", () => {
    expect(percentTextToBps("20")).toBe(2000);
    expect(percentTextToBps("2.5")).toBe(250);
    expect(percentTextToBps("0.25")).toBe(25);
    expect(percentTextToBps("20.55")).toBe(2055);
    expect(percentTextToBps("")).toBeNull();
    expect(percentTextToBps("1.234")).toBeNull();
    expect(percentTextToBps("-1")).toBeNull();
    expect(percentTextToBps("abc")).toBeNull();
  });

  it("states the contract bounds per field, in percent", () => {
    expect(FEE_BOUNDS_PCT.performanceFeeBps).toEqual({ min: 10, max: 90 });
    expect(FEE_BOUNDS_PCT.managementFeeBps).toEqual({ min: 0, max: 5 });
    expect(FEE_BOUNDS_PCT.payoutFeeBps).toEqual({ min: 0, max: 10 });
  });

  it("clamps basis points to the field's bounds", () => {
    expect(clampFeeBps("performanceFeeBps", 500)).toBe(1000);
    expect(clampFeeBps("performanceFeeBps", 9500)).toBe(9000);
    expect(clampFeeBps("managementFeeBps", 900)).toBe(500);
    expect(clampFeeBps("payoutFeeBps", -100)).toBe(0);
    expect(clampFeeBps("payoutFeeBps", 1200)).toBe(1000);
    expect(clampFeeBps("payoutFeeBps", 250.4)).toBe(250);
  });
});

describe("typing a fee [R4]", () => {
  it("keeps digits and one separator, a comma read as a dot, at most two decimals", () => {
    expect(sanitizeFeeInput("2a0%")).toBe("20");
    expect(sanitizeFeeInput("2,5")).toBe("2.5");
    expect(sanitizeFeeInput("2.5.5")).toBe("2.55");
    expect(sanitizeFeeInput("2.555")).toBe("2.55");
    expect(sanitizeFeeInput("-5")).toBe("5");
    expect(sanitizeFeeInput("12345")).toBe("123");
    expect(sanitizeFeeInput("")).toBe("");
  });

  it("commits live only a complete value inside the bounds", () => {
    expect(liveFeeInput("performanceFeeBps", "25")).toBe("25");
    expect(liveFeeInput("performanceFeeBps", "2")).toBeNull();
    expect(liveFeeInput("performanceFeeBps", "95")).toBeNull();
    expect(liveFeeInput("managementFeeBps", "2.")).toBeNull();
    expect(liveFeeInput("managementFeeBps", "2.5")).toBe("2.5");
    expect(liveFeeInput("payoutFeeBps", "")).toBeNull();
  });

  it("snaps the typed value to the bounds on blur, in a form setFeePercent accepts", () => {
    const accepted = /^\d+(\.\d{0,2})?$/;
    const cases: [Parameters<typeof commitFeeInput>[0], string, string][] = [
      ["performanceFeeBps", "95", "90"],
      ["performanceFeeBps", "3", "10"],
      ["performanceFeeBps", "20.5", "20.5"],
      ["managementFeeBps", "7", "5"],
      ["managementFeeBps", ".5", "0.5"],
      ["payoutFeeBps", "12,75", "10"],
      ["payoutFeeBps", "3.", "3"],
      ["payoutFeeBps", "007", "7"],
    ];
    for (const [field, typed, committed] of cases) {
      const result = commitFeeInput(field, typed);
      expect(result, `${field} ${typed}`).toBe(committed);
      expect(result).toMatch(accepted);
    }
  });

  it("commits nothing for an empty field, so the stored value stays", () => {
    expect(commitFeeInput("performanceFeeBps", "")).toBeNull();
    expect(commitFeeInput("performanceFeeBps", ".")).toBeNull();
    expect(commitFeeInput("performanceFeeBps", "abc")).toBeNull();
  });
});

describe("the fee steppers [R4]", () => {
  it("moves one percent and clamps at the bounds", () => {
    expect(stepFee("performanceFeeBps", 2000, 1)).toBe("21");
    expect(stepFee("performanceFeeBps", 2000, -1)).toBe("19");
    expect(stepFee("performanceFeeBps", 9000, 1)).toBe("90");
    expect(stepFee("performanceFeeBps", 1000, -1)).toBe("10");
    expect(stepFee("managementFeeBps", 0, -1)).toBe("0");
    expect(stepFee("payoutFeeBps", 250, 1)).toBe("3.5");
  });

  it("brings a stored value from outside the bounds back inside", () => {
    expect(stepFee("performanceFeeBps", 500, 1)).toBe("10");
    expect(stepFee("managementFeeBps", 900, -1)).toBe("5");
  });

  it("says whether a step can move at all", () => {
    expect(canStepFee("performanceFeeBps", 9000, 1)).toBe(false);
    expect(canStepFee("performanceFeeBps", 9000, -1)).toBe(true);
    expect(canStepFee("managementFeeBps", 0, -1)).toBe(false);
    expect(canStepFee("payoutFeeBps", 1000, 1)).toBe(false);
    expect(canStepFee("payoutFeeBps", 999, 1)).toBe(true);
  });
});

describe("USDC amounts [R7]", () => {
  it("keeps digits and one separator with at most six decimals while typing", () => {
    expect(sanitizeUsdcInput("1,000")).toBe("1.000");
    expect(sanitizeUsdcInput("1000 USDC")).toBe("1000");
    expect(sanitizeUsdcInput("1.1234567")).toBe("1.123456");
    expect(sanitizeUsdcInput("1.2.3")).toBe("1.23");
    expect(sanitizeUsdcInput("-5")).toBe("5");
  });

  it("normalises the text on blur", () => {
    expect(normalizeUsdcInput("0100.500")).toBe("100.5");
    expect(normalizeUsdcInput(".5")).toBe("0.5");
    expect(normalizeUsdcInput("100.")).toBe("100");
    expect(normalizeUsdcInput("000")).toBe("0");
    expect(normalizeUsdcInput(".")).toBe("");
    expect(normalizeUsdcInput("")).toBe("");
  });

  it("parses to raw six-decimal units, or null", () => {
    expect(parseUsdc("100")).toBe(BigInt("100000000"));
    expect(parseUsdc("0.75")).toBe(BigInt("750000"));
    expect(parseUsdc("")).toBeNull();
    expect(parseUsdc("1.1234567")).toBeNull();
    expect(parseUsdc("abc")).toBeNull();
  });

  it("formats raw units with grouping and trailing zeros trimmed, never through a float", () => {
    expect(formatUsdc(BigInt("2500000000"))).toBe("2,500");
    expect(formatUsdc(BigInt("2500500000"))).toBe("2,500.5");
    expect(formatUsdc(BigInt("750000"))).toBe("0.75");
    expect(formatUsdc(BigInt("123456789012345678"))).toBe("123,456,789,012.345678");
    expect(formatShares(BigInt("1234"))).toBe("1,234");
  });
});

describe("the cropped logo [R3]", () => {
  it("turns the crop's PNG data URL into an image/png file", async () => {
    const file = dataUrlToFile("data:image/png;base64,iVBORw0KGgo=");
    expect(file).not.toBeNull();
    expect(file?.type).toBe("image/png");
    expect(file?.name).toBe("logo.png");
    expect(file?.size).toBe(8);
  });

  it("answers null for anything that is not a base64 data URL", () => {
    expect(dataUrlToFile("blob:http://localhost/123")).toBeNull();
    expect(dataUrlToFile("data:image/png,plain")).toBeNull();
    expect(dataUrlToFile("data:image/png;base64,%%%")).toBeNull();
  });
});

describe("the name [R1]", () => {
  it("counts the trimmed name and accepts 10 to 50 characters", () => {
    expect(nameLength("  ETH and BTC on Arbitrum  ")).toBe(23);
    expect(isNameLengthValid("123456789")).toBe(false);
    expect(isNameLengthValid("  1234567890  ")).toBe(true);
    expect(isNameLengthValid("x".repeat(50))).toBe(true);
    expect(isNameLengthValid("x".repeat(51))).toBe(false);
  });
});

describe("which seed rule failed [R7]", () => {
  const base = {
    seed: "1000",
    minimum: "100",
    balance: USDC("2500"),
    preview: previewSeed(USDC("1000")),
  };

  it("passes a first deposit between the minimum and the balance that mints a share", () => {
    expect(seedReason(base)).toBeNull();
  });

  it("names an amount that is not USDC", () => {
    expect(seedReason({ ...base, seed: "", preview: null })).toBe("seedInvalid");
    expect(seedReason({ ...base, seed: "1.1234567", preview: null })).toBe("seedInvalid");
  });

  it("names a first deposit under the minimum, compared with the amount typed", () => {
    expect(seedReason({ ...base, seed: "99.99", preview: previewSeed(USDC("99.99")) })).toBe(
      "seedUnderMinimum",
    );
    expect(seedReason({ ...base, seed: "0", preview: null })).toBe("seedUnderMinimum");
  });

  it("names a first deposit over the balance", () => {
    expect(seedReason({ ...base, seed: "2500.01", preview: previewSeed(USDC("2500.01")) })).toBe(
      "seedOverBalance",
    );
  });

  it("names an amount that mints no whole share after the fee", () => {
    const seed = "1.002";
    expect(seedReason({ ...base, seed, minimum: "1", preview: previewSeed(USDC(seed)) })).toBe(
      "seedNoShare",
    );
  });

  it("names a balance that has not been read, after the rules it does not need", () => {
    expect(seedReason({ ...base, balance: null })).toBe("balanceUnread");
    expect(
      seedReason({ ...base, balance: null, seed: "50", preview: previewSeed(USDC("50")) }),
    ).toBe("seedUnderMinimum");
  });

  it("leaves the minimum's own fault to the terms card", () => {
    expect(seedReason({ ...base, minimum: "0" })).toBeNull();
    expect(seedReason({ ...base, minimum: "" })).toBeNull();
  });
});

describe("reviewReasons: the first reason in screen order [R9]", () => {
  it("answers null for a review with nothing to fix", () => {
    expect(reviewReasons(input())).toBeNull();
    expect(listReviewReasons(input())).toEqual([]);
  });

  it("walks identity, fees, terms, first deposit, then the Build", () => {
    const review: ReviewDraft = {
      name: "short",
      description: "x".repeat(281),
      imageUrl: "",
      performanceFeeBps: 500,
      managementFeeBps: 900,
      payoutFeeBps: 1500,
      minimum: "0",
      seed: "5000",
    };
    const reasons = listReviewReasons(
      input({
        review,
        uploading: true,
        buildReason: {
          code: "review_zero_share",
          messageKey: "fundBuilder.canvas.review.zeroShare",
        },
      }),
    );
    expect(reasons.map((reason) => reason.code)).toEqual([
      "nameLength",
      "descriptionLength",
      "logoUploading",
      "performanceFee",
      "managementFee",
      "instantFee",
      "minimum",
      "seedOverBalance",
      "build",
    ]);
    expect(reasons.map((reason) => reason.field)).toEqual([
      "name",
      "description",
      "imageUrl",
      "performanceFeeBps",
      "managementFeeBps",
      "payoutFeeBps",
      "minimum",
      "seed",
      "build",
    ]);
    expect(reviewReasons(input({ review, uploading: true }))?.code).toBe("nameLength");
  });

  it("puts the logo upload after the name, and reads it from the blocker too", () => {
    const blocker = {
      code: "LOGO_UPLOADING",
      field: "imageUrl",
      messageKey: "fundLaunch.uploadFailed",
    };
    expect(reviewReasons(input({ launchBlockers: [blocker] }))).toEqual({
      code: "logoUploading",
      field: "imageUrl",
      messageKey: "mandate.logoUploading",
    });
    expect(
      reviewReasons(input({ uploading: true, review: { ...VALID, name: "too short" } }))?.code,
    ).toBe("nameLength");
  });

  it("orders the seed rules: under the minimum, over the balance, no whole share, balance unread", () => {
    const under = { ...VALID, seed: "50" };
    expect(reviewReasons(input({ review: under, balance: null }))?.code).toBe("seedUnderMinimum");
    const over = { ...VALID, seed: "3000" };
    expect(reviewReasons(input({ review: over }))?.code).toBe("seedOverBalance");
    const tiny = { ...VALID, minimum: "1", seed: "1.001" };
    expect(reviewReasons(input({ review: tiny }))?.code).toBe("seedNoShare");
    expect(reviewReasons(input({ balance: null }))?.code).toBe("balanceUnread");
  });

  it("names the characters the API refuses when the hook flags a name of the right length", () => {
    const review = { ...VALID, name: "ETH <and> BTC" };
    expect(reviewReasons(input({ review, errors: [{ field: "name" }] }))?.code).toBe(
      "nameCharacters",
    );
    const described = { ...VALID, description: "a <b>" };
    expect(
      reviewReasons(input({ review: described, errors: [{ field: "description" }] }))?.code,
    ).toBe("descriptionCharacters");
  });

  it("falls back to the hook's flags for a fee, the minimum, the logo and the seed", () => {
    expect(reviewReasons(input({ errors: [{ field: "imageUrl" }] }))?.code).toBe("logoInvalid");
    expect(reviewReasons(input({ errors: [{ field: "payoutFeeBps" }] }))?.code).toBe("instantFee");
    expect(reviewReasons(input({ errors: [{ field: "minimum" }] }))?.code).toBe("minimum");
    expect(reviewReasons(input({ errors: [{ field: "seed" }] }))?.code).toBe("seedNoShare");
  });

  it("uses the Build reason it is given, and the hook's Build gap otherwise", () => {
    expect(
      reviewReasons(
        input({
          buildReason: {
            code: "review_empty_plan",
            messageKey: "fundBuilder.canvas.review.emptyPlan",
          },
        }),
      ),
    ).toEqual({
      code: "build",
      field: "build",
      messageKey: "fundBuilder.canvas.review.emptyPlan",
      detail: "review_empty_plan",
    });
    const gap = { code: "BUILD_EXECUTION_GAP", messageKey: "fundLaunch.buildGap" };
    expect(reviewReasons(input({ launchBlockers: [gap] }))).toEqual({
      code: "build",
      field: "build",
      messageKey: "fundLaunch.buildGap",
      detail: "BUILD_EXECUTION_GAP",
    });
  });

  it("ends with a draft the browser could not read or store", () => {
    const blocker = { code: "STORAGE_UNAVAILABLE", messageKey: "fundLaunch.walletOrJournal" };
    expect(reviewReasons(input({ launchBlockers: [blocker] }))).toEqual({
      code: "draft",
      field: "draft",
      messageKey: "fundLaunch.walletOrJournal",
      detail: "STORAGE_UNAVAILABLE",
    });
  });

  it("gives every form reason a field-specific key that exists, never the generic validation key", () => {
    for (const [code, key] of Object.entries(REVIEW_REASON_KEYS)) {
      expect(key, code).not.toBe("fundLaunch.validation");
      expect(typeof enValue(key), `${code} -> ${key}`).toBe("string");
    }
  });
});
