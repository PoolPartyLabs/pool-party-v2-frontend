/** @id PP-MGR-CMP-094 @name ManageLendingRiskSection tests @implements-rules-version v1 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManageLendingRiskSection } from "./ManageLendingRiskSection";
import type {
  LendingRiskRead,
  LendingRiskSnapshot,
  LendingRiskToken,
  ManageLendingRiskOrigin,
} from "./manageLendingRisk";

let locale = "en";
vi.mock("next-intl", () => ({
  useLocale: () => locale,
  useTranslations: () => (key: string) =>
    ({
      title: "Lending risk",
      healthFactor: "Health factor",
      liquidationPrice: "Estimated liquidation price",
      current: "Current",
      after: "After",
      notAvailable: "Not available",
      notApplicable: "Not applicable",
      noDebt: "No debt",
      accountUnavailable: "Account data is unavailable.",
      previewUnavailable: "A valid account preview is unavailable.",
      stale: "Account risk data is stale.",
      fullAccount: "Risk belongs to the full account or obligation.",
      noPositiveRoot: "No positive liquidation price was supplied for this scenario.",
      fixture: "Illustrative fixture",
    })[key] ?? key,
}));
const address = (digit: string) => `0x${digit.repeat(40)}`;
const identity = {
  protocol: "aave-v3" as const,
  chainId: 42161,
  core: address("a"),
  account: address("b"),
  market: address("c"),
};
const origin: ManageLendingRiskOrigin = { identity, preview: null };
const unavailable: LendingRiskRead = { status: "unavailable", snapshot: null };
const collateral: LendingRiskToken = {
  network: "evm",
  chainId: 42161,
  address: address("d"),
  symbol: "WETH",
  decimals: 18,
};
const debt: LendingRiskToken = {
  network: "evm",
  chainId: 42161,
  address: address("e"),
  symbol: "USDC",
  decimals: 6,
};
function snapshot(): LendingRiskSnapshot {
  const source = {
    kind: "observed" as const,
    reference: "read-42",
    asOf: "2026-10-07T21:00:00.123456Z",
    freshness: "fresh" as const,
    blockOrSlot: "9007199254740993123456",
  };
  return {
    identity,
    snapshotId: "account-1",
    source,
    complete: true,
    debt: { status: "confirmed", total: { decimal: "5000", currency: "USD" } },
    scenario: { kind: "current", id: "current-1" },
    context: {
      snapshotId: "account-1",
      scenarioId: "current-1",
      method: "Aave supplied account result",
      assumptions: ["WETH varies while debt USD quotes remain fixed"],
      collateral: [{ token: collateral, raw: "5000000000000000000" }],
      debt: [{ token: debt, raw: "5000000000" }],
      oracles: [collateral, debt].map((token) => ({
        token,
        decimal: token.symbol === "WETH" ? "3000" : "1",
        unit: "USD-per-token",
        provider: "Declared oracle",
        snapshotId: "account-1",
        source,
      })),
      parameters: [
        { token: collateral, liquidationThresholdRatio: "0.8", borrowFactorRatio: null },
        { token: debt, liquidationThresholdRatio: null, borrowFactorRatio: null },
      ],
    },
    healthFactor: { decimal: "2.400000000000000001", unit: "ratio", scenarioId: "current-1" },
    liquidationPrice: {
      status: "available",
      decimal: "1400.123456789",
      unit: "USD-per-token",
      asset: collateral,
      scenarioId: "current-1",
    },
  };
}
const ready = (s: LendingRiskSnapshot): LendingRiskRead => ({ status: "ready", snapshot: s });
describe("POO-2290 shared lending risk section", () => {
  it("[R1,R2,R3] matches the unavailable Current / After risk rows", () => {
    const { container } = render(
      <ManageLendingRiskSection
        origin={{ identity: null, preview: null }}
        current={unavailable}
        after={unavailable}
      />,
    );
    expect(screen.getByRole("region", { name: "Lending risk" })).toBeVisible();
    expect(screen.getByText("Health factor")).toBeVisible();
    expect(screen.getByText("Estimated liquidation price")).toBeVisible();
    expect(screen.getAllByText("Current")).toHaveLength(2);
    expect(screen.getAllByText("After")).toHaveLength(2);
    expect(screen.getAllByText("Not available")).toHaveLength(4);
    expect(screen.getByText("Account data is unavailable.")).toBeVisible();
    expect(container.querySelector("button,input,select,a")).toBeNull();
  });
  it("[R3] shows No debt per confirmed column with Not applicable and no zero risk", () => {
    const s = snapshot();
    s.context = null;
    s.debt.total = { decimal: "0", currency: "USD" };
    const { container } = render(
      <ManageLendingRiskSection origin={origin} current={ready(s)} after={unavailable} />,
    );
    expect(screen.getAllByText("Not applicable")).toHaveLength(2);
    expect(screen.getByText(/Current.*No debt/)).toBeVisible();
    expect(screen.getAllByText("Not available")).toHaveLength(2);
    expect(container).not.toHaveTextContent("Infinity");
    expect(container).not.toHaveTextContent("2.400");
  });
  it("[R1,R2,R4] renders exact source values, full identity, selected liquidation asset and aggregate assumptions", () => {
    const { container } = render(
      <ManageLendingRiskSection origin={origin} current={ready(snapshot())} after={unavailable} />,
    );
    expect(screen.getByText("2.400000000000000001")).toBeVisible();
    expect(screen.getByText("1,400.123456789 USD / WETH")).toBeVisible();
    expect(screen.getByText(identity.account)).toBeVisible();
    expect(screen.getByText(identity.core)).toBeVisible();
    expect(screen.getByText(identity.market)).toBeVisible();
    expect(screen.getByText("2026-10-07T21:00:00.123456Z")).toBeVisible();
    expect(screen.getByText("9007199254740993123456")).toBeVisible();
    expect(screen.getByText("WETH varies while debt USD quotes remain fixed")).toBeVisible();
    expect(screen.getByRole("heading", { name: "collateral" })).toBeVisible();
    expect(screen.getByText("5 WETH")).toBeVisible();
    expect(screen.getByText("5,000 USDC")).toBeVisible();
    expect(container.querySelector("button,input,select,a")).toBeNull();
  });
  // @rule R1,R2,R4: independently supplied Aave snapshots need no Kamino-specific factor.
  it("[R1,R2,R4] renders Aave Current and After without a borrow factor (POO-2290)", () => {
    const current = snapshot(),
      after = snapshot();
    after.snapshotId = "preview-7";
    after.scenario = { kind: "preview", id: "draft-7", baseSnapshotId: "account-1", valid: true };
    if (!after.context || !after.healthFactor || after.liquidationPrice?.status !== "available")
      throw new Error("fixture");
    after.context.snapshotId = after.snapshotId;
    after.context.scenarioId = "draft-7";
    for (const oracle of after.context.oracles) oracle.snapshotId = after.snapshotId;
    after.healthFactor = { decimal: "2.700000000000000001", unit: "ratio", scenarioId: "draft-7" };
    after.liquidationPrice.scenarioId = "draft-7";
    after.liquidationPrice.decimal = "1250.123456789";
    render(
      <ManageLendingRiskSection
        origin={{ identity, preview: { id: "draft-7", baseSnapshotId: "account-1" } }}
        current={ready(current)}
        after={ready(after)}
      />,
    );
    expect(screen.getByText("2.400000000000000001")).toBeVisible();
    expect(screen.getByText("2.700000000000000001")).toBeVisible();
    expect(screen.getByText("1,250.123456789 USD / WETH")).toBeVisible();
    expect(screen.queryByText(/borrowFactor:/)).toBeNull();
  });
  // @rule R1,R4: display the supplied debt-variable scenario, with its asset and assumptions.
  it("[R1,R4] renders a price for the declared debt asset and its scenario (POO-2290)", () => {
    const s = snapshot();
    if (!s.context || s.liquidationPrice?.status !== "available") throw new Error("fixture");
    s.context.assumptions = ["USDC debt quote varies while WETH quote and quantities remain fixed"];
    s.liquidationPrice.asset = debt;
    s.liquidationPrice.decimal = "2.400000000000000001";
    render(<ManageLendingRiskSection origin={origin} current={ready(s)} after={unavailable} />);
    expect(screen.getByText("2.400000000000000001 USD / USDC")).toBeVisible();
    expect(
      screen.getByText("USDC debt quote varies while WETH quote and quantities remain fixed"),
    ).toBeVisible();
    expect(screen.getByText("current-1")).toBeVisible();
  });
  it("[R4] retains unknown price for no positive root while showing valid HF", () => {
    const s = snapshot();
    s.liquidationPrice = { status: "no-positive-root", scenarioId: "current-1" };
    render(<ManageLendingRiskSection origin={origin} current={ready(s)} after={unavailable} />);
    expect(screen.getByText("2.400000000000000001")).toBeVisible();
    expect(screen.getByText(/No positive liquidation price/)).toBeVisible();
    expect(screen.queryByText(/1,400/)).toBeNull();
  });
  it("[R3,R4] hides stale metrics and tells which source state prevents the read", () => {
    const s = snapshot();
    s.source.freshness = "stale";
    render(<ManageLendingRiskSection origin={origin} current={ready(s)} after={unavailable} />);
    expect(screen.getByText(/Current.*Account risk data is stale/)).toBeVisible();
    expect(screen.queryByText("2.400000000000000001")).toBeNull();
  });
  it("[R4] localizes separators without float rounding", () => {
    locale = "pt-BR";
    render(
      <ManageLendingRiskSection origin={origin} current={ready(snapshot())} after={unavailable} />,
    );
    expect(screen.getByText("2,400000000000000001")).toBeVisible();
    expect(screen.getByText("1.400,123456789 USD / WETH")).toBeVisible();
    locale = "en";
  });
  it("[R1,R2] replaces the identity and both columns on rerender without retaining old metrics", () => {
    const view = render(
      <ManageLendingRiskSection origin={origin} current={ready(snapshot())} after={unavailable} />,
    );
    view.rerender(
      <ManageLendingRiskSection
        origin={{ identity: null, preview: null }}
        current={unavailable}
        after={unavailable}
      />,
    );
    expect(screen.queryByText(identity.account)).toBeNull();
    expect(screen.queryByText("2.400000000000000001")).toBeNull();
    expect(screen.getAllByText("Not available")).toHaveLength(4);
  });
  it("[R4] retains explicit fixture provenance for illustrative supplied values", () => {
    const s = snapshot();
    s.source.kind = "fixture";
    s.source.blockOrSlot = null;
    render(<ManageLendingRiskSection origin={origin} current={ready(s)} after={unavailable} />);
    expect(screen.getByText(/Illustrative fixture/)).toBeVisible();
  });
  it("[R1,R4] uses natural height, wrapping identity and equal columns without clipping", () => {
    const { container } = render(
      <ManageLendingRiskSection
        origin={origin}
        current={ready(snapshot())}
        after={unavailable}
        className="host-style"
      />,
    );
    const section = screen.getByRole("region", { name: "Lending risk" });
    expect(section).toHaveClass("host-style", "min-w-0");
    expect(section.className).not.toMatch(/h-\[|overflow-hidden|overflow-clip/);
    const rows = container.querySelectorAll("[data-lending-risk-values]");
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toHaveClass("grid-cols-2", "gap-3");
    expect(within(section).getByText(identity.account)).toHaveClass("break-all");
  });
});
