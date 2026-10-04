import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft, tokenKey } from "../mandateDraft";
import { MANDATE_DRAFTS_KEY, upsertDraft } from "../mandateDraftStore";
import type { FundLaunchDraft } from "./contracts";
import { createJournal, journalKey, saveJournal } from "./journal";
import { journeyKey, persistJourney } from "./journey";
import { type CanvasPlan, deriveLaunchSteps } from "./plan";
import { useV2Launch } from "./useV2Launch";

const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  catalog: vi.fn(),
  manager: `0x${"34".repeat(20)}`,
}));
vi.mock("./useV2LaunchBinding", () => ({ useV2LaunchBinding: mocks.binding }));
vi.mock("./useV2LaunchWallet", () => ({
  useV2LaunchWallet: () => ({ manager: mocks.manager, wallet: {} }),
}));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogTokensAction: mocks.catalog,
  getCatalogReservesAction: mocks.catalog,
}));
vi.mock("../v2Mandate", () => ({
  buildRealCatalog: vi.fn(),
  toV2MandateSelection: () => ({
    chains: [{ chainId: 42161, tokens: [`0x${"34".repeat(20)}`], uniswapV4PoolIds: [] }],
    aaveV3Reserves: [],
    spokeCapPercent: null,
  }),
}));
const manager = `0x${"34".repeat(20)}`;
const permitted = {
  network: "arbitrum" as const,
  address: manager,
  symbol: "WETH",
  name: "Wrapped Ether",
  logoUrl: null,
  locked: false,
};
const draft: FundLaunchDraft = {
  ...createEmptyDraft("2026-10-04", "hook"),
  tokens: [permitted],
  caps: {
    networks: {},
    protocols: {},
    tokens: { [tokenKey(permitted)]: { noCap: true, pct: 100 } },
  },
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
const orphanFrozen = () => ({
  plan: draft.plan,
  review: draft.review,
  request: {
    manager,
    chains: [{ chainId: 42161, tokens: [manager], uniswapV4PoolIds: [] }],
    aaveV3Reserves: [],
    spokeCapPercent: null,
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 200,
    minFirstDeposit: "100000000",
    seedAmount: "100000000",
  },
});
function storeOrphan(plan: CanvasPlan = draft.plan) {
  upsertDraft({ ...draft, tokens: [], plan: undefined, review: { ...draft.review, seed: "0" } });
  const journal = createJournal(
    draft.id,
    manager,
    { ...orphanFrozen(), plan },
    deriveLaunchSteps(plan, {}, true, false),
  );
  journal.checkpoints.create = {
    stepId: "create",
    chain: 42161,
    status: "submitted",
    txHash: `0x${"ab".repeat(32)}`,
    receiptStatus: "unknown",
  };
  journal.addresses.coreVault = manager;
  saveJournal(localStorage, journal);
  return journal;
}
describe("public launch hook seam [R3, R4, R6]", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.clearAllMocks();
    mocks.manager = manager;
    mocks.catalog.mockResolvedValue({ ok: true, data: { tokens: [], reserves: [] } });
    mocks.binding.mockReturnValue({
      steps: [{ id: "create", kind: "create", chain: 42161 }],
      checkpoints: {
        create: { status: "submitted", txHash: `0x${"ab".repeat(32)}`, receiptStatus: "unknown" },
      },
      sign: vi.fn(),
      retry: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
      status: "running",
    });
  });
  it("recovers an accepted collectFees flow without auto and preserves frozen bytes", async () => {
    const plan: CanvasPlan = structuredClone(draft.plan);
    const chain = plan.hub.chains[0];
    if (!chain) throw new Error("fixture");
    chain.steps.push({ id: "fees", family: "flow", kind: "collectFees", config: {} });
    const journal = storeOrphan(plan);
    const rawJournal = localStorage.getItem(journalKey(draft.id, manager));
    const frozenBytes = JSON.stringify(journal.frozen);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useV2Launch(encodeURIComponent(`${manager}:${draft.id}`)));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.journey?.draft.plan).toEqual(plan);
    expect(result.current.journey?.draft.plan.hub.chains[0]?.steps[1]).not.toHaveProperty("auto");
    expect(JSON.stringify(result.current.journey?.journal?.frozen)).toBe(frozenBytes);
    expect(localStorage.getItem(journalKey(draft.id, manager))).toBe(rawJournal);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.binding.mock.results.at(-1)?.value.sign).not.toHaveBeenCalled();
  });
  it.each([
    { id: "fees", family: "flow", kind: "collectFees", auto: "yes" },
    { id: "fees", family: "flow", kind: "collectFees", config: { fullRange: "yes" } },
    { id: "fees", family: "flow", kind: 42 },
  ])("rejects malformed frozen flow %j without recovery writes", async (flow) => {
    const journal = storeOrphan();
    const plan = { ...draft.plan, hub: { chains: [{ id: "leaf", sharePct: 100, steps: [flow] }] } };
    localStorage.setItem(
      journalKey(draft.id, manager),
      JSON.stringify({
        ...journal,
        frozen: { ...orphanFrozen(), plan },
      }),
    );
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useV2Launch(`${manager}:${draft.id}`));
    await waitFor(() => expect(result.current.loadingError).toBe(true));
    expect(result.current.ready).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it("recovers orphan metadata from frozen data before invalid editable draft readiness", async () => {
    const journal = storeOrphan();
    const rawJournal = localStorage.getItem(journalKey(draft.id, manager));
    const rawDrafts = localStorage.getItem(MANDATE_DRAFTS_KEY);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const journeyId = `${manager}:${draft.id}`;
    const { result } = renderHook(() => useV2Launch(encodeURIComponent(journeyId)));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.journey).toMatchObject({
      journeyId,
      draft: { plan: draft.plan, review: draft.review, tokens: [] },
      journal: JSON.parse(rawJournal ?? "null"),
    });
    expect(mocks.binding).toHaveBeenLastCalledWith(
      expect.objectContaining({ draftId: draft.id, manager, frozen: journal.frozen }),
    );
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledWith(journeyKey(journeyId), expect.any(String));
    expect(localStorage.getItem(journalKey(draft.id, manager))).toBe(rawJournal);
    expect(localStorage.getItem(MANDATE_DRAFTS_KEY)).toBe(rawDrafts);
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.binding.mock.results.at(-1)?.value.sign).not.toHaveBeenCalled();
    writes.mockRestore();
  });
  it("rejects another wallet without recovering metadata, then recovers on wallet connection", async () => {
    storeOrphan();
    mocks.manager = `0x${"56".repeat(20)}`;
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const journeyId = `${manager}:${draft.id}`;
    const { result, rerender } = renderHook(() => useV2Launch(encodeURIComponent(journeyId)));
    await waitFor(() => expect(result.current.loadingError).toBe(true));
    expect(result.current.ready).toBe(false);
    expect(result.current.journey).toBeNull();
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.binding).toHaveBeenLastCalledWith(
      expect.objectContaining({ manager: null, wallet: null, frozen: undefined }),
    );
    expect(mocks.catalog).not.toHaveBeenCalled();
    mocks.manager = manager;
    rerender();
    await waitFor(() => expect(result.current.ready).toBe(true));
    writes.mockRestore();
  });
  it.each([
    "journal",
    "plan",
    "review",
    "request",
    "hash",
    "wallet",
  ])("fails closed on malformed orphan %s without writes or catalog hydration", async (part) => {
    const journal = storeOrphan();
    const frozen = orphanFrozen();
    const broken = {
      ...journal,
      ...(part === "journal" ? { steps: [] } : {}),
      ...(part === "hash"
        ? { checkpoints: { create: { ...journal.checkpoints.create, txHash: "bad" } } }
        : {}),
      frozen: {
        ...frozen,
        ...(["plan", "review", "request"].includes(part) ? { [part]: {} } : {}),
        ...(part === "wallet"
          ? { request: { ...frozen.request, manager: `0x${"56".repeat(20)}` } }
          : {}),
      },
    };
    localStorage.setItem(journalKey(draft.id, manager), JSON.stringify(broken));
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useV2Launch(`${manager}:${draft.id}`));
    await waitFor(() => expect(result.current.loadingError).toBe(true));
    expect(result.current.ready).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
    writes.mockRestore();
  });
  it("reads frozen journal on reload and exposes broadcast explorer links without catalog I/O", async () => {
    const frozen = { plan: draft.plan, review: draft.review, request: { manager } };
    saveJournal(
      localStorage,
      createJournal(draft.id, manager, frozen, deriveLaunchSteps(draft.plan, {}, true, false)),
    );
    const journey = persistJourney(draft, manager);
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.current?.explorerUrl).toBe(`https://arbiscan.io/tx/0x${"ab".repeat(32)}`);
    expect(result.current.current?.receiptStatus).toBe("unknown");
    expect(mocks.binding).toHaveBeenLastCalledWith(expect.objectContaining({ frozen }));
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it("refuses a different wallet and reports a missing journey as failed", async () => {
    saveJournal(
      localStorage,
      createJournal(draft.id, manager, {}, deriveLaunchSteps(draft.plan, {}, true, false)),
    );
    const journey = persistJourney(draft, manager);
    mocks.manager = `0x${"56".repeat(20)}`;
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.journey).not.toBeNull());
    expect(result.current.ready).toBe(false);
    expect(mocks.binding).toHaveBeenLastCalledWith(
      expect.objectContaining({ manager: null, wallet: null }),
    );
    const missing = renderHook(() => useV2Launch("missing"));
    await waitFor(() => expect(missing.result.current.outcome).toBe("failed"));
  });
  it("prepares a legacy journey without a checkpoint and exposes explicit actions", async () => {
    const journey = persistJourney(draft, manager);
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(mocks.binding).toHaveBeenLastCalledWith(
      expect.objectContaining({
        frozen: expect.objectContaining({
          request: expect.objectContaining({ seedAmount: "100000000" }),
        }),
      }),
    );
    await result.current.sign();
    expect(mocks.binding.mock.results.at(-1)?.value.sign).toHaveBeenCalled();
    result.current.cancel();
    expect(mocks.binding.mock.results.at(-1)?.value.pause).toHaveBeenCalled();
  });
  it("reports failed catalog hydration without requesting signatures", async () => {
    mocks.catalog.mockResolvedValue({ ok: false });
    const journey = persistJourney(draft, manager);
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.outcome).toBe("failed"));
    await result.current.sign();
    expect(mocks.binding.mock.results.at(-1)?.value.sign).not.toHaveBeenCalled();
  });
  it("rejects a legacy unfrozen journey that bypasses Limits", async () => {
    const journey = persistJourney({ ...draft, tokens: [] }, manager);
    const { result } = renderHook(() => useV2Launch(journey.journeyId));
    await waitFor(() => expect(result.current.outcome).toBe("failed"));
    await result.current.sign();
    expect(mocks.binding.mock.results.at(-1)?.value.sign).not.toHaveBeenCalled();
  });
});
