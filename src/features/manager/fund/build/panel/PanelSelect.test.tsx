/**
 * @id PP-MGR-CMP-063
 * @name PanelSelect tests
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, a presentational control under test
 *
 * The select of the panels (handoff P11): it lists only the options it is handed, opens a popover
 * with the selected row checked and the footer link row, and a choice only calls `onChange` (the
 * draft), by mouse or keyboard.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PanelSelect, type PanelSelectOption } from "./PanelSelect";

const OPTIONS: PanelSelectOption[] = [
  {
    id: "weth-usdc",
    label: "WETH / USDC · 0.05%",
    logos: [{ symbol: "WETH" }, { symbol: "USDC" }],
  },
  {
    id: "wbtc-usdc",
    label: "WBTC / USDC · 0.30%",
    logos: [{ symbol: "WBTC" }, { symbol: "USDC" }],
    metric: { label: "Supply APY", value: "4.1%" },
  },
];

function renderSelect(onChange = vi.fn(), onLink = vi.fn()) {
  render(
    <>
      <span id="pool-label">Pool</span>
      <PanelSelect
        labelId="pool-label"
        options={OPTIONS}
        value="weth-usdc"
        onChange={onChange}
        footer={{ prompt: "Need another pool?", label: "Edit mandate · Pools", onClick: onLink }}
      />
    </>,
  );
  return { onChange, onLink };
}

describe("PanelSelect (P11)", () => {
  it("[P11] shows the selected value, closed", () => {
    // @rule P11
    renderSelect();
    const button = screen.getByRole("button", { name: "Pool" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveTextContent("WETH / USDC · 0.05%");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("[P11] opens with the selected row checked, the metrics and the footer link row", async () => {
    // @rule P11
    const { onLink } = renderSelect();
    await userEvent.click(screen.getByRole("button", { name: "Pool" }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("4.1%")).toBeInTheDocument();
    expect(screen.getByText("Need another pool?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit mandate · Pools" }));
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it("[P11] a choice only calls onChange (the draft), and closes", async () => {
    // @rule P11
    const { onChange } = renderSelect();
    await userEvent.click(screen.getByRole("button", { name: "Pool" }));
    await userEvent.click(screen.getByRole("option", { name: /WBTC/ }));
    expect(onChange).toHaveBeenCalledWith("wbtc-usdc");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("[P11] the keyboard moves, chooses and closes", async () => {
    // @rule P11
    const { onChange } = renderSelect();
    screen.getByRole("button", { name: "Pool" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    const list = screen.getByRole("listbox");
    expect(list).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("wbtc-usdc");
    expect(screen.getByRole("button", { name: "Pool" })).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("[M3] matches the value without case", () => {
    // @rule M3
    render(
      <>
        <span id="pool-label">Pool</span>
        <PanelSelect labelId="pool-label" options={OPTIONS} value="WETH-USDC" onChange={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("button", { name: "Pool" })).toHaveTextContent("WETH / USDC · 0.05%");
  });

  it("[M2] a disabled option shows its reason, the arrows skip it and it cannot be chosen", async () => {
    // @rule M2
    const onChange = vi.fn();
    const options: PanelSelectOption[] = [
      ...OPTIONS.slice(0, 1),
      { ...(OPTIONS[1] as PanelSelectOption), disabledReason: "Supply cap reached" },
      { id: "usdg", label: "USDG", logos: [{ symbol: "USDG" }] },
    ];
    render(
      <>
        <span id="asset-label">Asset</span>
        <PanelSelect
          labelId="asset-label"
          options={options}
          value="weth-usdc"
          onChange={onChange}
        />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Asset" }));
    const disabled = screen.getByRole("option", { name: /WBTC/ });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled).toHaveTextContent("Supply cap reached");
    await userEvent.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    // From the first row, one Arrow Down lands past the disabled one.
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("usdg");
  });

  it("closes on a press outside", async () => {
    renderSelect();
    await userEvent.click(screen.getByRole("button", { name: "Pool" }));
    await userEvent.click(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
