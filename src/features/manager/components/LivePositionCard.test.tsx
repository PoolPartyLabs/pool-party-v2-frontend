/**
 * @id PP-MGR-CMP-001
 * @name LivePositionCard.test
 * Behavior: renders the position summary + range state; Collect / Compound confirm first
 * (PP-MGR-MOD-002), then call the service, zero out the uncollected fees and show the in-dialog
 * success view; Move Range opens its own modal and moves the range.
 */
import { describe, expect, it, vi } from "vitest";
import { managerPosition } from "@/mocks/data/manager";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { LivePositionCard } from "./LivePositionCard";

// `vi.hoisted` so the fns exist before the hoisted `vi.mock` factory references them.
const { collectFees, compound, moveRange } = vi.hoisted(() => ({
  collectFees: vi.fn(async () => ({ collectedUsd: 842.19, gasCostUsd: 0.42 })),
  compound: vi.fn(async () => ({ compoundedUsd: 842.19, gasCostUsd: 0.42 })),
  // Mirrors the mock service contract (POO-518): echoes the applied bounds + the full flag.
  moveRange: vi.fn(
    async (_id: string, input: { rangeMin: number; rangeMax: number; full?: boolean }) => ({
      rangeMin: input.rangeMin,
      rangeMax: input.rangeMax,
      full: input.full ?? false,
      gasCostUsd: 0.42,
    }),
  ),
}));
vi.mock("@/lib/services", () => ({
  isMockMode: true,
  managerService: { collectFees, compound, moveRange },
}));
// CollectModal (rendered in managed mode) reads useRouter; stub it so next-intl's navigation client
// (which imports next/navigation) doesn't load in vitest. Managed mode never calls refresh.
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("LivePositionCard", () => {
  it("renders the position summary and the in-range state", () => {
    renderWithProviders(<LivePositionCard position={managerPosition} />);

    expect(screen.getByText("ETH/USDC")).toBeInTheDocument();
    expect(screen.getByText("In range")).toBeInTheDocument();
    expect(screen.getByText("Uncollected fees")).toBeInTheDocument();
    // Move Range is live (opens the confirm modal).
    expect(screen.getByRole("button", { name: "Move range" })).toBeEnabled();
  });

  it("collects fees through the investor Collect dialog (POO-286 R1)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LivePositionCard position={managerPosition} />);

    await user.click(screen.getByRole("button", { name: "Collect fees" }));

    // The shared PP-STR-MOD-003 dialog: investor layout, manager data (no perf-fee row).
    expect(await screen.findByText("Collect yield")).toBeInTheDocument();
    expect(screen.getByText("Available to collect")).toBeInTheDocument();
    expect(collectFees).not.toHaveBeenCalled();

    // POO-615: the CTA starts the build → a Review pause → the Review approve → signing.
    await user.click(screen.getByRole("button", { name: "Collect $842.19" }));
    await screen.findByText(/Refreshes in/, undefined, { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "Collect $842.19" }));

    // POO-802 R8: the balance body copy is gone — the receipt carries the figure.
    await screen.findAllByText("Yield collected", undefined, { timeout: 2000 });
    // The receipt Amount Received row uses the confirm-time snapshot — the live claimable is
    // already 0 here, so an exact "$842.19" node (the receipt value) must exist.
    expect(screen.getByText("Amount Received")).toBeInTheDocument();
    expect(screen.getByText("$842.19")).toBeInTheDocument();
    expect(collectFees).toHaveBeenCalledWith("yield-plus");

    await user.click(screen.getByRole("button", { name: "Done" }));
    // Nothing left to collect → Collect and Compound disable.
    expect(screen.getByRole("button", { name: "Collect fees" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Compound" })).toBeDisabled();
  });

  it("compounds through the confirm modal", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LivePositionCard position={managerPosition} />);

    await user.click(screen.getByRole("button", { name: "Compound" }));
    expect(await screen.findByText("Compound fees?")).toBeInTheDocument();

    const confirm = screen.getAllByRole("button", { name: "Compound" }).at(-1);
    if (!confirm) throw new Error("expected the modal confirm button");
    await user.click(confirm);

    expect(compound).toHaveBeenCalledWith("yield-plus");
    expect(
      await screen.findByText("Compounded $842.19 back into the position."),
    ).toBeInTheDocument();
  });

  it("flags an out-of-range position", () => {
    renderWithProviders(<LivePositionCard position={{ ...managerPosition, currentPrice: 5000 }} />);

    expect(screen.getByText("Out of range")).toBeInTheDocument();
    expect(screen.getByText(/out of range and isn't earning fees/i)).toBeInTheDocument();
  });

  // POO-236 R1: the range bounds are inclusive — a price exactly on the upper bound is In range.
  // Locks the inclusive semantics now that the card derives the state from the shared getRangeStatus
  // util (rangeMax is 3400 in the mock).
  it("treats the range bounds as inclusive (price on the upper bound is in range)", () => {
    renderWithProviders(<LivePositionCard position={{ ...managerPosition, currentPrice: 3400 }} />);

    expect(screen.getByText("In range")).toBeInTheDocument();
    expect(screen.queryByText("Out of range")).not.toBeInTheDocument();
  });

  it("moves range: opens the modal, confirms, updates the range and notifies", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LivePositionCard position={managerPosition} />);

    await user.click(screen.getByRole("button", { name: "Move range" }));
    // The modal opened (slippage now lives behind the settings gear, so assert the range editor).
    expect(await screen.findByLabelText("Min price")).toBeInTheDocument();

    // POO-387 redesign: the form CTA advances to the Review step; the Review CTA runs the move.
    // The form CTA is the second "Move range" (the first is the card trigger).
    const formCta = screen.getAllByRole("button", { name: "Move range" }).at(-1);
    if (!formCta) throw new Error("expected the form CTA");
    await user.click(formCta);

    await user.click(await screen.findByRole("button", { name: "Confirm & move range" }));

    // The runner drives the move asynchronously through its mock steps before settling.
    await waitFor(() => expect(moveRange).toHaveBeenCalled());
    expect(await screen.findByText(/Range moved to/)).toBeInTheDocument();
  });

  // POO-518 R2: a FULL move renders the full-range representation on the operate surface — the
  // success notice says full range (not the derived extreme numbers) and the Range reading flips to
  // "Full range" (always in range).
  it("[POO-518 R2] a full move shows the full-range notice and range reading", async () => {
    // The hoisted service mock is shared across the file's tests — scope the call assertions here.
    moveRange.mockClear();
    const user = userEvent.setup();
    renderWithProviders(<LivePositionCard position={managerPosition} />);

    await user.click(screen.getByRole("button", { name: "Move range" }));
    await user.click(await screen.findByRole("button", { name: "Full" }));
    // Full-range mode hides the min/max inputs.
    await waitFor(() => expect(screen.queryByLabelText("Min price")).toBeNull());

    const formCta = screen.getAllByRole("button", { name: "Move range" }).at(-1);
    if (!formCta) throw new Error("expected the form CTA");
    await user.click(formCta);
    await user.click(await screen.findByRole("button", { name: "Confirm & move range" }));

    await waitFor(() => expect(moveRange).toHaveBeenCalled());
    expect(moveRange.mock.calls.at(-1)?.[1]).toMatchObject({ full: true });
    // The notice uses the full-range representation, and the Range reading follows.
    expect(await screen.findByText("Range moved to full range.")).toBeInTheDocument();
    expect(screen.getByText("Full range")).toBeInTheDocument();
    expect(screen.getByText("In range")).toBeInTheDocument();
    // The old band reading is gone.
    expect(screen.queryByText(/2,850/)).toBeNull();
  });
});
