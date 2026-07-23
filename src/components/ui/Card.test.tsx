import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./Card";

describe("Card", () => {
  it("renders the full composition with all parts and their children", () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Portfolio</CardTitle>
          <CardDescription>Your active positions</CardDescription>
        </CardHeader>
        <CardContent>Balance: $12,500</CardContent>
        <CardFooter>
          <button type="button">Manage</button>
        </CardFooter>
      </Card>,
    );

    expect(screen.getByTestId("card")).toBeInTheDocument();
    expect(screen.getByText("Portfolio")).toBeInTheDocument();
    expect(screen.getByText("Your active positions")).toBeInTheDocument();
    expect(screen.getByText("Balance: $12,500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
  });

  it("renders CardTitle as a level-3 heading", () => {
    render(<CardTitle>Heading</CardTitle>);

    expect(screen.getByRole("heading", { level: 3, name: "Heading" })).toBeInTheDocument();
  });

  it("merges a consumer className onto the card surface defaults", () => {
    render(
      <Card data-testid="card" className="rounded-xl">
        Body
      </Card>,
    );

    const card = screen.getByTestId("card");
    expect(card).toHaveClass("bg-surface", "border", "border-border", "rounded-xl");
    expect(card).not.toHaveClass("rounded-lg");
  });

  it("forwards native div props such as aria-label", () => {
    render(
      <Card aria-label="Account summary" data-testid="card">
        Body
      </Card>,
    );

    expect(screen.getByTestId("card")).toHaveAttribute("aria-label", "Account summary");
  });
});
