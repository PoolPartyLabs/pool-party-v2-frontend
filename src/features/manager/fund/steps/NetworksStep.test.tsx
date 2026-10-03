/**
 * @id PP-MGR-CMP-035
 * @name NetworksStep.test
 * @implements-rules-version v2 (POO-2142 rules v2)
 * @analytics-events none, the shell emits
 *
 * POO-2123 [R10] / [R12] / [R15] / [R16] / [R17], epic POO-2119. Mandate step 1. Rules v2
 * (POO-2142, buildathon scope): the one spoke is Robinhood Chain, always available, and no network
 * row renders "Coming soon".
 *
 * The reducer is `PP-MGR-LIB-019`'s and already tested there, so these cases assert what the SCREEN
 * does: which rows it draws, which of them can be pressed, and what it hands `update` and
 * `onBlocked`. `update` is called with the reducer function, so each case applies it to the draft it
 * rendered and asserts the resulting network list, which keeps the screen honest about the reducer
 * it chose without re-testing the reducer's own invariants.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog } from "../mandateCatalog";
import { createEmptyDraft, type MandateDraft, type NetworkId } from "../mandateDraft";
import { NetworksStep } from "./NetworksStep";

const catalog = buildMandateCatalog();
// PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
// /** Every spoke off, so nothing but the hub is in the mandate. */
// const catalogNoSpokes = buildMandateCatalog({ robinhoodChain: false });

function draftWith(networks: NetworkId[]): MandateDraft {
  const empty = createEmptyDraft("2026-10-03T00:00:00.000Z", "draft-1");
  return { ...empty, networks: ["arbitrum", ...networks.filter((n) => n !== "arbitrum")] };
}

/** Render the step and expose the reducer the screen last handed to `update`. */
function renderStep(
  options: { draft?: MandateDraft; catalog?: ReturnType<typeof buildMandateCatalog> } = {},
) {
  const draft = options.draft ?? draftWith([]);
  const update = vi.fn();
  const onBlocked = vi.fn();
  renderWithProviders(
    <NetworksStep
      draft={draft}
      catalog={options.catalog ?? catalog}
      update={update}
      block={null}
      onBlocked={onBlocked}
    />,
  );
  /** Apply whatever reducer the screen passed to `update`, and read the networks out. */
  const networksAfterUpdate = () => {
    const reducer = update.mock.calls.at(-1)?.[0] as (d: MandateDraft) => MandateDraft;
    return reducer(draft).networks;
  };
  return { draft, update, onBlocked, networksAfterUpdate };
}

