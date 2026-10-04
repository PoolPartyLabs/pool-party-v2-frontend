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

// @rule R3 (POO-2223)
describe("composition coverage validation", () => {
  const fixturePosition = (index: number) => {
    const position = mockFund.positionsSummary?.positions[index];
    if (!position) throw new Error(`Missing position fixture ${index}`);
    return position;
  };
  const withShares = (shares: Array<string | null>) => ({
    ...mockFund,
    positionsSummary: {
      protocolVersion: "v2" as const,
      positions: shares.map((shareOfNav, i) => ({
        ...fixturePosition(i % 2),
        positionKey: `0x${String(i + 1).repeat(64)}`,
        shareOfNav,
      })),
    },
  });
  it.each([
    ["120", "-55"],
    ["70", "40"],
    [null, "40"],
    ["NaN", "40"],
    ["33.333333333333333333333", "66.666666666666666666668"],
  ])("rejects unverified shares %j", (...shares) => {
    expect(detailedCoverage(withShares(shares))).toBeNull();
  });
  it("rejects duplicate chain-position identities", () => {
    const position = fixturePosition(0);
    expect(
      detailedCoverage({
        ...mockFund,
        positionsSummary: { protocolVersion: "v2", positions: [position, position] },
      }),
    ).toBeNull();
  });
  it("keeps true zero and exact complete coverage", () => {
    expect(detailedCoverage(withShares(["0", "0"]))).toBe(0);
    expect(detailedCoverage(withShares(["33.3", "66.7"]))).toBe(100);
    expect(detailedCoverage({ ...mockFund, positionsSummary: undefined })).toBeNull();
  });
});
