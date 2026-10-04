import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../mandateDraft";
import type { FundLaunchDraft } from "./contracts";
import { createJournal, loadJournal, saveJournal } from "./journal";
import { readJourney } from "./journey";
import { deriveLaunchSteps } from "./plan";
import { startFundLaunch } from "./startFundLaunch";

const mocks = vi.hoisted(() => ({
  balance: vi.fn(),
  catalog: vi.fn(),
  navigate: vi.fn(),
  session: vi.fn(),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({ readContract: mocks.balance }),
}));
vi.mock("@/features/auth/siweActions", () => ({ getSessionAction: mocks.session }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => true }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogTokensAction: mocks.catalog,
  getCatalogReservesAction: mocks.catalog,
}));
vi.mock("../v2Mandate", () => ({
  buildRealCatalog: vi.fn(),
  toV2MandateSelection: () => ({ chains: [], aaveV3Reserves: [], spokeCapPercent: null }),
}));
vi.mock("./lock", () => ({
  withLaunchLock: async (_key: string, work: () => Promise<unknown>) => work(),
}));
const manager = `0x${"34".repeat(20)}`;
const draft: FundLaunchDraft = {
  ...createEmptyDraft("2026-10-04", "entry"),
  networks: ["arbitrum"],
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
          id: "leaf",
          sharePct: 100,
          steps: [
            {
              id: "aave",
              family: "position",
              kind: "aaveSupply",
              config: { assetKey: `arbitrum:${manager}` },
            },
          ],
        },
      ],
    },
    spokes: [],
  },
};
describe("Review launch entry point [R3, R4, V5]", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal("window", { location: { assign: mocks.navigate } });
    mocks.session.mockResolvedValue(manager);
    mocks.balance.mockResolvedValue(BigInt(200000000));
    mocks.catalog.mockResolvedValue({ ok: true, data: { tokens: [], reserves: [] } });
  });
  it("freezes validated Review and navigates without signing or building a transaction", async () => {
    const result = await startFundLaunch(draft);
    expect(readJourney(result.journeyId)?.draft.review).toEqual(draft.review);
    expect(loadJournal(localStorage, draft.id, manager)?.frozen).toMatchObject({
      request: { seedAmount: "100000000", payoutFeeBps: 200 },
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.stringContaining(`/manager/fund-launch/${encodeURIComponent(result.journeyId)}`),
    );
  });
  it("resumes an existing checkpoint without rereading balance/catalog or rebuilding create", async () => {
    const journal = createJournal(
      draft.id,
      manager,
      { plan: draft.plan, review: draft.review, request: { manager } },
      deriveLaunchSteps(draft.plan, {}, true, false),
    );
    const hash = `0x${"ab".repeat(32)}`;
    journal.checkpoints.create = {
      stepId: "create",
      chain: 42161,
      status: "waiting",
      txHash: hash,
      receiptStatus: "unknown",
    };
    saveJournal(localStorage, journal);
    await startFundLaunch(draft);
    expect(loadJournal(localStorage, draft.id, manager)?.checkpoints.create?.txHash).toBe(hash);
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it("rejects insufficient first deposit before persisting or navigating", async () => {
    mocks.balance.mockResolvedValue(BigInt(1));
    await expect(startFundLaunch(draft)).rejects.toThrow("INVALID_DEPOSIT");
    expect(loadJournal(localStorage, draft.id, manager)).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
