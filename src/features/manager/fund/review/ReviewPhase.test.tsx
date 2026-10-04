/**
 * @id PP-MGR-CMP-077 (POO-2195)
 * @name ReviewPhase.test
 * @implements-rules-version v1
 * @analytics-events none: verifies assembly emissions and launch entry.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";
import {
  hubSupplyPlan,
  makeTestDraft,
  spokePoolPlan,
  withCompletePools,
} from "../build/plan/planTestKit";
import { buildMandateCatalog } from "../mandateCatalog";
import { ReviewPhase } from "./ReviewPhase";
import { reviewStoryBalance, reviewStoryKit, reviewStoryPreview } from "./reviewStoryKit";

const mocks = vi.hoisted(() => ({
  binding: {} as Record<string, unknown>,
  status: null as unknown,
  start: vi.fn(),
  track: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("../launch/useV2ReviewDraft", () => ({ useV2ReviewDraft: () => mocks.binding }));
vi.mock("../launch/useV2LaunchStatus", () => ({ useV2LaunchStatus: () => mocks.status }));
vi.mock("../launch/startFundLaunch", () => ({ startFundLaunch: mocks.start }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: mocks.track }) }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/components/ui/ImageCropModal", () => ({ ImageCropModal: () => null }));
const draft = () => ({
  ...makeTestDraft(),
  id: "review-test",
  name: reviewStoryKit.name,
  plan: hubSupplyPlan(),
  review: { ...reviewStoryKit },
});
const back = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = null;
  mocks.start.mockResolvedValue({ journeyId: "existing" });
  mocks.binding = {
    draft: draft(),
    catalog: buildMandateCatalog(),
    manager: `0x${"a".repeat(40)}`,
    review: { ...reviewStoryKit },
    balance: reviewStoryBalance,
    preview: reviewStoryPreview,
    errors: [],
    launchBlockers: [],
    uploading: false,
    uploadError: null,
    feeConfiguration: { flowFeeBps: 25, flowSource: "fallback" },
    setField: vi.fn(),
    setFeePercent: vi.fn(),
    setMax: vi.fn(),
    uploadLogo: vi.fn(),
    refreshBalance: vi.fn(),
  };
});
function show() {
  return renderWithProviders(
    <ReviewPhase draftId="review-test" onBackToBuild={back} onEditMandate={vi.fn()} />,
  );
}
describe("Review assembly [R1-R9]", () => {
  it("binds current form values and shows sourced summaries without invented metrics", async () => {
    show();
    expect(await screen.findByLabelText("Strategy name")).toHaveValue(reviewStoryKit.name);
    expect(screen.getByText("Estimated protocol rate")).toBeInTheDocument();
    expect(
      screen.queryByText(/Operating cash|Risk level|TVL|Estimated return/),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Strategy name"), {
      target: { value: "Changed strategy" },
    });
    expect(mocks.binding.setField).toHaveBeenCalledWith("name", "Changed strategy");
    expect(mocks.track).toHaveBeenCalledWith("builder_review_field_changed", {
      review_field: "name",
    });
  });
  it("shows unavailable draft with retry and emits an error", async () => {
    mocks.binding.draft = null;
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(mocks.track).toHaveBeenCalledWith("builder_review_error", {
      error_code: "REVIEW_DRAFT_UNAVAILABLE",
    });
  });
  it("focuses the first field reason and never starts launch", async () => {
    mocks.binding.review = { ...reviewStoryKit, name: "Short", minimum: "0" };
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Launch strategy" }));
    expect(screen.getByLabelText("Strategy name")).toHaveFocus();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith("builder_launch_blocked", {
      review_field: "name",
      error_code: "REVIEW_NAME_LENGTH",
    });
  });
  it("prevents launch during an upload and with unread balance", async () => {
    mocks.binding.uploading = true;
    mocks.binding.balance = null;
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Launch strategy" }));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(document.activeElement).toHaveAttribute("id", "review-imageUrl");
  });
  it("returns unsupported Build to its revealed blocker", async () => {
    const d = draft();
    if (!d.plan.hub.chains[0]?.steps[0]) throw new Error("fixture");
    d.plan.hub.chains[0].steps[0].kind = "aaveBorrow";
    mocks.binding.draft = d;
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Launch strategy" }));
    expect(back).toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("blocks a catalog failure and keeps retry available", async () => {
    mocks.binding.catalog = { ...buildMandateCatalog(), error: true, retry: vi.fn() };
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Launch strategy" }));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });
  it("shows a spoke launch preview grouped on its actual network", async () => {
    const d = draft();
    d.plan = withCompletePools(spokePoolPlan());
    mocks.binding.draft = d;
    show();
    expect(await screen.findByText("Launch steps")).toBeInTheDocument();
    expect(screen.getAllByText("Robinhood Chain").length).toBeGreaterThan(0);
    expect(screen.getByText(/Up to \d+ signatures/)).toBeInTheDocument();
    expect(screen.getByText(/transactions and .* profile messages/)).toBeInTheDocument();
  });
  it("enters the existing launch exactly once even on repeated clicks", async () => {
    let finish: (value: { journeyId: string }) => void = () => {};
    mocks.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    show();
    const button = await screen.findByRole("button", { name: "Launch strategy" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ id: "review-test", review: reviewStoryKit }),
    );
    finish({ journeyId: "done" });
    expect(mocks.track.mock.calls.some(([name]) => name === "builder_launch_completed")).toBe(
      false,
    );
  });
  it("resumes an existing checkpoint without creating or rewriting launch", async () => {
    mocks.status = { journeyId: "wallet:draft", status: "paused" };
    mocks.binding.review = { ...reviewStoryKit, name: "Short" };
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Resume launch" }));
    expect(mocks.push).toHaveBeenCalledWith("/manager/fund-launch/wallet%3Adraft");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("reports safe launch entry failure and re-enables retry", async () => {
    mocks.start.mockRejectedValue(new Error("private endpoint"));
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Launch strategy" }));
    expect(await screen.findByText("Launch could not start. Please retry.")).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith("builder_review_error", {
      error_code: "REVIEW_LAUNCH_ENTRY_FAILED",
    });
  });
  it("reports abandonment when leaving before launch", async () => {
    const view = show();
    await screen.findByLabelText("Strategy name");
    view.unmount();
    expect(mocks.track).toHaveBeenCalledWith("builder_review_abandoned", { family: "v2" });
  });
});
