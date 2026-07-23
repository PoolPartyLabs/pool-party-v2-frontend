/**
 * @id PP-CORE-CMP-049
 * @name AprTooltip.test
 * Behavior: renders the APR text as a tooltip trigger whose accessible name is the localized
 * "Annual Percentage Rate", and reveals that expansion on tap (mobile-first).
 */
import { describe, expect, it } from "vitest";
import { renderWithProviders, screen, userEvent } from "../../../tests/utils/renderWithProviders";
import { AprTooltip } from "./AprTooltip";

describe("AprTooltip", () => {
  it("renders the APR text with an accessible 'Annual Percentage Rate' label", () => {
    renderWithProviders(<AprTooltip>APR</AprTooltip>);
    const trigger = screen.getByRole("button", { name: "Annual Percentage Rate" });
    expect(trigger).toHaveTextContent("APR");
  });

  it("reveals the expansion on tap (mobile-first)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AprTooltip>APR</AprTooltip>);
    await user.click(screen.getByRole("button", { name: "Annual Percentage Rate" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Annual Percentage Rate");
  });

  it("reveals the 'Annual Percentage Yield' expansion when the unit token is APY", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AprTooltip>APY</AprTooltip>);
    const trigger = screen.getByRole("button", { name: "Annual Percentage Yield" });
    expect(trigger).toHaveTextContent("APY");
    await user.click(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Annual Percentage Yield");
  });

  it("honors an explicit unit prop over the trigger text", () => {
    renderWithProviders(<AprTooltip unit="APY">Net rate</AprTooltip>);
    expect(screen.getByRole("button", { name: "Annual Percentage Yield" })).toHaveTextContent(
      "Net rate",
    );
  });

  it("defaults a named label to the 'Annual Percentage Rate' expansion", () => {
    renderWithProviders(<AprTooltip>Avg. APR</AprTooltip>);
    expect(screen.getByRole("button", { name: "Annual Percentage Rate" })).toHaveTextContent(
      "Avg. APR",
    );
  });

  // POO-712 R3: avg-APR KPI tooltips reveal the "Average" expansion, without mutating the shared
  // "Annual Percentage Rate" used by single-strategy APR sites.
  it("reveals the 'Average Annual Percentage Rate' expansion when average is set", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AprTooltip average>Avg. APR</AprTooltip>);
    const trigger = screen.getByRole("button", { name: "Average Annual Percentage Rate" });
    expect(trigger).toHaveTextContent("Avg. APR");
    await user.click(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Average Annual Percentage Rate");
  });

  // POO-736 R2: the Net APR label reveals a distinct "Net Annual Percentage Rate" expansion, not the
  // plain or averaged one.
  it("reveals the 'Net Annual Percentage Rate' expansion when net is set", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AprTooltip net>Net APR</AprTooltip>);
    const trigger = screen.getByRole("button", { name: "Net Annual Percentage Rate" });
    expect(trigger).toHaveTextContent("Net APR");
    await user.click(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Net Annual Percentage Rate");
  });
});
