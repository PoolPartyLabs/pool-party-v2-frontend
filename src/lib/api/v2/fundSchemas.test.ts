import { describe, expect, it } from "vitest";
import { mockFund, mockFundBuild, mockHolder } from "@/mocks/data/v2Funds";
import { fundBuildSchema, fundViewSchema, holderSchema } from "./fundSchemas";

describe("fund view mapping contracts", () => {
  it("R4 follows API PR 181 string fee terms and scalar exit previews", () => {
    const fees = {
      protocolVersion: "v2",
      flowFeeBps: "25",
      payoutFeeBps: "200",
      performanceFeeBps: "2000",
      managementFeeBps: "0",
      standardPayoutTermSeconds: "259200",
    };
    expect(fundViewSchema.parse({ ...mockFund, fees }).fees?.flowFeeBps).toBe(25);
    expect(
      fundBuildSchema.parse({
        ...mockFundBuild({ action: "exit-closed-fund" }),
        preview: { protocolVersion: "v2", usdcPaid: "12345" },
      }).preview?.usdcPaid,
    ).toBe("12345");
  });
  it("R2 parses fund NAV, deployment and position views while normalizing report-age strings", () => {
    const value = fundViewSchema.parse({
      ...mockFund,
      lastReport: { ...mockFund.lastReport, ageSeconds: "120" },
      limitsUsage: [{ protocolVersion: "v2", currentPercent: "40" }],
    });
    expect(value.lastReport?.ageSeconds).toBe(120);
    expect(value.positionsSummary?.positions[0]?.aave?.supplyApy).toBe("4.21");
  });
  it("R3 preserves holder exposure without conflating income and principal", () => {
    const value = holderSchema.parse(mockHolder);
    expect(value.value).toBe("10000000000");
    expect(value.incomeOwed).toBe("325000000");
    expect(value.positionsSummary?.positions[0]?.holderExposure).toHaveProperty("valueUsd", "2500");
  });
  it("R4 treats previews as optional during deployment and null during allowance approval", () => {
    const built = mockFundBuild({ action: "deposit" });
    expect(
      fundBuildSchema.parse({ ...built, preview: null, previewUnavailableReason: "allowance" })
        .preview,
    ).toBeNull();
    const { preview, ...old } = built;
    expect(preview).toBeTruthy();
    expect(fundBuildSchema.parse(old).preview).toBeUndefined();
  });
  it("R8 rejects protocol mixing and malformed signing calldata", () => {
    expect(fundViewSchema.safeParse({ ...mockFund, protocolVersion: "v1" }).success).toBe(false);
    const built = mockFundBuild({ action: "deposit" });
    expect(
      fundBuildSchema.safeParse({
        ...built,
        transactions: [{ ...built.transactions[0], data: "0x1" }],
      }).success,
    ).toBe(false);
  });
  it("R4 rejects malformed optional preview amounts before rendering", () => {
    for (const key of ["sharesBurned", "usdcRequested", "usdcOutstanding", "marketCost"])
      expect(
        fundBuildSchema.safeParse({
          ...mockFundBuild({ action: "deposit" }),
          preview: { protocolVersion: "v2", [key]: "not-an-integer" },
        }).success,
      ).toBe(false);
  });
});