describe("NetworksStep", () => {
  // @rule R15
  it("shows the hub locked, with its caption, and offers no way to remove it", () => {
    renderStep();

    expect(screen.getByText("Hub")).toBeInTheDocument();
    expect(screen.getByText("Arbitrum")).toBeInTheDocument();
    expect(
      screen.getByText("Deposits and withdrawals happen on this network."),
    ).toBeInTheDocument();
    expect(screen.getByText("Always included")).toBeInTheDocument();
    // Every checkbox on this screen is a spoke or Select all; the hub has none.
    expect(screen.queryByRole("checkbox", { name: "Arbitrum" })).not.toBeInTheDocument();
  });

  // @rule R16 v2
  it("lists Robinhood Chain as the one spoke under its own group head", () => {
    renderStep();

    expect(screen.getByText("Other networks")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Robinhood Chain" })).toBeInTheDocument();
    // Base, Polygon and Unichain are no longer offered (POO-2142).
    for (const name of ["Base", "Polygon", "Unichain"]) {
      expect(screen.queryByRole("checkbox", { name })).not.toBeInTheDocument();
    }
  });

  // @rule R16
  it("adds an available spoke through withNetworks when its row is pressed", async () => {
    const user = userEvent.setup();
    const { update, networksAfterUpdate } = renderStep();

    await user.click(screen.getByRole("checkbox", { name: "Robinhood Chain" }));

    expect(update).toHaveBeenCalledTimes(1);
    expect(networksAfterUpdate()).toEqual(["arbitrum", "robinhood"]);
  });

  // @rule R16
  it("removes a selected spoke when its row is pressed again", async () => {
    const user = userEvent.setup();
    const { update, networksAfterUpdate } = renderStep({ draft: draftWith(["robinhood"]) });

    const row = screen.getByRole("checkbox", { name: "Robinhood Chain" });
    expect(row).toHaveAttribute("aria-checked", "true");
    await user.click(row);

    expect(update).toHaveBeenCalledTimes(1);
    expect(networksAfterUpdate()).toEqual(["arbitrum"]);
  });

  // @rule R16
  it("ticks Select all only when every AVAILABLE spoke is in the mandate", () => {
    const { unmount } = renderWithProviders(
      <NetworksStep
        draft={draftWith([])}
        catalog={catalog}
        update={vi.fn()}
        block={null}
        onBlocked={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    unmount();

    // Robinhood Chain is the only available spoke, so it alone satisfies "all".
    renderWithProviders(
      <NetworksStep
        draft={draftWith(["robinhood"])}
        catalog={catalog}
        update={vi.fn()}
        block={null}
        onBlocked={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  // @rule R16
  it("selects every available spoke, and never an unavailable one, from Select all", async () => {
    const user = userEvent.setup();
    const { networksAfterUpdate } = renderStep();

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));

    expect(networksAfterUpdate()).toEqual(["arbitrum", "robinhood"]);
  });

  // @rule R16
  it("clears every spoke when Select all is un-ticked, keeping the hub", async () => {
    const user = userEvent.setup();
    const { networksAfterUpdate } = renderStep({ draft: draftWith(["robinhood"]) });

    await user.click(screen.getByRole("checkbox", { name: "Select all" }));

    expect(networksAfterUpdate()).toEqual(["arbitrum"]);
  });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // // @rule R16
  // it("offers no Select all when no spoke is available at all", () => {
  //   renderStep({ catalog: catalogNoSpokes });
  //
  //   expect(screen.queryByRole("checkbox", { name: "Select all" })).not.toBeInTheDocument();
  // });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // // @rule R17
  // it("marks an unavailable spoke Coming soon and reports the click as a blocked intent", async () => {
  //   const user = userEvent.setup();
  //   const { update, onBlocked } = renderStep();
  //
  //   const base = screen.getByRole("checkbox", { name: "Base" });
  //   expect(base).toHaveAttribute("aria-disabled", "true");
  //   expect(base).toHaveAttribute("data-mandate-row", "base");
  //
  //   await user.click(base);
  //
  //   expect(onBlocked).toHaveBeenCalledWith({
  //     step: "networks",
  //     reason: "coming_soon",
  //     rowId: "base",
  //   });
  //   expect(update).not.toHaveBeenCalled();
  // });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // // @rule R17
  // it("turns Robinhood Chain into Coming soon when its flag is off", () => {
  //   renderStep({ catalog: catalogNoSpokes });
  //
  //   expect(screen.getByRole("checkbox", { name: "Robinhood Chain" })).toHaveAttribute(
  //     "aria-disabled",
  //     "true",
  //   );
  //   // Four spokes, four "Coming soon" pills.
  //   expect(screen.getAllByText("Coming soon")).toHaveLength(4);
  // });

  // @rule R17 v2
  it("offers Robinhood Chain as selectable, and renders no Coming soon row", async () => {
    const user = userEvent.setup();
    const { update, onBlocked } = renderStep();

    const robinhood = screen.getByRole("checkbox", { name: "Robinhood Chain" });
    expect(robinhood).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();

    await user.click(robinhood);

    expect(update).toHaveBeenCalledTimes(1);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  // @rule R12
  it("fills a selected spoke with the raised surface", () => {
    const { unmount } = renderWithProviders(
      <NetworksStep
        draft={draftWith(["robinhood"])}
        catalog={catalog}
        update={vi.fn()}
        block={null}
        onBlocked={vi.fn()}
      />,
    );
    const selected = screen.getByRole("checkbox", { name: "Robinhood Chain" });
    expect(selected.className).toContain("bg-surface-raised");
    unmount();

    renderStep();
    const unselected = screen.getByRole("checkbox", { name: "Robinhood Chain" });
    expect(unselected.className).not.toContain("bg-surface-raised");
  });

  // @rule R10
  it("names every network logo it draws", () => {
    renderStep();

    for (const name of ["Arbitrum", "Robinhood Chain"]) {
      expect(screen.getByRole("img", { name })).toHaveAttribute("title", name);
    }
  });

  // PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
  // /**
  //  * A refused click is counted, and says nothing it has not already said.
  //  *
  //  * The only block this step can raise is `coming_soon` from a disabled row, and that row already
  //  * carries its "Coming soon" pill. Answering it with "Pick at least one to continue." tells the
  //  * manager to do the thing they just tried, about a row that is not the problem; the blocked-intent
  //  * event is the part that has to happen, and it goes through `onBlocked` either way.
  //  */
  // // @rule R17
  // it("answers a Coming soon click with the event only, never with Pick at least one", async () => {
  //   const user = userEvent.setup();
  //   const update = vi.fn();
  //   const onBlocked = vi.fn();
  //   const draft = draftWith([]);
  //   const { rerender } = renderWithProviders(
  //     <NetworksStep
  //       draft={draft}
  //       catalog={catalog}
  //       update={update}
  //       block={null}
  //       onBlocked={onBlocked}
  //     />,
  //   );
  //
  //   await user.click(screen.getByRole("checkbox", { name: "Base" }));
  //
  //   expect(onBlocked).toHaveBeenCalledWith({
  //     step: "networks",
  //     reason: "coming_soon",
  //     rowId: "base",
  //   });
  //   // The shell hands the refusal straight back as `block`, which is the render that matters.
  //   rerender(
  //     <NetworksStep
  //       draft={draft}
  //       catalog={catalog}
  //       update={update}
  //       block={{ step: "networks", reason: "coming_soon", rowId: "base" }}
  //       onBlocked={onBlocked}
  //     />,
  //   );
  //
  //   expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  //   expect(screen.queryByText("Pick at least one to continue.")).not.toBeInTheDocument();
  //   // The pill is where "not yet" is said, and it is still said.
  //   expect(screen.getAllByText("Coming soon").length).toBeGreaterThan(0);
  // });

  it("shows the inline notice only when the block belongs to this step", () => {
    const { unmount } = renderWithProviders(
      <NetworksStep
        draft={draftWith([])}
        catalog={catalog}
        update={vi.fn()}
        block={{ step: "protocols", reason: "nothing_selected", rowId: null }}
        onBlocked={vi.fn()}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();

    renderWithProviders(
      <NetworksStep
        draft={draftWith([])}
        catalog={catalog}
        update={vi.fn()}
        block={{ step: "networks", reason: "nothing_selected", rowId: null }}
        onBlocked={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Pick at least one to continue.");
  });
});
