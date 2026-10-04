import { act, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../../../../tests/utils/renderWithProviders";
import { FallbackReviewIndex } from "./FallbackReviewIndex";

const state = vi.hoisted(() => ({
  enabled: true,
  mock: false,
  manager: "0xmanager" as string | null,
  drafts: [{ id: "saved", name: "Demo fund", savedAt: "2026-10-04T07:00:00Z" }],
  resume: true,
}));
const storage = vi.hoisted(() => ({ listener: () => {}, writes: vi.fn() }));
const journeys = vi.hoisted(() => ({
  drafts: [] as { id: string; name: string; savedAt: string }[],
}));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return state.mock;
  },
}));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => state.enabled }),
}));
vi.mock("../useV2LaunchWallet", () => ({
  useV2LaunchWallet: () => ({ manager: state.manager, balance: BigInt(200000000) }),
}));
vi.mock("../../useV2MandateCatalog", () => ({ useV2MandateCatalog: () => ({}) }));
vi.mock("../../mandateDraftStore", () => ({
  listDrafts: () => state.drafts,
  subscribe: (listener: () => void) => {
    storage.listener = listener;
    return () => {};
  },
  upsertDraft: storage.writes,
}));
vi.mock("./draftReadiness", () => ({ draftReadiness: () => ["execution"] }));
vi.mock("../useV2LaunchStatus", () => ({
  useV2LaunchStatus: () =>
    state.resume
      ? { journeyId: "0xmanager:saved", outcome: "in-progress", status: "paused" }
      : null,
}));
vi.mock("../journey", () => ({
  listLaunchJourneys: () => ({
    journeys: journeys.drafts.map((draft) => ({ draftId: draft.id, draft })),
    unavailable: false,
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: (props: import("react").AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
describe("fallback draft index", () => {
  beforeEach(() => {
    Object.assign(state, {
      enabled: true,
      mock: false,
      manager: "0xmanager",
      drafts: [{ id: "saved", name: "Demo fund", savedAt: "2026-10-04T07:00:00Z" }],
      resume: true,
    });
    vi.clearAllMocks();
    journeys.drafts = [];
  });
  it("lists saved drafts, blockers, exact saved time and wallet-scoped resume links without writes", () => {
    renderWithProviders(<FallbackReviewIndex />);
    expect(screen.getByText("Demo fund")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review & launch" })).toHaveAttribute(
      "href",
      "/manager/fund-launch/review/saved",
    );
    expect(screen.getByRole("link", { name: "Resume" })).toHaveAttribute(
      "href",
      "/manager/fund-launch/0xmanager%3Asaved",
    );
    expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-10-04T07:00:00.000Z");
    expect(screen.getByText("Check execution settings and allocations.")).toBeInTheDocument();
    expect(storage.writes).not.toHaveBeenCalled();
  });
  it("refreshes from the existing draft subscription", () => {
    renderWithProviders(<FallbackReviewIndex />);
    act(() => {
      state.drafts = [];
      storage.listener();
    });
    expect(screen.getByText("No saved drafts in this browser.")).toBeInTheDocument();
  });
  it("includes wallet-local journeys whose Mandate draft was removed", () => {
    state.drafts = [];
    journeys.drafts = [{ id: "orphan", name: "Existing launch", savedAt: "2026-10-04T07:00:00Z" }];
    renderWithProviders(<FallbackReviewIndex />);
    expect(screen.getByText("Existing launch")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Resume" })).toBeInTheDocument();
  });
  it("does not offer resume when no active launch exists", () => {
    state.resume = false;
    renderWithProviders(<FallbackReviewIndex />);
    expect(screen.queryByRole("link", { name: "Resume" })).not.toBeInTheDocument();
  });
  it("hides drafts immediately on wallet disconnect", () => {
    const view = renderWithProviders(<FallbackReviewIndex />);
    state.manager = null;
    view.rerender(<FallbackReviewIndex />);
    expect(screen.queryByText("Demo fund")).not.toBeInTheDocument();
    expect(
      screen.getByText("Connect your manager wallet to review saved drafts."),
    ).toBeInTheDocument();
  });
  it.each(["flag", "mock"])("does not expose links when %s is unavailable", (mode) => {
    state.enabled = mode !== "flag";
    state.mock = mode === "mock";
    renderWithProviders(<FallbackReviewIndex />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
