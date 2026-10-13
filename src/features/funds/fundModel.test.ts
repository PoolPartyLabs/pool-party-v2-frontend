import { describe, expect, it } from "vitest";
import { fundViewSchema } from "@/lib/api/v2/fundSchemas";
import { mockFund } from "@/mocks/data/v2Funds";
import fund6 from "./fixtures/fund6Detail.json";
import {
  estimateDeposit,
  fundChainNetwork,
  fundErrorKey,
  fundNetworkRows,
  hasSolanaSpoke,
  rawAmount,
  reportFreshness,
  v6ReportGate,
} from "./fundModel";

describe("fund model rules v2", () => {
  it("R4 estimates one whole share and refunds unused budget after the fixed fee", () => {
    expect(estimateDeposit("2000000", "1000000000000000000000000")).toEqual({
      sharesMinted: "1000000000000000000",
      flowFee: "5000",
      usdcCharged: "1005000",
      refundToCaller: "995000",
    });
  });
  it("R4 uses chain fee parameters without floating point loss", () => {
    expect(estimateDeposit("9007199254740993000000", "1000000000000000000000000", 30).flowFee).toBe(
      "27021597764222979000",
    );
  });
  it("R5 accepts six decimal places and rejects zero, negatives and excess precision", () => {
    expect(rawAmount("1.000001")).toBe("1000001");
    for (const amount of ["0", "-1", "1.0000001", "NaN", "1e3"])
      expect(() => rawAmount(amount)).toThrow();
  });
  it("R6 requires an accepted report within its own mandate lifetime", () => {
    expect(reportFreshness(50, 60, 9)).toBe(true);
    expect(reportFreshness(50, 60, 11)).toBe(false);
    expect(reportFreshness(null, 60)).toBe(false);
    expect(reportFreshness(0, 0)).toBe(false);
  });
  it("R7 maps contract, limit, deferred and dormant errors without raw messages", () => {
    expect(fundErrorKey("PayoutBelowOneShare")).toBe("payoutWholeShares");
    expect(fundErrorKey("BelowMinFirstDeposit")).toBe("minimum");
    expect(fundErrorKey("FUND_LIMIT_EXCEEDED")).toBe("limit");
    expect(fundErrorKey("V2_DEFERRED")).toBe("deferred");
    expect(fundErrorKey("StaleSpokeReport")).toBe("refreshing");
    expect(fundErrorKey("V2_UNAVAILABLE")).toBe("unavailable");
    expect(fundErrorKey("TX_CONFIRMATION_UNKNOWN")).toBe("confirmationTimeout");
  });
});

describe("POO-2262 v6 networks and report gate", () => {
  const fund = fundViewSchema.parse(fund6.data);
  it("names the Fund's networks, Solana as chain 1, and EVM chains from chain config", () => {
    expect(fundChainNetwork("1")).toEqual({ slug: "solana", name: "Solana" });
    expect(fundChainNetwork(42161)).toEqual({ slug: "arbitrum", name: "Arbitrum" });
    expect(fundChainNetwork("4663")).toEqual({ slug: "robinhood", name: "Robinhood Chain" });
  });
  it("lists Hub, Robinhood and Solana with each spoke's report and the Solana accounts", () => {
    expect(fundNetworkRows(fund)).toEqual([
      {
        chainId: "42161",
        slug: "arbitrum",
        name: "Arbitrum",
        hub: true,
        status: "created",
        report: null,
        solana: null,
      },
      {
        chainId: "4663",
        slug: "robinhood",
        name: "Robinhood Chain",
        hub: false,
        status: "created",
        report: { usable: false, hasReport: true, ageMinutes: 25 },
        solana: null,
      },
      {
        chainId: "1",
        slug: "solana",
        name: "Solana",
        hub: false,
        status: "created",
        report: { usable: true, hasReport: true, ageMinutes: 2 },
        solana: {
          program: "7PptZ653uyn5eoAFKqs4DXR1ijxH6sf49f2YAGMLTfCx",
          fund: "4fhgX4FhW8Gvq5cnt7QJq9d4uTDhQdYc8ZMRULWkRWnu",
          vault: "AXnN1ihCoy6bCwqcii6eDLT74abAwzDrn1AmgN57wNK6",
          usdcAta: "HEkWhruKWari9tepXfcKCTpS2YYfbYCWfoJtKmzqRw8b",
        },
      },
    ]);
  });
  it("gates a v6 Fund on reportsUsable and keeps EVM-only Funds on the single-report gate", () => {
    expect(hasSolanaSpoke(fund)).toBe(true);
    expect(v6ReportGate(fund)).toEqual({ usable: false, solanaUsable: true });
    expect(v6ReportGate({ ...fund, spokes: undefined })).toEqual({
      usable: false,
      solanaUsable: null,
    });
    expect(v6ReportGate({ ...fund, reportsUsable: undefined })).toBeNull();
    // An EVM-only Fund on an API that already serves reportsUsable keeps today's gate.
    expect(hasSolanaSpoke(mockFund)).toBe(false);
    expect(v6ReportGate({ ...mockFund, reportsUsable: false })).toBeNull();
  });
  it("maps the builders' report waits to the refreshing message", () => {
    expect(fundErrorKey("SOLANA_REPORT_REFRESHING")).toBe("refreshing");
    expect(fundErrorKey("SPOKE_REPORT_STALE")).toBe("refreshing");
  });
});
