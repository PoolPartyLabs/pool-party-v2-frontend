/**
 * @id PP-MGR-SCR-004
 * @name StrategyManageView.test
 * Behavior (POO-181): renders the manage detail (performance + period tabs, range, activity,
 * operations, investors); out-of-range shows the alert + a disabled Move Range; Show in Strategies list
 * and Pause deposits are disabled with a coming-soon hint (POO-738, no backend yet); Collect and Close
 * run through the ConfirmDialog and mutate the session state (collect zeroes the claimable + toasts);
 * drafts and closed strategies collapse to their special states; the share link copies to the clipboard.
 */
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagerStrategyDetail } from "@/lib/schemas";
import { resetMockManagerState } from "@/lib/services";
import { managerStrategyDetails } from "@/mocks/data/manager";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { StrategyManageView } from "./StrategyManageView";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));

const toastSuccess = vi.fn();
vi.mock("@/components/ui/Toast", () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args) },
}));

// The post-write refresh calls server actions (revalidate*) that need a request scope; stub it so
// these UI tests don't emit unhandled rejections. Its wiring is covered by the *Refresh test.
vi.mock("@/lib/tx/usePostWriteRefresh", () => ({ usePostWriteRefresh: () => vi.fn() }));

// POO-901 [R2]: the share link is referral-aware (useReferral is module-cached shared state; the
// mock program starts code-less). Pin the code per test so the link is deterministic.
const referral = vi.hoisted(() => ({ code: null as string | null }));
vi.mock("@/features/rewards/useReferral", () => ({
  useReferral: () => ({ program: { code: referral.code }, createCode: vi.fn() }),
}));

/** Looks up a detail fixture by id (throws on typos so tests fail loudly). */
function fixture(id: string): ManagerStrategyDetail {
  const found = managerStrategyDetails.find((detail) => detail.id === id);
  if (!found) throw new Error(`missing fixture ${id}`);
  return structuredClone(found);
}

/** Stateful harness mirroring the console: mutations re-render the view. */
function Harness({ initial }: { initial: ManagerStrategyDetail }) {
  const [detail, setDetail] = useState(initial);
  return <StrategyManageView detail={detail} onBack={vi.fn()} onDetailChange={setDetail} />;
}

beforeEach(() => resetMockManagerState());
afterEach(() => {
  push.mockClear();
  toastSuccess.mockClear();
  referral.code = null;
});

