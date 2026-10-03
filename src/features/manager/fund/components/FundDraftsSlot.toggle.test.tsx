/**
 * @id PP-MGR-CMP-044
 * @name FundDraftsSlot - header toggle integration tests
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events none, a gate; this file asserts what the press renders and emits nothing.
 *   A test is never an emitter
 *
 * POO-2127 [D2], epic POO-2119. `FundDraftsSlot.test.tsx` mocks {@link useContractFamily} to drive
 * its three negative branches, so nothing there could notice that the hook was not actually shared:
 * the slot read its own copy of the family and a press on the header's V2 left the Manager Console
 * showing no drafts card until the page remounted.
 *
 * This file mocks no hook. The real toggle, the real slot, the real store, one press. The drafts
 * CARD is stubbed: whether the card lists a draft is `MandateDraftsList.test.tsx`'s subject, and
 * mounting the real one here would make a gate regression arrive as a failure inside the card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import { __resetContractFamilyStoreForTests } from "@/lib/hooks/useContractFamily";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { ContractFamilyToggle } from "../../../../components/layout/ContractFamilyToggle";
import { FundDraftsSlot } from "./FundDraftsSlot";

vi.mock("./MandateDraftsList", () => ({
  MandateDraftsList: () => <p>the drafts card</p>,
}));

/** Turn the gate on, the way an environment would. */
function enableFlag() {
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FUND_CONTRACTS", "on");
}

describe("ContractFamilyToggle and FundDraftsSlot, wired by the real store", () => {
  beforeEach(() => {
    window.dataLayer = [];
    window.localStorage.clear();
    __resetContractFamilyStoreForTests();
    __resetDevOverridesForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetContractFamilyStoreForTests();
    __resetDevOverridesForTests();
  });

  // @rule D2
  it("[D2] shows the drafts card when V2 is pressed in the header, and hides it on V1", async () => {
    const user = userEvent.setup();
    enableFlag();
    const { container } = renderWithProviders(
      <>
        <ContractFamilyToggle />
        <FundDraftsSlot />
      </>,
    );

    expect(screen.queryByText("the drafts card")).toBeNull();

    await user.click(screen.getByRole("button", { name: "V2" }));

    expect(screen.getByText("the drafts card")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "V1" }));

    expect(screen.queryByText("the drafts card")).toBeNull();
    // Back to exactly the console the manager had: the slot leaves nothing of itself behind.
    expect(container.textContent).toBe("V1V2");
  });
});
