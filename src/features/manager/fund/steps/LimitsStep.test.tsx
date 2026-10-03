/**
 * @id PP-MGR-CMP-039
 * @name LimitsStep.test
 * @implements-rules-version v2 (POO-2142 rules v2)
 * @analytics-events none, the shell emits
 *
 * POO-2126 [R6] / [R39] to [R43], epic POO-2119. Mandate step 5.
 *
 * `capRows`, `setCap` and `validateStep` belong to `PP-MGR-LIB-019` and are tested there; these
 * cases assert the screen's own decisions. Three carry real weight. R43 is asserted as ABSENCE (the
 * hub, the two required protocols and the deposit token must have no cap row), because an extra row
 * there is a cap a manager can set that nothing downstream reads. R39's unset state is asserted
 * separately from the 0% state, since "no cap record yet" and "capped at 0%" are different drafts
 * that `validateStep` treats differently and a shared rendering would hide. And R41 is asserted
 * negatively against the word "guarantee": per protocol and per token caps have no contract behind
 * them today, so the one defect that matters here is copy that implies they do.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { buildMandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  type MandateDraft,
  type MandateTokenRef,
  type StepBlock,
  tokenKey,
  validateStep,
} from "../mandateDraft";
import { LimitsStep } from "./LimitsStep";

const catalog = buildMandateCatalog();
const NOW = "2026-10-03T00:00:00.000Z";

/** The two unlocked tokens the Figma shows, as the draft stores them. */
const WETH: MandateTokenRef = {
  address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  symbol: "WETH",
  name: "Ether",
  network: "arbitrum",
  logoUrl: null,
  locked: false,
};
const WBTC: MandateTokenRef = {
  address: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f",
  symbol: "WBTC",
  name: "Wrapped Bitcoin",
  network: "arbitrum",
  logoUrl: null,
  locked: false,
};

/** Hub only, required protocols only, deposit token only: every group is empty. */
function emptyDraft(): MandateDraft {
  return createEmptyDraft(NOW, "draft-1");
}

/**
 * The draft the Figma frame draws, seeded directly. The frame also shows Base with No cap; the
 * mandate no longer offers Base (rules v2, POO-2142), so the No cap row here is Uniswap v4's.
 */
function figmaDraft(overrides: Partial<MandateDraft> = {}): MandateDraft {
  const base = emptyDraft();
  return {
    ...base,
    networks: ["arbitrum", "robinhood"],
    protocols: ["uniswap-v3-swap", "across", "aave-v3", "uniswap-v3", "uniswap-v4"],
    tokens: [...base.tokens, WETH, WBTC],
    caps: {
      networks: {
        arbitrum: { noCap: true, pct: 0 },
        robinhood: { noCap: false, pct: 40 },
      },
      protocols: {
        "aave-v3": { noCap: false, pct: 60 },
        "uniswap-v3": { noCap: false, pct: 35 },
        "uniswap-v4": { noCap: true, pct: 0 },
      },
      tokens: {
        [tokenKey(WETH)]: { noCap: false, pct: 60 },
        [tokenKey(WBTC)]: { noCap: true, pct: 0 },
      },
    },
    ...overrides,
  };
}

/** Render the step and expose the reducer the screen last handed to `update`. */
function renderStep(draft: MandateDraft = figmaDraft(), block: StepBlock | null = null) {
  const update = vi.fn();
  const onBlocked = vi.fn();
  const view = renderWithProviders(
    <LimitsStep
      draft={draft}
      catalog={catalog}
      update={update}
      block={block}
      onBlocked={onBlocked}
    />,
  );
  const draftAfterUpdate = () => {
    const reducer = update.mock.calls.at(-1)?.[0] as (d: MandateDraft) => MandateDraft;
    return reducer(draft);
  };
  const capsAfterUpdate = () => draftAfterUpdate().caps;
  return { ...view, draft, update, onBlocked, capsAfterUpdate, draftAfterUpdate };
}

