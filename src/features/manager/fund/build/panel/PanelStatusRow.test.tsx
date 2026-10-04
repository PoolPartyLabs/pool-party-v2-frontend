/**
 * @id PP-MGR-CMP-065
 * @name PanelStatusRow tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational row under test
 *
 * The status row above Apply changes (handoff P5) and its notice (P6): three states, Discard, and
 * the notice that is an alert, comes into view and takes focus on every refused exit.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PanelStatus, PanelStatusRow } from "./PanelStatusRow";

const COPY = {
  pending: "Changes not applied",
  applied: "All changes applied",
  discard: "Discard",
  leaveTitle: "Changes not applied",
  leaveBody: "You changed this block and did not apply.",
  leaveDiscard: "Discard changes",
};

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  // jsdom has no scrollIntoView of its own.
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

function renderRow(status: PanelStatus, attempt = 0, onDiscard = vi.fn()) {
  const view = render(
    <PanelStatusRow status={status} copy={COPY} onDiscard={onDiscard} attempt={attempt} />,
  );
  return { ...view, onDiscard };
}

describe("PanelStatusRow (P5, P6)", () => {
  it("[P5] pending: says so, and Discard is a button", async () => {
    // @rule P5
    const { onDiscard } = renderRow("pending");
    expect(screen.getByText("Changes not applied")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("[P5] applied: the check and its sentence, with nothing to press", () => {
    // @rule P5
    renderRow("applied");
    expect(screen.getByText("All changes applied")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("[P6] leave blocked: an alert that comes into view and takes focus", async () => {
    // @rule P6
    const { onDiscard } = renderRow("leaveBlocked", 1);
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Changes not applied");
    expect(notice).toHaveTextContent("You changed this block and did not apply.");
    expect(notice).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("[P6] every new refusal brings the notice back into view and focus", () => {
    // @rule P6
    const { rerender } = renderRow("leaveBlocked", 1);
    screen.getByRole("alert").blur();
    rerender(<PanelStatusRow status="leaveBlocked" copy={COPY} onDiscard={() => {}} attempt={2} />);
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
