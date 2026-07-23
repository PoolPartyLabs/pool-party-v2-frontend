/**
 * @id PP-CORE-CMP-055
 * @name NoCopy.test
 * Behavior: renders children, is non-selectable, and cancels copy / cut / context-menu while still
 * forwarding to a consumer handler.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { NoCopy } from "./NoCopy";

describe("NoCopy", () => {
  it("renders children and is non-selectable", () => {
    renderWithProviders(<NoCopy>Protected copy</NoCopy>);
    const region = screen.getByText("Protected copy");
    expect(region).toBeInTheDocument();
    expect(region).toHaveClass("select-none");
  });

  it("cancels copy and cut", () => {
    renderWithProviders(<NoCopy>Protected copy</NoCopy>);
    const region = screen.getByText("Protected copy");
    // fireEvent returns false when a handler called preventDefault on a cancelable event.
    expect(fireEvent.copy(region)).toBe(false);
    expect(fireEvent.cut(region)).toBe(false);
  });

  it("cancels the context menu", () => {
    renderWithProviders(<NoCopy>Protected copy</NoCopy>);
    expect(fireEvent.contextMenu(screen.getByText("Protected copy"))).toBe(false);
  });

  it("still forwards to a consumer handler after preventing", () => {
    const onCopy = vi.fn();
    renderWithProviders(<NoCopy onCopy={onCopy}>Protected copy</NoCopy>);
    fireEvent.copy(screen.getByText("Protected copy"));
    expect(onCopy).toHaveBeenCalled();
  });
});
