/**
 * @id PP-CORE-CMP-014
 * @name Tabs.test
 * @implements-rules-version v1
 * Behavior tests for the Tabs primitive (content switching, keyboard nav, controlled mode).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

function Fixture(props: React.ComponentProps<typeof Tabs>) {
  return (
    <Tabs defaultValue="overview" {...props}>
      <TabsList aria-label="Sections">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="holdings">Holdings</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview panel</TabsContent>
      <TabsContent value="holdings">Holdings panel</TabsContent>
      <TabsContent value="activity">Activity panel</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders the default tab's content and hides the others", () => {
    render(<Fixture />);
    expect(screen.getByText("Overview panel")).toBeVisible();
    expect(screen.queryByText("Holdings panel")).not.toBeInTheDocument();
  });

  it("switches the visible content when a trigger is clicked", async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    await user.click(screen.getByRole("tab", { name: "Holdings" }));

    expect(screen.getByText("Holdings panel")).toBeVisible();
    expect(screen.queryByText("Overview panel")).not.toBeInTheDocument();
  });

  it("marks the active trigger with aria-selected", async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    const holdings = screen.getByRole("tab", { name: "Holdings" });
    expect(holdings).toHaveAttribute("aria-selected", "false");

    await user.click(holdings);

    expect(holdings).toHaveAttribute("aria-selected", "true");
  });

  it("moves focus between triggers with arrow keys", async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Holdings" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveFocus();
  });

  it("supports controlled usage via value and onValueChange", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    function Controlled() {
      const [value, setValue] = useState("overview");
      return (
        <Fixture
          value={value}
          defaultValue={undefined}
          onValueChange={(next) => {
            onValueChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Controlled />);
    await user.click(screen.getByRole("tab", { name: "Activity" }));

    expect(onValueChange).toHaveBeenCalledWith("activity");
    expect(screen.getByText("Activity panel")).toBeVisible();
  });

  it("merges a consumer-supplied className onto the list", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList className="custom-list" aria-label="x">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole("tablist")).toHaveClass("custom-list");
  });
});
