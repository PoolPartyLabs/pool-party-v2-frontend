/**
 * @id PP-CORE-MOD-005
 * @name WalletModal.stories
 * @implements-rules-version v1
 * Storybook coverage for the wallet modal: default (multi-token), empty/zero, and loading states.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { TokenBalance } from "@/lib/balances";
import { WalletModal } from "./WalletModal";

// USDC across two networks (top group) + volatile tokens + a sub-$1 dust row (hidden by the list,
// still counted in the total) to exercise the POO-814 group/divider/hide-<$1 rules.
const balances: TokenBalance[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    amount: 1200,
    decimals: 6,
    usd: 1200,
    chainId: 8453,
    logoUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    amount: 340.5,
    decimals: 6,
    usd: 340.5,
    chainId: 42161,
    logoUrl: "https://assets.coingecko.com/coins/images/6319/large/usdc.png",
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    amount: 0.0008,
    decimals: 8,
    usd: 52,
    chainId: 42161,
    logoUrl: "https://assets.coingecko.com/coins/images/7598/large/wrapped_bitcoin_wbtc.png",
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    amount: 0.02,
    decimals: 18,
    usd: 50,
    chainId: 8453,
    logoUrl: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
  },
  {
    symbol: "DAI",
    name: "Dai",
    amount: 30,
    decimals: 18,
    usd: 30,
    chainId: 137,
    logoUrl: "https://assets.coingecko.com/coins/images/9956/large/Badge_Dai.png",
  },
  {
    symbol: "AERO",
    name: "Aerodrome",
    amount: 12,
    decimals: 18,
    usd: 10,
    chainId: 8453,
    logoUrl: "https://assets.coingecko.com/coins/images/31745/large/token.png",
  },
  {
    symbol: "PEPE",
    name: "Pepe",
    amount: 5_000_000,
    decimals: 18,
    usd: 0.35,
    chainId: 8453,
    logoUrl: "https://assets.coingecko.com/coins/images/29850/large/pepe-token.jpeg",
  },
];

const noop = () => {};

const meta = {
  title: "Wallet/WalletModal",
  component: WalletModal,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onOpenChange: noop,
    address: "0x1A2b3C4d5E6f7890a1B2c3D4e5F6789012345678",
    walletKind: "embedded",
    balances,
    totalUsd: 1682.85,
    dayChangeUsd: 58.4,
    dayChangePct: 0.047,
    isLoading: false,
    isRefreshing: false,
    onRefresh: noop,
    onBuy: noop,
    onReceive: noop,
    onManage: noop,
    onDisconnect: noop,
  },
} satisfies Meta<typeof WalletModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Connected wallet with balances across Arbitrum, Base and Polygon. */
export const Default: Story = {};

/** First-run / zero-balance state: an informational placeholder only, while the persistent actions row (Buy/Receive) and the Manage/Disconnect footer remain available. */
export const Empty: Story = { args: { balances: [], totalUsd: 0 } };

/** Balances still loading (skeletons). */
export const Loading: Story = { args: { isLoading: true, balances: [], totalUsd: 0 } };

/** Manual refresh in flight (POO-808): the total stays put while the refresh icon spins. */
export const Refreshing: Story = { args: { isRefreshing: true } };