/** The row with this `data-mandate-row`, whatever shape it took. */
function row(id: string): HTMLElement {
  const found = document.querySelector(`[data-mandate-row="${id}"]`);
  if (!found) throw new Error(`no row ${id}`);
  return found as HTMLElement;
}

beforeAll(() => {
  // jsdom implements no layout, so `scrollIntoView` does not exist on Element at all (R6 calls it).
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LimitsStep", () => {
  // @rule R39
  it("renders the three groups with their heads and captions", () => {
    renderStep();

    expect(screen.getByText("Per network")).toBeInTheDocument();
    expect(screen.getByText("Max share of capital on each network · 5% steps")).toBeInTheDocument();
    expect(screen.getByText("Per protocol")).toBeInTheDocument();
    expect(
      screen.getByText("Max share of capital in each protocol · 5% steps"),
    ).toBeInTheDocument();
    expect(screen.getByText("Per token")).toBeInTheDocument();
    expect(
      screen.getByText("Max share of capital held in each token · 5% steps"),
    ).toBeInTheDocument();
  });

  // @rule R43
  it("takes its rows from capRows: spokes, chosen protocols and unlocked tokens only", () => {
    renderStep();

    for (const id of [
      "robinhood",
      "aave-v3",
      "uniswap-v3",
      "uniswap-v4",
      tokenKey(WETH),
      tokenKey(WBTC),
    ]) {
      expect(row(id)).toBeInTheDocument();
    }
  });

  // @rule R43
  it("gives no cap row to the required protocols or to the deposit token", () => {
    const draft = figmaDraft();
    renderStep(draft);

    const deposit = draft.tokens.find((token) => token.locked);
    if (!deposit) throw new Error("the draft lost its deposit token");

    for (const id of ["uniswap-v3-swap", "across", tokenKey(deposit)]) {
      expect(document.querySelector(`[data-mandate-row="${id}"]`)).toBeNull();
    }
  });

  // @rule R39
  it("captions a protocol with its kind and a token with its name", () => {
    renderStep();

    expect(within(row("aave-v3")).getByText("Lending")).toBeInTheDocument();
    expect(within(row("uniswap-v3")).getByText("Liquidity positions")).toBeInTheDocument();
    expect(within(row(tokenKey(WETH))).getByText("Ether")).toBeInTheDocument();
    expect(within(row(tokenKey(WBTC))).getByText("Wrapped Bitcoin")).toBeInTheDocument();
  });

  // @rule R39
  it("moves the slider in 5% steps and shows the value beside it", () => {
    renderStep();

    const slider = within(row("robinhood")).getByRole("slider");
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "100");
    expect(slider).toHaveAttribute("step", "5");
    expect(slider).toHaveValue("40");
    expect(slider).toHaveAttribute("aria-label", "Max share for Robinhood Chain");
    expect(slider).toHaveAttribute("aria-valuetext", "40%");
    expect(within(row("robinhood")).getByText("40%")).toBeInTheDocument();
  });

  // @rule R39
  it("writes the new share through setCap when the slider moves", () => {
    const { capsAfterUpdate } = renderStep();

    fireEvent.change(within(row("robinhood")).getByRole("slider"), { target: { value: "55" } });

    expect(capsAfterUpdate().networks.robinhood).toEqual({ noCap: false, pct: 55 });
  });

  // @rule R39
  it("writes a protocol and a token share through the same control", () => {
    const { capsAfterUpdate, update } = renderStep();

    fireEvent.change(within(row("aave-v3")).getByRole("slider"), { target: { value: "25" } });
    expect(capsAfterUpdate().protocols["aave-v3"]).toEqual({ noCap: false, pct: 25 });

    update.mockClear();
    fireEvent.change(within(row(tokenKey(WETH))).getByRole("slider"), { target: { value: "15" } });
    expect(capsAfterUpdate().tokens[tokenKey(WETH)]).toEqual({ noCap: false, pct: 15 });
  });

  // @rule R39
  it("hides the slider and the value on a No cap row", () => {
    renderStep();

    const v4 = within(row("uniswap-v4"));
    expect(v4.queryByRole("slider")).not.toBeInTheDocument();
    expect(v4.queryByText("0%")).not.toBeInTheDocument();
    expect(v4.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    expect(v4.getByText("No cap")).toBeInTheDocument();
  });

  // @rule R39
  it("ticks No cap keeping the share the row already had", async () => {
    const user = userEvent.setup();
    const { capsAfterUpdate } = renderStep();

    await user.click(within(row("robinhood")).getByRole("checkbox"));

    expect(capsAfterUpdate().networks.robinhood).toEqual({ noCap: true, pct: 40 });
  });

  // @rule R39
  it("un-ticks No cap back to the stored share", async () => {
    const user = userEvent.setup();
    const { capsAfterUpdate } = renderStep(
      figmaDraft({
        caps: {
          networks: { arbitrum: { noCap: true, pct: 0 }, robinhood: { noCap: true, pct: 40 } },
          protocols: {},
          tokens: {},
        },
      }),
    );

    await user.click(within(row("robinhood")).getByRole("checkbox"));

    expect(capsAfterUpdate().networks.robinhood).toEqual({ noCap: false, pct: 40 });
  });

  /**
   * Un-ticking a row that never had a share returns it to UNSET, not to 0%.
   *
   * The round trip is one click each way, and it used to end on `{ noCap: false, pct: 0 }`: a 0%
   * ceiling `validateStep` accepts, so Next passed and the mandate carried a cap meaning "this
   * network may hold nothing" that no manager ever chose. The row looked answered because it read
   * "0%", which is exactly the state this step's own rule says is not the same as unset.
   */
  // @rule R39
  it("un-ticks a row that never had a share back to unset, not to 0%", async () => {
    const user = userEvent.setup();
    // What the tick left behind: a record created by the checkbox on a row with no share.
    const { capsAfterUpdate, draftAfterUpdate } = renderStep(
      figmaDraft({
        caps: {
          networks: { arbitrum: { noCap: true, pct: 0 }, robinhood: { noCap: true, pct: 0 } },
          protocols: {},
          tokens: {},
        },
      }),
    );

    await user.click(within(row("robinhood")).getByRole("checkbox"));

    expect(capsAfterUpdate().networks.robinhood).toBeUndefined();
    // And the step says so again on the next Next, rather than letting a 0% cap through.
    expect(validateStep(draftAfterUpdate(), "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_missing",
      rowId: "robinhood",
    });
  });

  /**
   * [B5] A deliberate 0% does not survive a round trip through "No cap", and that is the decision.
   *
   * `toggleNoCap` reads `pct > 0` as "this row had a share before", because the draft has no third
   * field to say it any other way: `{ noCap: true, pct: 0 }` is what both a chosen 0% and an
   * untouched row leave behind, so un-ticking cannot tell them apart. Of the two readings, this one
   * fails closed. Next is refused with "Set a cap or tick No cap to continue." and the manager sets
   * the slider again; the other reading would let Next through on a 0% ceiling nobody chose, one
   * click after they said they wanted no ceiling at all.
   *
   * Pinned with the full three-click round trip, which the other un-tick cases do not cover, so a
   * later tidy-up of that comparison has to argue with a test rather than with a comment.
   */
  // @rule R39
  it("forgets a deliberate 0% cap across a No cap round trip, so Next asks again", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    let draft = figmaDraft();
    const step = (current: MandateDraft) => (
      <LimitsStep
        draft={current}
        catalog={catalog}
        update={update}
        block={null}
        onBlocked={vi.fn()}
      />
    );
    const { rerender } = renderWithProviders(step(draft));
    /** Apply what the screen last asked for, then show it the result. */
    const apply = () => {
      const reducer = update.mock.calls.at(-1)?.[0] as (d: MandateDraft) => MandateDraft;
      draft = reducer(draft);
      rerender(step(draft));
    };

    // 0% on purpose: "this network may hold nothing", which `validateStep` accepts.
    fireEvent.change(within(row("robinhood")).getByRole("slider"), { target: { value: "0" } });
    apply();
    expect(draft.caps.networks.robinhood).toEqual({ noCap: false, pct: 0 });

    await user.click(screen.getByRole("checkbox", { name: "No cap for Robinhood Chain" }));
    apply();
    expect(draft.caps.networks.robinhood).toEqual({ noCap: true, pct: 0 });

    await user.click(screen.getByRole("checkbox", { name: "No cap for Robinhood Chain" }));
    apply();

    expect(draft.caps.networks.robinhood).toBeUndefined();
    expect(validateStep(draft, "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_missing",
      rowId: "robinhood",
    });
  });

  // @rule R39
  it("un-ticks a protocol and a token row back to unset the same way", async () => {
    const user = userEvent.setup();
    const { capsAfterUpdate, update } = renderStep(
      figmaDraft({
        caps: {
          networks: { arbitrum: { noCap: true, pct: 0 } },
          protocols: { "aave-v3": { noCap: true, pct: 0 } },
          tokens: { [tokenKey(WETH)]: { noCap: true, pct: 0 } },
        },
      }),
    );

    await user.click(within(row("aave-v3")).getByRole("checkbox"));
    expect(capsAfterUpdate().protocols["aave-v3"]).toBeUndefined();

    update.mockClear();
    await user.click(within(row(tokenKey(WETH))).getByRole("checkbox"));
    expect(capsAfterUpdate().tokens[tokenKey(WETH)]).toBeUndefined();
  });

  /**
   * M8: twelve checkboxes called "No cap" are twelve controls a screen reader cannot tell apart.
   *
   * The visible text is enough on screen because the row is right beside it; the accessible name has
   * to carry the row, or the rotor lists the same control over and over and nothing says which
   * network, protocol or token each one caps.
   */
  // @rule R39
  it("names every No cap checkbox after the row it caps", () => {
    renderStep();

    expect(
      screen.getByRole("checkbox", { name: "No cap for Robinhood Chain" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "No cap for Aave v3" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "No cap for WETH on Arbitrum" }),
    ).toBeInTheDocument();
    // Every cap row's box is distinct, which is the whole point.
    const names = screen
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("aria-label") ?? "");
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * [B4] A token held on two networks is two cap rows, and they are not the same question.
   *
   * The rows come from the draft's token ENTRIES, one per network, so a mandate holding WETH on the
   * hub and on the spoke drew two rows called "WETH": identical on screen, and identical in the
   * accessible names of both the slider and the "No cap" box, which is a rotor listing four controls
   * and saying which one none of them belongs to. The network is now in the row and in every name.
   */
  // @rule R39
  // @rule R43
  it("tells two networks' rows for one token apart, by name and to a screen reader", () => {
    const spokeWeth: MandateTokenRef = { ...WETH, network: "robinhood" };
    renderStep(figmaDraft({ tokens: [...emptyDraft().tokens, WETH, spokeWeth] }));

    expect(within(row(tokenKey(WETH))).getByTitle("Arbitrum")).toBeInTheDocument();
    expect(within(row(tokenKey(spokeWeth))).getByTitle("Robinhood Chain")).toBeInTheDocument();

    expect(
      screen.getByRole("slider", { name: "Max share for WETH on Arbitrum" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("slider", { name: "Max share for WETH on Robinhood Chain" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "No cap for WETH on Arbitrum" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "No cap for WETH on Robinhood Chain" }),
    ).toBeInTheDocument();

    // Every control on the step, not only the two token rows: one duplicate is one too many.
    const names = [...screen.getAllByRole("slider"), ...screen.getAllByRole("checkbox")].map(
      (control) => control.getAttribute("aria-label") ?? "",
    );
    expect(new Set(names).size).toBe(names.length);
  });

  // @rule R39
  it("shows an unset row as Not set with the slider at zero and the box unticked", () => {
    renderStep(
      figmaDraft({
        caps: { networks: { arbitrum: { noCap: true, pct: 0 } }, protocols: {}, tokens: {} },
      }),
    );

    const robinhood = within(row("robinhood"));
    expect(robinhood.getByText("Not set")).toBeInTheDocument();
    expect(robinhood.queryByText("0%")).not.toBeInTheDocument();
    expect(robinhood.getByRole("slider")).toHaveValue("0");
    expect(robinhood.getByRole("slider")).toHaveAttribute("aria-valuetext", "Not set");
    expect(robinhood.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  });

  // @rule R39
  it("creates the cap record on the first interaction with an unset row", () => {
    const { capsAfterUpdate } = renderStep(
      figmaDraft({
        caps: { networks: { arbitrum: { noCap: true, pct: 0 } }, protocols: {}, tokens: {} },
      }),
    );

    fireEvent.change(within(row("robinhood")).getByRole("slider"), { target: { value: "20" } });

    expect(capsAfterUpdate().networks.robinhood).toEqual({ noCap: false, pct: 20 });
  });

  // @rule R40
  it("locks the hub row with its caption and the implicit-cap line, and gives it no control", () => {
    renderStep();

    const hub = within(row("arbitrum"));
    expect(hub.getByText("Arbitrum")).toBeInTheDocument();
    expect(hub.getByText("Hub")).toBeInTheDocument();
    expect(hub.getByText("No cap · the hub holds what is not sent elsewhere")).toBeInTheDocument();
    expect(hub.queryByRole("slider")).not.toBeInTheDocument();
    expect(hub.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // @rule R42
  it("prints the footnote once, under the three groups", () => {
    renderStep();

    expect(
      screen.getByText(
        "Caps are checked when money moves. Growth from price changes is not forced back.",
      ),
    ).toBeInTheDocument();
  });

  // @rule R43
  it("says so in a group that has nothing to cap", () => {
    renderStep(emptyDraft());

    // Hub only, required protocols only, deposit token only: all three groups are empty.
    expect(
      screen.getAllByText("Nothing to cap here: nothing was added in this group."),
    ).toHaveLength(3);
    // The hub row survives: it is the locked row, not a cap row.
    expect(row("arbitrum")).toBeInTheDocument();
  });

  // @rule R6
  it("shows the cap-missing notice and points it at the offending row", () => {
    renderStep(
      figmaDraft({
        caps: { networks: { arbitrum: { noCap: true, pct: 0 } }, protocols: {}, tokens: {} },
      }),
      { step: "limits", reason: "cap_missing", rowId: "robinhood" },
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Set a cap or tick No cap to continue.");
    expect(row("robinhood").scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(row("robinhood").className).toContain("ring-destructive/60");
    expect(row("aave-v3").className).not.toContain("ring-destructive/60");
  });

  // @rule R6
  it("drops the highlight after a second and a half", () => {
    vi.useFakeTimers();
    renderStep(figmaDraft(), { step: "limits", reason: "cap_missing", rowId: "robinhood" });

    expect(row("robinhood").className).toContain("ring-destructive/60");
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(row("robinhood").className).not.toContain("ring-destructive/60");
  });

  // @rule R6
  it("ignores a block that belongs to another step", () => {
    renderStep(figmaDraft(), { step: "pools", reason: "nothing_selected", rowId: null });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // @rule R41
  it("never presents a cap as an on-chain guarantee", () => {
    renderStep();

    const copy = document.body.textContent?.toLowerCase() ?? "";
    expect(copy).not.toContain("on-chain");
    expect(copy).not.toContain("on chain");
    expect(copy).not.toContain("guarantee");
    expect(copy).not.toContain("enforced");
  });
});
