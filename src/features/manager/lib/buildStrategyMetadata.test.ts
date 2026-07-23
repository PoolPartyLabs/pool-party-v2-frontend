/**
 * @id PP-MGR-LIB-008 (POO-308 · POO-579)
 * @name buildStrategyMetadata tests
 * @implements-rules-version v1
 *
 * The pure Review-step -> v2 metadata-POST body mapping, shaped to the deployed pp-api DTO (POO-579):
 * performance -> top-level `managerFee` in BASIS POINTS (never a nested `fees` object); `riskLevel` is
 * the `RiskProfile` enum; `logoUrl` is sent ONLY when it is a real https URL (a `data:` preview is
 * omitted so it can't 400 the create). category is carried through; name/description are trimmed; an
 * empty description collapses to null.
 */
import { describe, expect, it } from "vitest";
import { buildStrategyMetadata, type StrategyMetadataParams } from "./buildStrategyMetadata";

const base: StrategyMetadataParams = {
  name: "Blue Chip ETH",
  description: "Concentrated ETH/USDC around spot.",
  logoUrl: "https://cdn/logo.png",
  category: "blueChip",
  objective: ["income"],
  riskProfile: "dynamic",
  performancePct: 20,
  access: "public",
};

describe("buildStrategyMetadata", () => {
  it("sends managerFee top-level in basis points and never a nested fees object", () => {
    // @rule R1 @rule R7 — POO-579: the DTO reads a top-level `managerFee` @IsInt basis points.
    expect(buildStrategyMetadata(base)).toEqual({
      name: "Blue Chip ETH",
      description: "Concentrated ETH/USDC around spot.",
      logoUrl: "https://cdn/logo.png",
      category: "blueChip",
      objectiveTags: ["income"],
      riskLevel: "dynamic",
      managerFee: 2000,
      access: "public",
    });
    expect(buildStrategyMetadata(base)).not.toHaveProperty("fees");
  });

  it("carries the derived OBJECTIVE tags through to objectiveTags (POO-830 R7)", () => {
    // @rule R7 — the objective is derived at creation and persisted (backend strips it until supported).
    expect(buildStrategyMetadata(base).objectiveTags).toEqual(["income"]);
    expect(
      buildStrategyMetadata({ ...base, objective: ["gradualBuy", "gradualSell"] }).objectiveTags,
    ).toEqual(["gradualBuy", "gradualSell"]);
  });

  it("converts the performance percent to an integer basis-point managerFee", () => {
    // @rule R7 — 12.5% -> 1250 bps, rounded to an integer (the DTO is @IsInt).
    const result = buildStrategyMetadata({ ...base, performancePct: 12.5 });
    expect(result.managerFee).toBe(1250);
    expect(Number.isInteger(result.managerFee)).toBe(true);
  });

  it("carries the RiskProfile enum as riskLevel, never a 1-5 band", () => {
    // @rule R7 — POO-579: the DTO validates @IsIn(['steady','dynamic','wild']).
    expect(buildStrategyMetadata({ ...base, riskProfile: "steady" }).riskLevel).toBe("steady");
    expect(buildStrategyMetadata({ ...base, riskProfile: "wild" }).riskLevel).toBe("wild");
  });

  it("keeps an https logoUrl", () => {
    // @rule R7
    const result = buildStrategyMetadata({ ...base, logoUrl: "https://cdn/logo.png" });
    expect(result.logoUrl).toBe("https://cdn/logo.png");
    expect(result.category).toBe("blueChip");
  });

  it("omits a data: logoUrl so a local crop preview never 400s the create", () => {
    // @rule R7 — POO-579: the DTO validates https-only @IsUrl; a data: preview must not be sent.
    const result = buildStrategyMetadata({ ...base, logoUrl: "data:image/png;base64,AAA" });
    expect(result).not.toHaveProperty("logoUrl");
  });

  it("omits a null logoUrl (key absent)", () => {
    expect(buildStrategyMetadata({ ...base, logoUrl: null })).not.toHaveProperty("logoUrl");
  });

  it("trims the name and description", () => {
    const result = buildStrategyMetadata({ ...base, name: "  Blue Chip  ", description: "  hi  " });
    expect(result.name).toBe("Blue Chip");
    expect(result.description).toBe("hi");
  });

  it("collapses an empty / whitespace description to null", () => {
    expect(buildStrategyMetadata({ ...base, description: "   " }).description).toBeNull();
  });

  it("keeps the provided access model (public in V1)", () => {
    expect(buildStrategyMetadata(base).access).toBe("public");
  });
});
