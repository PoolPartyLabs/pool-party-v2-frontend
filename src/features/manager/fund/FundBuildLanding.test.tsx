/**
 * @id PP-MGR-SCR-002
 * @name FundBuildLanding tests
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events none, the names are ASSERTED here rather than emitted; a test is never an
 *   emitter, so a screen cannot count as instrumented by being tested
 *
 * The Build phase's landing (POO-2127 [B2]): the screen a manager reaches the moment their mandate
 * is closed and persisted, while the Build canvas itself is still in design. Three things are worth
 * pinning: that it says what is missing rather than looking broken, that the only way on from here
 * is back (no Next, nothing forward), and that it reports its own view, because a landing nobody
 * can leave forwards is exactly the screen a funnel needs to be able to see.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog, type MandateCatalog } from "./mandateCatalog";
import { createEmptyDraft, type MandateDraft } from "./mandateDraft";

const analytics = vi.hoisted(() => ({ track: vi.fn(), trackFailure: vi.fn() }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => analytics }));

import { FundBuildLanding } from "./FundBuildLanding";

const catalog: MandateCatalog = buildMandateCatalog({ robinhoodChain: true });

function draftOf(over: Partial<MandateDraft> = {}): MandateDraft {
  return {
    ...createEmptyDraft("2026-10-01T00:00:00.000Z", "d-1"),
    name: "ETH and BTC on Arbitrum",
    completedAt: "2026-10-02T00:00:00.000Z",
    lastStep: "limits",
    passedSteps: ["networks", "protocols", "tokens", "limits"],
    ...over,
  };
}

function renderLanding(over: Partial<MandateDraft> = {}, broad?: boolean) {
  const onBackToMandate = vi.fn();
  const view = renderWithProviders(
    <FundBuildLanding
      draft={draftOf(over)}
      catalog={catalog}
      broad={broad}
      onBackToMandate={onBackToMandate}
    />,
  );
  return { ...view, onBackToMandate };
}

describe("FundBuildLanding", () => {
  // @rule B2
  it("says the Build canvas is still in design and that the mandate is kept", () => {
    renderLanding();

    expect(screen.getByText("Build")).toBeInTheDocument();
    expect(
      screen.getByText(/The Build canvas for the fund contracts is in design/),
    ).toBeInTheDocument();
  });

  // @rule B2
  it("prints the mandate summary under it", () => {
    renderLanding();

    expect(screen.getByRole("heading", { name: "Your mandate" })).toBeInTheDocument();
    expect(screen.getByTestId("mandate-summary-networks")).toHaveTextContent("Arbitrum");
  });

  // @rule B2
  it("offers Back: Mandate and nothing that moves forward", () => {
    renderLanding();

    expect(screen.getByRole("button", { name: "Back: Mandate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next/ })).not.toBeInTheDocument();
  });

  // @rule B2
  it("calls back to the mandate when that button is pressed", async () => {
    const { onBackToMandate } = renderLanding();

    await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));

    expect(onBackToMandate).toHaveBeenCalledTimes(1);
  });

  // @rule B1
  it("passes the broad flag through to the summary", () => {
    renderLanding({}, true);

    expect(screen.getByRole("note")).toHaveTextContent(
      "This strategy will carry a Broad mandate flag",
    );
  });

  // @rule B2
  it("records the landing as a view, once", () => {
    analytics.track.mockClear();

    renderLanding();

    expect(
      analytics.track.mock.calls.filter((call) => call[0] === "builder_build_landing_viewed"),
    ).toHaveLength(1);
  });
});
