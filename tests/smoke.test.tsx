import { describe, expect, it } from "vitest";
import { renderWithProviders, screen } from "./utils/renderWithProviders";

describe("test harness", () => {
  it("renders a component and applies jest-dom matchers", () => {
    renderWithProviders(<button type="button">Quack</button>);
    expect(screen.getByRole("button", { name: "Quack" })).toBeInTheDocument();
  });
});
