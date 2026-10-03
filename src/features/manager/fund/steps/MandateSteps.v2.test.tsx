/**
 * @id PP-MGR-LIB-021 (POO-2133)
 * @name RealMandateStepTests
 * @implements-rules-version v1
 * The real-mode Networks, Protocols, Tokens and Limits contract.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CatalogReserve, CatalogToken } from "@/lib/api/v2/schemas";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import type { MandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  depositTokenRefFor,
  isBlocked,
  type MandateDraft,
  validateStep,
  withProtocols,
} from "../mandateDraft";
import { buildRealCatalog, toV2MandateSelection } from "../v2Mandate";
import { LimitsStep } from "./LimitsStep";
import { NetworksStep } from "./NetworksStep";
import { ProtocolsStep } from "./ProtocolsStep";
import { TokensStep } from "./TokensStep";

const base = depositTokenRefFor("arbitrum");
if (!base) throw new Error("missing hub base");
const usdc: CatalogToken = {
  protocolVersion: "v2",
  chainId: "42161",
  address: base.address,
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  logoUrl: "https://example.test/usdc.png",
  hubPriced: true,
  priceUsd: "1",
  priceUpdatedAt: null,
  priceSource: base.address,
  priceProvenance: "fixed-1:1",
  priceUnavailableReason: null,
};
const weth: CatalogToken = {
  ...usdc,
  address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  symbol: "WETH",
  name: "Wrapped Ether",
  logoUrl: "https://example.test/weth.png",
};
const reserve: CatalogReserve = {
  protocolVersion: "v2",
  chainId: "42161",
  adapterKind: "aave-v3",
  mode: "supply",
  token: usdc,
  poolKey: `0x${usdc.address.slice(2).padStart(64, "0")}`,
  poolAddress: usdc.address,
  dataProviderAddress: usdc.address,
  aTokenAddress: usdc.address,
  supplyApy: "3.22",
  supplyRateRay: "1",
  supplyCap: "0",
  currentSupply: { protocolVersion: "v2", raw: "1", decimal: "0.000001" },
  active: true,
  frozen: false,
  paused: false,
  supplyCapReached: false,
  available: true,
  mandateRequired: true,
};
const catalog = buildRealCatalog([usdc, weth], [reserve]);
const draft = (): MandateDraft => ({
  ...createEmptyDraft("2026-10-03", "real"),
  dataMode: "real",
  catalogVersion: "v2-catalog-v1",
  protocols: ["uniswap-v3-swap"],
  positionProtocolsByChain: {},
});

function Harness({
  step,
  initial = draft(),
  source = catalog,
}: {
  step: "networks" | "protocols" | "tokens" | "limits";
  initial?: MandateDraft;
  source?: MandateCatalog;
}) {
  const [current, setCurrent] = useState(initial);
  const Step = {
    networks: NetworksStep,
    protocols: ProtocolsStep,
    tokens: TokensStep,
    limits: LimitsStep,
  }[step];
  return (
    <>
      <Step
        draft={current}
        catalog={source}
        block={null}
        onBlocked={vi.fn()}
        update={(reduce) => {
          const result = reduce(current);
          if (!isBlocked(result)) setCurrent(result);
        }}
      />
      <output data-testid="draft">{JSON.stringify(current)}</output>
    </>
  );
}
describe("real Mandate step contract", () => {
  // @rule R3
  it("Networks offers only the hub and Robinhood", () => {
    renderWithProviders(<Harness step="networks" />);
    expect(screen.getByRole("checkbox", { name: "Robinhood Chain" })).toBeInTheDocument();
    expect(screen.queryByText("Base")).not.toBeInTheDocument();
  });
  // @rule R3
  it("Protocols keeps swaps locked, omits hub-only Across, displays Aave APY and disables v3 positions", async () => {
    renderWithProviders(<Harness step="protocols" />);
    expect(screen.queryByText("Across")).not.toBeInTheDocument();
    expect(screen.getByText(/USDC supply APY: 3.2%/)).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Aave v3" }));
    expect(JSON.parse(screen.getByTestId("draft").textContent ?? "{}").aaveV3Reserves).toEqual([
      usdc.address,
    ]);
  });
  // @rule R4
  it("Tokens uses catalog logos and excludes unpriced catalog tokens from Add all", () => {
    const source = buildRealCatalog(
      [usdc, weth, { ...weth, address: `0x${"33".repeat(20)}`, symbol: "BAD", hubPriced: false }],
      [reserve],
    );
    const { container } = renderWithProviders(<Harness step="tokens" source={source} />);
    expect(container.querySelector('img[src="https://example.test/weth.png"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add all 1" })).toBeInTheDocument();
    expect(screen.getByText("1 of 16")).toBeInTheDocument();
  });
  // @rule R2
  it("Tokens distinguishes failed catalog from empty and exposes retry", async () => {
    const retry = vi.fn();
    renderWithProviders(<Harness step="tokens" source={{ ...catalog, error: true, retry }} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("The v2 catalog is unavailable.");
  });
  // @rule R7
  it("Limits discloses client-only allocation aids and permits them to remain unset", () => {
    const current = withProtocols(draft(), ["aave-v3"]);
    renderWithProviders(<Harness step="limits" initial={current} />);
    expect(screen.getByText(/not enforced on chain until POO-2169/)).toBeInTheDocument();
    expect(validateStep(current, "limits", catalog)).toBeNull();
    expect(toV2MandateSelection(current, catalog)).not.toHaveProperty("caps");
  });
  // @rule R8
  it("flags a restored mock draft in real mode", () => {
    renderWithProviders(
      <Harness step="networks" initial={createEmptyDraft("2026-10-03", "old")} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("stale or mock data");
  });
});
