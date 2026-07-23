/**
 * @id PP-MGR-MOD-001
 * @name MoveRangeModal.test
 * @implements-rules-version v3 (POO-597 rules v1) · v1 (POO-842 rules v1)
 *
 * Behavior (2026-06-28 redesign, POO-387): the form renders the current price + range token-by-token
 * (R1), an invert pill that flips the orientation and recomputes the bounds (R2), the ±5/±10/±20/Full
 * presets (R4) and the estimated-balance split (R5). Confirm advances to an explicit Review step (R6)
 * whose CTA runs the wallet-sign steps, calls moveRange, reports the result and closes.
 *
 * POO-597 (rules v1): the build->review->sign handshake — the form CTA now BUILDS before the Review
 * (an async `building` step), so `goToReview` awaits the Review CTA. The fake-timer rebuild + real-gas
 * tests live in MoveRangeModalRealMode.test.tsx (real mode allows injecting the build figures).
 */
import { describe, expect, it, vi } from "vitest";
import { settleSwapInfo } from "@/features/strategies/components/settle";
import { fullRangeTicks } from "@/lib/manager/fullRangeTicks";
import { priceToNearestUsableTick, tickToPrice } from "@/lib/manager/tickPrice";
import { managerPosition } from "@/mocks/data/manager";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { MoveRangeModal, type MoveRangeTarget } from "./MoveRangeModal";

