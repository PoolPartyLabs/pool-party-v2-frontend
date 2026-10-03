/**
 * @id PP-CORE-CMP-075
 * @name ContractFamilyToggle - tests
 * @implements-rules-version v1
 *
 * POO-2120 [R3] / [R5]. Behaviour: the control does not exist while the `fundContracts` flag is
 * off, it is a labelled group of two `aria-pressed` buttons whose pressed state follows the chosen
 * family, pressing the other segment chooses it AND reports it, pressing the selected one does
 * neither, and before hydration it shows V1 so there is no flash of V2.
 *
 * `useContractFamily` is mocked here on purpose. This file is about the CONTROL: what it renders,
 * what it calls, and what it reports. Persistence, validation, cross-tab sync and the storage
 * failure path are pinned against the real hook in `src/lib/hooks/useContractFamily.test.tsx`, and
 * the mock is what makes the pre-hydration render observable at all (effects flush inside `act`, so
 * a real hook has already hydrated by the time an assertion runs).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import type { ContractFamily } from "@/lib/hooks/useContractFamily";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { ContractFamilyToggle } from "./ContractFamilyToggle";

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

/** Every `contract_family_toggled` push so far, in order. */
function toggleEvents() {
  return (window.dataLayer ?? []).filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" &&
      entry !== null &&
      "event" in entry &&
      entry.event === "contract_family_toggled",
  );
}

/** Turn the gate on, the way an environment would. */
function enableFlag() {
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FUND_CONTRACTS", "on");
}

describe("ContractFamilyToggle", () => {
  // The feature-flag client snapshot is memoized at module scope, so reset it around each test for
  // the per-test `vi.stubEnv` to resolve fresh (same reason as AppShell.test.tsx).
  beforeEach(() => {
    window.dataLayer = [];
    familyState.family = "v1";
    familyState.hydrated = true;
    familyState.setFamily = vi.fn();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetDevOverridesForTests();
  });

  // @rule R3. Off is ABSENT, not disabled and not hidden by CSS. A disabled V2 segment would
  // advertise a preview that does not exist in this environment.
  it("renders nothing at all while the fundContracts flag is off", () => {
    const { container } = renderWithProviders(<ContractFamilyToggle />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("group", { name: "Builder version" })).toBeNull();
  });

  // @rule R3
  it("renders a labelled group of two aria-pressed buttons when the flag is on", () => {
    enableFlag();
    renderWithProviders(<ContractFamilyToggle />);
    const group = screen.getByRole("group", { name: "Builder version" });
    const v1 = screen.getByRole("button", { name: "V1" });
    const v2 = screen.getByRole("button", { name: "V2" });
    expect(group).toContainElement(v1);
    expect(group).toContainElement(v2);
    expect(v1).toHaveAttribute("aria-pressed", "true");
    expect(v2).toHaveAttribute("aria-pressed", "false");
  });

  // @rule R3
  it("follows the chosen family in the pressed state", () => {
    enableFlag();
    familyState.family = "v2";
    renderWithProviders(<ContractFamilyToggle />);
    expect(screen.getByRole("button", { name: "V2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "V1" })).toHaveAttribute("aria-pressed", "false");
  });

  // @rule R3. Before hydration the control shows V1 even when V2 is the stored choice, so the
  // first client render matches the server HTML and a V2 manager never sees V1 flash into V2.
  it("shows V1 selected before hydration", () => {
    enableFlag();
    familyState.hydrated = false;
    familyState.family = "v1";
    renderWithProviders(<ContractFamilyToggle />);
    expect(screen.getByRole("button", { name: "V1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "V2" })).toHaveAttribute("aria-pressed", "false");
  });

  // @rule R5
  it("chooses the other family and reports it", async () => {
    const user = userEvent.setup();
    enableFlag();
    renderWithProviders(<ContractFamilyToggle />);
    await user.click(screen.getByRole("button", { name: "V2" }));
    expect(familyState.setFamily).toHaveBeenCalledWith("v2");
    expect(toggleEvents()).toHaveLength(1);
    expect(toggleEvents()[0]).toMatchObject({ event: "contract_family_toggled", family: "v2" });
  });

  // @rule R5
  it("reports v1 when switching back", async () => {
    const user = userEvent.setup();
    enableFlag();
    familyState.family = "v2";
    renderWithProviders(<ContractFamilyToggle />);
    await user.click(screen.getByRole("button", { name: "V1" }));
    expect(familyState.setFamily).toHaveBeenCalledWith("v1");
    expect(toggleEvents()[0]).toMatchObject({ family: "v1" });
  });

  // @rule R5. Pressing the selected segment is not a decision. Counting it would make the series
  // measure clicks on a control rather than changes of builder.
  it("does nothing when the already selected segment is pressed", async () => {
    const user = userEvent.setup();
    enableFlag();
    renderWithProviders(<ContractFamilyToggle />);
    await user.click(screen.getByRole("button", { name: "V1" }));
    expect(familyState.setFamily).not.toHaveBeenCalled();
    expect(toggleEvents()).toHaveLength(0);
  });

  // @rule R3
  it("explains the two builders in a tooltip", async () => {
    const user = userEvent.setup();
    enableFlag();
    renderWithProviders(<ContractFamilyToggle />);
    await user.hover(screen.getByRole("group", { name: "Builder version" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Switch between the live builder (V1) and the fund contracts preview (V2).",
    );
  });

  // @rule R3. Desktop only (the builder is), and the same 36 px height as the RewardsPill it sits
  // beside, so the header row does not grow a second line.
  it("is hidden below md and matches the RewardsPill height", () => {
    enableFlag();
    renderWithProviders(<ContractFamilyToggle />);
    const group = screen.getByRole("group", { name: "Builder version" });
    expect(group).toHaveClass("hidden", "md:inline-flex", "h-9");
  });
});
