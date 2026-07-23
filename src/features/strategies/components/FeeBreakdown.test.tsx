/**
 * @id PP-STR-CMP-018
 * @name FeeBreakdown.test
 *
 * The body shows every fee line; a bold Total appears only when >1 line (a gas-only flow shows a
 * single line, no Total). feeFlatLabel mirrors that for the accessible tooltip name. POO-800: a
 * display-only line (Bridge "Coming soon") renders its text instead of a USD figure and stays out
 * of the Total; buildCanonicalFeeLines enforces the canonical DEX · Network · Protocol ·
 * Performance · Bridge order, hiding any line without a real figure; buildMaxSlippageRow renders
 * the gear slippage with an "Auto" badge when the default applies (epic decision #7).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  buildCanonicalFeeLines,
  buildFeeRow,
  buildMaxSlippageRow,
  buildPriceImpactRow,
  FeeBreakdownBody,
  type FeeLine,
  feeFlatLabel,
  HIGH_PRICE_IMPACT_PCT,
} from "./FeeBreakdown";

const multi: FeeLine[] = [
  { key: "protocol", label: "Protocol fee (0.25%)", usd: 2.5 },
  { key: "network", label: "Estimated gas (network fee)", usd: 0.3 },
];
const single: FeeLine[] = [{ key: "network", label: "Estimated gas (network fee)", usd: 0.3 }];

describe("FeeBreakdownBody", () => {
  it("renders each fee line and a Total when there is more than one line", () => {
    render(<FeeBreakdownBody lines={multi} totalLabel="Total" totalUsd={2.8} />);
    expect(screen.getByText("Protocol fee (0.25%)")).toBeInTheDocument();
    expect(screen.getByText("Estimated gas (network fee)")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("$2.80")).toBeInTheDocument();
  });

  it("omits the Total row for a single (gas-only) line", () => {
    render(<FeeBreakdownBody lines={single} totalLabel="Total" totalUsd={0.3} />);
    expect(screen.getByText("Estimated gas (network fee)")).toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });
});

describe("feeFlatLabel", () => {
  it("joins the lines and appends the total when >1 line", () => {
    expect(feeFlatLabel(multi, "Total", 2.8)).toBe(
      "Protocol fee (0.25%) $2.50 · Estimated gas (network fee) $0.30 · Total $2.80",
    );
  });

  it("is just the single line for a gas-only flow (no Total)", () => {
    expect(feeFlatLabel(single, "Total", 0.3)).toBe("Estimated gas (network fee) $0.30");
  });
});

describe("buildFeeRow", () => {
  // @rule R4 — one consolidated Fee row whose tooltip breaks the total down
  it("sums the lines into the row value and a breakdown tooltip", () => {
    const row = buildFeeRow({ label: "Fee", lines: multi, totalLabel: "Total" });
    expect(row.label).toBe("Fee");
    expect(row.value).toBe("$2.80");
    // The object tooltip keeps a flat accessible name plus a rich body.
    expect(typeof row.tooltip).toBe("object");
    expect((row.tooltip as { label: string }).label).toBe(
      "Protocol fee (0.25%) $2.50 · Estimated gas (network fee) $0.30 · Total $2.80",
    );
  });

  // @rule R5 — fees are never rendered in red
  it("never sets a negative (red) tone", () => {
    const row = buildFeeRow({ label: "Fee", lines: multi, totalLabel: "Total" });
    expect(row.tone).not.toBe("negative");
  });

  it("renders its breakdown body from the tooltip", () => {
    const row = buildFeeRow({ label: "Fee", lines: single, totalLabel: "Total" });
    const tip = row.tooltip;
    if (tip == null || typeof tip !== "object") throw new Error("expected an object tooltip");
    render(<div>{tip.body}</div>);
    expect(screen.getByText("Estimated gas (network fee)")).toBeInTheDocument();
  });
});

describe("buildPriceImpactRow (POO-612 / POO-613)", () => {
  it("formats the impact as a 2-decimal percent and stays neutral below the threshold", () => {
    const row = buildPriceImpactRow("Price impact", 0.5);
    expect(row.label).toBe("Price impact");
    expect(row.value).toBe("0.50%");
    expect(row.tone).toBe("default");
  });

  // @rule POO-613 R2 — a high price impact turns the row amber (warning), never red.
  it("turns amber (warning) at or above the 2% threshold", () => {
    expect(buildPriceImpactRow("Price impact", HIGH_PRICE_IMPACT_PCT).tone).toBe("warning");
    expect(buildPriceImpactRow("Price impact", 5.3).tone).toBe("warning");
    expect(buildPriceImpactRow("Price impact", HIGH_PRICE_IMPACT_PCT).tone).not.toBe("negative");
  });

  it("stays neutral just below the threshold", () => {
    expect(buildPriceImpactRow("Price impact", 1.99).tone).toBe("default");
  });
});

const withBridge: FeeLine[] = [
  { key: "network", label: "Estimated gas (network fee)", usd: 0.3 },
  { key: "bridge", label: "Bridge fee", usd: 0, display: "Coming soon" },
];

describe("display-only fee lines (POO-800 R2/R3)", () => {
  // @rule R3 — the Bridge placeholder is display-only: text instead of a fabricated USD figure.
  it("renders the display text instead of a USD figure", () => {
    render(<FeeBreakdownBody lines={withBridge} totalLabel="Total" totalUsd={0.3} />);
    expect(screen.getByText("Bridge fee")).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("counts as a line for the Total rule but never adds to the summed value", () => {
    const row = buildFeeRow({ label: "Est. fee", lines: withBridge, totalLabel: "Total" });
    // The row value sums only the real figures; the display-only line contributes nothing.
    expect(row.value).toBe("$0.30");
    expect((row.tooltip as { label: string }).label).toBe(
      "Estimated gas (network fee) $0.30 · Bridge fee Coming soon · Total $0.30",
    );
  });
});

const CANONICAL_LABELS = {
  dex: "DEX fee",
  network: "Estimated gas (network fee)",
  protocol: "Protocol fee",
  performance: "Performance fee",
  bridge: "Bridge fee",
  comingSoon: "Coming soon",
};

describe("buildCanonicalFeeLines (POO-800 R2/R3)", () => {
  // @rule R2 — ONE tooltip, lines in canonical order.
  it("orders the lines DEX · Network · Protocol · Performance · Bridge", () => {
    const lines = buildCanonicalFeeLines({
      labels: CANONICAL_LABELS,
      dexUsd: 0.05,
      networkUsd: 0.3,
      protocolUsd: 0.25,
      performanceUsd: 1.2,
      crossChain: true,
    });
    expect(lines.map((line) => line.key)).toEqual([
      "dex",
      "network",
      "protocol",
      "performance",
      "bridge",
    ]);
    expect(lines.map((line) => line.label)).toEqual([
      "DEX fee",
      "Estimated gas (network fee)",
      "Protocol fee",
      "Performance fee",
      "Bridge fee",
    ]);
  });

  // @rule global directive #1 — a missing figure hides the line; nothing is ever fabricated.
  it("omits any line whose figure is unavailable", () => {
    const lines = buildCanonicalFeeLines({ labels: CANONICAL_LABELS, networkUsd: 0.3 });
    expect(lines.map((line) => line.key)).toEqual(["network"]);
  });

  it("keeps a zero figure (a real $0 fee is data, not absence)", () => {
    const lines = buildCanonicalFeeLines({
      labels: CANONICAL_LABELS,
      networkUsd: 0.3,
      protocolUsd: 0,
    });
    expect(lines.map((line) => line.key)).toEqual(["network", "protocol"]);
  });

  // @rule R3 + epic decision #2 — Bridge renders on cross-chain flows only, as a placeholder.
  it("shows the Bridge placeholder only on cross-chain flows, display-only", () => {
    const sameChain = buildCanonicalFeeLines({ labels: CANONICAL_LABELS, networkUsd: 0.3 });
    expect(sameChain.some((line) => line.key === "bridge")).toBe(false);
    const crossChain = buildCanonicalFeeLines({
      labels: CANONICAL_LABELS,
      networkUsd: 0.3,
      crossChain: true,
    });
    const bridge = crossChain.find((line) => line.key === "bridge");
    expect(bridge?.display).toBe("Coming soon");
    expect(bridge?.usd).toBe(0);
  });
});

describe("buildMaxSlippageRow (POO-800 R1, epic decision #7)", () => {
  it("renders a custom slippage as the plain percent", () => {
    const row = buildMaxSlippageRow({ label: "Max. slippage", slippagePct: 0.5 });
    expect(row.label).toBe("Max. slippage");
    expect(row.value).toBe("0.5%");
  });

  // @rule epic decision #7 — the default slippage carries an "Auto" badge next to the percent.
  it("adds the Auto badge when the default slippage applies", () => {
    const row = buildMaxSlippageRow({ label: "Max. slippage", slippagePct: 2, autoLabel: "Auto" });
    render(<div>{row.value}</div>);
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("2%")).toBeInTheDocument();
  });

  it("stays neutral (fees and settings are never red)", () => {
    expect(buildMaxSlippageRow({ label: "Max. slippage", slippagePct: 2 }).tone).not.toBe(
      "negative",
    );
  });
});
