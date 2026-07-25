/**
 * @id PP-STR-CMP-023
 * @name FundingSourceSelector, stories
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The five states worth looking at: one holding, a wallet spread across all three chains, a chain
 * that cannot pay its own gas (blocked, and shown anyway), a selection that does not reach the
 * requirement, and an exact cover. Interactive, so the running total and the CTA gate can be
 * exercised by hand.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import type { FundingSource } from "@/lib/balances/fundingInventory";
import type { GasFeasibility } from "@/lib/provisioning";
import { GAS_ESCAPE_LABEL_KEYS, GAS_VERDICT_REASON_KEYS } from "@/lib/provisioning";
import { FundingSourceSelector } from "./FundingSourceSelector";

const ARBITRUM = 42161;
const BASE = 8453;
const POLYGON = 137;

const baseUsdc: FundingSource = {
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  chainId: BASE,
  symbol: "USDC",
  decimals: 6,
  amount: "620450000",
  usd: 620.45,
  reachableChainIds: [ARBITRUM, BASE, POLYGON],
  isNative: false,
  logoUrl: "",
};

const polygonWeth: FundingSource = {
  address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  chainId: POLYGON,
  symbol: "WETH",
  decimals: 18,
  amount: "148000000000000000",
  usd: 431.2,
  reachableChainIds: [ARBITRUM, BASE, POLYGON],
  isNative: false,
  logoUrl: "",
};

const arbitrumUsdc: FundingSource = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  chainId: ARBITRUM,
  symbol: "USDC",
  decimals: 6,
  amount: "212900000",
  usd: 212.9,
  reachableChainIds: [ARBITRUM, BASE, POLYGON],
  isNative: false,
  logoUrl: "",
};

const ok = (chainId: number): GasFeasibility => ({
  chainId,
  verdict: "OK",
  quotedGasUsd: 0.14,
  requiredGasUsd: 0.19,
  shortfallUsd: 0,
  surplusUsd: 2.4,
  reasonKey: GAS_VERDICT_REASON_KEYS.ok,
});

const topUp = (chainId: number): GasFeasibility => ({
  chainId,
  verdict: "TOP_UP",
  quotedGasUsd: 0.22,
  requiredGasUsd: 0.33,
  shortfallUsd: 0.29,
  surplusUsd: 0,
  reasonKey: GAS_VERDICT_REASON_KEYS.topUp,
  topUp: {
    token: {
      symbol: "WETH",
      address: polygonWeth.address,
      decimals: 18,
      balanceRaw: polygonWeth.amount,
      balanceUsd: polygonWeth.usd,
    },
    amountRaw: "99000000000000",
    amountUsd: 0.29,
    buyNativeUsd: 0.29,
  },
});

const blocked = (chainId: number): GasFeasibility => ({
  chainId,
  verdict: "BLOCKED",
  quotedGasUsd: 0.18,
  requiredGasUsd: 0.23,
  shortfallUsd: 0.23,
  surplusUsd: 0,
  reasonKey: GAS_VERDICT_REASON_KEYS.noNative,
  escapes: [
    {
      kind: "bridge-native",
      labelKey: GAS_ESCAPE_LABEL_KEYS["bridge-native"],
      fromChainIds: [BASE],
    },
    { kind: "buy-crypto", labelKey: GAS_ESCAPE_LABEL_KEYS["buy-crypto"] },
  ],
});

const meta = {
  title: "Strategies/Provisioning/FundingSourceSelector",
  component: FundingSourceSelector,
  parameters: { layout: "centered" },
  args: {
    sources: [],
    gasByChainId: {},
    requiredUsd: 500,
    selected: [],
    onSelectedChange: () => {},
    onConfirm: () => {},
  },
} satisfies Meta<typeof FundingSourceSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

function Interactive({
  sources,
  gasByChainId,
  requiredUsd,
  initial = [],
}: {
  sources: FundingSource[];
  gasByChainId: Record<number, GasFeasibility>;
  requiredUsd: number;
  initial?: string[];
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <div className="w-[26rem] rounded-2xl bg-surface p-5">
      <FundingSourceSelector
        sources={sources}
        gasByChainId={gasByChainId}
        requiredUsd={requiredUsd}
        selected={selected}
        onSelectedChange={setSelected}
        onConfirm={() => {}}
      />
    </div>
  );
}

/** One holding, comfortably covering a small requirement. */
export const SingleSource: Story = {
  render: () => (
    <Interactive sources={[baseUsdc]} gasByChainId={{ [BASE]: ok(BASE) }} requiredUsd={250} />
  ),
};

/** A wallet spread across all three chains, one of which needs a gas top-up first. */
export const MultipleSources: Story = {
  render: () => (
    <Interactive
      sources={[baseUsdc, polygonWeth, arbitrumUsdc]}
      gasByChainId={{
        [BASE]: ok(BASE),
        [POLYGON]: topUp(POLYGON),
        [ARBITRUM]: ok(ARBITRUM),
      }}
      requiredUsd={900}
    />
  ),
};

/** A chain holding no native coin: the row stays, greyed, with its reason and its two escapes. */
export const BlockedChain: Story = {
  render: () => (
    <Interactive
      sources={[baseUsdc, arbitrumUsdc]}
      gasByChainId={{ [BASE]: ok(BASE), [ARBITRUM]: blocked(ARBITRUM) }}
      requiredUsd={700}
    />
  ),
};

/** Everything selected and still short: the shortfall stays on screen and the CTA stays shut. */
export const InsufficientTotal: Story = {
  render: () => (
    <Interactive
      sources={[baseUsdc, arbitrumUsdc]}
      gasByChainId={{ [BASE]: ok(BASE), [ARBITRUM]: ok(ARBITRUM) }}
      requiredUsd={1500}
      initial={[
        `${BASE}:${baseUsdc.address.toLowerCase()}`,
        `${ARBITRUM}:${arbitrumUsdc.address.toLowerCase()}`,
      ]}
    />
  ),
};

/** The selection lands exactly on the requirement: covered, and the CTA opens. */
export const ExactCover: Story = {
  render: () => (
    <Interactive
      sources={[baseUsdc, polygonWeth]}
      gasByChainId={{ [BASE]: ok(BASE), [POLYGON]: ok(POLYGON) }}
      requiredUsd={620.45}
      initial={[`${BASE}:${baseUsdc.address.toLowerCase()}`]}
    />
  ),
};