const { moveRange } = vi.hoisted(() => ({
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
// POO-1011: wrap settleSwapInfo so the gate test can force a catastrophic figure once;
// everything else delegates to the real settle module.
vi.mock("@/features/strategies/components/settle", async (importActual) => {
  const actual = await importActual<typeof import("@/features/strategies/components/settle")>();
  return { ...actual, settleSwapInfo: vi.fn(actual.settleSwapInfo) };
});

vi.mock("@/lib/services", () => ({
  isMockMode: true,
  managerService: { moveRange },
  // The slippage error view (POO-499) renders TransactionErrorActions → useTxDiagnostics, which
  // reads accountService.getWalletKind(); stub it so the error view mounts in mock mode.
  accountService: { getWalletKind: vi.fn(async () => "embedded") },
}));

/**
 * The POO-501 position-value block, mirroring the `yield-plus` mock detail: ETH(18d)/USDC(6d), whole
 * pool position 24.72 ETH + 51,440 USDC ≈ $128,600 (a ~60/40 value split) at tickCurrent −195863 ≈
 * $3,120/ETH. `poolValueUsd` (= detail.aum) is the split anchor. Per-token USD prices derive from the
 * reserves + anchor: ETH ≈ $3,120.96, USDC ≈ $1.0002.
 */
const VALUE_BLOCK = {
  reserves: {
    token0: "ETH",
    token1: "USDC",
    totalSupply0: "24720000000000000000",
    totalSupply1: "51440000000",
    tickCurrent: -195_863,
    decimals0: 18,
    decimals1: 6,
  },
  poolValueUsd: 128_600,
} as const;

function renderModal(over: { currentMin?: number; currentMax?: number } = {}) {
  const onOpenChange = vi.fn();
  const onMoved = vi.fn();
  renderWithProviders(
    <MoveRangeModal
      open
      onOpenChange={onOpenChange}
      position={managerPosition}
      currentMin={over.currentMin ?? 2850}
      currentMax={over.currentMax ?? 3400}
      onMoved={onMoved}
    />,
  );
  return { onOpenChange, onMoved };
}

/** Render with a target that carries the position-value block (real-mode-shaped, mock-safe). */
function renderModalWithValue(
  over: { currentMin?: number; currentMax?: number; position?: Partial<MoveRangeTarget> } = {},
) {
  const onOpenChange = vi.fn();
  const onMoved = vi.fn();
  const position: MoveRangeTarget = {
    ...managerPosition,
    decimals0: 18,
    decimals1: 6,
    ...VALUE_BLOCK,
    ...over.position,
  };
  renderWithProviders(
    <MoveRangeModal
      open
      onOpenChange={onOpenChange}
      position={position}
      currentMin={over.currentMin ?? 2850}
      currentMax={over.currentMax ?? 3400}
      onMoved={onMoved}
    />,
  );
  return { onOpenChange, onMoved };
}

/** Advance from the form to the Review step (form CTA "Move range" → async build → Review, POO-597). */
async function goToReview(user: ReturnType<typeof userEvent.setup>) {
  const next = screen.getAllByRole("button", { name: "Move range" }).at(-1);
  if (!next) throw new Error("expected the form CTA");
  await user.click(next);
  // POO-597: the build runs before the Review; wait for the Review CTA to render.
  await screen.findByRole("button", { name: "Confirm & move range" });
}

describe("MoveRangeModal", () => {
  // @rule POO-1011 R2/R3 — the manager move-range Review is gated at a catastrophic built impact:
  // funds-at-risk alert + explicit acknowledgment before the Confirm CTA re-enables.
  it("(POO-1011 R2) a catastrophic price impact blocks Confirm & move range until acknowledged", async () => {
    vi.mocked(settleSwapInfo).mockReturnValueOnce({
      priceImpactPercentage: 92.41,
      protocolFee: 0.2,
      minAmountInStable: 15,
    });
    const user = userEvent.setup();
    renderModal();
    await goToReview(user);
    const cta = screen.getByRole("button", { name: "Confirm & move range" });
    expect(cta).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toContain("92.41%");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(cta).toBeEnabled();
  });

  it("renders the seeded range; slippage lives behind the settings gear", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByLabelText("Min price")).toHaveValue("2850");
    expect(screen.getByLabelText("Max price")).toHaveValue("3400");
    // Slippage is no longer inline — it opens from the settings gear (#9).
    expect(screen.queryByText("Max slippage")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
  });

  // @rule POO-547 R1/R2: the custom slippage input no longer caps at the old 5% manager cap; a value
  // above 5% (e.g. 12.5%) is accepted and surfaces the High-slippage warning, and the form CTA stays
  // enabled (warn-only, never blocks — R2).
  it("[POO-547 R1/R2] accepts a >5% custom slippage and warns without blocking the CTA", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const custom = screen.getByLabelText("Custom");
    await user.clear(custom);
    await user.type(custom, "12.5");
    // The value passes through (old 5% cap would have clamped it) and the warning shows.
    expect(custom).toHaveValue("12.5");
    expect(screen.getByText("High slippage")).toBeInTheDocument();
    // Close the gear (its modal overlay hides the CTA from the a11y tree); warn-only means the form
    // CTA (Move range) is still enabled once the sheet is dismissed.
    await user.click(screen.getByRole("button", { name: "Done" }));
    const cta = screen.getAllByRole("button", { name: "Move range" }).at(-1);
    expect(cta).toBeEnabled();
  });

  // @rule R1: Current price & Current range render token-by-token ("{token1} per {token0}").
  it("shows the current price and range token-by-token (R1)", () => {
    renderModal();
    // managerPosition: token0 ETH, token1 USDC, currentPrice 3120.5, range 2850–3400.
    expect(screen.getByText("Current price")).toBeInTheDocument();
    expect(screen.getByText(/3,120\.5 USDC per ETH/)).toBeInTheDocument();
    expect(screen.getByText(/2,850 – 3,400 USDC per ETH/)).toBeInTheDocument();
  });

  // @rule POO-860 R4: an inverted (or sub-2-tick) new range shows the inline error and disables the
  // Move CTA, sharing the create-strategy Build-step range guard.
  it("[POO-860 R4] blocks an inverted range with an inline error and disables the CTA", async () => {
    const user = userEvent.setup();
    renderModal(); // seeded 2850 / 3400
    const max = screen.getByLabelText("Max price");
    await user.clear(max);
    await user.type(max, "2800"); // below the min of 2850
    expect(screen.getByText("Max must be at least 2 ticks above min.")).toBeInTheDocument();
    const cta = screen.getAllByRole("button", { name: "Move range" }).at(-1);
    expect(cta).toBeDisabled();
  });

  // @rule R2: an invert pill labelled with the pair flips the orientation and recomputes min/max.
  it("inverts the orientation via the pair pill and recomputes the bounds (R2)", async () => {
    const user = userEvent.setup();
    renderModal();
    // Canonical orientation: ETH/USDC pill, bounds 2850 / 3400.
    const pill = screen.getByRole("button", { name: /ETH\/USDC/ });
    expect(pill).toBeInTheDocument();
    await user.click(pill);
    // Inverted: USDC/ETH, displayed bounds = reciprocal + swap → 1/3400 .. 1/2850.
    expect(screen.getByRole("button", { name: /USDC\/ETH/ })).toBeInTheDocument();
    const min = Number((screen.getByLabelText("Min price") as HTMLInputElement).value);
    const max = Number((screen.getByLabelText("Max price") as HTMLInputElement).value);
    expect(min).toBeCloseTo(1 / 3400, 6);
    expect(max).toBeCloseTo(1 / 2850, 6);
    expect(min).toBeLessThan(max);
  });

  // @rule R2: inverted range LABELS keep distinct min/max for ETH-class pairs. A tight band around
  // ~3120.5 inverts to sub-0.001 bounds that collapse to identical "0.0003" strings at a fixed 4dp;
  // the magnitude-aware fmtPrice must keep them distinct (guards a regression to fixed-dp formatting).
  it("renders distinct inverted min/max range labels for a tight ETH-class band (R2)", async () => {
    const user = userEvent.setup();
    // Band around 3120.5 (≈ ±5%): canonical 2964.475 / 3276.525 inverts to ~0.000305 / ~0.000337.
    renderModal({ currentMin: 2964.475, currentMax: 3276.525 });
    await user.click(screen.getByRole("button", { name: /ETH\/USDC/ }));
    // The Current range reading is "{min} – {max} ETH per USDC" in the inverted orientation (the en
    // dash separator disambiguates it from the single-value Current price reading).
    const label = screen.getByText(/–.*ETH per USDC/).textContent ?? "";
    const match = label.match(/^([\d.,]+)\s*–\s*([\d.,]+)\s+ETH per USDC$/);
    expect(match).not.toBeNull();
    const [, minLabel, maxLabel] = match as RegExpMatchArray;
    // At a fixed 4dp both would be "0.0003"; fmtPrice keeps ~5 significant figures, so they differ.
    expect(minLabel).not.toBe(maxLabel);
    expect(minLabel).not.toMatch(/^0\.0003$/);
  });

  it("re-centers the range on the current price, keeping the width", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Re-center on current price" }));
    // Re-center keeps the width but snaps both bounds onto the pool's usable-tick grid (POO-408), so
    // they land within one tick of the nominal 2845.5 .. 3395.5.
    const recMin = Number((screen.getByLabelText("Min price") as HTMLInputElement).value);
    const recMax = Number((screen.getByLabelText("Max price") as HTMLInputElement).value);
    expect(recMin).toBeCloseTo(2845.5, -1);
    expect(recMax).toBeCloseTo(3395.5, -1);
  });

  // @rule R4: ±5/±10/±20 presets apply a symmetric range around the current price.
  it("offers the standardized ±5 / ±10 / ±20 presets and applies them around the current price", async () => {
    const user = userEvent.setup();
    renderModal();
    for (const name of ["±5%", "±10%", "±20%"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "±20%" }));
    // ±20% around 3120.5, snapped onto the pool's usable-tick grid (POO-408): within one tick of
    // 2496.4 .. 3744.6.
    const pMin = Number((screen.getByLabelText("Min price") as HTMLInputElement).value);
    const pMax = Number((screen.getByLabelText("Max price") as HTMLInputElement).value);
    expect(pMin).toBeCloseTo(2496.4, -1);
    expect(pMax).toBeCloseTo(3744.6, -1);
  });

  // @rule R4: a separate Full chip switches to full-range mode (POO-339 debt resolved).
  it("offers a Full preset that switches to full-range mode (R4 / POO-339)", async () => {
    const user = userEvent.setup();
    renderModal();
    const full = screen.getByRole("button", { name: "Full" });
    expect(full).toBeInTheDocument();
    await user.click(full);
    // Full range hides the min/max inputs and shows the full-range note.
    expect(screen.queryByLabelText("Min price")).toBeNull();
    expect(screen.getByText(/Full range/)).toBeInTheDocument();
  });

  // @rule R5: the estimated-balance block sums to ~100% across the two tokens.
  it("renders an estimated-balance split that sums to ~100% (R5)", () => {
    renderModal();
    expect(screen.getByText("Estimated balance")).toBeInTheDocument();
    const pcts = screen
      .getAllByText(/^\d{1,3}%$/)
      .map((node) => Number(node.textContent?.replace("%", "")));
    const total = pcts.slice(0, 2).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(99);
    expect(total).toBeLessThanOrEqual(101);
  });

  // @rule R6: confirm opens the Review step (not pending) with the assurance line + Confirm CTA.
  it("advances from the form to an explicit Review step (R6)", async () => {
    const user = userEvent.setup();
    renderModal();
    await goToReview(user);
    // POO-406 R4: reworded assurance copy.
    expect(
      screen.getByText(
        "The position is moved without investors needing to touch the strategy's funds.",
      ),
    ).toBeInTheDocument();
    // POO-406 R3: the fixed Pool Party fee row. POO-540 R4: managerPosition carries no `network`
    // slug, so the native symbol degrades to the ETH default → "0.001 ETH".
    expect(screen.getByText("Fee")).toBeInTheDocument();
    expect(screen.getByText("0.001 ETH")).toBeInTheDocument();
    // POO-406 R5: no bottom Back button — only the top-left back arrow is named "Back".
    expect(screen.getAllByRole("button", { name: "Back" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeInTheDocument();
    // Still in review — the wallet steps have not started.
    expect(screen.queryByText("Continue in your wallet")).toBeNull();
    expect(moveRange).not.toHaveBeenCalled();
  });

  // @rule POO-540 R1: on an ETH-network position (Base/Arbitrum) the fee reads "0.001 ETH".
  it("[POO-540 R1] review fee shows the native ETH symbol on an ETH network", async () => {
    const user = userEvent.setup();
    renderModalWithValue({ position: { network: "base" } });
    await goToReview(user);
    expect(screen.getByText("0.001 ETH")).toBeInTheDocument();
    expect(screen.queryByText("0.001 POL")).toBeNull();
  });

  // @rule POO-540 R1: on a Polygon position the fee reads the native "0.001 POL" — never "ETH".
  it("[POO-540 R1] review fee shows the native POL symbol on Polygon", async () => {
    const user = userEvent.setup();
    renderModalWithValue({ position: { network: "polygon" } });
    await goToReview(user);
    expect(screen.getByText("0.001 POL")).toBeInTheDocument();
    expect(screen.queryByText("0.001 ETH")).toBeNull();
  });

  // POO-515 R4: the Review's network-gas row carries a gas-only breakdown tooltip (parity with the
  // other modals' Fee rows); the native protocol fee row stays tooltip-less (it is not a USD fee and
  // cannot be summed with the gas, POO-445 R4 exception).
  it("[POO-515 R4] review: the gas row has a gas-only tooltip; the ETH fee row has none", async () => {
    const user = userEvent.setup();
    renderModal();
    await goToReview(user);
    // managerPosition.gasCostUsd = 0.42 → the gas-only breakdown, no slippage/DEX/protocol lines
    // and no redundant Total (single component).
    const tip = screen.getByRole("button", { name: /Estimated gas \(network fee\)/ });
    expect(tip).toHaveAccessibleName(/\$0\.42/);
    expect(tip).not.toHaveAccessibleName(/Total/);
    expect(tip).not.toHaveAccessibleName(/slippage/i);
    // The ETH protocol fee row has no info tooltip.
    expect(screen.queryByRole("button", { name: /0\.001 ETH/ })).toBeNull();
    // POO-612 R1: the rebalancing swap's real price impact shows on the Review.
    expect(screen.getByText("Price impact")).toBeInTheDocument();
  });

  // @rule R1/R2 (POO-406)
  it("(POO-406 R1/R2) form shows the two-row range preview and drops the gas note", () => {
    renderModal();
    expect(screen.getByTestId("move-range-preview")).toBeInTheDocument();
    expect(screen.queryByText(/You pay the network gas for these actions/)).not.toBeInTheDocument();
  });

  /** Set the gear slippage to a demo-failing 0.05% (POO-499 R6: <= 0.1% forces the mock failure). */
  async function setTinySlippage(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const custom = screen.getByLabelText("Custom");
    await user.clear(custom);
    await user.type(custom, "0.05");
    // Close the settings sheet so the flow can run.
    await user.click(screen.getByRole("button", { name: "Done" }));
  }

  // POO-499 R3: two slippage failures show the slippage error view and re-open the settings gear.
  it("[POO-499 R3] two slippage failures show the slippage error view and re-open settings", async () => {
    const user = userEvent.setup();
    renderModal();
    await setTinySlippage(user);
    await goToReview(user);
    await user.click(screen.getByRole("button", { name: "Confirm & move range" }));
    // Both mock confirms fail as slippage (<= 0.1%): the slippage error view shows and the settings
    // sheet auto-opens (Max slippage visible again). Two 0.35s mock beats per attempt, so allow ~4s.
    await waitFor(
      () => expect(screen.getAllByText("Price moved too much").length).toBeGreaterThanOrEqual(1),
      { timeout: 4000 },
    );
    expect(screen.getByText(/moved beyond your max slippage.*again/i)).toBeInTheDocument();
    expect(screen.getByText("Max slippage")).toBeInTheDocument();
    // The mock service move is never reached (the confirm throws before it).
    expect(moveRange).not.toHaveBeenCalled();
  });

  // @rule R6: the Review CTA runs the wallet-sign steps, calls moveRange, reports it and closes.
  it("confirms from Review: runs the wallet-sign steps, calls moveRange, reports it and closes", async () => {
    const user = userEvent.setup();
    const { onOpenChange, onMoved } = renderModal();

    await goToReview(user);
    await user.click(screen.getByRole("button", { name: "Confirm & move range" }));

    // The multistep wallet-signing modal shows while the mock steps run.
    expect(screen.getByText("Continue in your wallet")).toBeInTheDocument();

    // The mock confirm step calls managerService.moveRange; on success the modal reports + closes.
    await waitFor(() =>
      expect(moveRange).toHaveBeenCalledWith("yield-plus", {
        rangeMin: 2850,
        rangeMax: 3400,
        // POO-518 R1: a band move carries full: false.
        full: false,
        // POO-463 R2: manager flows default to 5% (the existing cap).
        slippagePct: 5,
      }),
    );
    await waitFor(() => expect(onMoved).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // POO-518 R1: a mock FULL move reports the fullRangeTicks-derived bounds + full: true — never the
  // seeded current band. managerPosition carries no decimals, so the same-decimals derivation (the
  // raw 1.0001^tick bounds) applies.
  it("[POO-518 R1] a full move reports the derived full-range bounds, not the seeded band", async () => {
    const user = userEvent.setup();
    const { onMoved } = renderModal();

    await user.click(screen.getByRole("button", { name: "Full" }));
    await goToReview(user);
    await user.click(screen.getByRole("button", { name: "Confirm & move range" }));

    // managerPosition is the 0.05% tier (feeBps 5, spacing 10).
    const { tickLower, tickUpper } = fullRangeTicks(managerPosition.feeBps);
    const minPrice = tickToPrice(tickLower, 0, 0);
    const maxPrice = tickToPrice(tickUpper, 0, 0);
    await waitFor(() =>
      expect(moveRange).toHaveBeenCalledWith("yield-plus", {
        rangeMin: minPrice,
        rangeMax: maxPrice,
        full: true,
        slippagePct: 5,
      }),
    );
    await waitFor(() =>
      expect(onMoved).toHaveBeenCalledWith({
        rangeMin: minPrice,
        rangeMax: maxPrice,
        full: true,
        gasCostUsd: 0.42,
      }),
    );
    // Guard the regression: the old behavior echoed the seeded 2850/3400 band.
    const result = onMoved.mock.calls[0]?.[0] as { rangeMin: number; rangeMax: number };
    expect(result.rangeMin).not.toBe(2850);
    expect(result.rangeMax).not.toBe(3400);
  });

  // ---- POO-501: token logos + per-token estimated amounts and USD ----

  // @rule R1: the estimated-balance legend resolves the major-token logos (ETH/USDC) without a
  // network slug. The Dialog renders in a portal and the logos are decorative (alt=""), so query the
  // raw <img> src set from the document.
  it("passes resolved major-token logos into the estimated-balance legend (R1)", () => {
    renderModalWithValue();
    const srcs = Array.from(document.querySelectorAll("img")).map((n) => n.getAttribute("src"));
    expect(srcs).toContain("/tokens/eth.png");
    expect(srcs).toContain("/tokens/usdc.png");
  });

  // @rule R2: with the value block present, the FORM Estimated balance shows the per-token estimated
  // amount + USD for the new range (seeded 2850–3400, snapped): ETH ≈ 20 (~$62.5K), USDC ≈ 65.9K
  // (~$65.9K). The exact figure shifts with the tick snap, so match tolerantly on the leading digits.
  it("shows the per-token estimated amount + USD in the form when the target carries the value block (R2)", () => {
    renderModalWithValue();
    // ETH leg: ~20 ETH with an approx-marked ~$62K USD in the sub-line.
    expect(screen.getByText(/~20(\.\d+)?\s*ETH \(~\$62,\d/)).toBeInTheDocument();
    // USDC leg: ~65.9K USDC with an approx-marked ~$65K USD.
    expect(screen.getByText(/~65,\d{3}(\.\d+)?\s*USDC \(~\$65,\d/)).toBeInTheDocument();
  });

  // @rule R2/R3: the per-token estimate ALSO renders in the Review's Estimated balance card.
  it("shows the per-token estimated amount + USD in the Review when the target carries the value block (R2/R3)", async () => {
    const user = userEvent.setup();
    renderModalWithValue();
    await goToReview(user);
    // The review Estimated balance legend carries the same per-token estimates.
    expect(screen.getByText(/~20(\.\d+)?\s*ETH \(~\$62,\d/)).toBeInTheDocument();
    expect(screen.getByText(/~65,\d{3}(\.\d+)?\s*USDC \(~\$65,\d/)).toBeInTheDocument();
  });

  // @rule R3: the form's read-only Current range block gains a "Current balance" row per token, with
  // the CURRENT amount + USD + logo. ETH 24.72 (~$77,150), USDC 51,440 (~$51,450).
  it("renders the current per-token balance rows in the form (R3)", () => {
    renderModalWithValue();
    expect(screen.getByText("Current balance")).toBeInTheDocument();
    expect(screen.getByText(/24\.72\s*ETH/)).toBeInTheDocument();
    expect(screen.getByText(/51,440\s*USDC/)).toBeInTheDocument();
    // Per-token USD alongside each amount (de-emphasized, parenthesised).
    expect(screen.getByText(/\$77,150/)).toBeInTheDocument();
    expect(screen.getByText(/\$51,4\d\d/)).toBeInTheDocument();
  });

  // @rule R4: without the value block the card renders exactly today's percent-only legend (no
  // approx-marked amounts, no Current balance row). managerPosition carries no reserves.
  it("falls back to percent-only when the value block is absent (R4)", () => {
    renderModal();
    expect(screen.getByText("Estimated balance")).toBeInTheDocument();
    // No approx-marked per-token amount leaks in.
    expect(screen.queryByText(/~.*ETH \(~\$/)).toBeNull();
    expect(screen.queryByText("Current balance")).toBeNull();
  });

  // @rule R7: a new range sitting entirely ABOVE the current price moves all value into token0 (ETH).
  // Range 3300–3900 vs current ~3120.5 → 100% ETH ≈ 41.21 ETH (~$128,600), USDC ≈ 0 (~$0.00).
  it("moves all estimated value to one token when the new range sits entirely above the current price (R7)", async () => {
    const user = userEvent.setup();
    renderModalWithValue();
    // Type a range fully above the current price.
    const min = screen.getByLabelText("Min price");
    const max = screen.getByLabelText("Max price");
    await user.clear(min);
    await user.type(min, "3300");
    await user.clear(max);
    await user.type(max, "3900");
    // 100% ETH: ~41 ETH and the whole anchor in USD; USDC leg at ~$0.
    await waitFor(() => expect(screen.getByText(/~41(\.\d+)?\s*ETH/)).toBeInTheDocument());
    expect(screen.getByText(/~\$128,6\d\d/)).toBeInTheDocument();
    expect(screen.getByText(/~0\s*USDC/)).toBeInTheDocument();
  });

  // @rule R5: inverting the orientation swaps which token renders left/right, but every amount stays
  // attached to its own token (ETH's ~20.05 estimate never migrates to the USDC symbol).
  it("keeps each amount attached to its token when the orientation is inverted (R5)", async () => {
    const user = userEvent.setup();
    renderModalWithValue();
    await user.click(screen.getByRole("button", { name: /ETH\/USDC/ }));
    // Inverted view (USDC/ETH pair): ETH still ~20 ETH, USDC still ~65.9K USDC (each amount stays
    // attached to its own token; inversion swaps sides only).
    expect(screen.getByRole("button", { name: /USDC\/ETH/ })).toBeInTheDocument();
    expect(screen.getByText(/~20(\.\d+)?\s*ETH \(~\$62,\d/)).toBeInTheDocument();
    expect(screen.getByText(/~65,\d{3}(\.\d+)?\s*USDC \(~\$65,\d/)).toBeInTheDocument();
  });

  // @rule POO-513 R2: reopening the modal resets the gear settings (slippage + deadline) to the
  // manager defaults, so a stale custom slippage never carries into the next move-range build; the
  // gear re-derives its custom field from the reset slippage (R1).
  it("resets the gear slippage to the manager default on close (POO-513 R2)", async () => {
    const user = userEvent.setup();
    const props = {
      onOpenChange: vi.fn(),
      position: managerPosition,
      currentMin: 2850,
      currentMax: 3400,
      onMoved: vi.fn(),
    };
    const view = renderWithProviders(<MoveRangeModal open {...props} />);
    // The manager default (5%) is not a preset, so the gear seeds it as custom text.
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const custom = screen.getByLabelText("Custom");
    expect(custom).toHaveValue("5");
    fireEvent.change(custom, { target: { value: "4" } });
    expect(custom).toHaveValue("4");
    await user.click(screen.getByRole("button", { name: "Done" }));
    // Close + reopen (the component stays mounted with `open` toggled, as in the manage view).
    view.rerender(<MoveRangeModal open={false} {...props} />);
    view.rerender(<MoveRangeModal open {...props} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Custom")).toHaveValue("5");
  });

  // @rule POO-842 R4: two 40px steppers per bound in a 2-column grid leave ~40px of visible text
  // at 375px — 4+ digit prices are mostly hidden while the onBlur tick-snap can rewrite digits the
  // manager cannot see. Below sm the two bound editors stack full-width; sm+ keeps them side by side.
  it("[POO-842 R4] the min/max bound editors stack below sm", () => {
    renderModal();
    const min = screen.getByLabelText("Min price");
    // Climb to the bounds grid (the nearest .grid ancestor of the Min input).
    const grid = min.closest(".grid");
    expect(grid).toHaveClass("grid-cols-1");
    expect(grid).toHaveClass("sm:grid-cols-2");
    expect(grid).not.toHaveClass("grid-cols-2");
  });

  // POO-877/881/900: a live position on a stable pool (USDC/USDT, decimals known → the exact on-chain
  // tick grid), where the ± steppers used to lock / loop and where the input-level clamp runs.
  // Defaults to tickSpacing 1 (0.01%); pass feeBps 5 for the spacing-10 variant (POO-900 R6 fixtures).
  function renderStable(over: { currentMin?: number; currentMax?: number; feeBps?: number } = {}) {
    const position: MoveRangeTarget = {
      strategyId: "0xstable",
      currentPrice: 1,
      feeBps: over.feeBps ?? 1,
      token0: "USDC",
      token1: "USDT",
      gasCostUsd: 0.5,
      decimals0: 6,
      decimals1: 6,
    };
    renderWithProviders(
      <MoveRangeModal
        open
        onOpenChange={vi.fn()}
        position={position}
        currentMin={over.currentMin ?? 0.999}
        currentMax={over.currentMax ?? 1.001}
        onMoved={vi.fn()}
      />,
    );
  }

  /** The tick the displayed bound sits on (round resolver, POO-877) for the stable 6/6 grid. */
  function shownTick(input: HTMLInputElement, feeBps = 1): number {
    return priceToNearestUsableTick(Number.parseFloat(input.value), 6, 6, feeBps);
  }

  // @rule POO-877 R4 — the Move Range ± stepper moves the underlying tick, so it never freezes on a
  // tickSpacing-1 position (the same fix as the create-strategy Build step, via the shared grid).
  it("[POO-877 R4] does not lock the ± stepper on a tickSpacing-1 position", async () => {
    const user = userEvent.setup();
    renderStable();
    const min = screen.getByLabelText("Min price") as HTMLInputElement;
    const up = screen.getByRole("button", { name: "Min price +" });
    const readings = [Number.parseFloat(min.value)];
    for (let i = 0; i < 4; i++) {
      await user.click(up);
      readings.push(Number.parseFloat(min.value));
    }
    for (let i = 1; i < readings.length; i++) {
      expect(readings[i]).toBeGreaterThan(readings[i - 1] as number);
    }
  });

  // @rule POO-881 R8 + POO-900 R2 - typing a min that violates the minimum width and blurring snaps
  // it to the exactly-2-tick-spacings boundary against the max, so the inline error clears and the
  // Move CTA re-enables (input-level enforcement, same as the Build step).
  it("[POO-900 R2] snaps a blurred violating min to exactly 2 spacings below max", async () => {
    const user = userEvent.setup();
    renderStable();
    const min = screen.getByLabelText("Min price") as HTMLInputElement;
    const max = screen.getByLabelText("Max price") as HTMLInputElement;
    await user.clear(min);
    await user.type(min, "9999");
    await user.click(max); // blur min → snapBound clamps it
    expect(Number.parseFloat(min.value)).toBeLessThan(Number.parseFloat(max.value));
    // POO-900 R2: the snap lands on the TICK exactly 2 spacings below the max.
    expect(shownTick(max) - shownTick(min)).toBe(2);
    expect(screen.queryByText("Max must be at least 2 ticks above min.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move range" })).toBeEnabled();
  });

  // @rule POO-900 R1/R6 - same rule as BuildStep (R6 parity): the narrowing steppers hard-stop AND
  // disable at exactly 2 spacings; no 3-tick sawtooth loop past the boundary.
  it("[POO-900 R1] hard-stops the min stepper at exactly 2 spacings and disables it", async () => {
    const user = userEvent.setup();
    renderStable({ currentMin: 0.9998, currentMax: 1.0002 });
    const min = screen.getByLabelText("Min price") as HTMLInputElement;
    const max = screen.getByLabelText("Max price") as HTMLInputElement;
    const up = screen.getByRole("button", { name: "Min price +" });
    for (let i = 0; i < 8; i++) await user.click(up);
    expect(Number.parseFloat(min.value)).toBeLessThan(Number.parseFloat(max.value));
    expect(shownTick(max) - shownTick(min)).toBe(2);
    expect(up).toBeDisabled();
    expect(screen.queryByText("Max must be at least 2 ticks above min.")).not.toBeInTheDocument();
  });

  // @rule POO-900 R7 - narrowing is MONOTONIC: over N presses the min bound never moves away from the
  // max (regression lock on the 3-tick loop).
  it("[POO-900 R7] repeated narrowing presses never move min back down (loop regression)", async () => {
    const user = userEvent.setup();
    renderStable({ currentMin: 0.9998, currentMax: 1.0002 });
    const min = screen.getByLabelText("Min price") as HTMLInputElement;
    const up = screen.getByRole("button", { name: "Min price +" });
    let prev = Number.parseFloat(min.value);
    for (let i = 0; i < 10; i++) {
      await user.click(up);
      const next = Number.parseFloat(min.value);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });

  // @rule POO-900 R1/R5 - at exactly 2 tick-spacings the NARROWING steppers (min +, max −) are
  // disabled while the WIDENING ones stay enabled, on the spacing-1 grid…
  // The seeds sit a deterministic 0.1 tick ABOVE ticks 0 and 2, so the modal's POO-319 floor
  // seed-snap lands them on exactly those ticks (an exact tick price can float a hair below its own
  // tick and floor one tick down, which would shift the fixture's width).
  it("[POO-900 R1/R5] disables only the narrowing steppers at the 2-spacing minimum (spacing 1)", async () => {
    const user = userEvent.setup();
    renderStable({
      currentMin: tickToPrice(0, 6, 6) * 1.00001,
      currentMax: tickToPrice(2, 6, 6) * 1.00001,
    });
    expect(screen.getByRole("button", { name: "Min price +" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Max price −" })).toBeDisabled();
    const widenMin = screen.getByRole("button", { name: "Min price −" });
    expect(widenMin).toBeEnabled();
    expect(screen.getByRole("button", { name: "Max price +" })).toBeEnabled();
    // Widening one step re-enables narrowing (width 3 > minimum).
    await user.click(widenMin);
    expect(screen.getByRole("button", { name: "Min price +" })).toBeEnabled();
  });

  // …and on the spacing-10 grid (0.05%), where the same boundary sits 10 ticks per spacing apart.
  it("[POO-900 R1/R5] disables only the narrowing steppers at the 2-spacing minimum (spacing 10)", () => {
    renderStable({
      feeBps: 5,
      currentMin: tickToPrice(-10, 6, 6),
      currentMax: tickToPrice(10, 6, 6),
    });
    expect(screen.getByRole("button", { name: "Min price +" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Max price −" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Min price −" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Max price +" })).toBeEnabled();
  });

  // @rule POO-900 R6 - orientation parity: inverting the display flips side AND direction, so the
  // narrowing pair is still (displayed min +, displayed max −) and stays disabled at the minimum.
  it("[POO-900 R6] keeps the narrowing steppers disabled at the minimum when inverted", async () => {
    const user = userEvent.setup();
    renderStable({
      currentMin: tickToPrice(0, 6, 6) * 1.00001,
      currentMax: tickToPrice(2, 6, 6) * 1.00001,
    });
    await user.click(screen.getByRole("button", { name: /USDC\/USDT/ }));
    expect(screen.getByRole("button", { name: "Min price +" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Max price −" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Min price −" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Max price +" })).toBeEnabled();
  });
});
