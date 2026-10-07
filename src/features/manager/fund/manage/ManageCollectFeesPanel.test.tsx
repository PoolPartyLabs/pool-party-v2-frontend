/** @id PP-MGR-CMP-092 @name ManageCollectFeesPanel tests @implements-rules-version v1 */
import { describe, expect, it, vi } from "vitest";
import { findToken } from "@/lib/tokens/tokenList";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { ManageCollectFeesPanel } from "./ManageCollectFeesPanel";
import type { ManageCollectDetail, ManageCollectRead } from "./manageCollectFees";
import { normalizeManageModel } from "./manageModel";

const normalized = normalizeManageModel(mockFund).positions.find(
  (item) => item.kind === "liquidity",
);
if (!normalized) throw new Error("liquidity fixture missing");
const origin = {
  ...normalized,
  tokens: normalized.tokens.map((token, index) => ({
    ...token,
    address:
      index === 0
        ? "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
        : "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
    symbol: index === 0 ? "USDG" : "WETH",
  })),
};
const version = { protocolVersion: "v2" as const };
const amount = (raw: string, decimal: string) => ({ ...version, raw, decimal });
function read(): ManageCollectRead {
  const position: ManageCollectDetail = {
    chainId: "4663",
    positionKey: origin.positionKey,
    status: "open",
    adapterKind: "uniswap-v4",
    tokens: origin.tokens.map(({ address, symbol, decimals }) => ({
      ...version,
      address: address ?? "",
      symbol,
      decimals,
    })),
    uniswap: {
      ...version,
      poolKey: {
        ...version,
        currency0: origin.tokens[0]?.address ?? "",
        currency1: origin.tokens[1]?.address ?? "",
        fee: 3000,
        tickSpacing: 60,
        hooks: `0x${"0".repeat(40)}`,
      },
      tickLower: -120,
      tickUpper: 120,
      currentTick: 0,
      tickSpacing: 60,
      fee: 3000,
      liquidity: "1",
      sqrtPriceX96: "1",
      inRange: true,
      lowerPrice: { ...version, token1PerToken0: "1", token0PerToken1: "1" },
      upperPrice: { ...version, token1PerToken0: "2", token0PerToken1: "0.5" },
      currentPrice: { ...version, token1PerToken0: "1", token0PerToken1: "1" },
    },
    uncollectedIncome: {
      amount0: amount("650000000", "650"),
      amount1: amount("200000000000000000", "0.2"),
    },
  };
  return { identity: origin.id, status: "ready", position, error: null, freshness: "fresh" };
}
const props = () => ({ position: origin, read: read(), onBack: vi.fn(), onRetry: vi.fn() });

