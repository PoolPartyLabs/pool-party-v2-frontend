/**
 * @id PP-MGR-SCR-002
 * @name BuilderRouteSwitch - header toggle integration tests
 * @implements-rules-version v1 (POO-2120 rules v1, POO-2157 rules v1)
 * @analytics-events none, the names are ASSERTED nowhere here; this file is about what the press
 *   RENDERS. A test is never an emitter
 *
 * POO-2157 (review F2 of PR #41): the press is also a way out of the builder on screen, so with
 * unsaved work in it the toggle asks first and the builder stays until Leave.
 *
 * POO-2120 [R6], epic POO-2119. The one claim `BuilderRouteSwitch.test.tsx` cannot make: the header
 * control and the switch are two components with no props between them, so the only thing that
 * carries a press from one to the other is {@link useContractFamily}. Both unit files mock that hook
 * (they have to, to reach the pre-hydration branch), which left the wiring itself untested, and the
 * wiring was broken: the hook kept a copy of the family per component, so a manager on
 * `/manager/new` pressed V2 in the header and the builder underneath stayed V1 until the page
 * remounted.
 *
 * So this file mocks NO hook. The real toggle, the real switch, the real store, one press.
 *
 * `FundStrategyBuilderScreen` IS stubbed: this is a test about routing, and mounting the whole fund
 * builder (five steps, a draft store, a pool search) would make a routing regression arrive as a
 * failure somewhere in the Mandate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import { UnsavedChangesProvider } from "@/lib/hooks/unsavedChanges";
import { __resetContractFamilyStoreForTests } from "@/lib/hooks/useContractFamily";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { ContractFamilyToggle } from "../../../components/layout/ContractFamilyToggle";
import { BuilderRouteSwitch } from "./BuilderRouteSwitch";

/** Whether the stand-in fund builder holds unsaved work, registered the way the real one does. */
const fundBuilder = vi.hoisted(() => ({ dirty: false }));

vi.mock("./FundStrategyBuilderScreen", async () => {
  const { useUnsavedChanges } = await import("@/lib/hooks/unsavedChanges");
  function StandInFundBuilder() {
    useUnsavedChanges(fundBuilder.dirty);
    return <p>the fund builder</p>;
  }
  return { FundStrategyBuilderScreen: StandInFundBuilder };
});

/** A cheap stand-in for the V1 element the page passes in. */
function V1Stub() {
  return <p>the v1 builder</p>;
}

/** Turn the gate on, the way an environment would. */
function enableFlag() {
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FUND_CONTRACTS", "on");
}

describe("ContractFamilyToggle and BuilderRouteSwitch, wired by the real store", () => {
  beforeEach(() => {
    window.dataLayer = [];
    window.localStorage.clear();
    fundBuilder.dirty = false;
    __resetContractFamilyStoreForTests();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetContractFamilyStoreForTests();
    __resetDevOverridesForTests();
  });

  // @rule R6
  it("[R6] swaps the builder when V2 is pressed in the header, and back on V1", async () => {
    const user = userEvent.setup();
    enableFlag();
    renderWithProviders(
      <>
        <ContractFamilyToggle />
        <BuilderRouteSwitch v1={<V1Stub />} />
      </>,
    );

    expect(screen.getByText("the v1 builder")).toBeInTheDocument();
    expect(screen.queryByText("the fund builder")).toBeNull();

    await user.click(screen.getByRole("button", { name: "V2" }));

    expect(screen.getByText("the fund builder")).toBeInTheDocument();
    expect(screen.queryByText("the v1 builder")).toBeNull();
    expect(screen.getByRole("button", { name: "V2" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "V1" }));

    expect(screen.getByText("the v1 builder")).toBeInTheDocument();
    expect(screen.queryByText("the fund builder")).toBeNull();
    expect(screen.getByRole("button", { name: "V1" })).toHaveAttribute("aria-pressed", "true");
  });

  // @rule R6 - the press is the only thing that moved. The switch is never unmounted and remounted
  // by the press, so the branch it renders is a re-render of the same tree.
  it("[R6] keeps the stored choice, so a reload lands in the builder that was chosen", async () => {
    const user = userEvent.setup();
    enableFlag();
    const first = renderWithProviders(
      <>
        <ContractFamilyToggle />
        <BuilderRouteSwitch v1={<V1Stub />} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "V2" }));
    first.unmount();

    // A reload is a fresh module state reading the same store, which is what the reset simulates.
    __resetContractFamilyStoreForTests();
    renderWithProviders(<BuilderRouteSwitch v1={<V1Stub />} />);

    expect(await screen.findByText("the fund builder")).toBeInTheDocument();
  });

  // @rule HU3 (POO-2157, review F2 of PR #41): the toggle is a way out of the builder on screen.
  it("[HU3] asks before leaving a builder with unsaved work, and keeps it until Leave", async () => {
    const user = userEvent.setup();
    enableFlag();
    fundBuilder.dirty = true;
    renderWithProviders(
      <UnsavedChangesProvider>
        <ContractFamilyToggle />
        <BuilderRouteSwitch v1={<V1Stub />} />
      </UnsavedChangesProvider>,
    );

    // V1 holds nothing unsaved, so entering V2 is immediate, as before.
    await user.click(screen.getByRole("button", { name: "V2" }));
    expect(screen.getByText("the fund builder")).toBeInTheDocument();
    expect(screen.queryByText("Unsaved changes")).toBeNull();

    // Leaving V2 with its work unsaved asks first, and the builder stays on screen meanwhile.
    await user.click(screen.getByRole("button", { name: "V1" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByText("the fund builder")).toBeInTheDocument();
    // The modal hides the page from assistive technology while it is open, hence `hidden`.
    expect(screen.getByRole("button", { name: "V2", hidden: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Leave" }));

    expect(screen.getByText("the v1 builder")).toBeInTheDocument();
    expect(screen.queryByText("the fund builder")).toBeNull();
  });
});
