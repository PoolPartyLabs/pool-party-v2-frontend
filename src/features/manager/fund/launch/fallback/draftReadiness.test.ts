import { describe, expect, it } from "vitest";
import type { MandateCatalog } from "../../mandateCatalog";
import type { MandateDraft } from "../../mandateDraft";
import { draftReadiness } from "./draftReadiness";

const asset = `0x${"12".repeat(20)}`;
const draft = {
  id: "draft",
  networks: ["arbitrum"],
  tokens: [{ address: asset, network: "arbitrum" }],
  pools: [],
  aaveV3Reserves: [asset],
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
          id: "root",
          sharePct: 100,
          steps: [{ id: "supply", family: "position", kind: "aaveSupply", config: null }],
        },
      ],
    },
    spokes: [],
  },
} as unknown as MandateDraft;
const catalog = {
  validateDraft: () => true,
  depositTokenFor: () => ({ address: asset }),
} as unknown as MandateCatalog;
describe("draft index readiness", () => {
  it("previews valid fallback settings without writing the draft", () => {
    expect(draftReadiness(draft, catalog, BigInt(200000000))).toEqual([]);
    const block = draft.plan?.hub.chains[0]?.steps[0];
    expect(block?.family === "position" ? block.config : undefined).toBeNull();
  });
  it("reports missing Review, Build, catalog and balance", () => {
    expect(
      draftReadiness(
        { ...draft, review: undefined, plan: undefined },
        { ...catalog, loading: true },
        null,
      ),
    ).toEqual(["catalog", "balance", "review", "execution"]);
  });
  it("blocks stale catalog, insufficient balance and unreadable Build", () => {
    expect(
      draftReadiness(
        { ...draft, planUnreadable: true },
        { ...catalog, validateDraft: () => false },
        BigInt(1),
      ),
    ).toEqual(["catalog", "review", "execution"]);
  });
});
