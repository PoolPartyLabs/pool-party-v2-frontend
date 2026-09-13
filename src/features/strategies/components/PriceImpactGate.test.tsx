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
 *
 * POO-1172 adds the gate's own instrumentation to the same hook, and the second describe below locks
 * it: `tx_impact_gate_blocked` fires from DERIVED state once per engagement (the Review re-quotes
 * every 5s, so an unlatched emitter would report the same blocked quote twelve times a minute) and
 * re-arms only after the gate has actually RELEASED; `tx_impact_gate_acknowledged` fires on the
 * user's override and on nothing else, because the number that matters is the override RATE and
 * both a toggle-off and the effect's programmatic reset would corrupt it.
 *
 * Assertions read `window.dataLayer` rather than a mocked `track`, so what is asserted is what GTM
 * would really receive, sanitizer included (the convention of ProvisioningPanel.analytics.test.tsx).
 */
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import {
  CATASTROPHIC_PRICE_IMPACT_PCT,
  isCatastrophicPriceImpact,
  PriceImpactGate,
  type PriceImpactGateAnalytics,
  usePriceImpactGate,
} from "./PriceImpactGate";

function Harness({
  pct,
  active = true,
  analytics,
}: {
  pct?: number;
  active?: boolean;
  analytics?: PriceImpactGateAnalytics;
}) {
  const gate = usePriceImpactGate(pct, active, analytics);
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

/** Every gate event GTM would have received so far, in emission order. */
function gateEvents(name: "tx_impact_gate_blocked" | "tx_impact_gate_acknowledged") {
  return ((window.dataLayer ?? []) as Record<string, unknown>[]).filter(
    (entry) => entry.event === name,
  );
}

/** Fresh dataLayer per test: the counts below are the whole point, so they cannot carry over. */
beforeEach(() => {
  window.dataLayer = [];
});

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

describe("usePriceImpactGate — instrumentation (POO-1172)", () => {
  const ctx: PriceImpactGateAnalytics = { flow: "invest", strategyId: "str-usdc-eth-1" };

  it("[P0] reports the block ONCE per engagement, with the impact pct that caused it", () => {
    const { rerender } = renderWithProviders(<Harness pct={15} analytics={ctx} />);
    expect(gateEvents("tx_impact_gate_blocked")).toHaveLength(1);
    expect(gateEvents("tx_impact_gate_blocked")[0]).toMatchObject({
      event: "tx_impact_gate_blocked",
      flow: "invest",
      strategy_id: "str-usdc-eth-1",
      metric_name: "price_impact_pct",
      metric_value: 15,
    });

    // The Review re-quotes every 5s. Same figure, then worse ones: the gate never released, so this
    // is still ONE engagement. An unlatched emitter would turn a single blocked user into a series.
    rerender(<Harness pct={15} analytics={ctx} />);
    rerender(<Harness pct={41.7} analytics={ctx} />);
    rerender(<Harness pct={92.41} analytics={ctx} />);
    expect(screen.getByRole("button", { name: "CTA" })).toBeDisabled();
    expect(gateEvents("tx_impact_gate_blocked")).toHaveLength(1);
  });

  it("[P0] re-arms after the gate RELEASES below the threshold, and reports the new figure", () => {
    const { rerender } = renderWithProviders(<Harness pct={15} analytics={ctx} />);
    expect(gateEvents("tx_impact_gate_blocked")).toHaveLength(1);

    // Routing improves: the gate releases entirely (no alert, CTA enabled). Still one event.
    rerender(<Harness pct={1.2} analytics={ctx} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(gateEvents("tx_impact_gate_blocked")).toHaveLength(1);

    // It degrades again: a genuinely NEW engagement, reported at its own pct.
    rerender(<Harness pct={92.41} analytics={ctx} />);
    const blocked = gateEvents("tx_impact_gate_blocked");
    expect(blocked).toHaveLength(2);
    expect(blocked[1]).toMatchObject({ metric_value: 92.41 });
  });

  it("[P0] re-arms when the acknowledgment releases the gate and a worsening re-quote re-blocks it", () => {
    const { rerender } = renderWithProviders(<Harness pct={15} analytics={ctx} />);
    expect(gateEvents("tx_impact_gate_blocked")).toHaveLength(1);

    // Acknowledging releases the CTA: the gate is no longer blocking.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "CTA" })).toBeEnabled();
    expect(gateEvents("tx_impact_gate_blocked")).toHaveLength(1);

    // [R5v2] the re-quote invalidates that consent and blocks again: a second block to report.
    rerender(<Harness pct={92.41} analytics={ctx} />);
    expect(screen.getByRole("button", { name: "CTA" })).toBeDisabled();
    const blocked = gateEvents("tx_impact_gate_blocked");
    expect(blocked).toHaveLength(2);
    expect(blocked[1]).toMatchObject({ metric_value: 92.41 });
  });

  it("[P0] stays silent while the Review is not showing, and reports on the way in", () => {
    const { rerender } = renderWithProviders(<Harness pct={15} active={false} analytics={ctx} />);
    expect(gateEvents("tx_impact_gate_blocked")).toHaveLength(0);

    rerender(<Harness pct={15} active analytics={ctx} />);
    expect(gateEvents("tx_impact_gate_blocked")).toHaveLength(1);
  });

  it("[R1/R4] never reports a block below the threshold or without a figure", () => {
    const { rerender } = renderWithProviders(<Harness pct={4.5} analytics={ctx} />);
    rerender(<Harness pct={undefined} analytics={ctx} />);
    rerender(<Harness pct={CATASTROPHIC_PRICE_IMPACT_PCT - 0.01} analytics={ctx} />);
    expect(gateEvents("tx_impact_gate_blocked")).toHaveLength(0);
  });

  it("[P0] reports the acknowledgment on the user's override and NOT on the uncheck", () => {
    renderWithProviders(
      <Harness pct={92.41} analytics={{ flow: "withdraw", strategyId: "str-9" }} />,
    );
    expect(gateEvents("tx_impact_gate_acknowledged")).toHaveLength(0);

    fireEvent.click(screen.getByRole("checkbox"));
    const acked = gateEvents("tx_impact_gate_acknowledged");
    expect(acked).toHaveLength(1);
    expect(acked[0]).toMatchObject({
      event: "tx_impact_gate_acknowledged",
      flow: "withdraw",
      strategy_id: "str-9",
      metric_name: "price_impact_pct",
      metric_value: 92.41,
    });

    // Toggling off is not an override. Counting it would inflate the denominator's twin and make
    // the override rate (the entire reason the pair exists) unreadable.
    fireEvent.click(screen.getByRole("checkbox"));
    expect(gateEvents("tx_impact_gate_acknowledged")).toHaveLength(1);
  });

  it("[P0] does not report an acknowledgment for the effect's programmatic resets", () => {
    const { rerender } = renderWithProviders(<Harness pct={15} analytics={ctx} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(gateEvents("tx_impact_gate_acknowledged")).toHaveLength(1);

    // [R5v2] a worsening re-quote clears the consent from inside the effect (setAcknowledgedState,
    // not the user's setAcknowledged). No user decided anything, so there is nothing to report.
    rerender(<Harness pct={92.41} analytics={ctx} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(gateEvents("tx_impact_gate_acknowledged")).toHaveLength(1);

    // [R5] the same for the drop-below-threshold reset and for leaving the Review.
    fireEvent.click(screen.getByRole("checkbox"));
    rerender(<Harness pct={1.2} analytics={ctx} />);
    act(() => {
      rerender(<Harness pct={15} active={false} analytics={ctx} />);
    });
    expect(gateEvents("tx_impact_gate_acknowledged")).toHaveLength(2);
  });

  it("emits with no flow context at all when the host has not been wired yet", () => {
    renderWithProviders(<Harness pct={15} />);
    const blocked = gateEvents("tx_impact_gate_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).not.toHaveProperty("flow");
    expect(blocked[0]).not.toHaveProperty("strategy_id");
    expect(blocked[0]).toMatchObject({ metric_name: "price_impact_pct", metric_value: 15 });
  });
});
