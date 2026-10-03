/**
 * @id PP-MGR-SCR-002
 * @name BuilderRouteSwitch - tests
 * @implements-rules-version v1 (POO-2120 rules v1, POO-2157 rules v1)
 *
 * POO-2120 [R6] / [R8]. Behaviour: the four branches of the switch, and the one that matters most,
 * the flag being off, pinned twice. Once on markup identity (the switch renders its `v1` child and
 * adds not one byte around it) and once against the REAL V1 builder, so "V1 is untouched" is a
 * claim about the shipped screen rather than about a stand-in.
 *
 * POO-2157 [A9, G2]: the same claims hold for the Build phase the canvas activated. A deep link into
 * Build (`?draft=...&phase=build`) on a closed mandate that already holds a plan reaches the canvas
 * ONLY with the flag on and V2 chosen; with the flag off or V1 chosen it renders V1, byte for byte.
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
import { hubPoolPlan, makeTestDraft } from "./build/plan/planTestKit";
import { upsertDraft } from "./mandateDraftStore";

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
/** The deep link the fund builder reads; empty unless a Build case points it at a draft. */
const route = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => route.params }));

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
    route.params = new URLSearchParams();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetDevOverridesForTests();
    window.localStorage.clear();
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

  /**
   * POO-2157 [A9, G2]: a deep link into the Build canvas, on a closed mandate that holds a plan.
   * Stored for real, so the fund builder (when it renders at all) would open the canvas on it.
   */
  function linkIntoBuild(): void {
    const stored = upsertDraft({
      ...makeTestDraft(),
      id: "d-build-link",
      savedAt: "2026-10-03T00:00:00.000Z",
      lastPhase: "build",
      plan: hubPoolPlan(),
    });
    if (!stored) throw new Error("fixture: seed write failed");
    route.params = new URLSearchParams("draft=d-build-link&step=limits&phase=build");
  }

  // @rule A9
  it("[A9] with the flag off, a link into Build renders V1 and adds nothing around it", () => {
    linkIntoBuild();
    familyState.family = "v2";
    const viaSwitch = renderWithProviders(<BuilderRouteSwitch v1={<V1Stub />} />);
    const switchHtml = viaSwitch.container.innerHTML;
    expect(screen.queryByRole("heading", { name: "Build your strategy" })).toBeNull();
    viaSwitch.unmount();
    const bare = render(<V1Stub />);
    expect(switchHtml).toBe(bare.container.innerHTML);
  });

  // @rule A9
  it("[A9] with the flag on and V1 chosen, a link into Build renders V1 and adds nothing", () => {
    enableFlag();
    linkIntoBuild();
    const viaSwitch = renderWithProviders(<BuilderRouteSwitch v1={<V1Stub />} />);
    const switchHtml = viaSwitch.container.innerHTML;
    expect(screen.queryByRole("heading", { name: "Build your strategy" })).toBeNull();
    viaSwitch.unmount();
    const bare = render(<V1Stub />);
    expect(switchHtml).toBe(bare.container.innerHTML);
  });

  // @rule A9
  it("[A9] the real V1 builder is untouched by a link into Build while the flag is off", () => {
    linkIntoBuild();
    renderWithProviders(
      <BuilderRouteSwitch v1={<StrategyBuilderScreen pools={[]} feePolicy={managerFeePolicy} />} />,
    );
    expect(screen.getByRole("heading", { name: "Create new strategy" })).toBeInTheDocument();
    // The V1 builder has its own "Build your strategy" step, so the canvas is told apart by its
    // own markers: none of them exists, and the fund builder's Save & exit is not there either.
    expect(document.querySelector("[data-build-screen]")).toBeNull();
    expect(document.querySelector("[data-build-graph]")).toBeNull();
    expect(screen.queryByTestId("build-palette")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save & exit" })).toBeNull();
  });

  // @rule G2
  it("[G2] with the flag on and V2 chosen, the same link opens the Build canvas", async () => {
    enableFlag();
    linkIntoBuild();
    familyState.family = "v2";
    renderWithProviders(<BuilderRouteSwitch v1={<V1Stub />} />);
    expect(await screen.findByRole("heading", { name: "Build your strategy" })).toBeInTheDocument();
    expect(screen.queryByText("the v1 builder")).toBeNull();
  });
});
