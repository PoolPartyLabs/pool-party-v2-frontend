/**
 * @id PP-MGR-CMP-067
 * @name FundSlippageControl tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational control under test
 *
 * The Max slippage field (handoff P12 with decision D-D, finding 27): presets, the custom field and
 * its blur rules, the 5% cap with its sentence, and no warning above it.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { FundSlippageControl } from "./FundSlippageControl";

const COPY = {
  label: "Max slippage",
  help: "Cancels the transaction if the price moves more than this before it confirms.",
  helpLabel: "More about Max slippage",
  custom: "Custom",
  customLabel: "Custom max slippage, in percent",
  max: (pct: string) => `${pct}% is the maximum.`,
};

/** The control over a value it owns, reporting every change. */
function Controlled({ start, onChange }: { start: number; onChange(pct: number): void }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <FundSlippageControl
        value={value}
        onChange={(pct) => {
          setValue(pct);
          onChange(pct);
        }}
        copy={COPY}
      />
      <button type="button" onClick={() => setValue(1)}>
        outside
      </button>
    </>
  );
}

function field(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Custom max slippage, in percent" });
}

describe("FundSlippageControl (P12, D-D)", () => {
  it("[P12] shows the three presets, the 2% default selected and the field empty", () => {
    // @rule P12
    render(<Controlled start={2} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "0.5%" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "1%" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "2%" })).toHaveAttribute("aria-pressed", "true");
    expect(field()).toHaveValue("");
    expect(field()).toHaveAttribute("placeholder", "Custom");
  });

  it("[P12] a preset writes its value", async () => {
    // @rule P12
    const onChange = vi.fn();
    render(<Controlled start={2} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "0.5%" }));
    expect(onChange).toHaveBeenCalledWith(0.5);
    expect(screen.getByRole("button", { name: "0.5%" })).toHaveAttribute("aria-pressed", "true");
  });

  it("[D-D, finding 27] keeps a typed 8 visible, then brings it to 5 on blur and says so", async () => {
    // @rule D-D
    const onChange = vi.fn();
    render(<Controlled start={2} onChange={onChange} />);
    await userEvent.type(field(), "8");
    // Not capped on the keystroke: the app's sanitiser gets no max of 5.
    expect(field()).toHaveValue("8");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(5);
    expect(field()).toHaveValue("5");
    expect(screen.getByText("5% is the maximum.")).toBeInTheDocument();
    // No High or Very high slippage warning exists.
    expect(screen.queryByText(/High slippage/i)).toBeNull();
    // The next edit takes the sentence away.
    await userEvent.type(field(), "{backspace}3");
    expect(screen.queryByText("5% is the maximum.")).toBeNull();
  });

  it("[P12] a value under 0.1, zero included, becomes 0.1 on blur", async () => {
    // @rule P12
    const onChange = vi.fn();
    render(<Controlled start={2} onChange={onChange} />);
    await userEvent.type(field(), "0");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(0.1);
    expect(field()).toHaveValue("0.1");
  });

  it("[P12] reads a comma as the decimal point and keeps one decimal", async () => {
    // @rule P12
    const onChange = vi.fn();
    render(<Controlled start={2} onChange={onChange} />);
    await userEvent.type(field(), "1,25");
    expect(field()).toHaveValue("1.2");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(1.2);
  });

  it("[P12] a typed value equal to a preset stays custom", async () => {
    // @rule P12
    render(<Controlled start={0.5} onChange={vi.fn()} />);
    await userEvent.type(field(), "2");
    await userEvent.tab();
    expect(field()).toHaveValue("2");
    expect(screen.getByRole("button", { name: "2%" })).toHaveAttribute("aria-pressed", "false");
  });

  it("[P12] an emptied custom field goes back to the 2% preset", async () => {
    // @rule P12
    const onChange = vi.fn();
    render(<Controlled start={3.5} onChange={onChange} />);
    expect(field()).toHaveValue("3.5");
    await userEvent.clear(field());
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(screen.getByRole("button", { name: "2%" })).toHaveAttribute("aria-pressed", "true");
  });

  it("[P12] a blur on the untouched field keeps the selected preset", async () => {
    // @rule P12
    const onChange = vi.fn();
    render(<Controlled start={1} onChange={onChange} />);
    await userEvent.click(field());
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "1%" })).toHaveAttribute("aria-pressed", "true");
  });

  it("re-seeds when the value changes from outside (Discard)", async () => {
    render(<Controlled start={4.5} onChange={vi.fn()} />);
    expect(field()).toHaveValue("4.5");
    await userEvent.click(screen.getByRole("button", { name: "outside" }));
    expect(field()).toHaveValue("");
    expect(screen.getByRole("button", { name: "1%" })).toHaveAttribute("aria-pressed", "true");
  });
});
