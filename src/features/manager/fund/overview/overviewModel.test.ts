import { describe, expect, it, vi } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import type { LaunchJourney } from "../launch/contracts";
import type { MandateDraft } from "../mandateDraft";
import { overviewModel, overviewStrategyRow, type SetupSnapshot } from "./overviewModel";

vi.mock("../launch/journey", () => ({
  launchStatus: (j: { completed?: boolean }) => ({
    outcome: j.completed ? "completed" : "in-progress",
  }),
}));
const draft = { id: "d1", name: "Same" } as MandateDraft;
const journey = {
  journeyId: "wallet:d1",
  draftId: "d1",
  manager: "wallet",
  draft: { id: "d1" },
  journal: { addresses: { coreVault: mockFund.coreVault } },
} as unknown as LaunchJourney;
const setup: SetupSnapshot = {
  drafts: [draft],
  journeys: [journey],
  draftStatus: "available",
  journeyStatus: "available",
};
describe("Overview source authority POO-2245", () => {
  // @rule R2
  it("deduplicates matching launch and excludes its discovered core from table", () => {
    const m = overviewModel([mockFund], setup, "wallet");
    expect(m.setup.map((i) => i.kind)).toEqual(["launch"]);
    expect(m.rows).toEqual([]);
  });
  // @rule R2
  it("does not join another wallet or a same-name draft", () => {
    const m = overviewModel([], { ...setup, drafts: [draft, { ...draft, id: "d2" }] }, "other");
    expect(m.setup).toHaveLength(2);
  });
  // @rule R4
  it("never claims first use from discovery without authoritative history coverage", () => {
    expect(overviewModel([], { ...setup, drafts: [], journeys: [] }, "wallet").firstUse).toBe(
      false,
    );
  });
  // @rule R5
  it("reports corrupt local storage while retaining valid work", () => {
    const m = overviewModel(null, { ...setup, draftStatus: "corrupt" }, "wallet");
    expect(m.localUnavailable).toBe(true);
    expect(m.setup).toHaveLength(1);
  });
  // @rule R3
  it("keeps Closing and Closed identities without inferring ready counts", () => {
    const m = overviewModel(
      [{ ...mockFund, state: "Closed" }],
      { ...setup, drafts: [], journeys: [] },
      "wallet",
    );
    expect(m.rows[0]?.state).toBe("Closed");
  });
});
describe("Overview strategy row POO-2335", () => {
  // @rule R9
  it("gives the Figma row parts: avatar initials, a status pill tone and network names from config", () => {
    const row = overviewStrategyRow({
      ...mockFund,
      profile: { ...mockFund.profile, name: "Balanced Income", imageUrl: undefined, image: null },
      chains: [...mockFund.chains, { ...mockFund.chains[0], chainId: "999999" }],
    } as typeof mockFund);
    expect(row).toMatchObject({ name: "Balanced Income", initials: "BI", logoUrl: null });
    expect(row.status).toEqual({ key: "stateOpen", tone: "success" });
    expect(row.networks.map((n) => n.name)).toEqual(["Arbitrum", "Robinhood Chain", "999999"]);
    expect(row.networks.map((n) => n.slug)).toEqual(["arbitrum", "robinhood", null]);
    expect(overviewStrategyRow({ ...mockFund, state: "Closing" }).status).toEqual({
      key: "stateClosing",
      tone: "warning",
    });
    expect(overviewStrategyRow({ ...mockFund, state: "Closed" }).status.tone).toBe("muted");
    expect(
      overviewStrategyRow({ ...mockFund, state: "Unknown" } as unknown as typeof mockFund).status,
    ).toEqual({
      key: "notAvailable",
      tone: "muted",
    });
  });
});
