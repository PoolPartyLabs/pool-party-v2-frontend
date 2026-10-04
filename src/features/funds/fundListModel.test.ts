import { describe, expect, it } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import { fundListModel } from "./fundListModel";

describe("v2 card projection POO-2181", () => {
  it("R2 preserves zero money and missing metrics independently", () => {
    expect(fundListModel({ ...mockFund, sharePrice: "0", shareAssets: "0" })).toMatchObject({
      sharePrice: "$0",
      shareAssets: "$0",
    });
    expect(
      fundListModel({
        ...mockFund,
        sharePrice: undefined,
        shareAssets: undefined,
        positionsSummary: undefined,
      }),
    ).toMatchObject({ sharePrice: null, shareAssets: null, positions: null });
  });
  it("R2 maps the profile, chain and protocol fields without V1 identifiers", () => {
    const model = fundListModel({
      ...mockFund,
      profile: {
        protocolVersion: "v2",
        name: "",
        imageUrl: "https://example.com/logo.png",
        managerDisplayName: "Manager",
      },
    });
    expect(model).toMatchObject({
      protocolVersion: "v2",
      name: `PP-${mockFund.creationNumber}`,
      image: "https://example.com/logo.png",
      managerName: "Manager",
      manager: mockFund.manager,
    });
    expect(model.chains).toEqual(["Arbitrum", "Robinhood Chain"]);
    expect(model.protocols.length).toBeGreaterThan(0);
    expect(model).not.toHaveProperty("strategyId");
  });
});
