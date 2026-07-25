/**
 * @id PP-MGR-MOD-001 (POO-310)
 * @name MoveRangeModal real-mode.test
 * @implements-rules-version v2 (POO-597 rules v1)
 *
 * Behavior in real mode (POO-310): confirm drives the multistep wallet-sign runner (FU-001) with the
 * steps built from the network/positionId/decimals + the entered range + slippage, reports the applied
 * range and closes. The orchestration hook is stubbed (its own optimize→routing→build chain is tested
 * separately): buildSteps returns a resolving 2-step list.
 *
 * POO-597 (rules v1): the build->review->sign handshake — the real-mode mock build is a microtask, so
 * `await user.click("Move range")` already flushes it to the Review. Adds a fake-timer rebuild test
 * (the 10s re-quote) and a real-gas test (built `estimatedGasInUsd` drives the Review network line).
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import type { MoveRangeTarget } from "./MoveRangeModal";

/** POO-597: the Review re-quote window (mirrors the component's REVIEW_REFRESH_SECS). */
const REVIEW_REFRESH_SECS = 10;

const mocks = vi.hoisted(() => ({ buildSteps: vi.fn() }));

// POO-1044 [R3]: the provisioning panel's buy-crypto escape renders the locale-aware Link, which
// resolves Next's app-router navigation. It does not exist under jsdom, so it is stood in for, as
// in every other suite that mounts a navigating component.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/services", () => ({ isMockMode: false, managerService: {} }));
vi.mock("../hooks/useMoveRange", () => ({
  useMoveRange: () => ({ buildSteps: mocks.buildSteps, execute: vi.fn() }),
}));

import { fullRangeTicks } from "@/lib/manager/fullRangeTicks";
import { priceToClosestUsableTick, tickToPrice } from "@/lib/manager/tickPrice";
import { MoveRangeModal } from "./MoveRangeModal";

const target: MoveRangeTarget = {
  strategyId: "0xpos",
  currentPrice: 3000,
  feeBps: 30,
  token0: "ETH",
  token1: "USDC",
  gasCostUsd: 0.5,
  network: "arbitrum",
  decimals0: 18,
  decimals1: 6,
};

function renderModal(over: Partial<MoveRangeTarget> = {}) {
  const onOpenChange = vi.fn();
  const onMoved = vi.fn();
  renderWithProviders(
    <MoveRangeModal
      open
      onOpenChange={onOpenChange}
      position={{ ...target, ...over }}
      currentMin={2800}
      currentMax={3200}
      onMoved={onMoved}
    />,
  );
  return { onOpenChange, onMoved };
}

