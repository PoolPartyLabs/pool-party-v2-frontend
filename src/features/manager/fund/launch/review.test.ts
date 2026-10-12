import { describe, expect, it } from "vitest";
import { buildMandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  setDefaultTokenCap,
  setTokenMode,
  tokenKey,
  validateStep,
} from "../mandateDraft";
import {
  hasLaunchTokenAllowance,
  previewSeed,
  rawUsdc,
  validateLogo,
  validateReview,
} from "./review";

const review = {
  name: "  Aave income fund  ",
  description: "",
  imageUrl: "",
  performanceFeeBps: 2000,
  managementFeeBps: 0,
  payoutFeeBps: 200,
  minimum: "100",
  seed: "100",
};

describe("fund Review [R1, R2]", () => {
  it.each([
    [undefined, false],
    [{ pct: 0, noCap: false }, false],
    [{ pct: 5, noCap: false }, true],
    [{ noCap: true, pct: 100 }, true],
  ] as const)("matches the Limits amendment for cap %j", (cap, allowed) => {
    const token = {
      network: "arbitrum" as const,
      address: `0x${"12".repeat(20)}`,
      symbol: "WETH",
      name: "Wrapped Ether",
      logoUrl: null,
      locked: false,
    };
    const draft = {
      ...createEmptyDraft("2026-10-04", "limits"),
      tokens: [token],
      caps: { networks: {}, protocols: {}, tokens: cap ? { [tokenKey(token)]: cap } : {} },
    };
    expect(hasLaunchTokenAllowance(draft)).toBe(allowed);
    expect(validateStep(draft, "limits", buildMandateCatalog()) === null).toBe(allowed);
    expect(hasLaunchTokenAllowance({ ...draft, tokens: [{ ...token, locked: true }] })).toBe(false);
  });
  it("gives All mode its allowance from the default cap, so USDC alone can launch", () => {
    // @rule R10
    const catalog = buildMandateCatalog();
    const usdcOnly = setTokenMode(createEmptyDraft("2026-10-04", "all-mode"), "all");
    expect(usdcOnly.tokens.every((token) => token.locked)).toBe(true);
    const capped = setDefaultTokenCap(usdcOnly, { noCap: false, pct: 15 });
    expect(hasLaunchTokenAllowance(capped)).toBe(true);
    expect(validateStep(capped, "limits", catalog)).toBeNull();
    expect(hasLaunchTokenAllowance(setDefaultTokenCap(usdcOnly, { noCap: true, pct: 0 }))).toBe(
      true,
    );
    // An enabled 0% default cap, or no default cap at all, allows no token.
    expect(hasLaunchTokenAllowance(setDefaultTokenCap(usdcOnly, { noCap: false, pct: 0 }))).toBe(
      false,
    );
    expect(hasLaunchTokenAllowance(usdcOnly)).toBe(false);
    // Real data mode has no All mode, so the per-token caps decide.
    expect(hasLaunchTokenAllowance({ ...capped, dataMode: "real" })).toBe(false);
  });
  it("trims identity and validates the manager's first deposit", () => {
    expect(validateReview(review, BigInt("100000000")).name).toBe("Aave income fund");
  });
  it.each([
    { name: "short" },
    { name: "x".repeat(51) },
    { description: "x".repeat(281) },
    { description: "<script>" },
    { imageUrl: "blob:test" },
    { performanceFeeBps: 999 },
    { performanceFeeBps: 9001 },
    { managementFeeBps: 501 },
    { payoutFeeBps: 1001 },
    { seed: "99" },
    { minimum: "0" },
    { minimum: "0.1", seed: "0.1" },
    { seed: "Infinity" },
    { seed: "100.0000001" },
  ])("refuses invalid review %j", (patch) => {
    expect(() => validateReview({ ...review, ...patch }, BigInt("100000000"))).toThrow();
  });
  it("refuses a budget exceeding balance", () => {
    expect(() => validateReview(review, BigInt("99999999"))).toThrow();
  });
  it("rounds whole shares after the flow fee without using gross as allocation denominator", () => {
    expect(previewSeed(rawUsdc("100"))).toEqual({
      fee: BigInt("250000"),
      shares: BigInt("99"),
      principal: BigInt("99000000"),
      charged: BigInt("99250000"),
      remainder: BigInt("750000"),
    });
  });
  it("preserves exact large and six-decimal input", () => {
    expect(rawUsdc("9007199254740993.123456")).toBe(BigInt("9007199254740993123456"));
  });
  it("accepts only nonempty PNG/JPG within 10 MiB", () => {
    expect(() => validateLogo({ type: "image/jpeg", size: 10 * 1024 * 1024 })).not.toThrow();
    expect(() => validateLogo({ type: "image/svg+xml", size: 1 })).toThrow();
    expect(() => validateLogo({ type: "image/png", size: 10 * 1024 * 1024 + 1 })).toThrow();
  });
});
