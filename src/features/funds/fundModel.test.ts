import { describe, expect, it } from "vitest";
import { estimateDeposit, fundErrorKey, rawAmount, reportFreshness } from "./fundModel";

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
