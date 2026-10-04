import { describe, expect, it } from "vitest";
import { mockFund, mockHolder } from "@/mocks/data/v2Funds";
import { detailedCoverage, fundResumeAmount, hasFundInterest } from "./fundDetailsModel";

describe("V2 details projection", () => {
  it("R5 restores only a raw6 amount for the same authenticated account", () => {
    const wallet = `0x${"4".repeat(40)}`;
    const personal = { status: "ready" as const, holder: mockHolder, wallet };
    expect(
      fundResumeAmount(new URLSearchParams({ invest: "10.123456", account: wallet }), personal),
    ).toBe(10.123456);
    expect(
      fundResumeAmount(new URLSearchParams({ invest: "10.1234567", account: wallet }), personal),
    ).toBeNull();
    expect(
      fundResumeAmount(
        new URLSearchParams({ invest: "100", account: `0x${"5".repeat(40)}` }),
        personal,
      ),
    ).toBeNull();
    expect(fundResumeAmount(new URLSearchParams({ invest: "100" }), personal)).toBeNull();
    expect(
      fundResumeAmount(new URLSearchParams({ invest: "100", account: wallet }), {
        status: "disconnected",
      }),
    ).toBeNull();
  });
  it("R2 retains pending income without shares", () =>
    expect(
      hasFundInterest({
        ...mockHolder,
        shares: "0",
        incomeOwed: "0",
        payout: { ...mockHolder.payout, open: false },
        incomeWithdrawal: ["1", false],
      }),
    ).toBe(true));
  it("R3 keeps incomplete composition coverage", () =>
    expect(
      detailedCoverage({
        ...mockFund,
        positionsSummary: {
          protocolVersion: "v2",
          positions: (mockFund.positionsSummary?.positions ?? []).map((p, i) => ({
            ...p,
            shareOfNav: i === 0 ? "25" : "40",
          })),
        },
      }),
    ).toBe(65));
});
