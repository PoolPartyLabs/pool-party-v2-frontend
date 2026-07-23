/**
 * @id PP-CORE-CMP-060
 * @name CollapsibleReceiptRows.test
 *
 * POO-800 R1: the shared collapsible Review/Receipt card keeps the summary rows always visible and
 * hides the fee detail behind a "Show more / Show less" toggle. Rows below the toggle (`after`) and
 * the caption `footer` stay visible in both states; the toggle disappears when there is no detail
 * to reveal; the trigger is wired for assistive tech (aria-expanded + aria-controls).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CollapsibleReceiptRows } from "./CollapsibleReceiptRows";

const summary = [[{ label: "Amount", value: "$100.00" }]];
const details = [
  [
    { label: "Est. fee", value: "$0.55" },
    { label: "Price impact", value: "0.10%" },
  ],
];
const after = [[{ label: "Receive as", value: "USDC" }]];

function renderCard(props: Partial<Parameters<typeof CollapsibleReceiptRows>[0]> = {}) {
  return render(
    <CollapsibleReceiptRows
      summary={summary}
      details={details}
      showMoreLabel="Show more"
      showLessLabel="Show less"
      {...props}
    />,
  );
}

describe("CollapsibleReceiptRows", () => {
  // @rule R1 — compact by default: summary visible, fee detail behind Show more.
  it("starts collapsed: summary visible, detail rows hidden behind Show more", () => {
    renderCard();
    expect(screen.getByText("Amount")).toBeVisible();
    expect(screen.getByText("Est. fee")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });

  // @rule R1 — the toggle reveals the fee detail and flips its label.
  it("Show more reveals the detail rows and flips to Show less", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Est. fee")).toBeVisible();
    expect(screen.getByText("Price impact")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
  });

  it("Show less collapses the detail again", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    fireEvent.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getByText("Est. fee")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
  });

  it("can start expanded via defaultOpen", () => {
    renderCard({ defaultOpen: true });
    expect(screen.getByText("Est. fee")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
  });

  // @rule R1 — rows below the toggle (Receive as) and the caption footer never collapse.
  it("keeps the after rows and the footer visible in both states", () => {
    renderCard({ after, footer: <p>after fees &amp; max. 2% slippage</p> });
    expect(screen.getByText("Receive as")).toBeVisible();
    expect(screen.getByText("after fees & max. 2% slippage")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getByText("Receive as")).toBeVisible();
    expect(screen.getByText("after fees & max. 2% slippage")).toBeVisible();
  });

  it("renders no toggle when there is no detail to reveal", () => {
    renderCard({ details: [[]] });
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("wires the toggle for assistive tech (aria-expanded + aria-controls)", () => {
    renderCard();
    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(document.getElementById(controls as string)).toContainElement(
      screen.getByText("Est. fee"),
    );
  });
});
