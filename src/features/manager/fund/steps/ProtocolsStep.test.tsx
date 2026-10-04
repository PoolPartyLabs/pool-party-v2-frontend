/**
 * @id PP-MGR-CMP-036
 * @name ProtocolsStep.test
 * @implements-rules-version v3 (POO-2142 rules v2, POO-2143 rules v2, POO-2167 rules v3)
 * @analytics-events none, the shell emits
 *
 * POO-2123 [R12] / [R19] / [R20] / [R21] / [R22], epic POO-2119. Mandate step 2. Rules v2
 * (POO-2143, buildathon scope): no GMX. Rules v3 (POO-2167): Aave v3 and Uniswap v4 to operate, and
 * Uniswap v3 positions listed but "Coming soon". The disabled row mechanism is also exercised on a
 * catalog where Uniswap v4 runs on Robinhood Chain only.
 *
 * As on step 1, the reducer is `PP-MGR-LIB-019`'s and tested there; these cases assert the screen's
 * own decisions. Two of them carry real weight: the "On" column must show the INTERSECTION with the
 * networks of step 1 (a protocol dot for a network the mandate does not hold is a promise the
 * contracts never made), and R22, which is asserted negatively because "via Across" is exactly the
 * kind of phrase that gets copy-pasted into a caption three slices later.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog, type MandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  type MandateDraft,
  type NetworkId,
  type ProtocolId,
  withNetworks,
} from "../mandateDraft";
import { ProtocolsStep } from "./ProtocolsStep";

const catalog = buildMandateCatalog();

/**
 * The real catalog with Uniswap v4 moved to Robinhood Chain only. No protocol the buildathon scope
 * offers runs on no network of a hub-only mandate, so this is how the R21 mechanism that stays (a
 * protocol with no network in common with step 1 renders disabled) is still exercised.
 */
const catalogV4SpokeOnly: MandateCatalog = {
  ...catalog,
  protocols: catalog.protocols.map((protocol) =>
    protocol.id === "uniswap-v4" ? { ...protocol, availableOn: ["robinhood"] } : protocol,
  ),
};

/**
 * The real catalog with Aave v3 marked unavailable as well, so a SECOND protocol the step lists but
 * cannot operate is exercised beside Uniswap v3 positions (R20 v3).
 */
const catalogAaveUnavailable: MandateCatalog = {
  ...catalog,
  protocols: catalog.protocols.map((protocol) =>
    protocol.id === "aave-v3" ? { ...protocol, available: false } : protocol,
  ),
};

function draftWith(networks: NetworkId[], protocols: ProtocolId[]): MandateDraft {
  const base = withNetworks(
    createEmptyDraft("2026-10-03T00:00:00.000Z", "draft-1"),
    networks,
    catalog,
  );
  return { ...base, protocols: ["uniswap-v3-swap", "across", ...protocols] };
}

/** Render the step and expose the reducer the screen last handed to `update`. */
function renderStep(
  draft: MandateDraft = draftWith([], []),
  stepCatalog: MandateCatalog = catalog,
) {
  const update = vi.fn();
  const onBlocked = vi.fn();
  renderWithProviders(
    <ProtocolsStep
      draft={draft}
      catalog={stepCatalog}
      update={update}
      block={null}
      onBlocked={onBlocked}
    />,
  );
  const protocolsAfterUpdate = () => {
    const reducer = update.mock.calls.at(-1)?.[0] as (d: MandateDraft) => MandateDraft;
    return reducer(draft).protocols;
  };
  return { draft, update, onBlocked, protocolsAfterUpdate };
}

/** The row with this `data-mandate-row`, whatever shape it took. */
function row(id: string): HTMLElement {
  const found = document.querySelector(`[data-mandate-row="${id}"]`);
  if (!found) throw new Error(`no row ${id}`);
  return found as HTMLElement;
}

