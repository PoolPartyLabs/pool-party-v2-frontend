/**
 * @id PP-MGR-CMP-077 (POO-2195)
 * @name ReviewNavigation.test
 * @implements-rules-version v1
 * @analytics-events none: verifies saved phase navigation and preservation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";
import { hubSupplyPlan, makeTestDraft } from "../build/plan/planTestKit";
import { FundStrategyBuilderScreen } from "../FundStrategyBuilderScreen";
import { getDraft, upsertDraft } from "../mandateDraftStore";
import { reviewStoryKit } from "./reviewStoryKit";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/manager/new",
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: mocks.track }) }));
vi.mock("../build/BuildScreen", () => ({
  BuildScreen: (p: { onReview: () => void }) => (
    <button type="button" onClick={p.onReview}>
      Next: Review
    </button>
  ),
}));
vi.mock("./ReviewPhase", () => ({
  ReviewPhase: (p: { onBackToBuild: () => void; onEditMandate: () => void }) => (
    <div>
      <h2>Connected Review</h2>
      <button type="button" onClick={p.onBackToBuild}>
        Back to Build
      </button>
      <button type="button" onClick={p.onEditMandate}>
        Edit mandate
      </button>
    </div>
  ),
}));
vi.mock("@/components/ui/Toast", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.scrollTo = vi.fn();
  const d = {
    ...makeTestDraft(),
    id: "review-nav",
    completedAt: "2026-10-04T09:00:00.000Z",
    savedAt: "2026-10-04T09:00:00.000Z",
    lastPhase: "build" as const,
    plan: hubSupplyPlan(),
    review: reviewStoryKit,
  };
  upsertDraft(d);
  mocks.params = new URLSearchParams("draft=review-nav&phase=build");
});
describe("saved Review navigation [R1] [R9]", () => {
  it("persists Build before Review, preserves fields and returns to Build", async () => {
    renderWithProviders(<FundStrategyBuilderScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Next: Review" }));
    expect(await screen.findByRole("heading", { name: "Connected Review" })).toBeInTheDocument();
    expect(getDraft("review-nav")?.lastPhase).toBe("review");
    expect(getDraft("review-nav")?.review).toEqual(reviewStoryKit);
    expect(mocks.track).toHaveBeenCalledWith("builder_build_completed", { family: "v2" });
    await userEvent.click(screen.getByRole("button", { name: "Back to Build" }));
    expect(await screen.findByRole("button", { name: "Next: Review" })).toBeInTheDocument();
  });
  it("reopens saved Review from the same draft", async () => {
    const d = getDraft("review-nav");
    if (!d) throw new Error("fixture");
    upsertDraft({ ...d, lastPhase: "review" });
    mocks.params = new URLSearchParams("draft=review-nav&phase=review");
    renderWithProviders(<FundStrategyBuilderScreen />);
    expect(await screen.findByRole("heading", { name: "Connected Review" })).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(expect.stringContaining("phase=review"), {
        scroll: false,
      }),
    );
  });
});
