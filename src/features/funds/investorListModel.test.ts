import { describe, expect, it } from "vitest";
import { mockFund, mockHolder, mockWallet } from "@/mocks/data/v2Funds";
import { investorHref, projectInvestorFund, projectInvestorHolding } from "./investorListModel";

describe("investor list projection", () => {
  // @rule R2
  it("routes V2 with portfolio and closed origins, and keeps V1 paths", () => {
    expect(investorHref({ id: "pool", protocolVersion: "v1" })).toBe("/strategies/pool");
    expect(investorHref(projectInvestorFund(mockFund), "portfolio", true)).toBe(
      `/funds/${mockFund.coreVault}?withdraw=1&from=portfolio`,
    );
  });
  // @rule R3
  it("keeps missing metrics absent instead of using holder value as cost or income as yield", () => {
    const strategy = projectInvestorFund(mockFund);
    const position = projectInvestorHolding(mockFund, mockHolder, mockWallet);
    expect(strategy.riskLevel).toBeNull();
    expect(strategy.estReturn).toBeNull();
    expect(position.invested).toBeNull();
    expect(position.totalYield).toBeNull();
    expect(position.currentValue).toBe(10000);
  });
  // @rule R3 R5
  it("marks unknown lifecycle unavailable and keeps fund TVL distinct from pool TVL", () => {
    const { state, ...partial } = mockFund;
    expect(projectInvestorHolding(partial, mockHolder, mockWallet).status).toBe("unavailable");
    expect(projectInvestorFund(mockFund).tvlUsd).toBe(1000000);
    expect(projectInvestorFund(mockFund)).not.toHaveProperty("uniswapPoolTvlUsd");
  });
});
