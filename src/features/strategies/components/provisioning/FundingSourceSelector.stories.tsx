/**
 * @id PP-STR-CMP-023 (POO-1155)
 * @name FundingSourceSelector, stories
 * @implements-rules-version v3 (POO-1155 / POO-1129 rules v3) · v2 (POO-1086 rules v1) · v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The states worth looking at: one holding, a wallet spread across all three chains, a chain that
 * cannot pay its own gas (blocked, and shown anyway), a selection that does not reach the
 * requirement, an exact cover, and one that overshoots. Interactive, so the coverage meter, the
 * "Convert everything" shortcut and the CTA gate can all be exercised by hand.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { type ReactNode, useState } from "react";
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

const NATIVE = "0x0000000000000000000000000000000000000000";

/**
 * POO-1155: a same-chain USDC holding as it really arrives from Uniswap — the routability list is
 * bridge DESTINATIONS and OMITS the token's own chain (42161). It must still be selectable, since a
 * same-chain holding needs no bridge at all.
 */
const arbitrumUsdcOwnChainOmitted: FundingSource = {
  ...arbitrumUsdc,
  reachableChainIds: [BASE, POLYGON],
};

/** POO-1155: the native coin below the signing reserve (0.0007 ETH < 0.001 floor): unselectable. */
const arbitrumEthBelowReserve: FundingSource = {
  address: NATIVE,
  chainId: ARBITRUM,
  symbol: "ETH",
  decimals: 18,
  amount: "700000000000000",
  usd: 2.31,
  reachableChainIds: [BASE],
  isNative: true,
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
    // [R50] The buffer disclosure interpolates this, so every story states the rate it applies.
    bufferPct: 5,
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
  targetChainId,
  allowShortfall,
  bufferPct = 5,
  onOpenSettings,
  details,
}: {
  sources: FundingSource[];
  gasByChainId: Record<number, GasFeasibility>;
  requiredUsd: number;
  initial?: string[];
  targetChainId?: number;
  allowShortfall?: boolean;
  bufferPct?: number;
  onOpenSettings?: () => void;
  details?: ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <div className="w-[26rem] rounded-2xl bg-surface p-5">
      <FundingSourceSelector
        sources={sources}
        gasByChainId={gasByChainId}
        requiredUsd={requiredUsd}
        bufferPct={bufferPct}
        selected={selected}
        onSelectedChange={setSelected}
        onConfirm={() => {}}
        {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
        {...(details === undefined ? {} : { details })}
        {...(targetChainId === undefined ? {} : { targetChainId })}
        {...(allowShortfall === undefined ? {} : { allowShortfall })}
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

/**
 * A chain holding no native coin. POO-1502 [R11]: the row is NOT rendered, so this story shows one
 * option where the wallet has two holdings. It deliberately reverses POO-1032 [R2]/[R3], and the
 * cost is that the screen no longer says why the Arbitrum money cannot move.
 */
export const BlockedChainIsNotListed: Story = {
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

/**
 * The overshoot, which is the visible consequence of POO-1082 D1.
 *
 * The Figma draws a per-token amount with a Max button, so its meter always lands on "Enough".
 * Selection here is whole-source (the amount editor is deferred to POO-1090), so picking a $620.45
 * holding to cover $210 really does commit all of it, and the meter says by how much. Naming the
 * surplus is the honest version of that: a user who has just over-committed $410 needs to be told,
 * not shown a green tick.
 */
export const Surplus: Story = {
  render: () => (
    <Interactive
      sources={[baseUsdc, arbitrumUsdc]}
      gasByChainId={{ [BASE]: ok(BASE), [ARBITRUM]: ok(ARBITRUM) }}
      requiredUsd={210}
      initial={[`${BASE}:${baseUsdc.address.toLowerCase()}`]}
    />
  ),
};

/**
 * POO-1155, the reported wallet's shape, on an Arbitrum strategy. The same-chain USDC arrives with its
 * OWN chain omitted from the routability list (bridge destinations only) and is still selectable and
 * pre-selected via `initial`; the below-reserve native ETH is greyed with "Kept for network costs",
 * not the misleading "Can't reach this network"; and `allowShortfall` keeps Continue live so the
 * on-ramp can buy the remainder.
 */
export const SameChainAndNativeReserve: Story = {
  render: () => (
    <Interactive
      sources={[arbitrumUsdcOwnChainOmitted, arbitrumEthBelowReserve]}
      gasByChainId={{ [ARBITRUM]: ok(ARBITRUM) }}
      requiredUsd={500}
      targetChainId={ARBITRUM}
      allowShortfall
      initial={[`${ARBITRUM}:${arbitrumUsdcOwnChainOmitted.address.toLowerCase()}`]}
    />
  ),
};

/**
 * POO-1502 `2c` (Figma `7354:766`): the gear ([R17]) and the step plan behind `See details` ([R18]).
 *
 * The detail is a slot, so this story stands in for what `ProvisioningPanel` composes there
 * (`ProvisioningPlanCard` + `ProvisioningCostBreakdown`). What matters at this level is the rule:
 * the *how* goes behind the disclosure and the coverage total above it never does.
 */
export const SettingsAndDetails: Story = {
  render: () => (
    <Interactive
      sources={[baseUsdc, arbitrumUsdc]}
      gasByChainId={{ [BASE]: ok(BASE), [ARBITRUM]: ok(ARBITRUM) }}
      requiredUsd={700}
      onOpenSettings={() => {}}
      details={
        <div className="rounded-xl bg-surface-raised p-4 text-foreground text-sm">
          The step plan and the You pay block live here.
        </div>
      }
    />
  ),
};
