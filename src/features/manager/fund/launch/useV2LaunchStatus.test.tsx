import { act, renderHook } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog } from "../mandateCatalog";
import { createEmptyDraft } from "../mandateDraft";
import { upsertDraft } from "../mandateDraftStore";
import { ReviewPhase } from "../review/ReviewPhase";
import type { FundLaunchDraft } from "./contracts";
import { FundLaunchJourneysList } from "./FundLaunchJourneysList";
import { createJournal, journalKey, saveJournal } from "./journal";
import { getLaunchStatusForDraft, journeyKey, listLaunchJourneys, persistJourney } from "./journey";
import { type CanvasPlan, deriveLaunchSteps } from "./plan";
import { useV2LaunchStatus } from "./useV2LaunchStatus";

const mocks = vi.hoisted(() => ({
  address: `0x${"3".repeat(40)}` as string | undefined,
  reviewBinding: {} as Record<string, unknown>,
  push: vi.fn(),
  start: vi.fn(),
  track: vi.fn(),
  catalog: vi.fn(),
  balance: vi.fn(),
}));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.address }) }));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("./useV2ReviewDraft", () => ({ useV2ReviewDraft: () => mocks.reviewBinding }));
vi.mock("./startFundLaunch", () => ({ startFundLaunch: mocks.start }));
vi.mock("@/lib/api/v2/actions", () => ({
  getCatalogTokensAction: mocks.catalog,
  getCatalogReservesAction: mocks.catalog,
}));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: mocks.track }) }));
vi.mock("@/components/ui/ImageCropModal", () => ({ ImageCropModal: () => null }));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
  useRouter: () => ({ push: mocks.push }),
}));
const wallet = `0x${"3".repeat(40)}`;
const draft: FundLaunchDraft = {
  ...createEmptyDraft("2026-10-04", "status"),
  review: {
    name: "Wallet-local income",
    description: "",
    imageUrl: "",
    performanceFeeBps: 2000,
    managementFeeBps: 0,
    payoutFeeBps: 0,
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
              family: "position",
              kind: "aaveSupply",
              config: { assetKey: `arbitrum:${wallet}` },
            },
          ],
        },
      ],
    },
    spokes: [],
  },
};
function orphanJournal(plan: CanvasPlan = draft.plan) {
  const journal = createJournal(
    draft.id,
    wallet,
    {
      plan,
      review: draft.review,
      request: {
        manager: wallet,
        chains: [{ chainId: 42161, tokens: [wallet], uniswapV4PoolIds: [] }],
        aaveV3Reserves: [],
        spokeCapPercent: null,
        performanceFeeBps: 2000,
        managementFeeBps: 0,
        payoutFeeBps: 0,
        minFirstDeposit: "100000000",
        seedAmount: "100000000",
      },
    },
    deriveLaunchSteps(plan, {}, true, false),
  );
  journal.checkpoints.create = {
    stepId: "create",
    chain: 42161,
    status: "submitted",
    txHash: `0x${"ab".repeat(32)}`,
    receiptStatus: "unknown",
  };
  saveJournal(localStorage, journal);
  return journal;
}
describe("wallet-local launch status POO-2181", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.address = wallet;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  it("discovers accepted no-auto collectFees flow without mutating frozen data", () => {
    const plan: CanvasPlan = structuredClone(draft.plan);
    const chain = plan.hub.chains[0];
    if (!chain) throw new Error("fixture");
    chain.steps.push({ id: "fees", family: "flow", kind: "collectFees", config: {} });
    const journal = orphanJournal(plan);
    const raw = localStorage.getItem(journalKey(draft.id, wallet));
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() => useV2LaunchStatus(draft.id));
    expect(result.current).toMatchObject({ journeyId: `${wallet}:${draft.id}`, status: "paused" });
    expect(result.current?.current).toEqual(JSON.parse(JSON.stringify(journal.steps[0])));
    expect(localStorage.getItem(journalKey(draft.id, wallet))).toBe(raw);
    expect(localStorage.getItem(journeyKey(`${wallet}:${draft.id}`))).toBeNull();
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.balance).not.toHaveBeenCalled();
  });
  it.each([
    { id: "fees", family: "flow", kind: "collectFees", auto: "yes" },
    { id: "fees", family: "flow", kind: "collectFees", config: { tickLower: "bad" } },
    { id: "fees", family: "invalid", kind: "collectFees" },
  ])("hides malformed frozen flow %j without storage writes", (flow) => {
    const journal = orphanJournal();
    const frozen = journal.frozen as Record<string, unknown>;
    localStorage.setItem(
      journalKey(draft.id, wallet),
      JSON.stringify({
        ...journal,
        frozen: {
          ...frozen,
          plan: { ...draft.plan, hub: { chains: [{ id: "hub", sharePct: 100, steps: [flow] }] } },
        },
      }),
    );
    const writes = vi.spyOn(Storage.prototype, "setItem");
    expect(getLaunchStatusForDraft(draft.id, wallet)).toBeNull();
    expect(writes).not.toHaveBeenCalled();
  });
  it("discovers a wallet-scoped orphan without writes, catalog or balance reads", () => {
    const journal = orphanJournal();
    const raw = localStorage.getItem(journalKey(draft.id, wallet));
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const { result, rerender } = renderHook(() => useV2LaunchStatus(draft.id));
    expect(result.current).toMatchObject({ journeyId: `${wallet}:${draft.id}`, status: "paused" });
    expect(result.current?.current).toEqual(JSON.parse(JSON.stringify(journal.steps[0])));
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.balance).not.toHaveBeenCalled();
    expect(localStorage.getItem(journeyKey(`${wallet}:${draft.id}`))).toBeNull();
    expect(localStorage.getItem(journalKey(draft.id, wallet))).toBe(raw);
    mocks.address = `0x${"4".repeat(40)}`;
    rerender();
    expect(result.current).toBeNull();
    expect(getLaunchStatusForDraft(draft.id, null)).toBeNull();
    expect(journal.checkpoints.create?.txHash).toBe(`0x${"ab".repeat(32)}`);
  });
  it.each(["failed", "complete"] as const)("reads orphan %s from saved checkpoints", (status) => {
    const journal = orphanJournal();
    for (const step of journal.steps) {
      journal.checkpoints[step.id] = {
        stepId: step.id,
        chain: step.chain,
        status: status === "complete" ? "confirmed" : "failed",
      };
    }
    saveJournal(localStorage, journal);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    expect(getLaunchStatusForDraft(draft.id, wallet)).toMatchObject({
      status,
      outcome: status === "complete" ? "completed" : "failed",
    });
    expect(writes).not.toHaveBeenCalled();
  });
  it.each([
    "journal",
    "plan",
    "review",
    "request",
    "manager",
  ])("hides malformed orphan %s without repairing storage", (part) => {
    const journal = orphanJournal();
    const frozen = journal.frozen as Record<string, unknown>;
    localStorage.setItem(
      journalKey(draft.id, wallet),
      JSON.stringify({
        ...journal,
        ...(part === "journal" ? { steps: [] } : {}),
        ...(part === "manager" ? { manager: `0x${"4".repeat(40)}` } : {}),
        frozen: {
          ...frozen,
          ...(["plan", "review", "request"].includes(part) ? { [part]: {} } : {}),
        },
      }),
    );
    const writes = vi.spyOn(Storage.prototype, "setItem");
    expect(getLaunchStatusForDraft(draft.id, wallet)).toBeNull();
    expect(writes).not.toHaveBeenCalled();
  });
  it("real Review component resumes an orphan despite invalid edited Build and Review", async () => {
    const edited = {
      ...draft,
      tokens: [],
      plan: undefined,
      review: { ...draft.review, seed: "0" },
    };
    upsertDraft(edited);
    const plan: CanvasPlan = structuredClone(draft.plan);
    const chain = plan.hub.chains[0];
    if (!chain) throw new Error("fixture");
    chain.steps.push({ id: "fees", family: "flow", kind: "collectFees", config: {} });
    orphanJournal(plan);
    mocks.reviewBinding = {
      draft: edited,
      catalog: buildMandateCatalog(),
      manager: wallet,
      review: edited.review,
      balance: null,
      preview: null,
      errors: [{ field: "seed", messageKey: "fundLaunch.validation" }],
      launchBlockers: [
        { code: "INVALID_REVIEW", field: "seed", messageKey: "fundLaunch.validation" },
      ],
      uploading: false,
      uploadError: null,
      feeConfiguration: { flowFeeBps: 25, flowSource: "fallback" },
      setField: vi.fn(),
      setFeePercent: vi.fn(),
      setMax: vi.fn(),
      uploadLogo: vi.fn(),
      refreshBalance: mocks.balance,
    };
    const writes = vi.spyOn(Storage.prototype, "setItem");
    renderWithProviders(
      <ReviewPhase draftId={draft.id} onBackToBuild={vi.fn()} onEditMandate={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Resume launch" }));
    expect(mocks.push).toHaveBeenCalledWith(
      `/manager/fund-launch/${encodeURIComponent(`${wallet}:${draft.id}`)}`,
    );
    expect(mocks.start).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.balance).not.toHaveBeenCalled();
  });
  it("R8 returns null without a journey and updates on journal completion", async () => {
    const { result } = renderHook(() => useV2LaunchStatus(draft.id));
    expect(result.current).toBeNull();
    act(() => {
      persistJourney(draft, wallet);
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current?.status).toBe("paused"));
    const journal = createJournal(draft.id, wallet, {}, [
      { id: "create", kind: "create", chain: 42161, dependencies: [] },
    ]);
    journal.checkpoints.create = { stepId: "create", chain: 42161, status: "confirmed" };
    act(() => saveJournal(localStorage, journal));
    expect(result.current).toMatchObject({
      status: "complete",
      current: null,
      outcome: "completed",
    });
  });
  it("R8 hides status immediately when the wallet or draft changes", () => {
    persistJourney(draft, wallet);
    const { result, rerender } = renderHook(({ draftId }) => useV2LaunchStatus(draftId), {
      initialProps: { draftId: draft.id },
    });
    expect(result.current).not.toBeNull();
    mocks.address = undefined;
    rerender({ draftId: draft.id });
    expect(result.current).toBeNull();
    mocks.address = wallet;
    rerender({ draftId: "other" });
    expect(result.current).toBeNull();
  });
  it("R4 renders resume then completed journey and fund links", async () => {
    const journey = persistJourney(draft, wallet);
    renderWithProviders(<FundLaunchJourneysList manager={wallet} />);
    expect(screen.getByRole("link", { name: "Resume launch" })).toHaveAttribute(
      "href",
      `/manager/fund-launch/${encodeURIComponent(journey.journeyId)}`,
    );
    const journal = createJournal(draft.id, wallet, {}, [
      { id: "create", kind: "create", chain: 42161, dependencies: [] },
    ]);
    journal.addresses.coreVault = wallet;
    journal.checkpoints.create = { stepId: "create", chain: 42161, status: "confirmed" };
    act(() => saveJournal(localStorage, journal));
    expect(await screen.findByRole("link", { name: "View journey" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      `/funds/${wallet}`,
    );
  });
  it("R4 skips malformed matching entries and reports inaccessible browser storage", () => {
    localStorage.setItem(
      journeyKey(`${wallet}:corrupt`),
      JSON.stringify({
        version: 1,
        journeyId: `${wallet}:corrupt`,
        draftId: "corrupt",
        manager: wallet,
        createdAt: "2026-10-04",
        draft: { id: "corrupt", review: { name: "broken" } },
      }),
    );
    expect(listLaunchJourneys(wallet).journeys).toEqual([]);
    vi.spyOn(Storage.prototype, "key").mockImplementation(() => {
      throw new Error("blocked storage");
    });
    renderWithProviders(<FundLaunchJourneysList manager={wallet} />);
    expect(screen.getByRole("alert")).toHaveTextContent("cannot be read");
  });
  it("R4 isolates wallet changes in the list", () => {
    persistJourney(draft, wallet);
    const { rerender } = renderWithProviders(<FundLaunchJourneysList manager={wallet} />);
    expect(screen.getByText(/Wallet-local income/)).toBeInTheDocument();
    rerender(<FundLaunchJourneysList manager={`0x${"4".repeat(40)}`} />);
    expect(screen.queryByText(/Wallet-local income/)).not.toBeInTheDocument();
    fireEvent(window, new Event("storage"));
  });
});
