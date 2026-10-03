/**
 * @id PP-MGR-CMP-026
 * @name MandateSummaryCard.stories
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events none, a story file over a read-only card that emits nothing
 *
 * Storybook coverage for the mandate summary (POO-2127 [B1]).
 *
 * Two things are worth a reviewer's eye here. First, density: a mandate with four networks, five
 * protocols, a dozen tokens and a dozen pools has to stay readable as a SUMMARY, which is what the
 * four-pool cut and the one-chip-per-symbol grouping are for. Second, the Broad notice, which is the
 * only claim on the card and the only thing on it an investor will also be shown (R13).
 *
 * Only Arbitrum and the Robinhood spoke are available in the catalog today, so a wide fixture is
 * wide in tokens and pools rather than in networks.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { buildMandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  type MandateDraft,
  type MandatePoolRef,
  type MandateTokenRef,
  type NetworkId,
  REQUIRED_PROTOCOLS,
  tokenKey,
  withNetworks,
  withProtocols,
} from "../mandateDraft";
import { MandateSummaryCard } from "./MandateSummaryCard";

const catalog = buildMandateCatalog({ robinhoodChain: true });

const base = createEmptyDraft("2026-10-01T00:00:00.000Z", "d-1");

/** A token the manager chose, as opposed to the locked deposit row. */
function token(symbol: string, network: NetworkId): MandateTokenRef {
  return {
    address: `0x${symbol.toLowerCase().padEnd(40, "0")}`,
    symbol,
    name: symbol,
    network,
    logoUrl: null,
    locked: false,
  };
}

/** A pool fixture with the fields the summary reads. */
function pool(index: number, symbol: string, feeBps: number): MandatePoolRef {
  return {
    id: `p-${index}`,
    address: `0x${String(index).padStart(40, "0")}`,
    network: "arbitrum",
    protocol: index % 2 === 0 ? "uniswap-v4" : "uniswap-v3",
    token0: { address: `0x${symbol}`, symbol, name: symbol, logoUrl: null },
    token1: { address: "0xusdc", symbol: "USDC", name: "USD Coin", logoUrl: null },
    feeBps,
    feeTier: feeBps * 100,
    tvlUsd: 2_400_000,
    aprPct: 14.2,
    tierSharePct: 62,
    hasHook: false,
  };
}

/** The hub alone, the two required protocols, the deposit token: the mandate at its smallest. */
const minimal: MandateDraft = base;

/** A realistic finished mandate: both networks, a lending protocol, positions, caps answered. */
const typical: MandateDraft = (() => {
  const draft = withProtocols(withNetworks(base, ["arbitrum", "robinhood"], catalog), [
    ...REQUIRED_PROTOCOLS,
    "aave-v3",
    "uniswap-v4",
  ]);
  const eth = token("ETH", "arbitrum");
  const wbtc = token("WBTC", "arbitrum");
  const ethSpoke = token("ETH", "robinhood");
  return {
    ...draft,
    tokens: [...draft.tokens, eth, wbtc, ethSpoke],
    pools: [pool(1, "ETH", 5), pool(2, "WBTC", 30)],
    caps: {
      networks: { ...draft.caps.networks, robinhood: { noCap: false, pct: 35 } },
      protocols: { "aave-v3": { noCap: false, pct: 50 }, "uniswap-v4": { noCap: true, pct: 0 } },
      tokens: {
        [tokenKey(eth)]: { noCap: false, pct: 40 },
        [tokenKey(wbtc)]: { noCap: false, pct: 20 },
        [tokenKey(ethSpoke)]: { noCap: true, pct: 0 },
      },
    },
    completedAt: "2026-10-02T00:00:00.000Z",
  };
})();

/** Twelve pools, so the four-shown cut and the "and N more" count are visible. */
const wide: MandateDraft = {
  ...typical,
  pools: [
    "ETH",
    "WBTC",
    "ARB",
    "LINK",
    "UNI",
    "AAVE",
    "GMX",
    "CRV",
    "LDO",
    "OP",
    "PENDLE",
    "RDNT",
  ].map((symbol, index) => pool(index + 1, symbol, index % 2 === 0 ? 5 : 30)),
};

const meta = {
  title: "Manager/MandateSummaryCard",
  component: MandateSummaryCard,
  args: { catalog },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 760 }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "A mandate read back: networks, protocols (the required two first, with a Lock), tokens grouped by symbol with their network dots, the first four pools, and the cap rows. The Broad mandate flag is passed in rather than derived, because the pool universe it depends on is known only to the Pools step.",
      },
    },
  },
} satisfies Meta<typeof MandateSummaryCard>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The smallest mandate the builder can produce: hub, required protocols, deposit token, no caps. */
export const Minimal: Story = {
  args: { draft: minimal },
};

/** What a finished mandate normally looks like. */
export const Typical: Story = {
  args: { draft: typical },
};

/** Twelve pools: four listed, the rest counted. */
export const ManyPools: Story = {
  args: { draft: wide },
};

/** R13: the one claim on the card, and the one an investor sees before depositing. */
export const BroadMandate: Story = {
  args: { draft: wide, broad: true },
};
