/**
 * @id PP-MGR-SCR-001
 * @name ManagerConsoleScreen fund-drafts slot tests
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events none, the names are ASSERTED here rather than emitted; a test is never an
 *   emitter
 *
 * POO-2127 [D2]: the one line that puts fund-contract drafts on the Console's Strategies tab, and
 * the promise that comes with it.
 *
 * The promise is the reason this file exists separately from the slot's own unit test. The slot's
 * test proves the gate returns nothing; this one proves that "nothing" means the Strategies tab is
 * byte-for-byte what it is today, measured on the REAL console with the real strategies list rather
 * than on a stand-in. A wrapper element, an extra gap or a one-frame skeleton would all pass the
 * unit test and all change the live screen.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContractFamily } from "@/lib/hooks/useContractFamily";
import {
  DEV_MANAGER_ADDRESS,
  managerDashboard,
  managerProfiles,
  managerStrategies,
} from "@/mocks/data/manager";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { createEmptyDraft, type MandateDraft } from "./fund/mandateDraft";
import { MANDATE_DRAFTS_KEY, MANDATE_DRAFTS_VERSION } from "./fund/mandateDraftStore";
import { ManagerConsoleScreen } from "./ManagerConsoleScreen";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/manager",
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=strategies"),
}));
// POO-847 R3: the managed surface is desktop only, and jsdom has no matchMedia.
vi.mock("@/hooks/useIsDesktop", () => ({ useIsDesktop: () => true }));
// Pin the greeting so two renders in the same test cannot straddle a clock boundary.
vi.mock("@/lib/utils/timeOfDay", () => ({ timeOfDay: () => "morning" }));
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({
    address: "0x3655C34c9A1BA3Ab523EC72f6C39549F6fCA3F77" as `0x${string}`,
    isLoading: false,
  }),
}));
vi.mock("@/lib/analytics/useAnalytics", () => ({
  useAnalytics: () => ({ track: vi.fn(), trackFailure: vi.fn() }),
}));

const flags = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, isEnabled: () => flags.enabled }),
}));

const family = vi.hoisted(() => ({ value: "v1" as ContractFamily }));
vi.mock("@/lib/hooks/useContractFamily", () => ({
  useContractFamily: () => ({ family: family.value, setFamily: vi.fn(), hydrated: true }),
}));

const found = managerProfiles.find((entry) => entry.address === DEV_MANAGER_ADDRESS);
if (!found) throw new Error("expected the dev-manager mock profile");
// Re-bound after the guard: `renderConsole` is a hoisted function declaration, so TypeScript will
// not carry the narrowing of `found` into it.
const profile = found;

/** A saved draft in the store, so the card has something to show when it is allowed to. */
function seedDraft(): void {
  const draft: MandateDraft = {
    ...createEmptyDraft("2026-10-01T00:00:00.000Z", "d-1"),
    name: "ETH and BTC on Arbitrum",
    savedAt: "2026-10-01T00:00:00.000Z",
  };
  window.localStorage.setItem(
    MANDATE_DRAFTS_KEY,
    JSON.stringify({ version: MANDATE_DRAFTS_VERSION, drafts: { "d-1": draft } }),
  );
}

function renderConsole() {
  return renderWithProviders(
    <ManagerConsoleScreen
      dashboard={managerDashboard}
      strategies={managerStrategies}
      profile={profile}
    />,
  );
}

beforeEach(() => {
  flags.enabled = false;
  family.value = "v1";
  window.localStorage.clear();
  seedDraft();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("ManagerConsoleScreen, the fund-drafts slot", () => {
  // @rule D2
  it("shows the drafts card at the top of the Strategies tab with the flag on and V2 selected", async () => {
    flags.enabled = true;
    family.value = "v2";

    renderConsole();

    expect(await screen.findByRole("heading", { name: "Drafts" })).toBeInTheDocument();
    expect(screen.getByText("ETH and BTC on Arbitrum")).toBeInTheDocument();
    // "At the top": the drafts card precedes the managed-strategies list in the document.
    const drafts = screen.getByTestId("mandate-drafts-card");
    const list = screen.getByRole("heading", { name: "Managed strategies" });
    expect(drafts.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // @rule D2
  it("adds nothing to the Strategies tab with the flag off", () => {
    // NOT asserted on the word "Drafts": the managed-strategies list already has a Drafts status
    // filter, which is exactly the sort of coincidence a markup assertion has to be specific about.
    const off = renderConsole().container.innerHTML;
    expect(off).not.toContain("mandate-drafts-card");

    flags.enabled = true;
    family.value = "v2";
    const on = renderConsole().container.innerHTML;

    expect(on).toContain("mandate-drafts-card");
    expect(on).not.toBe(off);
  });

  // @rule D2
  it("leaves the Strategies tab byte-identical with V1 selected while the flag is on", () => {
    const off = renderConsole().container.innerHTML;

    flags.enabled = true;
    family.value = "v1";
    const v1WithFlag = renderConsole().container.innerHTML;

    expect(v1WithFlag).toBe(off);
  });
});
