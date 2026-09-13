/** @id PP-CP-CMP-001 @name Cash+ observed state tests @implements-rules-version v1 */
import { describe, expect, it } from "vitest";
import { INVESTOR_HIDE_VALUES_KEY, PersistedMaskProvider } from "@/lib/hooks/maskValue";
import { CASH_PLUS_PREVIEW_SNAPSHOT } from "@/mocks/data/cashPlus";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { CashPlusChart, CashPlusPositionCard, CashPlusReturnSources } from "./CashPlusDashboard";

describe("Cash+ observed data", () => {
  // @rule CP-UI10: one checkpoint is not enough for a historical curve or annual yield.
  it("explains insufficient history rather than drawing a synthetic curve", () => {
    renderWithProviders(
      <CashPlusChart
        snapshot={{
          ...CASH_PLUS_PREVIEW_SNAPSHOT,
          mode: "fork",
          history: CASH_PLUS_PREVIEW_SNAPSHOT.history.slice(0, 1),
        }}
      />,
    );
    expect(screen.getByText("A little more history is needed")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Observed value/ })).toBeNull();
  });
  // @rule CP-UI09: unavailable attribution never becomes zero.
  it("shows unavailable attribution without substituting zero return", () => {
    renderWithProviders(
      <CashPlusReturnSources
        snapshot={{
          ...CASH_PLUS_PREVIEW_SNAPSHOT,
          interestAssets: null,
          conversionAssets: null,
          attributionComplete: false,
        }}
      />,
    );
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByText(/return breakdown is incomplete/)).toBeInTheDocument();
  });
  // @rule CP-UI07: an empty account receives a clear invest-first explanation.
  it("does not invent prior account value for a new investor", () => {
    renderWithProviders(
      <CashPlusPositionCard
        snapshot={{
          ...CASH_PLUS_PREVIEW_SNAPSHOT,
          accountShares: BigInt(0),
          accountAssets: BigInt(0),
        }}
      />,
    );
    expect(screen.getByText("One investment. Two sources of return.")).toBeInTheDocument();
    expect(screen.queryAllByText("$100,012.34")).toHaveLength(0);
  });
  // @rule CP-UI12: the shared investor preference masks both hero and chart.
  it("masks the personal investment and chart together", async () => {
    localStorage.removeItem(INVESTOR_HIDE_VALUES_KEY);
    const user = userEvent.setup();
    renderWithProviders(
      <PersistedMaskProvider persistKey={INVESTOR_HIDE_VALUES_KEY}>
        <CashPlusPositionCard snapshot={CASH_PLUS_PREVIEW_SNAPSHOT} />
        <CashPlusChart snapshot={CASH_PLUS_PREVIEW_SNAPSHOT} />
      </PersistedMaskProvider>,
    );
    expect(screen.getAllByText("$100,012.34")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Hide personal values" }));
    expect(screen.queryAllByText("$100,012.34")).toHaveLength(0);
    expect(screen.getByText("Chart hidden with personal values")).toBeInTheDocument();
    localStorage.removeItem(INVESTOR_HIDE_VALUES_KEY);
  });
});
