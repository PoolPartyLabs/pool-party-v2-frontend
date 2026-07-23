/**
 * @name CountrySelect.test
 * Behavior: filters the country list as you type, commits the picked country via onChange, and shows
 * the no-results label on a miss.
 */
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { CountrySelect } from "./CountrySelect";

function setup(value = "") {
  const onChange = vi.fn();
  renderWithProviders(
    <CountrySelect
      label="Country"
      value={value}
      onChange={onChange}
      placeholder="Search country"
      noResultsLabel="No match"
    />,
  );
  return { onChange, input: screen.getByRole("combobox", { name: "Country" }) };
}

describe("CountrySelect", () => {
  it("filters and commits the picked country", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup();
    await user.type(input, "braz");
    const option = await screen.findByRole("option", { name: "Brazil" });
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith("Brazil");
  });

  it("shows the no-results label for a non-matching query", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.type(input, "zzzz");
    expect(await screen.findByText("No match")).toBeInTheDocument();
  });

  it("opens the list on focus before any typing", async () => {
    const user = userEvent.setup();
    const { input } = setup();
    await user.click(input);
    expect((await screen.findAllByRole("option")).length).toBeGreaterThan(0);
  });

  it("commits the active option via ArrowDown then Enter (keyboard path)", async () => {
    const user = userEvent.setup();
    const { onChange, input } = setup();
    // "brazil" filters to the single "Brazil" match, so the active option is deterministic.
    await user.type(input, "brazil");
    expect(await screen.findByRole("option", { name: "Brazil" })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("Brazil");
  });

  it("reverts the query to the committed value and closes the list on Escape", async () => {
    const user = userEvent.setup();
    // Committed value is "Brazil"; a half-typed query must revert to it on Escape.
    const { onChange, input } = setup("Brazil");
    await user.clear(input);
    await user.type(input, "arg");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveValue("Brazil");
    expect(onChange).not.toHaveBeenCalled();
  });
});
