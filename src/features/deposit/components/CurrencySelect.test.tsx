/**
 * @id PP-DEP-CMP-006 — tests
 * @name CurrencySelect — tests
 * @implements-rules-version v1 (POO-1613 rules v1)
 *
 * POO-1613: the resolved currency is always named (real data, both modes). The INTERACTIVE control
 * (open menu, search, pick) exists only when the host hands it options (mock mode only, until
 * POO-1621 ships the real supported set) — never a Select whose options came from a fixture in
 * real mode.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { CurrencySelect } from "./CurrencySelect";

describe("CurrencySelect", () => {
  it("renders nothing when the currency cannot be resolved (AC3: never guess)", () => {
    const { container } = renderWithProviders(<CurrencySelect />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the resolved currency as plain text when no options are given (real mode today)", () => {
    renderWithProviders(<CurrencySelect currencyCode="USD" />);
    expect(screen.getByText(/USD/)).toBeInTheDocument();
    expect(screen.getByText(/US Dollar/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("stays plain text even with options if onSelect is not wired (never interactive by accident)", () => {
    renderWithProviders(<CurrencySelect currencyCode="USD" options={["USD", "EUR"]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("becomes an interactive control when both options and onSelect are given (mock mode)", async () => {
    renderWithProviders(
      <CurrencySelect currencyCode="USD" options={["USD", "EUR", "BRL"]} onSelect={vi.fn()} />,
    );
    const trigger = screen.getByRole("button");
    expect(trigger).toHaveTextContent("USD");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // The resolved default sits first and radio-marked.
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("USD");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Payment methods change with the currency.")).toBeInTheDocument();
  });

  it("searches by code or name", async () => {
    renderWithProviders(
      <CurrencySelect currencyCode="USD" options={["USD", "EUR", "BRL"]} onSelect={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "bra" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("BRL");
  });

  it("commits on click and closes the menu", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <CurrencySelect currencyCode="USD" options={["USD", "EUR", "BRL"]} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("option", { name: /EUR/ }));
    expect(onSelect).toHaveBeenCalledWith("EUR");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape without committing anything", () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <CurrencySelect currencyCode="USD" options={["USD", "EUR"]} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("listbox").parentElement as Element, {
      key: "Escape",
      code: "Escape",
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