describe("MoveRangeModal (real mode)", () => {
  beforeEach(() => {
    mocks.buildSteps.mockReset().mockReturnValue([
      { key: "build", run: async () => ({}) },
      { key: "confirm:moveRange", run: async () => ({ txHash: "0xhash" }) },
    ]);
  });

  it("confirm builds the steps with the mapped args, reports the range, and closes", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onMoved } = renderModal();

    // The seeded range snaps onto the pool's EXACT usable ticks (decimals known → POO-408), so what
    // goes on-chain equals the (snapped) values shown in the form. Read them before advancing.
    const minVal = Number((screen.getByLabelText("Min price") as HTMLInputElement).value);
    const maxVal = Number((screen.getByLabelText("Max price") as HTMLInputElement).value);
    expect(minVal).toBeCloseTo(2800, -2);
    expect(maxVal).toBeCloseTo(3200, -2);

    // Form CTA advances to the Review step (R6); the Review CTA runs the flow.
    await user.click(screen.getByRole("button", { name: "Move range" }));
    await user.click(screen.getByRole("button", { name: "Confirm & move range" }));

    // What executes on-chain == what the form showed (snapped usable ticks).
    expect(mocks.buildSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "arbitrum",
        positionId: "0xpos",
        feeBps: 30,
        decimals0: 18,
        decimals1: 6,
        minPrice: minVal,
        maxPrice: maxVal,
        slippagePct: 5,
      }),
    );
    // POO-518 R1: a band move reports the entered (snapped) bounds with full: false.
    await waitFor(() =>
      expect(onMoved).toHaveBeenCalledWith({
        rangeMin: minVal,
        rangeMax: maxVal,
        full: false,
        gasCostUsd: 0.5,
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("snaps a typed bound to the EXACT usable tick on blur (POO-408 R2)", async () => {
    const user = userEvent.setup();
    renderModal();
    const min = screen.getByLabelText("Min price");
    await user.clear(min);
    await user.type(min, "2837.5"); // an off-grid price
    await user.tab(); // blur snaps it
    const snapped = Number((min as HTMLInputElement).value);
    const expected = tickToPrice(priceToClosestUsableTick(2837.5, 18, 6, 30), 18, 6);
    // The displayed value is the exact price of the nearest usable tick — what will mint on-chain.
    expect(snapped).toBeCloseTo(expected, 1);
  });

  // POO-394: the Full preset is now wired on-chain. Selecting Full + confirming runs the wallet steps
  // with `fullRange: true` (no bounds; ticks come from fullRangeTicks) and only reports success on a
  // real tx hash — the interim disabled/"coming soon" gate (POO-424 R8) is gone.
  it("[POO-394] runs the on-chain full-range move (Full enabled, no false success)", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onMoved } = renderModal();

    const fullChip = screen.getByRole("button", { name: "Full" });
    expect(fullChip).toBeEnabled();
    await user.click(fullChip);

    await user.click(screen.getByRole("button", { name: "Move range" }));
    await user.click(screen.getByRole("button", { name: "Confirm & move range" }));

    // Full runs the real steps with fullRange:true and no bounds.
    expect(mocks.buildSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "arbitrum",
        positionId: "0xpos",
        feeBps: 30,
        fullRange: true,
        slippagePct: 5,
      }),
    );
    // Success only fires after the (mocked) steps resolve with a hash.
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  // POO-518 R1: the bounds a FULL move reports are the prices derived from the widest usable ticks
  // (fullRangeTicks → tickToPrice, respecting decimals0/1) — never the seeded current band, which is
  // what the success notice and the manage-view range patch (POO-462) render.
  it("[POO-518 R1] a full move reports the fullRangeTicks-derived prices, not the seeded band", async () => {
    const user = userEvent.setup();
    const { onMoved } = renderModal();

    await user.click(screen.getByRole("button", { name: "Full" }));
    await user.click(screen.getByRole("button", { name: "Move range" }));
    await user.click(screen.getByRole("button", { name: "Confirm & move range" }));

    const { tickLower, tickUpper } = fullRangeTicks(30);
    await waitFor(() =>
      expect(onMoved).toHaveBeenCalledWith({
        rangeMin: tickToPrice(tickLower, 18, 6),
        rangeMax: tickToPrice(tickUpper, 18, 6),
        full: true,
        gasCostUsd: 0.5,
      }),
    );
    // Guard the regression: the old behavior echoed the seeded 2800/3200 band.
    const result = onMoved.mock.calls[0]?.[0] as { rangeMin: number; rangeMax: number };
    expect(result.rangeMin).not.toBe(2800);
    expect(result.rangeMax).not.toBe(3200);
  });

  it("surfaces an error when the pool lacks on-chain data (no decimals/network)", async () => {
    const user = userEvent.setup();
    renderModal({ network: undefined, decimals0: undefined, decimals1: undefined });

    await user.click(screen.getByRole("button", { name: "Move range" }));

    expect(
      await screen.findByText("Something went wrong. No funds were moved."),
    ).toBeInTheDocument();
    expect(mocks.buildSteps).not.toHaveBeenCalled();
  });

  // POO-597: the build→review→sign handshake. The form CTA builds the tx first; the Review renders the
  // BUILT figures, re-quotes on a 10s countdown, and only signs on approve.

  // @rule POO-597 R4: the Review re-quotes (rebuilds) after the countdown lapses without approval —
  // a rebuild re-runs the build (index 0) step in place, without leaving the Review.
  it("[POO-597 R4] the Review re-quotes (rebuilds) after the countdown lapses without approval", async () => {
    vi.useFakeTimers();
    try {
      const buildRun = vi.fn(async () => ({}));
      mocks.buildSteps.mockReturnValue([
        { key: "build", run: buildRun },
        { key: "confirm:moveRange", run: async () => ({ txHash: "0xhash" }) },
      ]);
      renderModal();
      // Form CTA → build → Review. Flush the microtask-only build so the Review renders.
      fireEvent.click(screen.getByRole("button", { name: "Move range" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeInTheDocument();
      expect(buildRun).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(`Refreshes in ${REVIEW_REFRESH_SECS}s`, { exact: false }),
      ).toBeInTheDocument();
      // At 0 the Review re-quotes (flow.rebuild re-runs the build) in place — no navigation.
      await vi.advanceTimersByTimeAsync(REVIEW_REFRESH_SECS * 1000);
      expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeInTheDocument();
      expect(buildRun.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // @rule POO-597 R3: the built tx carries a real gas estimate (estimatedGasInUsd), which the Review's
  // network-fee tooltip reflects INSTEAD of the target.gasCostUsd ($0.50) default.
  it("[POO-597 R3] the built gas ($2.50) drives the Review network line, not the $0.50 default", async () => {
    const user = userEvent.setup();
    mocks.buildSteps.mockReturnValue([
      { key: "build", run: async () => ({ built: { estimatedGasInUsd: 2.5 } }) },
      { key: "confirm:moveRange", run: async () => ({ txHash: "0xhash" }) },
    ]);
    renderModal();
    await user.click(screen.getByRole("button", { name: "Move range" }));
    const tip = await screen.findByRole("button", { name: /Estimated gas \(network fee\)/ });
    expect(tip).toHaveAccessibleName(/\$2\.50/);
    expect(tip).not.toHaveAccessibleName(/\$0\.50/);
  });
});
