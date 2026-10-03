/**
 * @id PP-MGR-SCR-002
 * @name FundBuildLanding.stories
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events none, a story file. The landing emits its own view event on mount; the harness
 *   has no GTM container, so nothing leaves the workbench
 *
 * Storybook coverage for the Build phase landing (POO-2127 [B2]).
 *
 * The question a reviewer should ask of these stories is whether the screen reads as "the next part
 * is being built" rather than as "something went wrong with what I just did". That is the whole
 * reason the mandate summary sits under the empty state: it is proof the five screens of work
 * landed, on the screen that otherwise has nothing to show.
 *
 * The chrome (the H1, Save & exit and the phase stepper) belongs to the shell and is deliberately
 * absent here, so what is on screen is exactly what this component owns.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FundBuildLanding } from "./FundBuildLanding";
import { buildMandateCatalog } from "./mandateCatalog";
import {
  createEmptyDraft,
  type MandateDraft,
  type MandatePoolRef,
  type MandateTokenRef,
  REQUIRED_PROTOCOLS,
  tokenKey,
  withNetworks,
  withProtocols,
} from "./mandateDraft";

const catalog = buildMandateCatalog({ robinhoodChain: true });

/** A token the manager chose. */
function token(symbol: string): MandateTokenRef {
  return {
    address: `0x${symbol.toLowerCase().padEnd(40, "0")}`,
    symbol,
    name: symbol,
    network: "arbitrum",
    logoUrl: null,
    locked: false,
  };
}

/** A pool fixture with the fields the summary reads. */
function pool(index: number, symbol: string): MandatePoolRef {
  return {
    id: `p-${index}`,
    address: `0x${String(index).padStart(40, "0")}`,
    network: "arbitrum",
    protocol: "uniswap-v4",
    token0: { address: `0x${symbol}`, symbol, name: symbol, logoUrl: null },
    token1: { address: "0xusdc", symbol: "USDC", name: "USD Coin", logoUrl: null },
    feeBps: 5,
    feeTier: 500,
    tvlUsd: 3_100_000,
    aprPct: 11.8,
    tierSharePct: 58,
    hasHook: false,
  };
}

/** A mandate that closed: both networks, positions, every cap answered. */
const completed: MandateDraft = (() => {
  const draft = withProtocols(
    withNetworks(
      createEmptyDraft("2026-10-01T00:00:00.000Z", "d-1"),
      ["arbitrum", "robinhood"],
      catalog,
    ),
    [...REQUIRED_PROTOCOLS, "uniswap-v4"],
  );
  const eth = token("ETH");
  const wbtc = token("WBTC");
  return {
    ...draft,
    name: "ETH and BTC on Arbitrum",
    tokens: [...draft.tokens, eth, wbtc],
    pools: [pool(1, "ETH"), pool(2, "WBTC")],
    caps: {
      networks: { ...draft.caps.networks, robinhood: { noCap: false, pct: 30 } },
      protocols: { "uniswap-v4": { noCap: true, pct: 0 } },
      tokens: {
        [tokenKey(eth)]: { noCap: false, pct: 45 },
        [tokenKey(wbtc)]: { noCap: false, pct: 25 },
      },
    },
    lastStep: "limits",
    passedSteps: ["networks", "protocols", "tokens", "pools", "limits"],
    completedAt: "2026-10-02T09:12:00.000Z",
  };
})();

const meta = {
  title: "Manager/FundBuildLanding",
  component: FundBuildLanding,
  // The Back handler belongs to the shell, which is not in this story: a no-op keeps the control
  // pressable in the workbench without pretending the workbench has a phase to go back to.
  args: { draft: completed, catalog, onBackToMandate: () => {} },
  parameters: {
    nextjs: { navigation: { pathname: "/manager/new" } },
    docs: {
      description: {
        component:
          "Where a manager lands the moment their mandate is closed and saved, while the Build canvas is still in design. It says what is coming, prints the mandate back, and offers only the way back to the Mandate: there is nothing forward yet, so nothing forward is offered.",
      },
    },
  },
} satisfies Meta<typeof FundBuildLanding>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The normal arrival: pending canvas, mandate summary, Back: Mandate. */
export const Default: Story = {};

/** R13: a mandate wide enough that investors are told about it before they deposit. */
export const WithBroadNotice: Story = {
  args: { broad: true },
};
