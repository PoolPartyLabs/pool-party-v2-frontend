/** @id PP-CP-CMP-003 @name Cash+ calculator interaction tests @implements-rules-version v1 */
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "@/i18n/messages/en/cashPlus.json";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { CashPlusSimulation } from "./CashPlusSimulation";

describe("CashPlusSimulation", () => {
  // @rule CP-UI11, CP-D10: clearly separate illustrative annual output from observed balances.
  it("starts collapsed and keeps the illustrative label alongside the annual comparison", async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<CashPlusSimulation />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    await user.click(screen.getByText("What could a year look like?"));
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("$44,800.00")).toBeVisible();
    expect(screen.getByText("4.48%")).toBeVisible();
    expect(screen.getByText("12% more return dollars")).toBeVisible();
    expect(screen.getAllByText("Illustrative comparison")).toHaveLength(2);
  });
  // @rule CP-D11: reduced volume can match or underperform the lending reference.
  it.each([
    ["0", "3.40%"],
    ["10000000", "3.70%"],
    ["20000000", "4.00%"],
  ])("recalculates the scenario at %s annual volume", async (volume, expected) => {
    const user = userEvent.setup();
    renderWithProviders(<CashPlusSimulation />);
    await user.click(screen.getByText("What could a year look like?"));
    fireEvent.change(screen.getByLabelText("Annual conversion volume"), {
      target: { value: volume },
    });
    expect(screen.getAllByText(expected)[0]).toBeVisible();
    expect(screen.queryByText("4.48%")).toBeNull();
  });
  // @rule CP-UI11: invalid assumptions replace the calculation with an explicit state.
  it("does not keep displaying an old return when assumptions are invalid", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CashPlusSimulation />);
    await user.click(screen.getByText("What could a year look like?"));
    await user.click(screen.getByText("Adjust assumptions"));
    const field = screen.getByLabelText("Lending allocation (%)");
    await user.clear(field);
    await user.type(field, "101");
    expect(screen.getByRole("alert")).toHaveTextContent("Check the assumptions");
    expect(screen.queryByText("$44,800.00")).toBeNull();
  });
  // @rule CP-UI13: calculator fields honor the locale's decimal separator.
  it("accepts Portuguese percentage decimals", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <NextIntlClientProvider locale="pt-BR" messages={{ cashPlus: messages }}>
        <CashPlusSimulation />
      </NextIntlClientProvider>,
    );
    await user.click(screen.getByText("What could a year look like?"));
    await user.click(screen.getByText("Adjust assumptions"));
    const field = screen.getByLabelText("Lending rate (%)");
    await user.clear(field);
    await user.type(field, "4,5");
    expect(screen.getByText("4.86%")).toBeVisible();
  });
});
