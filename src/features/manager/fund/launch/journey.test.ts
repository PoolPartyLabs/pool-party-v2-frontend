import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyDraft } from "../mandateDraft";
import type { FundLaunchDraft } from "./contracts";
import { createJournal, saveJournal } from "./journal";
import * as journeyStore from "./journey";
import {
  explorerAddressUrl,
  explorerTxUrl,
  getLaunchSteps,
  persistJourney,
  readJourney,
} from "./journey";

const manager = `0x${"34".repeat(20)}`;
const base = `0x${"12".repeat(20)}`;
const draft: FundLaunchDraft = {
  ...createEmptyDraft("2026-10-04", "draft"),
  review: {
    name: "Income fund demo",
    description: "",
    imageUrl: "",
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 200,
    minimum: "100",
    seed: "100",
  },
  plan: {
    version: 1,
    hub: {
      chains: [
        {
          id: "hub",
          sharePct: 100,
          steps: [
            {
              id: "aave",
              kind: "aaveSupply",
              family: "position",
              config: { assetKey: `arbitrum:${base}` },
            },
          ],
        },
      ],
    },
    spokes: [],
  },
};
describe("public journey contracts [R3, R4, R6]", () => {
  beforeEach(() => localStorage.clear());
  it("R1 reads the route-encoded journey id from the original persisted key", () => {
    const journey = persistJourney(draft, manager);
    expect(readJourney(encodeURIComponent(journey.journeyId))).toEqual(
      readJourney(journey.journeyId),
    );
  });
  it("R3 rejects malformed encoding without creating or replacing a checkpoint", () => {
    const journey = persistJourney(draft, manager);
    const stored = localStorage.getItem(journeyStore.journeyKey(journey.journeyId));
    expect(() => readJourney("%not-an-escape")).toThrow("INVALID_JOURNAL");
    expect(localStorage.getItem(journeyStore.journeyKey(journey.journeyId))).toBe(stored);
  });
  it("R4 enumerates only the connected wallet's valid persisted journeys", () => {
    persistJourney(draft, manager);
    persistJourney({ ...draft, id: "other" }, base);
    localStorage.setItem("pp:v2:journey:1:corrupt", "{");
    expect(journeyStore).toHaveProperty("listLaunchJourneys");
    expect(journeyStore.listLaunchJourneys(manager).journeys).toHaveLength(1);
  });
  it("R8 projects incomplete and complete persisted status without writes", () => {
    const journey = persistJourney(draft, manager);
    expect(journeyStore).toHaveProperty("getLaunchStatusForDraft");
    expect(journeyStore.getLaunchStatusForDraft(draft.id, manager)).toMatchObject({
      journeyId: journey.journeyId,
      status: "paused",
      outcome: "in-progress",
    });
    const journal = createJournal(draft.id, manager, {}, [
      { id: "create", kind: "create", chain: 42161, dependencies: [] },
    ]);
    journal.checkpoints.create = { stepId: "create", chain: 42161, status: "confirmed" };
    saveJournal(localStorage, journal);
    expect(journeyStore.getLaunchStatusForDraft(draft.id, manager)).toMatchObject({
      status: "complete",
      current: null,
      outcome: "completed",
    });
    expect(journeyStore.getLaunchStatusForDraft(draft.id, base)).toBeNull();
  });
  it("derives signature previews without I/O and never counts server reads", () => {
    expect(getLaunchSteps(draft).find((step) => step.kind === "profile")).toMatchObject({
      signer: "manager-message",
      countsAsSignature: true,
    });
    expect(getLaunchSteps(draft).find((step) => step.kind === "discover")).toMatchObject({
      signer: "server",
      countsAsSignature: false,
    });
  });
  it("freezes one journey and returns it unchanged on repeated launch", () => {
    const journey = persistJourney(draft, manager);
    expect(readJourney(journey.journeyId)?.draft.review).toEqual(draft.review);
    expect(
      persistJourney({ ...draft, review: { ...draft.review, name: "Another fund name" } }, manager),
    ).toEqual(journey);
  });
  it("links exact explorer hashes and addresses and refuses malformed links", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect(explorerTxUrl(42161, hash)).toBe(`https://arbiscan.io/tx/${hash}`);
    expect(explorerTxUrl(4663, hash)).toBe(`https://robinhoodchain.blockscout.com/tx/${hash}`);
    expect(explorerAddressUrl(4663, base)).toBe(
      `https://robinhoodchain.blockscout.com/address/${base}`,
    );
    expect(explorerTxUrl(8453, hash)).toBeNull();
    expect(explorerTxUrl(42161, "bad")).toBeNull();
  });
});