describe("StrategyManageView", () => {
  it("names the selected window on the AUM change pill (POO-555 R3 / POO-558 R3)", () => {
    // POO-558 R3: the pill is now PERIOD-AWARE — it reads the selected tab's change (default 30D)
    // and names its window. On the date-less stable-yield fixture the default 30D slice rises
    // 0.9 -> 1 = +11.1%, and the label is the 30D tab. (POO-555's fixed-30d affix is superseded.)
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    expect(screen.getByText("+11.1% · 30D")).toBeInTheDocument();
  });

  it("renders performance, range, activity, operations and investors; period tabs switch (R3)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    for (const heading of ["AUM", "Range", "Recent activity", "Operations", "Investors"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByRole("tab", { name: "30D" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "7D" }));
    expect(screen.getByRole("tab", { name: "7D" })).toHaveAttribute("aria-selected", "true");
    // Fixed pool + investor counts from the fixture.
    expect(screen.getByText(/USDC\/DAI/)).toBeInTheDocument();
    expect(screen.getByText("880")).toBeInTheDocument();
  });

  // POO-897 R1: the managed variant's Composition card carries the same per-token proportion the
  // Allocation card computes (the allocation split is passed through to SinglePoolProspectus).
  // POO-903: the card starts collapsed, so the split asserts after expanding its header.
  it("[POO-897 R1] shows the allocation token split in the Composition card", () => {
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    fireEvent.click(screen.getByRole("button", { name: /Composition/ }));
    const composition = screen.getByText("Composition").closest("section") as HTMLElement;
    // stable-yield's allocation: USDC 51 / DAI 49: mirrored in Composition (consistent card).
    expect(within(composition).getByText("51%")).toBeInTheDocument();
    expect(within(composition).getByText("49%")).toBeInTheDocument();
    expect(within(composition).queryByText("Liquidity pool")).toBeNull();
  });

  // POO-897 R4: no allocation (missing reserves) -> the honest single "Liquidity pool 100%" row.
  it("[POO-897 R4] keeps the single 'Liquidity pool 100%' row when the allocation is absent", () => {
    const detail = fixture("stable-yield");
    detail.allocation = undefined;
    renderWithProviders(<Harness initial={detail} />);
    fireEvent.click(screen.getByRole("button", { name: /Composition/ }));
    const composition = screen.getByText("Composition").closest("section") as HTMLElement;
    expect(within(composition).getByText("Liquidity pool")).toBeInTheDocument();
  });

  it("shows the out-of-range alert and Move range as a live rail action (R4 / POO-286 R2)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("momentum")} />);
    expect(screen.getByText(/Out of range/)).toBeInTheDocument();
    expect(screen.getByText(/stopped earning fees/)).toBeInTheDocument();
    // The RangeCard stub is gone — Move range is a regular Operations-rail button opening the
    // POO-242 modal.
    const moveRange = screen.getByRole("button", { name: "Move range" });
    expect(moveRange).toBeEnabled();
    await user.click(moveRange);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // POO-738: listing on the public Strategies page has no backend yet (POO-314), so the switch is
  // soft-disabled with a coming-soon hint (was: toggles through the service, R6). Soft-disabled
  // (aria-disabled, NOT native `disabled`) keeps it keyboard-focusable so the hint stays reachable.
  it("soft-disables Show in Strategies list, keeping it keyboard-focusable (coming soon, POO-738)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    const toggle = screen.getByRole("switch", { name: "Show in Strategies list" });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).not.toBeDisabled(); // stays in the tab order for the focus-triggered hint
    // Clicking is inert: the aria-checked state does not flip.
    const before = toggle.getAttribute("aria-checked");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", before ?? "");
  });

  // POO-738: pausing/resuming deposits has no backend yet (POO-314), so the control is soft-disabled
  // with a coming-soon hint and never opens the confirm dialog (was: pauses through the ConfirmDialog,
  // R6). aria-disabled (not native `disabled`) keeps it focusable so the hint stays keyboard-reachable.
  it("soft-disables Pause deposits, keeping it keyboard-focusable (coming soon, POO-738)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    const pause = screen.getByRole("button", { name: "Pause deposits" });
    expect(pause).toHaveAttribute("aria-disabled", "true");
    expect(pause).not.toBeDisabled();
    // Clicking never opens the confirm dialog (the action is inert).
    await user.click(pause);
    expect(screen.queryByText("Pause deposits?")).toBeNull();
  });

  it("collects fees through the investor Collect dialog and zeroes the claimable (POO-286 R1)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    await user.click(screen.getByRole("button", { name: "Collect fees" }));
    // The shared PP-STR-MOD-003 dialog, fed with the strategy's claimable fees.
    expect(await screen.findByText("Collect yield")).toBeInTheDocument();
    // "Available to collect" now appears in both the dialog and the Your-allocation card.
    expect(screen.getAllByText("Available to collect").length).toBeGreaterThanOrEqual(1);
    // POO-615: the CTA starts the build → a Review pause → the Review approve → signing.
    await user.click(screen.getByRole("button", { name: "Collect $312.40" }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Collect $312.40" }));
    // The success view is the feedback — no toast (the mutation ran during "pending"). POO-802 R8
    // removed the "$X was added to your balance" body; the receipt now labels the figure
    // "Amount Received".
    expect(
      await screen.findByText("Amount Received", undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Done" }));
    // Claimable is now zero → Collect disables.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Collect fees" })).toBeDisabled(),
    );
  });

  it("closes the strategy: warning → review → confirmed (POO-388 R2/R6/R9)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    // The danger "Close strategy" first shows the warning.
    await user.click(screen.getByRole("button", { name: "Close strategy" }));
    // POO-804 R3: the close warning carries the shared confirm copy (investors note + Continue?).
    expect(screen.getByText(/all investors. liquidity will be removed/)).toBeInTheDocument();
    // Confirming the warning opens the review (not the amount form): full balance, $0.00 remaining.
    await user.click(screen.getByRole("button", { name: "Continue" }));
    const modal = await screen.findByRole("dialog");
    // POO-596 handshake: the form CTA builds asynchronously before the Review renders, so await it.
    expect(await within(modal).findByText("Amount requested")).toBeInTheDocument();
    // POO-803 R5/R7: the shared Review card dropped the "You'll receive at least" / "Remaining
    // invested" rows. POO-923 R3: the pair-forced close swaps nothing, so the "after fees" caption
    // is dropped too (with no arrival line on the close, the footer is empty).
    expect(within(modal).queryByText(/after fees/)).toBeNull();
    expect(within(modal).queryByText("You'll receive at least")).toBeNull();
    expect(within(modal).queryByText("Remaining invested")).toBeNull();
    expect(within(modal).queryByLabelText("Amount to withdraw")).toBeNull();
    // The review CTA runs the close, landing on the Confirmed screen (unique body copy).
    await user.click(within(modal).getByRole("button", { name: "Close strategy" }));
    expect(await within(modal).findByText(/on the way/)).toBeInTheDocument();
    // Done applies the close to the dashboard.
    await user.click(within(modal).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByText(/This strategy is closed/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Pause deposits" })).toBeNull();
    // POO-738: the listing switch is coming-soon in every state (soft-disabled: aria-disabled, inert,
    // yet keyboard-focusable), so a closed strategy shows it aria-disabled rather than native-disabled.
    expect(screen.getByRole("switch", { name: "Show in Strategies list" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("renders the closed read-only state (R9)", () => {
    renderWithProviders(<Harness initial={fixture("btc-weekender")} />);
    expect(screen.getByText(/This strategy is closed/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close strategy" })).toBeNull();
  });

  it("renders the draft notice and routes to the builder (R8)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-plus")} />);
    expect(screen.getByText("This strategy is a draft")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Operations" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Continue setup" }));
    expect(push).toHaveBeenCalledWith("/manager/new");
  });

  it("shows the manager's allocation + available-to-collect in its own card (POO-361)", async () => {
    const user = userEvent.setup();
    const detail = fixture("stable-yield");
    expect(detail.managerStakeUsd).toBe(1420.5);
    renderWithProviders(<Harness initial={detail} />);
    // "Your allocation" is now its own card (split out of Investors), with Available to collect.
    expect(screen.getByRole("heading", { name: "Your allocation" })).toBeInTheDocument();
    expect(screen.getByText("Available to collect")).toBeInTheDocument();
    // Manager values are masked by default — reveal them with the eye, then the real stake shows.
    await user.click(screen.getByRole("button", { name: "Hide values" }));
    expect(screen.getByText("$1,420.50")).toBeInTheDocument();
  });

  // @rule R5 (POO-548): a small, real accrued fee (the mapper now sources claimableFeesUsd from
  // totalYield when uncollectedFeesUsd is present-but-zero) shows in "Available to collect" and
  // enables Collect — the exact scenario that used to read $0.00 with Collect disabled.
  it("[POO-548 R5] a totalYield-sourced fee shows in Available to collect and enables Collect", async () => {
    const user = userEvent.setup();
    const detail = fixture("stable-yield");
    detail.claimableFeesUsd = 0.02;
    renderWithProviders(<Harness initial={detail} />);
    // Collect is enabled (not gated to $0).
    expect(screen.getByRole("button", { name: "Collect fees" })).toBeEnabled();
    // Reveal masked values → the allocation card's Available-to-collect shows the real figure.
    await user.click(screen.getByRole("button", { name: "Hide values" }));
    expect(screen.getByText("$0.02")).toBeInTheDocument();
  });

  // POO-656 (murilo): the Range card leads; the About description drops below the composition.
  it("[POO-656] renders the Range card before the About card", () => {
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    const range = screen.getByRole("heading", { name: "Range" });
    const about = screen.getByRole("heading", { name: "About this strategy" });
    // Range precedes About in the DOM (About FOLLOWS Range).
    expect(range.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the About, Composition and Investment mandate cards (murilo 2026-06-29)", () => {
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    // About — the manager's description, moved out of the header into a card.
    expect(screen.getByRole("heading", { name: "About this strategy" })).toBeInTheDocument();
    // Composition: since POO-897 the card shows the per-token proportion (the allocation split:
    // USDC 51 / DAI 49 on stable-yield) instead of the old single "Liquidity pool" item.
    // POO-903: both prospectus cards start collapsed, so the bodies assert after expanding.
    expect(screen.getByRole("heading", { name: "Composition" })).toBeInTheDocument();
    expect(screen.queryByText("Liquidity pool")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Investment mandate/ }));
    // Investment mandate — derived from the pool: the pair tokens + Uniswap v3. Scoped to the mandate
    // card: since POO-563 the Allocation card also shows a "Uniswap v3" protocol row, so an unscoped
    // getByText would match both.
    const mandateCard = screen
      .getByRole("heading", { name: "Investment mandate" })
      .closest("section");
    expect(mandateCard).not.toBeNull();
    expect(within(mandateCard as HTMLElement).getByText("Uniswap v3")).toBeInTheDocument();
  });

  it("makes cards collapsible while Performance stays open", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    // Performance is not a collapse toggle (its heading is not a button).
    expect(screen.queryByRole("button", { name: /^Performance/ })).toBeNull();
    // The Range card collapses from its header.
    const range = screen.getByRole("button", { name: /^Range/ });
    expect(range).toHaveAttribute("aria-expanded", "true");
    await user.click(range);
    expect(range).toHaveAttribute("aria-expanded", "false");
  });

  // POO-518 R2 (runtime bug): in mock mode a move-range success used to close the modal with no
  // feedback — the view refetched a detail whose range the mock service never changed, so the Range
  // card kept the old band. The onMoved patch path must run here too: the applied bounds land on the
  // open detail and the in/out-of-range status re-derives.
  it("[POO-518 R2] a move-range updates the Range card band in mock mode", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("momentum")} />);
    // momentum starts out of range (band 3,300 - 3,900 vs current 3,120.5).
    expect(screen.getByText(/Out of range/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Move range" }));
    const dialog = await screen.findByRole("dialog");
    // A ±10% band around the current price straddles it → the position returns to range.
    await user.click(within(dialog).getByRole("button", { name: "±10%" }));
    await user.click(within(dialog).getByRole("button", { name: "Move range" }));
    // POO-597 handshake: the form CTA builds asynchronously before the Review CTA renders.
    await user.click(await within(dialog).findByRole("button", { name: "Confirm & move range" }));

    // The mock steps walk (~0.7s), the modal closes, and the Range card reflects the new band.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 4000 });
    await waitFor(() => expect(screen.getAllByText(/In range/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Out of range/)).toBeNull();
    expect(screen.queryByText(/stopped earning fees/)).toBeNull();
  });

  // POO-518 R2: a FULL move flips the Range card to its existing full-range representation (min/max
  // read "Full range", always in range) in mock mode too.
  it("[POO-518 R2] a full move flips the Range card to the full-range representation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("momentum")} />);
    // Reveal the masked manager values so the min/max readings are assertable.
    await user.click(screen.getByRole("button", { name: "Hide values" }));
    expect(screen.getByText("3,300")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Move range" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Full" }));
    await user.click(within(dialog).getByRole("button", { name: "Move range" }));
    // POO-597 handshake: the form CTA builds asynchronously before the Review CTA renders.
    await user.click(await within(dialog).findByRole("button", { name: "Confirm & move range" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 4000 });
    // Min and max both read "Full range"; the old band is gone and the status flips to in range.
    await waitFor(() => expect(screen.getAllByText("Full range").length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText("3,300")).toBeNull();
    expect(screen.getAllByText(/In range/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Out of range/)).toBeNull();
  });

  // POO-649: the share pill deep-links the PUBLIC strategy page (`/strategies/<publicStrategyId>`),
  // not the private console id under `/m/<handle>/` (which had no route → 404). stable-yield maps to
  // the resolvable catalog id strat-treasury-plus.
  // @rule R1: the copied share link is the public `/strategies/<publicStrategyId>` URL.
  it("copies the public strategy share link and toasts (R2 / POO-649)", async () => {
    const user = userEvent.setup();
    const detail = fixture("stable-yield");
    expect(detail.publicStrategyId).toBe("strat-treasury-plus");
    renderWithProviders(<Harness initial={detail} />);
    await user.click(
      screen.getByRole("button", { name: /pool-party\.xyz\/strategies\/strat-treasury-plus/ }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Link copied"));
    expect(await window.navigator.clipboard.readText()).toBe(
      "https://app.pool-party.xyz/strategies/strat-treasury-plus",
    );
  });

  // POO-901 [R2]: once the manager has created a referral code the share pill deep-links the SAME
  // public strategy page with the sharer's ?ref=<code> appended (strategyReferralUrl — the owned
  // StrategyDetailScreen precedent); the copy writes the currently resolved URL ([R5]).
  it("[POO-901 R2] appends ?ref=<code> to the share link when the manager has a referral code", async () => {
    referral.code = "MARIA2026";
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={fixture("stable-yield")} />);
    await user.click(
      screen.getByRole("button", {
        name: /strategies\/strat-treasury-plus\?ref=MARIA2026/,
      }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Link copied"));
    expect(await window.navigator.clipboard.readText()).toBe(
      "https://app.pool-party.xyz/strategies/strat-treasury-plus?ref=MARIA2026",
    );
  });

  // @rule POO-750 R1/R5: "View on Uniswap" targets the position NFT (positions/v3), not the pool.
  it("[POO-750] links View on Uniswap to the Uniswap v3 position", () => {
    const detail = fixture("stable-yield");
    detail.pool = { ...detail.pool, network: "arbitrum", nftPositionId: "115990" };
    renderWithProviders(<Harness initial={detail} />);
    expect(screen.getByRole("link", { name: "View on Uniswap" })).toHaveAttribute(
      "href",
      "https://app.uniswap.org/positions/v3/arbitrum/115990",
    );
  });

  // @rule POO-750 R4: with no position NFT id (pending/closed), the link is hidden — never the pool URL.
  it("[POO-750] hides View on Uniswap when the position NFT id is absent", () => {
    const detail = fixture("stable-yield");
    detail.pool = { ...detail.pool, network: "arbitrum", nftPositionId: undefined };
    renderWithProviders(<Harness initial={detail} />);
    expect(screen.queryByRole("link", { name: "View on Uniswap" })).toBeNull();
  });

  // @rule POO-750 R3: the tokenId is read FRESH from the detail (not cached), so it tracks a
  // move-range that mints a new NFT — rendering with a new nftPositionId updates the href.
  it("[POO-750] reads the position NFT id fresh from the detail when it changes", () => {
    const detail = fixture("stable-yield");
    detail.pool = { ...detail.pool, network: "arbitrum", nftPositionId: "111" };
    const { rerender } = renderWithProviders(
      <StrategyManageView detail={detail} onBack={vi.fn()} onDetailChange={vi.fn()} />,
    );
    expect(screen.getByRole("link", { name: "View on Uniswap" })).toHaveAttribute(
      "href",
      "https://app.uniswap.org/positions/v3/arbitrum/111",
    );
    const moved = { ...detail, pool: { ...detail.pool, nftPositionId: "222" } };
    rerender(<StrategyManageView detail={moved} onBack={vi.fn()} onDetailChange={vi.fn()} />);
    expect(screen.getByRole("link", { name: "View on Uniswap" })).toHaveAttribute(
      "href",
      "https://app.uniswap.org/positions/v3/arbitrum/222",
    );
  });
});
