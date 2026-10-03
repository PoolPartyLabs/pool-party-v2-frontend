/**
 * @id PP-MGR-CMP-043
 * @name CopyAddressChip.test
 * @implements-rules-version v1
 * @analytics-events none, the shell emits
 *
 * POO-2125 [R11], epic POO-2119. The copy chip the Pools step puts under every pair.
 *
 * Three of these cases are the whole point of the component. The first is that the chip copies the
 * FULL address while showing a shortened one: a manager who pastes `0x82af…1ab1` into a block
 * explorer gets nothing, so the gap between what is drawn and what is written is the defect this
 * guards. The second is that a refused clipboard leaves no success state behind: an insecure
 * context and an in-app WebView both reject the write, and a chip that said "Copied" anyway would be
 * lying about the one thing it exists to do. The third is that the acknowledgement goes away on its
 * own, because a chip stuck on Check reads as "this one is the copied one" forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";
import { CopyAddressChip } from "./CopyAddressChip";

/** A real Arbitrum USDC address, so the shortening is read off a plausible string. */
const ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

/**
 * Replace `navigator.clipboard` with a stub; jsdom ships none.
 *
 * ORDER MATTERS, and it cost a red run to find out: `userEvent.setup()` installs a clipboard stub of
 * its OWN, so a stub written before it is silently replaced and every assertion about the write then
 * reads user-event's copy. A rejecting stub installed too early looks like a successful copy, which
 * is the exact case this file exists to pin. {@link sessionWith} is the only safe order.
 */
function stubClipboard(clipboard: unknown) {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
}

/** A user session whose clipboard is ours, in the one order that survives `setup()`. */
function sessionWith(clipboard: unknown) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  stubClipboard(clipboard);
  return user;
}

/** The real `setImmediate`, read at import, before `beforeEach` installs the fake timers. */
const realSetImmediate = globalThis.setImmediate;

/**
 * One full turn of the real event loop, so React has rendered whatever the click caused.
 *
 * The chip sets `copied` in the continuation of the awaited clipboard write, never inside the click
 * itself, so React renders it from a scheduler task (a real `setImmediate`, which the scheduler
 * captured before any fake timer existed). `await user.click()` does not wait for that task: it
 * waits on a faked `setTimeout(0)` that the `shouldAdvanceTime` tick releases, and which of the two
 * runs first depends on the event-loop phase and on how late that 20 ms tick is. On a fast local
 * run the render wins. On a loaded CI runner the tick is overdue and the assertion reads the DOM
 * from before the render, which cost a red `test:coverage` run in CI (2026-10-03).
 *
 * That ordering breaks an assertion in both directions. A "Copied" expectation fails although the
 * chip is right, and a "says nothing" expectation passes although the chip may be wrong, because
 * nothing has been rendered yet either way. Both were reproduced by forcing the late ordering: a
 * mutant that said "Copied" on a refused write went through the three refusal cases green.
 *
 * Immediates run first in, first out, so one queued AFTER the click resolves only once the
 * scheduler task queued DURING the click has run. Deterministic, and no polling.
 */
function settle() {
  return act(async () => {
    await new Promise<void>((resolve) => realSetImmediate(() => resolve()));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CopyAddressChip", () => {
  // @rule R11
  it("shows the first six and the last four characters of the address", () => {
    renderWithProviders(<CopyAddressChip address={ADDRESS} />);

    expect(screen.getByRole("button")).toHaveTextContent("0xaf88…5831");
  });

  // @rule R11
  it("copies the FULL address, not the shortened one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = sessionWith({ writeText });
    renderWithProviders(<CopyAddressChip address={ADDRESS} />);

    await user.click(screen.getByRole("button"));

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
  });

  // @rule R11
  it("names itself for assistive tech with the copy-address label", () => {
    renderWithProviders(<CopyAddressChip address={ADDRESS} />);

    expect(screen.getByRole("button", { name: "Copy token address" })).toBeInTheDocument();
  });

  // @rule R11
  it("acknowledges the copy, then goes back on its own", async () => {
    const user = sessionWith({ writeText: vi.fn().mockResolvedValue(undefined) });
    renderWithProviders(<CopyAddressChip address={ADDRESS} />);

    await user.click(screen.getByRole("button"));
    // `findAllByText`: Radix draws the content plus a visually-hidden copy for assistive tech, so
    // the singular matcher throws "found multiple" on a tooltip that is working correctly.
    expect(await screen.findAllByText("Copied")).not.toHaveLength(0);

    // `act` around the advance: the reset is a `setTimeout` callback, so the state change happens
    // outside React's own batching and the assertion would otherwise read the pre-flush DOM.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.queryAllByText("Copied")).toHaveLength(0);
  });

  /**
   * The acknowledgement has to reach someone who cannot see the chip.
   *
   * A Check icon and a tooltip anchored to the trigger are both visual: the tooltip is read only if
   * focus happens to land where it opened, and the icon swap is announced by nothing at all. The
   * a11y checklist asks copy controls to announce success through a live region, so the state change
   * itself is what speaks.
   */
  // @rule R11
  it("announces the copy in a live region, not only as an icon", async () => {
    const user = sessionWith({ writeText: vi.fn().mockResolvedValue(undefined) });
    renderWithProviders(<CopyAddressChip address={ADDRESS} />);

    const live = screen.getByRole("status");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("");

    await user.click(screen.getByRole("button"));

    // Not a synchronous read: the announcement arrives with the render the write schedules, one
    // scheduler task after the click (see `settle`). `waitFor` rather than `settle` here because a
    // positive expectation can simply be polled.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  // @rule R11
  it("announces nothing when the clipboard refused the write", async () => {
    const user = sessionWith({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    renderWithProviders(<CopyAddressChip address={ADDRESS} />);

    await user.click(screen.getByRole("button"));
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  // @rule R11
  it("says nothing when the clipboard refuses the write", async () => {
    const user = sessionWith({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    renderWithProviders(<CopyAddressChip address={ADDRESS} />);

    await user.click(screen.getByRole("button"));
    await settle();

    expect(screen.queryAllByText("Copied")).toHaveLength(0);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  // @rule R11
  it("survives a browser with no clipboard at all", async () => {
    const user = sessionWith(undefined);
    renderWithProviders(<CopyAddressChip address={ADDRESS} />);

    await user.click(screen.getByRole("button"));
    await settle();

    expect(screen.queryAllByText("Copied")).toHaveLength(0);
  });
});