describe("POO-2276 Collect fees presenter", () => {
  // @rule R1/R2/R3/R6: current position, pair and ordered fees, exact detail quantities.
  it("shows the origin header and fees without principal amounts or a fabricated USD total", () => {
    const { container } = renderWithProviders(<ManageCollectFeesPanel {...props()} />);
    expect(screen.getByRole("heading", { name: "Manage block" })).toBeVisible();
    expect(screen.getByText("USDG / WETH")).toBeVisible();
    expect(screen.getByText("Robinhood")).toBeVisible();
    const rows = [...container.querySelectorAll<HTMLElement>("[data-manage-collect-token]")];
    expect(rows.map((row) => row.dataset.manageCollectToken)).toEqual(
      origin.tokens.map((token) => token.address),
    );
    expect(within(rows[0] as HTMLElement).getByText("650")).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText("0.2")).toBeVisible();
    expect(rows[0]?.querySelector("img")?.getAttribute("src")).toBe(
      findToken("robinhood", origin.tokens[0]?.address ?? "")?.iconUrl,
    );
    expect(container).not.toHaveTextContent("200,000");
    expect(container).not.toHaveTextContent("$1,250.50");
    expect(container).not.toHaveTextContent("USDC / WETH");
  });
  // @rule R3: no float or rounding in this fee detail.
  it("shows the full large amount and a nonzero one-wei amount", () => {
    const input = props();
    if (!input.read.position) throw new Error("position missing");
    input.read.position.uncollectedIncome = {
      amount0: amount("9007199254740993123456", "9007199254740993.123456"),
      amount1: amount("1", "0.000000000000000001"),
    };
    renderWithProviders(<ManageCollectFeesPanel {...input} />);
    expect(screen.getByText("9007199254740993.123456")).toBeVisible();
    expect(screen.getByText("0.000000000000000001")).toBeVisible();
  });
  // @rule R4/R5: confirmed zero remains zero; no collection capability is inferred.
  it("keeps confirmed zero rows and collection disabled", async () => {
    const input = props();
    if (!input.read.position) throw new Error("position missing");
    input.read.position.uncollectedIncome = {
      amount0: amount("0", "0"),
      amount1: amount("0", "0"),
    };
    renderWithProviders(<ManageCollectFeesPanel {...input} />);
    expect(screen.getAllByText("0")).toHaveLength(2);
    expect(screen.getByText("No uncollected fees.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Collect" }));
    expect(screen.getByRole("button", { name: "Collect" })).toBeDisabled();
    expect(input.onBack).not.toHaveBeenCalled();
    expect(input.onRetry).not.toHaveBeenCalled();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });
  // @rule R4: partial fee amounts stay distinct from zero.
  it("preserves one known fee and labels the missing fee unavailable", () => {
    const input = props();
    if (!input.read.position?.uncollectedIncome) throw new Error("position missing");
    input.read.position.uncollectedIncome.amount1 = null;
    const { container } = renderWithProviders(<ManageCollectFeesPanel {...input} />);
    expect(screen.getByText("650")).toBeVisible();
    expect(screen.getByText("Some uncollected fee amounts are unavailable.")).toBeVisible();
    const second = container.querySelectorAll("[data-manage-collect-token]")[1];
    expect(within(second as HTMLElement).getByText("Not available")).toBeVisible();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
  // @rule R4/R6: late origin/read error do not leak values; retry/back are host callbacks only.
  it("clears late-origin fees and invokes only Retry and Back callbacks", async () => {
    const input = props();
    const view = renderWithProviders(<ManageCollectFeesPanel {...input} />);
    view.rerender(
      <ManageCollectFeesPanel
        {...input}
        position={{
          ...origin,
          id: `0x${"9".repeat(40)}:4663:${origin.positionKey}`,
          core: `0x${"9".repeat(40)}`,
        }}
      />,
    );
    expect(screen.queryByText("650")).not.toBeInTheDocument();
    view.rerender(
      <ManageCollectFeesPanel
        {...input}
        read={{ ...input.read, status: "error", error: "secret RPC details" }}
      />,
    );
    expect(screen.getByText("Uncollected fees could not be read.")).toBeVisible();
    expect(screen.queryByText("650")).not.toBeInTheDocument();
    expect(screen.queryByText("secret RPC details")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(input.onRetry).toHaveBeenCalledTimes(1);
    expect(input.onBack).toHaveBeenCalledTimes(1);
  });
  // @rule R4: loading exposes its status without retained fee values.
  it("shows a busy loading region with the existing Collect action disabled", () => {
    const input = props();
    const { container } = renderWithProviders(
      <ManageCollectFeesPanel {...input} read={{ ...input.read, status: "loading" }} />,
    );
    expect(container.querySelector("[aria-busy='true']")).toBeInTheDocument();
    expect(screen.getByText("Loading uncollected fees…")).toBeVisible();
    expect(screen.queryByText("650")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collect" })).toBeDisabled();
  });
  // @rule POO-2276 R4/R5: unknown freshness withholds values without an unproven stale claim.
  it("shows unknown freshness as unavailable without saying fees are stale (POO-2276)", () => {
    const input = props();
    renderWithProviders(
      <ManageCollectFeesPanel {...input} read={{ ...input.read, freshness: "unknown" }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Uncollected fees are unavailable.");
    expect(
      screen.queryByText("Uncollected fees are stale. Refresh to continue."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("650")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Collect" })).toBeDisabled();
    expect(input.onRetry).not.toHaveBeenCalled();
    expect(input.onBack).not.toHaveBeenCalled();
  });
  // @rule R4/R5/R7: stale quantities are withheld and receipt in hub Income is not promised.
  it("withholds stale fees and explains the cross-chain financial destination", () => {
    const input = props();
    renderWithProviders(
      <ManageCollectFeesPanel {...input} read={{ ...input.read, freshness: "stale" }} />,
    );
    expect(screen.getByText("Uncollected fees are stale. Refresh to continue.")).toBeVisible();
    expect(screen.queryByText("650")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Fees are received as Income only after conversion to USDC and arrival on the hub.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Collect" })).toBeDisabled();
    expect(screen.getByText("Not available")).toBeVisible();
  });
  // @rule R6/R7: local contexts do not show a cross-chain continuation claim.
  it("uses a neutral fallback for unknown token identity and omits hub transit copy locally", () => {
    const input = props();
    const local = {
      ...origin,
      chainId: 42161,
      network: "arbitrum",
      id: `${origin.core}:42161:${origin.positionKey}`,
      tokens: origin.tokens.map((token, index) => ({
        ...token,
        chainId: 42161,
        address: `0x${String(index + 8).repeat(40)}`,
      })),
    };
    if (!input.read.position?.uniswap) throw new Error("position missing");
    input.read.position.chainId = "42161";
    input.read.position.tokens = local.tokens.map(({ address, symbol, decimals }) => ({
      ...version,
      address,
      symbol,
      decimals,
    }));
    input.read.position.uniswap.poolKey.currency0 = local.tokens[0]?.address ?? "";
    input.read.position.uniswap.poolKey.currency1 = local.tokens[1]?.address ?? "";
    const { container } = renderWithProviders(
      <ManageCollectFeesPanel
        {...input}
        position={local}
        read={{ ...input.read, identity: local.id }}
      />,
    );
    expect(container.querySelectorAll("[data-manage-collect-token] img")).toHaveLength(0);
    expect(screen.getByText("650")).toBeVisible();
    expect(
      screen.queryByText(
        "Fees are received as Income only after conversion to USDC and arrival on the hub.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collect" })).toBeDisabled();
  });
});
