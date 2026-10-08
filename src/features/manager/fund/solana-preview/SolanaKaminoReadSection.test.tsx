/** @id PP-MGR-CMP-099 @implements-rules-version v1 (POO-2291) @analytics-events none, read-only presentation tests */
import { expect, it } from "vitest";
import {
  renderWithProviders,
  screen,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import type { LendingRiskSnapshot } from "../manage/manageLendingRisk";
import { SolanaKaminoReadSection } from "./SolanaKaminoReadSection";
import type { KaminoReadIdentity, KaminoReadSnapshot } from "./solanaKaminoReadModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

const asset = {
  network: "solana",
  cluster: "mainnet-beta",
  kind: "spl",
  symbol: "USDC",
  mint: USDC_MINT,
  decimals: 6,
  unit: "base-units",
} as const;
const origin: KaminoReadIdentity = {
  localId: "injected-supply",
  cluster: "mainnet-beta",
  program: WSOL_MINT,
  market: "11111111111111111111111111111111",
  reserve: "11111111111111111111111111111112",
  asset,
  positionId: WSOL_MINT,
  obligation: USDC_MINT,
};
const source = {
  kind: "fixture",
  fixtureId: "illustrative-kamino",
  sourceAsOf: "2026-10-07T10:00:00Z",
  slot: null,
} as const;
function read(): KaminoReadSnapshot {
  return structuredClone({
    identity: origin,
    metadata: { status: "available", value: origin, source },
    supplied: {
      quantity: { status: "available", value: { token: asset, raw: "2500000123456" }, source },
      valueUsd: null,
    },
    principal: null,
    interest: null,
    rewards: null,
    supplyApy: { status: "available", value: { percent: "5.42" }, source },
    availableLiquidity: null,
    depositCapacity: null,
    availableToWithdraw: null,
  });
}
// @rule R3/R4: production absence keeps metadata/amounts/APY unavailable and never provides a selector.
it("renders Configure fields with unavailable metadata before allocation and metrics", () => {
  renderWithProviders(
    <SolanaKaminoReadSection
      mode="configure"
      origin={null}
      read={null}
      allocation={<span>allocation-slot</span>}
    />,
  );
  const section = screen.getByRole("region", { name: "Supply USDC" });
  expect(within(section).getByText("Market")).toBeVisible();
  expect(within(section).getByText("Reserve")).toBeVisible();
  expect(within(section).getAllByText("Not available")).toHaveLength(8);
  const content = section.textContent ?? "";
  expect(content.indexOf("Market")).toBeLessThan(content.indexOf("allocation-slot"));
  expect(content.indexOf("allocation-slot")).toBeLessThan(content.indexOf("Supply APY"));
  expect(within(section).queryByRole("combobox")).toBeNull();
  expect(screen.queryByText(/Borrow|Multiply|No debt/)).toBeNull();
});
// @rule R2/R3: complete exact quantities, independently missing USD and declared provenance.
it("shows exact injected Manage quantities and fixture provenance without inferring USD or principal", () => {
  renderWithProviders(<SolanaKaminoReadSection mode="manage" origin={origin} read={read()} />);
  expect(screen.getByText("2500000.123456 USDC")).toBeVisible();
  expect(screen.getByText("5.42%")).toBeVisible();
  expect(screen.getAllByText("Illustrative fixture").length).toBeGreaterThan(0);
  expect(screen.getByText("Position")).toBeVisible();
  expect(screen.getByText("Obligation")).toBeVisible();
  expect(screen.queryByText("$2,500,000.12")).toBeNull();
  expect(screen.getByRole("region", { name: "Account risk" })).toHaveTextContent(
    "Verified account risk is not available.",
  );
  expect(screen.queryByRole("button")).toBeNull();
});
// @rule R3: valuation can be supplied independently without filling quantity or market identity.
it("displays independently sourced USD when quantity remains unavailable", () => {
  const input = read();
  input.supplied = {
    quantity: null,
    valueUsd: { status: "available", value: { usd: "1250000.12" }, source },
  };
  renderWithProviders(<SolanaKaminoReadSection mode="manage" origin={origin} read={input} />);
  expect(screen.getByText("$1,250,000.12")).toBeVisible();
  expect(screen.queryByText("2500000.123456 USDC")).toBeNull();
});
// @rule R3/R4: account risk is supplied independently and must belong to this obligation.
it("preserves compatible full-account risk without market metrics and leaves After unavailable", () => {
  const identity = {
    protocol: "kamino-lend",
    cluster: "mainnet-beta",
    program: origin.program,
    market: origin.market,
    account: "11111111111111111111111111111113",
    obligation: origin.obligation as string,
  } as const;
  const snapshot: LendingRiskSnapshot = {
    identity,
    snapshotId: "injected-account",
    source: {
      kind: "fixture",
      reference: "illustrative-full-account",
      asOf: source.sourceAsOf,
      blockOrSlot: null,
      freshness: "fresh",
    },
    complete: true,
    debt: { status: "confirmed", total: { decimal: "0", currency: "USD" } },
    scenario: { kind: "current", id: "current-account" },
    context: null,
    healthFactor: null,
    liquidationPrice: null,
  };
  const view = renderWithProviders(
    <SolanaKaminoReadSection
      mode="manage"
      origin={origin}
      read={null}
      risk={{
        origin: { identity, preview: null },
        current: { status: "ready", snapshot },
        after: { status: "unavailable", snapshot: null },
      }}
    />,
  );
  expect(
    within(screen.getByRole("region", { name: "Account risk" })).getByText("Current · No debt"),
  ).toBeVisible();
  const invalidRead = read();
  invalidRead.supplyApy = { status: "available", value: { percent: "bad-apy" }, source };
  view.rerender(
    <SolanaKaminoReadSection
      mode="manage"
      origin={origin}
      read={invalidRead}
      risk={{
        origin: { identity, preview: null },
        current: { status: "ready", snapshot },
        after: { status: "unavailable", snapshot: null },
      }}
    />,
  );
  expect(screen.getByText("Current · No debt")).toBeVisible();
  expect(screen.getByText("2500000.123456 USDC")).toBeVisible();
  expect(screen.queryByText("bad-apy")).toBeNull();
  view.rerender(
    <SolanaKaminoReadSection
      mode="manage"
      origin={{ ...origin, reserve: "0x123" }}
      read={null}
      risk={{
        origin: { identity, preview: null },
        current: { status: "ready", snapshot },
        after: { status: "unavailable", snapshot: null },
      }}
    />,
  );
  expect(screen.queryByText("Current · No debt")).toBeNull();
  view.rerender(
    <SolanaKaminoReadSection
      mode="manage"
      origin={origin}
      read={read()}
      risk={{
        origin: { identity: { ...identity, obligation: WSOL_MINT }, preview: null },
        current: {
          status: "ready",
          snapshot: { ...snapshot, identity: { ...identity, obligation: WSOL_MINT } },
        },
        after: { status: "unavailable", snapshot: null },
      }}
    />,
  );
  expect(screen.queryByText("No debt")).toBeNull();
  expect(screen.getByRole("region", { name: "Account risk" })).toHaveTextContent(
    "Verified account risk is not available.",
  );
});
// @rule R3: stale retains source but does not promote the old metric into an available figure.
it("keeps stale quantity and separate confirmed zero visible as distinct states", () => {
  const input = read();
  input.supplied = {
    quantity: {
      status: "stale",
      value: { token: asset, raw: "2500000123456" },
      source,
      reason: "stale",
    },
    valueUsd: null,
  };
  input.principal = {
    quantity: {
      status: "confirmed-zero",
      value: { token: asset, raw: "0" },
      source: {
        kind: "observed",
        source: "injected-confirmed-read",
        sourceAsOf: source.sourceAsOf,
        slot: "123456789",
        commitment: "confirmed",
      },
    },
    valueUsd: null,
  };
  renderWithProviders(<SolanaKaminoReadSection mode="manage" origin={origin} read={input} />);
  expect(screen.queryByText("2500000.123456 USDC")).toBeNull();
  expect(screen.getByText("Stale data")).toBeVisible();
  expect(screen.getByText("0 USDC")).toBeVisible();
  expect(screen.getByText("Confirmed zero")).toBeVisible();
  expect(screen.getByText("injected-confirmed-read")).toBeVisible();
});
// @rule R3: an empty rewards result is known absence; null means no reward read.
it("omits confirmed absent Rewards but keeps an unknown reward read unavailable", () => {
  const input = read();
  input.rewards = [];
  const view = renderWithProviders(
    <SolanaKaminoReadSection mode="manage" origin={origin} read={input} />,
  );
  expect(screen.queryByText("Rewards")).toBeNull();
  view.rerender(
    <SolanaKaminoReadSection mode="manage" origin={origin} read={{ ...input, rewards: null }} />,
  );
  const rewards = screen.getByText("Rewards");
  expect(rewards.parentElement).toHaveTextContent("Not available");
});
