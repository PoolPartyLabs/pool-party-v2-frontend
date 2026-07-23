/**
 * @id PP-PROF-CMP-005
 * @name FaqItem — tests
 */
import { describe, expect, it } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { FaqItem } from "./FaqItem";

describe("FaqItem", () => {
  it("expands to reveal the answer", () => {
    renderWithProviders(<FaqItem question="How do deposits work?" answer="Add money easily." />);
    expect(screen.queryByText("Add money easily.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "How do deposits work?" }));
    expect(screen.getByText("Add money easily.")).toBeInTheDocument();
  });
});
