/**
 * @id PP-CORE-CMP-035
 * @name CollapsibleCard.test
 * Behavior: the body is open by default and the header toggles it (aria-expanded reflects state);
 * `defaultOpen={false}` starts collapsed; the `aside` renders in the always-visible header.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CollapsibleCard } from "./CollapsibleCard";

describe("CollapsibleCard", () => {
  it("opens by default and toggles the body from the header", () => {
    render(
      <CollapsibleCard title="Range">
        <p>band content</p>
      </CollapsibleCard>,
    );
    const header = screen.getByRole("button", { name: /Range/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("band content")).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("band content")).toBeNull();

    fireEvent.click(header);
    expect(screen.getByText("band content")).toBeInTheDocument();
  });

  it("starts collapsed with defaultOpen=false and keeps the aside visible", () => {
    render(
      <CollapsibleCard title="Recent activity" defaultOpen={false} aside={<span>status chip</span>}>
        <p>hidden body</p>
      </CollapsibleCard>,
    );
    expect(screen.getByText("status chip")).toBeInTheDocument();
    expect(screen.queryByText("hidden body")).toBeNull();
    expect(screen.getByRole("button", { name: /Recent activity/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // POO-434 R4: a `peek` shows only when collapsed (e.g. the range bar without its numbers); the
  // full body takes over when expanded.
  it("[POO-434] shows the peek only when collapsed and the body when open", () => {
    render(
      <CollapsibleCard title="Range" peek={<p>bar only</p>}>
        <p>bar and values</p>
      </CollapsibleCard>,
    );
    const header = screen.getByRole("button", { name: /Range/ });
    // Open: the full body shows, the peek does not.
    expect(screen.getByText("bar and values")).toBeInTheDocument();
    expect(screen.queryByText("bar only")).toBeNull();
    // Collapsed: the peek shows, the full body does not.
    fireEvent.click(header);
    expect(screen.getByText("bar only")).toBeInTheDocument();
    expect(screen.queryByText("bar and values")).toBeNull();
  });
});
