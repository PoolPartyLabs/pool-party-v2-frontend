/**
 * @id PP-CORE-CMP-059 (promoted from PP-STR-CMP-019)
 * @name FilterDropdown — tests
 * Behavior: the collapsed filter opens on click (trigger `aria-expanded` toggles), closes on Escape
 * and on focus leaving the control, commits + closes on option select, and a non-neutral (non-first)
 * selection gives the trigger its active style. Mirrors {@link CountrySelect}'s test style.
 */
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { FilterDropdown, type FilterOption } from "./FilterDropdown";

const options: FilterOption<number | null>[] = [
  { value: null, label: "All" },
  { value: 1, label: "Conservative" },
  { value: 2, label: "Bold" },
];

function setup(value: number | null = null) {
  const onSelect = vi.fn();
  renderWithProviders(
    <FilterDropdown label="Browse by risk" value={value} onSelect={onSelect} options={options} />,
  );
  // The trigger's accessible name is "section: current selection".
  const trigger = screen.getByRole("button", {
    name: `Browse by risk: ${options.find((o) => o.value === value)?.label ?? "All"}`,
  });
  return { onSelect, trigger };
}

describe("FilterDropdown", () => {
  it("opens the listbox on click and toggles aria-expanded", async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // A second click collapses it again.
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes the listbox on Escape", async () => {
    const user = userEvent.setup();
    const { trigger } = setup();
    await user.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes when focus leaves the control (blur to outside)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <FilterDropdown label="Browse by risk" value={null} onSelect={vi.fn()} options={options} />
        <button type="button">outside</button>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Browse by risk: All" }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // Tab away to the sibling button: focus leaves the control, which closes the menu.
    await user.click(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("commits the picked value and closes on select", async () => {
    const user = userEvent.setup();
    const { onSelect, trigger } = setup();
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "Conservative" }));
    expect(onSelect).toHaveBeenCalledWith(1);
    // The menu closes after a commit.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("gives the trigger its active style for a non-neutral (non-first) selection", () => {
    // Neutral (first option) trigger stays muted; a committed non-neutral value flips it to active.
    const { rerender } = renderWithProviders(
      <FilterDropdown label="Browse by risk" value={null} onSelect={vi.fn()} options={options} />,
    );
    const neutral = screen.getByRole("button", { name: "Browse by risk: All" });
    expect(neutral).toHaveClass("text-muted-foreground");
    expect(neutral).not.toHaveClass("bg-surface-raised");

    rerender(
      <FilterDropdown label="Browse by risk" value={1} onSelect={vi.fn()} options={options} />,
    );
    const active = screen.getByRole("button", { name: "Browse by risk: Conservative" });
    expect(active).toHaveClass("bg-surface-raised");
    expect(active).toHaveClass("border-input");
  });
});