describe("ProtocolsStep", () => {
  // @rule R19
  it("locks the two required protocols under their own head and subtitle", () => {
    renderStep();

    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Every strategy needs a way to swap tokens and to move money between its networks.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Swaps · converts one token into another")).toBeInTheDocument();
    expect(screen.getByText("Bridge · moves money between your networks")).toBeInTheDocument();
    // Locked rows have no control: the swap adapter and the bridge cannot be removed.
    expect(screen.getAllByText("Always included")).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: "Across" })).not.toBeInTheDocument();
    expect(within(row("across")).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // @rule R20
  it("lists the operable protocols in catalog order with their captions", () => {
    renderStep();

    expect(screen.getByText("Protocols to operate")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Aave v3" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Uniswap v3" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Uniswap v4" })).toBeInTheDocument();
    expect(screen.getByText("Lending · supply tokens to earn interest")).toBeInTheDocument();
    expect(
      screen.getAllByText("Liquidity positions · earn trading fees in a price range"),
    ).toHaveLength(2);
    // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
    // expect(
    //   screen.getByText("Perpetuals · long and short positions with leverage"),
    // ).toBeInTheDocument();
  });

  // @rule R20 v2 @rule R21 v2
  it("no longer offers GMX", () => {
    renderStep();

    expect(screen.queryByRole("checkbox", { name: "GMX" })).not.toBeInTheDocument();
    expect(screen.queryByText("Perpetuals · long and short positions with leverage")).toBeNull();
  });

  // @rule R20 v3 (POO-2167)
  it("lists Uniswap v3 positions as Coming soon and reports the click as a blocked intent", async () => {
    const user = userEvent.setup();
    const { update, onBlocked } = renderStep(draftWith(["robinhood"], []));

    const v3 = screen.getByRole("checkbox", { name: "Uniswap v3" });
    expect(v3).toHaveAttribute("aria-disabled", "true");
    expect(within(row("uniswap-v3")).getByText("Coming soon")).toBeInTheDocument();
    // The only Coming soon row on the shipped catalog: Aave v3 and Uniswap v4 stay operable.
    expect(screen.getAllByText("Coming soon")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Uniswap v4" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(v3);

    expect(onBlocked).toHaveBeenCalledWith({
      step: "protocols",
      reason: "coming_soon",
      rowId: "uniswap-v3",
    });
    expect(update).not.toHaveBeenCalled();
  });

  // @rule R19 @rule R20 v3
  it("keeps the required Uniswap v3 swap locked and included", () => {
    renderStep();

    const swap = row("uniswap-v3-swap");
    expect(within(swap).getByText("Always included")).toBeInTheDocument();
    expect(within(swap).queryByText("Coming soon")).not.toBeInTheDocument();
    expect(within(swap).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // @rule R20
  it("shows under On only the networks of step 1 where the protocol runs", () => {
    // Hub plus Robinhood Chain: Uniswap v4 runs on both, Aave v3 only on the hub.
    renderStep(draftWith(["robinhood"], []));

    const v4 = within(row("uniswap-v4"));
    expect(v4.getByRole("img", { name: "Arbitrum" })).toBeInTheDocument();
    expect(v4.getByRole("img", { name: "Robinhood Chain" })).toBeInTheDocument();

    const aave = within(row("aave-v3"));
    expect(aave.getByRole("img", { name: "Arbitrum" })).toBeInTheDocument();
    // Aave v3 is hub-only, so a Robinhood dot here would promise a deployment that is not there.
    expect(aave.queryByRole("img", { name: "Robinhood Chain" })).not.toBeInTheDocument();
  });

  // @rule R20
  it("shows the On footnote once", () => {
    renderStep();

    expect(
      screen.getByText('"On" shows the networks from step 1 where each protocol is available.'),
    ).toBeInTheDocument();
  });

  // @rule R20
  it("adds a protocol through withProtocols when its row is pressed", async () => {
    const user = userEvent.setup();
    const { protocolsAfterUpdate } = renderStep();

    await user.click(screen.getByRole("checkbox", { name: "Uniswap v4" }));

    expect(protocolsAfterUpdate()).toEqual(["uniswap-v3-swap", "across", "uniswap-v4"]);
  });

  // @rule R19
  it("keeps the required two when a chosen protocol is removed", async () => {
    const user = userEvent.setup();
    const { protocolsAfterUpdate } = renderStep(draftWith([], ["uniswap-v4"]));

    await user.click(screen.getByRole("checkbox", { name: "Uniswap v4" }));

    expect(protocolsAfterUpdate()).toEqual(["uniswap-v3-swap", "across"]);
  });

  // @rule R20
  it("scopes Select all to the protocols that are actually selectable", async () => {
    const user = userEvent.setup();
    const { protocolsAfterUpdate } = renderStep();

    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await user.click(screen.getByRole("checkbox", { name: "Select all" }));

    // On a hub-only mandate Aave v3 and Uniswap v4 are selectable; Uniswap v3 positions are not.
    expect(protocolsAfterUpdate()).toEqual(["uniswap-v3-swap", "across", "aave-v3", "uniswap-v4"]);
  });

  // @rule R20
  it("ticks Select all once every selectable protocol is chosen", () => {
    renderStep(draftWith([], ["aave-v3", "uniswap-v4"]));

    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  // @rule R20
  it("clears every chosen protocol when Select all is un-ticked", async () => {
    const user = userEvent.setup();
    const { protocolsAfterUpdate } = renderStep(draftWith([], ["aave-v3", "uniswap-v4"]));

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));

    expect(protocolsAfterUpdate()).toEqual(["uniswap-v3-swap", "across"]);
  });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
  // // @rule R21
  // it("marks GMX Coming soon and reports the click as a blocked intent", async () => {
  //   const user = userEvent.setup();
  //   const { update, onBlocked } = renderStep();
  //
  //   const gmx = screen.getByRole("checkbox", { name: "GMX" });
  //   expect(gmx).toHaveAttribute("aria-disabled", "true");
  //   expect(within(row("gmx")).getByText("Coming soon")).toBeInTheDocument();
  //
  //   await user.click(gmx);
  //
  //   expect(onBlocked).toHaveBeenCalledWith({
  //     step: "protocols",
  //     reason: "coming_soon",
  //     rowId: "gmx",
  //   });
  //   expect(update).not.toHaveBeenCalled();
  // });

  // @rule R21 v2
  it("disables a protocol that runs on no network of this mandate", async () => {
    // GMX was the shipped example and left with POO-2143; the branch stays, and catches any
    // protocol whose networks are all outside the draft. Here: Uniswap v4 on Robinhood Chain only,
    // against a hub-only mandate.
    const user = userEvent.setup();
    const { update, onBlocked } = renderStep(draftWith([], []), catalogV4SpokeOnly);

    const v4 = screen.getByRole("checkbox", { name: "Uniswap v4" });
    expect(v4).toHaveAttribute("aria-disabled", "true");
    expect(within(row("uniswap-v4")).getByText("Coming soon")).toBeInTheDocument();
    expect(within(row("uniswap-v4")).queryByRole("img")).not.toBeInTheDocument();

    await user.click(v4);

    expect(onBlocked).toHaveBeenCalledWith({
      step: "protocols",
      reason: "coming_soon",
      rowId: "uniswap-v4",
    });
    expect(update).not.toHaveBeenCalled();
  });

  // @rule R21 v2: the `available: false` branch stays, exercised on a catalog that turns Aave v3 off.
  it("marks a protocol the catalog turns off Coming soon and reports the click as a blocked intent", async () => {
    const user = userEvent.setup();
    const { update, onBlocked } = renderStep(draftWith([], []), catalogAaveUnavailable);

    const aave = screen.getByRole("checkbox", { name: "Aave v3" });
    expect(aave).toHaveAttribute("aria-disabled", "true");
    expect(within(row("aave-v3")).getByText("Coming soon")).toBeInTheDocument();

    await user.click(aave);

    expect(onBlocked).toHaveBeenCalledWith({
      step: "protocols",
      reason: "coming_soon",
      rowId: "aave-v3",
    });
    expect(update).not.toHaveBeenCalled();
  });

  // @rule R20 @rule R21 v2
  it("keeps a protocol the catalog turns off out of Select all", async () => {
    const user = userEvent.setup();
    const { protocolsAfterUpdate } = renderStep(draftWith([], []), catalogAaveUnavailable);

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));

    expect(protocolsAfterUpdate()).toEqual(["uniswap-v3-swap", "across", "uniswap-v4"]);
  });

  // @rule R22
  it("never says via Across outside the Across row", () => {
    renderStep(draftWith(["robinhood"], ["aave-v3", "uniswap-v4"]));

    expect(document.body.textContent).not.toContain("via Across");
  });

  // @rule R12
  it("fills a chosen protocol with the raised surface", () => {
    renderStep(draftWith([], ["uniswap-v4"]));

    expect(screen.getByRole("checkbox", { name: "Uniswap v4" }).className).toContain(
      "bg-surface-raised",
    );
    expect(screen.getByRole("checkbox", { name: "Aave v3" }).className).not.toContain(
      "bg-surface-raised",
    );
  });

  /**
   * As on step 1: the refusal is counted, and the row already explains itself.
   *
   * "Pick at least one to continue." answered a click on GMX by telling the manager to pick
   * something, which is what they had just tried to do, about a row the product cannot offer at all.
   * The event is the half that has to survive, because "which protocol did managers keep trying to
   * add" is the only question this screen can answer for the roadmap. GMX left with POO-2143, so the
   * disabled row here is Uniswap v4 on a catalog that runs it on Robinhood Chain only.
   */
  // @rule R21 v2
  it("answers a Coming soon click with the event only, never with Pick at least one", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    const onBlocked = vi.fn();
    const draft = draftWith([], []);
    const { rerender } = renderWithProviders(
      <ProtocolsStep
        draft={draft}
        catalog={catalogV4SpokeOnly}
        update={update}
        block={null}
        onBlocked={onBlocked}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: "Uniswap v4" }));

    expect(onBlocked).toHaveBeenCalledWith({
      step: "protocols",
      reason: "coming_soon",
      rowId: "uniswap-v4",
    });
    rerender(
      <ProtocolsStep
        draft={draft}
        catalog={catalogV4SpokeOnly}
        update={update}
        block={{ step: "protocols", reason: "coming_soon", rowId: "uniswap-v4" }}
        onBlocked={onBlocked}
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Pick at least one to continue.")).not.toBeInTheDocument();
    expect(screen.getAllByText("Coming soon").length).toBeGreaterThan(0);
  });

  it("shows the inline notice only when the block belongs to this step", () => {
    const { unmount } = renderWithProviders(
      <ProtocolsStep
        draft={draftWith([], [])}
        catalog={catalog}
        update={vi.fn()}
        block={{ step: "networks", reason: "nothing_selected", rowId: null }}
        onBlocked={vi.fn()}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    renderWithProviders(
      <ProtocolsStep
        draft={draftWith([], [])}
        catalog={catalog}
        update={vi.fn()}
        block={{ step: "protocols", reason: "nothing_selected", rowId: null }}
        onBlocked={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one to continue.");
  });
});
