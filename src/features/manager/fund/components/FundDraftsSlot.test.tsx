/**
 * @id PP-MGR-CMP-044
 * @name FundDraftsSlot tests
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events none, the names are ASSERTED here rather than emitted; a test is never an
 *   emitter
 *
 * The one gate that decides whether the Manager Console shows fund-contract drafts at all
 * (POO-2127 [D2]). Three inputs, and the tests exist for the two states where the answer must be
 * NOTHING: the flag off (the preview does not exist in this environment) and V1 selected (the
 * manager is looking at the live builder, which has no drafts of this kind).
 *
 * "Nothing" is asserted as an empty container rather than as an absent card, because the promise
 * the console makes is stronger than "the drafts are hidden": with the flag off or V1 selected the
 * Strategies tab must be what it is today, with no wrapper, no spacing and no skeleton added.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../../tests/utils/renderWithProviders";
import { createEmptyDraft, type MandateDraft } from "../mandateDraft";
import { MANDATE_DRAFTS_KEY, MANDATE_DRAFTS_VERSION } from "../mandateDraftStore";

const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, isEnabled: () => flags.enabled }),
}));

const family = vi.hoisted(() => ({ value: "v2" as "v1" | "v2", hydrated: true }));
vi.mock("@/lib/hooks/useContractFamily", () => ({
  useContractFamily: () => ({
    family: family.value,
    setFamily: vi.fn(),
    hydrated: family.hydrated,
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/manager",
}));

vi.mock("@/lib/analytics/useAnalytics", () => ({
  useAnalytics: () => ({ track: vi.fn(), trackFailure: vi.fn() }),
}));

import { FundDraftsSlot } from "./FundDraftsSlot";

function seed(): void {
  const draft: MandateDraft = {
    ...createEmptyDraft("2026-10-01T00:00:00.000Z", "a"),
    name: "ETH and BTC on Arbitrum",
    savedAt: "2026-10-01T00:00:00.000Z",
  };
  window.localStorage.setItem(
    MANDATE_DRAFTS_KEY,
    JSON.stringify({ version: MANDATE_DRAFTS_VERSION, drafts: { a: draft } }),
  );
}

beforeEach(() => {
  flags.enabled = true;
  family.value = "v2";
  family.hydrated = true;
  window.localStorage.clear();
});

describe("FundDraftsSlot", () => {
  // @rule D2
  it("shows the drafts card with the flag on and V2 selected", async () => {
    seed();

    renderWithProviders(<FundDraftsSlot />);

    expect(await screen.findByRole("heading", { name: "Drafts" })).toBeInTheDocument();
    expect(screen.getByText("ETH and BTC on Arbitrum")).toBeInTheDocument();
  });

  // @rule D2
  it("renders nothing at all with the flag off", () => {
    seed();
    flags.enabled = false;

    const { container } = renderWithProviders(<FundDraftsSlot />);

    expect(container).toBeEmptyDOMElement();
  });

  // @rule D2
  it("renders nothing at all with V1 selected", () => {
    seed();
    family.value = "v1";

    const { container } = renderWithProviders(<FundDraftsSlot />);

    expect(container).toBeEmptyDOMElement();
  });

  // @rule D2
  it("renders nothing while the chosen family is still unknown", () => {
    // Nothing on screen is WRONG before the preference is read: the console is simply today's
    // console. A skeleton would push the strategies list down for one frame and pop it back up.
    seed();
    family.hydrated = false;

    const { container } = renderWithProviders(<FundDraftsSlot />);

    expect(container).toBeEmptyDOMElement();
  });
});
