/**
 * @id PP-MGR-CMP-093 (POO-2275)
 * @name ManageIdleOutputPanel tests
 * @implements-rules-version v1
 * @analytics-events none, callback-only presenter tests.
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { ManageIdleOutputPanel } from "./ManageIdleOutputPanel";
import type {
  IdleQueueAmounts,
  ManageIdleOutputOrigin,
  ManageIdleOutputRead,
} from "./manageIdleOutput";

const token = {
  chainId: 42161,
  address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  symbol: "USDC",
  decimals: 6,
};
const origin: ManageIdleOutputOrigin = { core: `0x${"a".repeat(40)}`, hubChainId: 42161, token };
function amounts(cohortId = "eligible", raw = "25000000000"): IdleQueueAmounts {
  return {
    cohortId,
    requested: { raw, cohortId },
    reserved: { raw: "10000000000", cohortId },
    stillNeeded: { raw: "15000000000", cohortId },
  };
}
function read(): ManageIdleOutputRead {
  return {
    core: origin.core,
    hubChainId: 42161,
    status: "ready",
    snapshot: {
      token,
      asOf: "2026-10-07T09:00:00Z",
      timezone: "UTC",
      freshness: "fresh",
      complete: true,
      confirmedEmpty: false,
      summary: amounts(),
      buckets: [
        {
          id: "today",
          date: "2026-10-07",
          relation: "today",
          deadlines: ["2026-10-07T18:00:00Z"],
          requestStates: ["pending"],
          amounts: amounts("today", "12000000000"),
        },
        {
          id: "overdue",
          date: "2026-10-06",
          relation: "overdue",
          deadlines: ["2026-10-06T12:00:00Z", "2026-10-06T18:00:00Z"],
          requestStates: ["partiallyPaid", "canceled", "inFlight"],
          amounts: amounts("earlier", "5000000000"),
        },
        {
          id: "later",
          date: "2026-10-21",
          relation: "later",
          deadlines: [],
          requestStates: [],
          amounts: amounts("later", "8000000000"),
        },
      ],
    },
  };
}
function render(readState = read(), onBack = vi.fn(), onRetry = vi.fn()) {
  return renderWithProviders(
    <ManageIdleOutputPanel origin={origin} read={readState} onBack={onBack} onRetry={onRetry} />,
  );
}
describe("POO-2275 inline Idle output", () => {
  // @rule R1/R4: all supplied periods/deadlines/timezone/asOf stay visible.
  it("renders exact totals, overdue/later/multiple deadlines and source request states", () => {
    render();
    expect(screen.getByRole("heading", { name: "Idle output" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Withdrawal deadlines" })).toBeInTheDocument();
    expect(screen.getByText("25,000 USDC")).toHaveClass("tabular-nums", "text-right");
    expect(screen.getByText("40% reserved")).toBeInTheDocument();
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
    expect(screen.getByText(/Later/)).toBeInTheDocument();
    expect(screen.getByText("Reserve by Oct 6, 2026, 12:00")).toBeInTheDocument();
    expect(screen.getByText("Reserve by Oct 6, 2026, 18:00")).toBeInTheDocument();
    expect(screen.getByText("Partially paid")).toBeInTheDocument();
    expect(screen.getByText("Canceled")).toBeInTheDocument();
    expect(screen.getByText("In flight")).toBeInTheDocument();
    expect(screen.getByText("Deadlines use UTC")).toBeInTheDocument();
    expect(screen.getByText(/As of/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Reserve|Confirm|Collect|Charts/ }),
    ).not.toBeInTheDocument();
  });
  // @rule R6/R7: only callbacks, no origin/draft mutation.
  it("Back calls the host once by keyboard and does not mutate the injected read", async () => {
    const onBack = vi.fn(),
      state = read(),
      before = JSON.stringify(state);
    render(state, onBack);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Back to blocks" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onBack).toHaveBeenCalledOnce();
    expect(JSON.stringify(state)).toBe(before);
  });
  it("error and Retry leave data unavailable and call only the authorized retry callback", async () => {
    const onRetry = vi.fn();
    render({ ...read(), status: "error" }, vi.fn(), onRetry);
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load withdrawal deadlines.");
    expect(screen.queryByText("25,000 USDC")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Back to blocks" })).toBeInTheDocument();
  });
  // @rule R2/R4: unavailable, loading, stale, confirmed empty are not zero.
  it.each([
    "loading",
    "unavailable",
  ] as const)("shows %s without any fabricated amount", (status) => {
    render({ ...read(), status });
    expect(screen.queryByText("25,000 USDC")).toBeNull();
    expect(screen.queryByText("0 USDC")).toBeNull();
    expect(screen.getByRole("button", { name: "Back to blocks" })).toBeInTheDocument();
    if (status === "loading") expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    else expect(screen.getByText("Withdrawal deadlines are not available.")).toBeInTheDocument();
  });
  it("shows stale state without presenting stale reserves", () => {
    const value = read();
    if (!value.snapshot) throw new Error("fixture");
    render({ ...value, snapshot: { ...value.snapshot, freshness: "stale" } });
    expect(
      screen.getByText("Withdrawal deadlines are out of date. Try again for a current snapshot."),
    ).toBeInTheDocument();
    expect(screen.queryByText("25,000 USDC")).toBeNull();
  });
  it("shows explicit empty confirmation without manufacturing zero amounts", () => {
    const value = read();
    if (!value.snapshot) throw new Error("fixture");
    render({
      ...value,
      snapshot: { ...value.snapshot, confirmedEmpty: true, buckets: [], summary: null },
    });
    expect(screen.getByText("No withdrawal requests due")).toBeInTheDocument();
    expect(screen.queryByText("0 USDC")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
  it("labels partial subtotal and leaves independent missing amount unavailable", () => {
    const value = read();
    if (!value.snapshot) throw new Error("fixture");
    render({
      ...value,
      snapshot: {
        ...value.snapshot,
        complete: false,
        summary: { ...amounts(), reserved: null, stillNeeded: null },
      },
    });
    expect(screen.getByText("Available subtotal")).toBeInTheDocument();
    const totals = document.querySelector<HTMLElement>("[data-idle-summary]");
    if (!totals) throw new Error("totals");
    expect(within(totals).getAllByText("Not available")).toHaveLength(2);
    expect(screen.queryByText("40% reserved")).toBeNull();
  });
  // @rule R5: exact raw quantities with full accessible text, no USD proxy.
  it("keeps large and tiny amounts exact, without USD or scientific notation", () => {
    const value = read();
    if (!value.snapshot) throw new Error("fixture");
    render({
      ...value,
      snapshot: {
        ...value.snapshot,
        summary: {
          ...amounts(),
          requested: { raw: "900719925474099312345678", cohortId: "eligible" },
          reserved: { raw: "1", cohortId: "eligible" },
        },
      },
    });
    expect(screen.getByText("900,719,925,474,099,312.345678 USDC")).toBeInTheDocument();
    expect(screen.getByText("0.000001 USDC")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/USD$|\$|NaN|Infinity|e\+/);
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});

// @rule R1/R4: two sub-minute deadlines remain distinguishable.
it("preserves supplied sub-minute deadlines", () => {
  const value = read();
  const first = value.snapshot?.buckets[0];
  if (!value.snapshot || !first) throw new Error("fixture");
  render({
    ...value,
    snapshot: {
      ...value.snapshot,
      buckets: [{ ...first, deadlines: ["2026-10-07T18:00:01Z", "2026-10-07T18:00:59Z"] }],
    },
  });
  expect(screen.getByText("Reserve by Oct 7, 2026, 18:00:01")).toBeInTheDocument();
  expect(screen.getByText("Reserve by Oct 7, 2026, 18:00:59")).toBeInTheDocument();
});

// @rule R1/R4: distinct fractional deadlines must not collapse into one displayed time.
it("keeps fractional deadline precision supplied by the queue", () => {
  const value = read();
  const first = value.snapshot?.buckets[0];
  if (!value.snapshot || !first) throw new Error("fixture");
  render({
    ...value,
    snapshot: {
      ...value.snapshot,
      buckets: [{ ...first, deadlines: ["2026-10-07T18:00:00.125Z", "2026-10-07T18:00:00.7501Z"] }],
    },
  });
  expect(screen.getByText("Reserve by Oct 7, 2026, 18:00:00.125")).toBeInTheDocument();
  expect(screen.getByText("Reserve by Oct 7, 2026, 18:00:00.7501")).toBeInTheDocument();
});

// @rule R4: unknown freshness is not a stale snapshot or a confirmed read.
it("shows unknown freshness separately without exposing quantities", () => {
  const value = read();
  if (!value.snapshot) throw new Error("fixture");
  render({ ...value, snapshot: { ...value.snapshot, freshness: "unknown" } });
  expect(
    screen.getByText(
      "Withdrawal deadline freshness is not available. Try again to verify the snapshot.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("25,000 USDC")).toBeNull();
});
