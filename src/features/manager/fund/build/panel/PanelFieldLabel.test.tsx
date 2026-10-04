/**
 * @id PP-MGR-CMP-062
 * @name PanelFieldLabel tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational label under test
 *
 * The label row of a panel field (handoff "Field label row"): the label, the (i) that carries the
 * help (never a caption under the field), and the value at the right end.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PanelFieldLabel } from "./PanelFieldLabel";

describe("PanelFieldLabel", () => {
  it("names the (i) button and describes it by the help text, which is never a caption", () => {
    // @rule Panel shell
    render(
      <PanelFieldLabel
        label="Allocation"
        help="Of the strategy's capital."
        helpLabel="More about Allocation"
        value="45%"
      />,
    );
    const help = screen.getByRole("button", { name: "More about Allocation" });
    expect(help).toHaveAccessibleDescription("Of the strategy's capital.");
    expect(screen.getByText("Allocation")).toBeInTheDocument();
    expect(screen.getByText("45%")).toBeInTheDocument();
    // The help is hidden until the tooltip opens: no caption under the field.
    expect(screen.getByText("Of the strategy's capital.")).not.toBeVisible();
  });

  it("labels a form control when it is given one", () => {
    render(
      <>
        <PanelFieldLabel label="Pool" help="Pools." helpLabel="More about Pool" htmlFor="pool" />
        <input id="pool" />
      </>,
    );
    expect(screen.getByLabelText("Pool")).toHaveAttribute("id", "pool");
  });
});
