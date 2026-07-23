/**
 * @id PP-STR-CMP-022
 * @name PriceImpactGate.test
 * @implements-rules-version v2
 *
 * POO-1011: the catastrophic price-impact gate. In the POO-1010 incident a 92.41% impact rendered
 * as one amber row hidden behind "Show more" and a $40 invest executed at a 92% loss. These tests
 * lock the gate contract: [R1] nothing below CATASTROPHIC_PRICE_IMPACT_PCT (10), a blocking alert
 * at/above it; [R2] the alert states the loss percent and the CTA stays blocked until the explicit
 * acknowledgment is checked; [R4] absent impact = no gate; [R5/R5v2] the acknowledgment resets when
 * the gate deactivates (impact re-quotes below threshold, the Review is left, or the impact
 * worsens more than 1pp past the acknowledged figure).
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import {
  CATASTROPHIC_PRICE_IMPACT_PCT,
  isCatastrophicPriceImpact,
  PriceImpactGate,
  usePriceImpactGate,
} from "./PriceImpactGate";

function Harness({ pct, active = true }: { pct?: number; active?: boolean }) {
  const gate = usePriceImpactGate(pct, active);
  return (
    <div>
      <PriceImpactGate
        priceImpactPct={pct}
        acknowledged={gate.acknowledged}
        onAcknowledgedChange={gate.setAcknowledged}
      />
      <button type="button" disabled={gate.blocked}>
        CTA
      </button>
    </div>
  );
}

describe("isCatastrophicPriceImpact (POO-1011 R1)", () => {
  it("is false below the threshold, true at and above it, false for missing data (R4)", () => {
    expect(isCatastrophicPriceImpact(undefined)).toBe(false);
    expect(isCatastrophicPriceImpact(2.5)).toBe(false);
    expect(isCatastrophicPriceImpact(CATASTROPHIC_PRICE_IMPACT_PCT - 0.01)).toBe(false);
    expect(isCatastrophicPriceImpact(CATASTROPHIC_PRICE_IMPACT_PCT)).toBe(true);
    expect(isCatastrophicPriceImpact(92.41)).toBe(true);
  });
});

describe("PriceImpactGate (POO-1011)", () => {
  it("[R1/R4] renders nothing below the threshold or without a figure", () => {
    const { rerender } = renderWithProviders(<Harness pct={4.5} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CTA" })).toBeEnabled();
    rerender(<Harness pct={undefined} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CTA" })).toBeEnabled();
  });

  it("[R2] shows the loss alert with the impact percent and blocks the CTA until acknowledged", () => {
    renderWithProviders(<Harness pct={92.41} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("92.41%");
    expect(screen.getByRole("button", { name: "CTA" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "CTA" })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "CTA" })).toBeDisabled();
  });

  it("[R5] clears the acknowledgment when a re-quote drops the impact below the threshold", () => {
    const { rerender } = renderWithProviders(<Harness pct={15} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "CTA" })).toBeEnabled();

    // Impact re-quotes below threshold: gate disappears entirely.
    rerender(<Harness pct={1.2} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Re-crossing the threshold starts UNCHECKED again: consent does not survive the dip.
    rerender(<Harness pct={15} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "CTA" })).toBeDisabled();
  });

  it("[R5] clears the acknowledgment when the Review is left (active=false)", () => {
    const { rerender } = renderWithProviders(<Harness pct={15} active />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();

    act(() => {
      rerender(<Harness pct={15} active={false} />);
    });
    rerender(<Harness pct={15} active />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "CTA" })).toBeDisabled();
  });

  it("[R2] keeps the acknowledgment across a re-quote that stays above the threshold", () => {
    const { rerender } = renderWithProviders(<Harness pct={92.41} />);
    fireEvent.click(screen.getByRole("checkbox"));
    rerender(<Harness pct={88.2} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "CTA" })).toBeEnabled();
  });

  it("[R5v2] clears the acknowledgment when a re-quote WORSENS the impact past the margin", () => {
    // Consenting to "about 15%" is not consenting to 92%: the checked box must not survive.
    const { rerender } = renderWithProviders(<Harness pct={15} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "CTA" })).toBeEnabled();

    rerender(<Harness pct={92.41} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "CTA" })).toBeDisabled();
    expect(screen.getByRole("alert").textContent).toContain("92.41%");
  });

  it("[R5v2] tolerates a worsening re-quote within the 1pp margin", () => {
    const { rerender } = renderWithProviders(<Harness pct={15} />);
    fireEvent.click(screen.getByRole("checkbox"));
    rerender(<Harness pct={15.8} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("button", { name: "CTA" })).toBeEnabled();
  });
});
