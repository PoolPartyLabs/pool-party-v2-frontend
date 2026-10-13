import { describe, expect, it } from "vitest";
import fund6 from "@/features/funds/fixtures/fund6Detail.json";
import { mockFund, mockFundBuild, mockHolder } from "@/mocks/data/v2Funds";
import { fundBuildSchema, fundListSchema, fundViewSchema, holderSchema } from "./fundSchemas";
import { chainIdSchema, isEvmDeployment, SOLANA_FUND_CHAIN_ID } from "./schemas";

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

// POO-2262: the live v6 demo Fund (Hub Arbitrum + Robinhood + Solana) as `GET /funds/:core` served it.

/** An EVM-only Fund in today's wire shape: the v6 fixture without its Solana entries. */
function evmOnlyDetail() {
  const data = structuredClone(fund6.data);
  const evm = <T extends { chainId: string }>(entries: T[]) =>
    entries.filter((entry) => entry.chainId !== SOLANA_FUND_CHAIN_ID);
  data.chains = evm(data.chains);
  data.mandate = {
    ...data.mandate,
    tokens: evm(data.mandate.tokens),
    adapters: evm(data.mandate.adapters),
    swapAdapters: evm(data.mandate.swapAdapters),
    pools: evm(data.mandate.pools),
    spokes: evm(data.mandate.spokes),
    bridgeAdapters: data.mandate.bridgeAdapters.filter(
      (entry) => entry.spokeChainId !== SOLANA_FUND_CHAIN_ID,
    ),
  };
  // Today's EVM-only wire shape has neither the per-spoke list nor the v6 gate.
  const { reportsUsable: _gate, spokes: _spokes, ...today } = data;
  return today;
}

describe("POO-2262 v6 fund reads", () => {
  it("parses the live three-chain Fund with its Solana entries, spokes and report gate", () => {
    const fund = fundViewSchema.parse(fund6.data);
    expect(fund.chains.map((chain) => chain.chainId)).toEqual(["42161", "4663", "1"]);
    const solana = fund.chains.find((chain) => chain.chainId === SOLANA_FUND_CHAIN_ID);
    expect(solana && !isEvmDeployment(solana) ? solana.solana : null).toEqual({
      protocolVersion: "v2",
      program: "7PptZ653uyn5eoAFKqs4DXR1ijxH6sf49f2YAGMLTfCx",
      fund: "4fhgX4FhW8Gvq5cnt7QJq9d4uTDhQdYc8ZMRULWkRWnu",
      vault: "AXnN1ihCoy6bCwqcii6eDLT74abAwzDrn1AmgN57wNK6",
      usdcAta: "HEkWhruKWari9tepXfcKCTpS2YYfbYCWfoJtKmzqRw8b",
    });
    expect(fund.spokes?.map((spoke) => [spoke.chainId, spoke.reportFreshness])).toEqual([
      [
        "4663",
        {
          protocolVersion: "v2",
          receiverIndex: 0,
          hasReport: true,
          ageSeconds: 1533,
          maxReportAge: 1600,
          marginSeconds: 120,
          usable: false,
        },
      ],
      [
        "1",
        {
          protocolVersion: "v2",
          receiverIndex: 1,
          hasReport: true,
          ageSeconds: 125,
          maxReportAge: 1600,
          marginSeconds: 120,
          usable: true,
        },
      ],
    ]);
    expect(fund.reportsUsable).toBe(false);
    expect(fund.factory).toBe("0xe964f36Eb23E95e20049D97122f375FbFe6B40dE");
    expect(fund.mandate.spokes.map((spoke) => spoke.chainId)).toEqual(["4663", "1"]);
    expect(fund.mandate.bridgeAdapters.filter((entry) => entry.spokeChainId === "1")).toHaveLength(
      2,
    );
    expect(
      fundListSchema.parse({
        protocolVersion: "v2",
        funds: [fund6.data],
        discovery: "factory",
      }).funds[0]?.chains,
    ).toHaveLength(3);
  });
  it("keeps route parameters EVM-only and refuses a Solana entry with EVM or malformed accounts", () => {
    expect(chainIdSchema.safeParse(1).success).toBe(false);
    const chains = structuredClone(fund6.data.chains);
    const entry = chains[2] as { solana: { vault: string } };
    entry.solana.vault = "0x1E45E497a734b3BcD67e514F0681F161EC78a718";
    expect(fundViewSchema.safeParse({ ...fund6.data, chains }).success).toBe(false);
  });
  it("parses an EVM-only Fund exactly as before: no Solana entry, no gate, adapters kept", () => {
    const fund = fundViewSchema.parse(evmOnlyDetail());
    expect(fund.chains.map((chain) => chain.chainId)).toEqual(["42161", "4663"]);
    expect(fund.chains.every(isEvmDeployment)).toBe(true);
    expect(fund.chains[1]).toMatchObject({
      spokeVault: "0x3962BE64873eEcA667B2934A1d6406Bf75A529ee",
      uniswapV4Adapter: "0x505cE7B842bC2C6752cd3e66Dd8e3fc5672C1B4A",
    });
    expect("spokes" in fund).toBe(false);
    expect("reportsUsable" in fund).toBe(false);
    expect(fundViewSchema.parse(mockFund)).toEqual(mockFund);
  });
  it("drops an unreadable spokes list instead of failing the whole Fund", () => {
    const fund = fundViewSchema.parse({ ...fund6.data, spokes: [{ chainId: "1" }] });
    expect(fund.spokes).toBeUndefined();
    expect(fund.chains).toHaveLength(3);
  });
  it("keeps the padded gas of a deposit build", () => {
    const built = mockFundBuild({ action: "deposit" });
    const transaction = { ...built.transactions[0], gas: "1057965" };
    expect(
      fundBuildSchema.parse({ ...built, transactions: [transaction] }).transactions[0]?.gas,
    ).toBe("1057965");
    expect(
      fundBuildSchema.safeParse({ ...built, transactions: [{ ...transaction, gas: "0x1" }] })
        .success,
    ).toBe(false);
  });
});
