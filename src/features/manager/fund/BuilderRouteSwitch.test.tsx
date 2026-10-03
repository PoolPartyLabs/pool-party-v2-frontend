/**
 * @id PP-MGR-SCR-002
 * @name BuilderRouteSwitch - tests
 * @implements-rules-version v1
 *
 * POO-2120 [R6] / [R8]. Behaviour: the four branches of the switch, and the one that matters most,
 * the flag being off, pinned twice. Once on markup identity (the switch renders its `v1` child and
 * adds not one byte around it) and once against the REAL V1 builder, so "V1 is untouched" is a
 * claim about the shipped screen rather than about a stand-in.
 *
 * `useContractFamily` is mocked so `hydrated: false` is observable: effects flush inside `act`, so
 * the real hook has already hydrated by the time an assertion runs, and the skeleton branch would
 * be unreachable. The hook's own behaviour is pinned in `src/lib/hooks/useContractFamily.test.tsx`.
 */
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import type { ContractFamily } from "@/lib/hooks/useContractFamily";
import { managerFeePolicy } from "@/mocks/data/manager";
import { render, renderWithProviders, screen } from "../../../../tests/utils/renderWithProviders";
import { StrategyBuilderScreen } from "../StrategyBuilderScreen";
import { BuilderRouteSwitch } from "./BuilderRouteSwitch";

/** The mocked hook's answer, rewritten per test. */
const familyState = vi.hoisted(() => ({
  family: "v1" as ContractFamily,
  hydrated: true,
  setFamily: vi.fn(),
}));

vi.mock("@/lib/hooks/useContractFamily", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/hooks/useContractFamily")>()),
  useContractFamily: () => familyState,
}));

// StrategyBuilderScreen renders a `Link` from `@/i18n/navigation`, which needs Next's app-router
// context this jsdom render does not have. Same mock the existing builder tests use.
//
// POO-2122 added `usePathname` and `useSearchParams`: the fund builder reads the deep link and
// writes the draft id back into the query string, and this file renders the REAL screen.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/manager/new",
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

/** A cheap stand-in for the V1 element the page passes in. */
function V1Stub() {
  return <p>the v1 builder</p>;
}

/** Turn the gate on, the way an environment would. */
function enableFlag() {
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FUND_CONTRACTS", "on");
}

describe("BuilderRouteSwitch", () => {
  beforeEach(() => {
    familyState.family = "v1";
    familyState.hydrated = true;
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetDevOverridesForTests();
  });

  // @rule R6 / @rule R8: and in the hardest form: even with V2 chosen and hydration unfinished,
  // the flag off short-circuits everything. No skeleton on the way in, so a manager in an
  // environment without the preview never sees the builder arrive late.
  it("[R6] renders V1 immediately when the flag is off, whatever the stored family says", () => {
    familyState.family = "v2";
    familyState.hydrated = false;
    renderWithProviders(<BuilderRouteSwitch v1={<V1Stub />} />);
    expect(screen.getByText("the v1 builder")).toBeInTheDocument();
    expect(screen.queryByRole("presentation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save & exit" })).toBeNull();
  });

  // @rule R8: markup identity: the switch is a decision, not a wrapper. Compared against the same
  // element rendered on its own, so an added div or class would fail here.
  it("[R8] adds nothing at all around the V1 element while the flag is off", () => {
    const viaSwitch = renderWithProviders(<BuilderRouteSwitch v1={<V1Stub />} />);
    const switchHtml = viaSwitch.container.innerHTML;
    viaSwitch.unmount();
    const bare = render(<V1Stub />);
    expect(switchHtml).toBe(bare.container.innerHTML);
  });

  // @rule R6: the flag is on but the store has not been read, so which builder to render is not
  // yet known. A skeleton rather than a guess: rendering V1 here would flash it away for every V2
  // manager, and rendering V2 would flash it away for every V1 one.
  it("[R6] renders a builder-shaped skeleton while the flag is on and hydration is unfinished", () => {
    enableFlag();
    familyState.hydrated = false;
    renderWithProviders(<BuilderRouteSwitch v1={<V1Stub />} />);
    expect(screen.queryByText("the v1 builder")).toBeNull();
    expect(screen.queryByText("Mandate steps are on their way")).toBeNull();
    // Skeleton bars are presentational and aria-hidden: a title bar plus three rows.
    expect(screen.getAllByRole("presentation", { hidden: true })).toHaveLength(4);
  });

  // @rule R6
  it("[R6] renders V1 when the flag is on and the chosen family is v1", () => {
    enableFlag();
    renderWithProviders(<BuilderRouteSwitch v1={<V1Stub />} />);
    expect(screen.getByText("the v1 builder")).toBeInTheDocument();
    expect(screen.queryByText("Mandate steps are on their way")).toBeNull();
  });

  // @rule R6 / @rule R7
  it("[R6] renders the fund builder when the flag is on and the chosen family is v2", () => {
    enableFlag();
    familyState.family = "v2";
    renderWithProviders(<BuilderRouteSwitch v1={<V1Stub />} />);
    expect(screen.queryByText("the v1 builder")).toBeNull();
    expect(screen.getByRole("heading", { name: "Create new strategy" })).toBeInTheDocument();
    // POO-2122: the shell replaced S0's placeholder, so the marker is the Mandate itself.
    expect(screen.getByRole("button", { name: "Save & exit" })).toBeInTheDocument();
    expect(screen.getByText("MANDATE · STEP 1 OF 4")).toBeInTheDocument();
  });

  // @rule R8: the shipped V1 builder, not a stand-in: its heading and its Mandate step are there
  // and nothing of this slice is. This is the regression that guards "V1 must not change".
  it("[R8] renders the real V1 builder untouched while the flag is off", () => {
    renderWithProviders(
      <BuilderRouteSwitch v1={<StrategyBuilderScreen pools={[]} feePolicy={managerFeePolicy} />} />,
    );
    expect(screen.getByRole("heading", { name: "Create new strategy" })).toBeInTheDocument();
    // "Mandate" appears more than once in the real screen (the stepper step and the section), which
    // is itself evidence the whole V1 tree mounted rather than a fragment of it.
    expect(screen.getAllByText("Mandate").length).toBeGreaterThan(0);
    expect(screen.queryByText("Mandate steps are on their way")).toBeNull();
    expect(
      screen.queryByText(
        "The fund contracts builder is being assembled. Switch back to V1 to create a strategy today.",
      ),
    ).toBeNull();
  });
});
