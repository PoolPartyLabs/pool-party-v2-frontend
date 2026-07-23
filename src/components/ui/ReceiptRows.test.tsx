/**
 * @id PP-CORE-CMP-027
 * @name ReceiptRows — tests
 * Behavior (POO-279 R5/R6): rows render label/value with semantic tones; dividers appear only
 * BETWEEN groups; Action rows are tappable.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../tests/utils/renderWithProviders";
import { ReceiptRows } from "./ReceiptRows";

describe("ReceiptRows", () => {
  // @rule R5 — tone variants
  it("renders rows with their semantic tones", () => {
    renderWithProviders(
      <ReceiptRows
        groups={[
          [
            { label: "Yield earned", value: "$120.00", tone: "positive" },
            { label: "Fee (instant)", value: "-$5.00", tone: "negative" },
          ],
          [{ label: "You receive", value: "$115.00", tone: "emphasis" }],
          // POO-613: amber warning tone for a high price impact (never red/destructive).
          [{ label: "Price impact", value: "3.20%", tone: "warning" }],
          [{ label: "Network fee", value: "$0.30" }],
        ]}
      />,
    );
    expect(screen.getByText("$120.00")).toHaveClass("text-success");
    expect(screen.getByText("-$5.00")).toHaveClass("text-destructive");
    expect(screen.getByText("$115.00")).toHaveClass("font-semibold");
    expect(screen.getByText("3.20%")).toHaveClass("text-warning");
    expect(screen.getByText("3.20%")).not.toHaveClass("text-destructive");
    expect(screen.getByText("$0.30")).toHaveClass("font-medium");
  });

  // @rule R6 — divider only BETWEEN groups
  it("draws dividers only between groups", () => {
    const { container } = renderWithProviders(
      <ReceiptRows
        groups={[
          [
            { label: "A", value: "1" },
            { label: "B", value: "2" },
          ],
          [{ label: "C", value: "3" }],
          [{ label: "D", value: "4" }],
        ]}
      />,
    );
    // 3 groups → 2 dividers, regardless of the 4 rows.
    expect(container.querySelectorAll(".border-t")).toHaveLength(2);
  });

  // @rule R5 — Action variant
  it("renders an Action row as a tappable button", () => {
    const onAction = vi.fn();
    renderWithProviders(
      <ReceiptRows groups={[[{ label: "Max slippage", value: "0.5%", onAction }]]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /0\.5%/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("skips empty groups without leaving stray dividers", () => {
    const { container } = renderWithProviders(
      <ReceiptRows groups={[[], [{ label: "Only", value: "row" }]]} />,
    );
    expect(container.querySelectorAll(".border-t")).toHaveLength(0);
  });

  // @rule R3 (POO-384) — an info (ⓘ) tooltip trigger renders next to the label, and the tooltip
  // text is exposed as the trigger's accessible name (aria-label) for a11y + i18n-safe assertions.
  it("renders an info tooltip next to the label when `tooltip` is set", () => {
    renderWithProviders(
      <ReceiptRows
        groups={[
          [
            {
              label: "Fees",
              value: "-$1.20",
              tone: "negative",
              tooltip: "DEX fee + Protocol fee (0.25%)",
            },
          ],
        ]}
      />,
    );
    // The tooltip body is the trigger's accessible name, so it is readable without opening it.
    expect(
      screen.getByRole("button", { name: "DEX fee + Protocol fee (0.25%)" }),
    ).toBeInTheDocument();
  });

  it("does not render a tooltip trigger when `tooltip` is absent (backward compatible)", () => {
    renderWithProviders(<ReceiptRows groups={[[{ label: "Network fee", value: "$0.30" }]]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // @rule POO-840 R1 — Radix tooltips never open on a plain tap, so the fee-breakdown (i) is
  // tap-dead on phones unless the open state is controlled (the AprTooltip POO-485 pattern).
  it("[POO-840 R1] opens the info tooltip on tap", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReceiptRows
        groups={[
          [
            {
              label: "Fees",
              value: "-$1.20",
              tooltip: { label: "Fee breakdown", body: "DEX fee + Protocol fee (0.25%)" },
            },
          ],
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Fee breakdown" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("DEX fee + Protocol fee (0.25%)");
  });

  // @rule POO-840 R2 — the 14px (i) carries an expanded (~44px) touch target via an ::after
  // hit-area, without changing its visual size or the row layout.
  it("[POO-840 R2] the info trigger carries an expanded touch target", () => {
    renderWithProviders(
      <ReceiptRows groups={[[{ label: "Fees", value: "-$1.20", tooltip: "Fee breakdown" }]]} />,
    );
    const trigger = screen.getByRole("button", { name: "Fee breakdown" });
    expect(trigger).toHaveClass("relative");
    expect(trigger).toHaveClass("after:absolute");
    expect(trigger).toHaveClass("after:-inset-3.5");
  });

  // POO-839 R4 — long, unbroken values (strategy names) wrap right-aligned and never overflow:
  // both cells can shrink (min-w-0) and the value breaks (break-words).
  it("contains long values: value cell wraps and both cells can shrink", () => {
    renderWithProviders(
      <ReceiptRows
        groups={[
          [{ label: "Strategy", value: "AVeryLongUnbrokenStrategyNameThatWouldOverflowTheRow" }],
        ]}
      />,
    );
    const label = screen.getByText("Strategy");
    const value = screen.getByText("AVeryLongUnbrokenStrategyNameThatWouldOverflowTheRow");
    expect(label).toHaveClass("min-w-0");
    expect(value).toHaveClass("min-w-0");
    expect(value).toHaveClass("break-words");
  });
});
