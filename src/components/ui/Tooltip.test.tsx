/**
 * @id PP-CORE-CMP-015
 * @name Tooltip.test
 * @implements-rules-version v1
 * Behavior tests for the Tooltip primitive (focus reveals content; placement props forwarded).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./Tooltip";

/** Self-contained tooltip: zero delay so focus reveals content without fake timers. */
function Fixture() {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger>Hint trigger</TooltipTrigger>
        <TooltipContent>Helpful hint</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe("Tooltip", () => {
  it("reveals tooltip content when the trigger receives keyboard focus", async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    // Content is not in the document until the trigger is interacted with.
    expect(screen.queryByText("Helpful hint")).not.toBeInTheDocument();

    // Tab moves focus to the trigger; Radix opens the tooltip on focus.
    await user.tab();
    expect(screen.getByText("Hint trigger")).toHaveFocus();

    // Radix renders the visible content (role="tooltip") once focused.
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent("Helpful hint");
    });
  });
});
