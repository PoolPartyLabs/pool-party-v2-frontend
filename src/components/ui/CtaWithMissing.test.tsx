/**
 * @id PP-CORE-CMP-022
 * @name CtaWithMissing.test
 * @implements-rules-version v1
 *
 * Behavior: when fields are missing the CTA is aria-disabled and a tap reveals the list instead of
 * firing the action; when nothing is missing it runs `onClick` and shows no reveal.
 */
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { CtaWithMissing } from "./CtaWithMissing";

describe("CtaWithMissing", () => {
  it("blocks the action and reveals the missing fields on tap", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithProviders(
      <CtaWithMissing
        missing={["Pool", "Name"]}
        missingTitle="Complete to continue:"
        onClick={onClick}
      >
        Launch
      </CtaWithMissing>,
    );

    const button = screen.getByRole("button", { name: "Launch" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    // Nothing is revealed until the user tries to act.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Complete to continue:");
    expect(status).toHaveTextContent("Pool");
    expect(status).toHaveTextContent("Name");
  });

  it("runs the action when nothing is missing", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderWithProviders(
      <CtaWithMissing missing={[]} missingTitle="Complete to continue:" onClick={onClick}>
        Launch
      </CtaWithMissing>,
    );

    const button = screen.getByRole("button", { name: "Launch" });
    expect(button).not.toHaveAttribute("aria-disabled");

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
