/**
 * @id PP-MGR-CMP-061
 * @name panelFixtures
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, story and test support: fixture bodies that emit nothing.
 *
 * STORY AND TEST SUPPORT for the configuration panel (POO-2187). Nothing in the app imports it.
 *
 * {@link fixturePoolBody} and {@link fixtureSupplyBody} are SMALL fixture bodies for the kind to
 * body registry (`panelBodies.ts`), so the shell's four modes, its status row, its guard and its
 * Allocation can be shown and tested before the real Uniswap v4 pool and Aave Supply bodies land
 * (their own slices). The English here is fixture copy, never shipped: the real bodies bring their
 * keys. This file imports no value of `panelBodies.ts` or `BlockPanel.tsx`, so a test can mock the
 * registry with these bodies.
 */
"use client";

import { createTranslator } from "next-intl";
import { useId } from "react";
import enManager from "@/i18n/messages/en/manager.json";

import type { ManagerTranslate } from "../blocks/blockCopy";
import { feeNumber } from "../blocks/blockRegistry";
import { fullRangeTicks } from "../plan/blockConfig";
import type { AaveBlockConfig, PoolBlockConfig } from "../plan/buildPlan";
import { FundSlippageControl } from "./FundSlippageControl";
import { PanelFieldLabel } from "./PanelFieldLabel";
import { PanelSelect } from "./PanelSelect";
import type { PanelBodies, PanelBodyDefinition } from "./panelBodies";
import { makePanelCopy, type PanelCopy, usePanelCopy } from "./panelCopy";
import { panelAssetKey, panelPoolId } from "./panelIds";

/** The panel copy in English, through next-intl's own translator (ICU filled), for tests. */
export function makeTestPanelCopy(): PanelCopy {
  const translator = createTranslator({
    locale: "en",
    messages: { manager: enManager },
    namespace: "manager",
  });
  return makePanelCopy((key, values) => (translator as unknown as ManagerTranslate)(key, values));
}

/** The spacing of the fixture pools (the 0.05% tier). */
const FIXTURE_TICK_SPACING = 10;

/** A complete pool config with the fixture defaults: full range, the quote as stored, 2%. */
function fixturePoolConfig(poolId: string): PoolBlockConfig {
  const full = fullRangeTicks(FIXTURE_TICK_SPACING);
  return {
    poolId,
    tickLower: full?.tickLower ?? -887_270,
    tickUpper: full?.tickUpper ?? 887_270,
    fullRange: true,
    displayInverted: false,
    slippagePct: 2,
  };
}

/** A fixture pool body: the mandate's v4 pools of the network, a Pool select and Max slippage. */
export const fixturePoolBody: PanelBodyDefinition<PoolBlockConfig> = {
  usePick(context) {
    const pools = context.draft.pools.filter(
      (pool) => pool.network === context.network && pool.protocol === "uniswap-v4",
    );
    return {
      heading: "Pools in your mandate",
      count: pools.length,
      filterPlaceholder: "Filter by token or address",
      rows: pools.map((pool) => ({
        id: pool.id,
        title: `${pool.token0.symbol} / ${pool.token1.symbol}`,
        subtitle: `${feeNumber(pool.feeBps)}%`,
        logos: [
          { symbol: pool.token0.symbol, network: pool.network },
          { symbol: pool.token1.symbol, network: pool.network },
        ],
        searchText: `${pool.token0.name} ${pool.token1.name} ${pool.address}`,
        config: fixturePoolConfig(panelPoolId(pool)),
      })),
      caption: `Only the Uniswap v4 pools on ${context.networkName} that you chose in the mandate (step 4). Pools are fixed at launch.`,
      link: { prompt: "Need another pool?", label: "Edit mandate · Pools", step: "pools" },
      noMatch: {
        title: (typed) => `No pool in your mandate has ${typed}`,
        caption:
          "Pools are chosen in the mandate, step 4. Your build stays saved while you edit it.",
      },
      emptyTitle: `No pool of your mandate is on ${context.networkName}`,
    };
  },
  Fields({ context, config, onConfigChange, allocation }) {
    const copy = usePanelCopy();
    const labelId = useId();
    const pools = context.draft.pools.filter(
      (pool) => pool.network === context.network && pool.protocol === "uniswap-v4",
    );
    return (
      <>
        <div className="flex flex-col gap-2">
          <PanelFieldLabel
            label="Pool"
            help={`Uniswap v4 pools of your mandate on ${context.networkName}.`}
            helpLabel={copy.moreAbout("Pool")}
            labelId={labelId}
          />
          <PanelSelect
            labelId={labelId}
            options={pools.map((pool) => ({
              id: panelPoolId(pool),
              label: `${pool.token0.symbol} / ${pool.token1.symbol} · ${feeNumber(pool.feeBps)}%`,
              logos: [
                { symbol: pool.token0.symbol, network: pool.network },
                { symbol: pool.token1.symbol, network: pool.network },
              ],
            }))}
            value={config.poolId}
            onChange={(poolId) => onConfigChange({ ...config, poolId })}
            footer={{
              prompt: "Need another pool?",
              label: copy.link.pools,
              onClick: () => context.onEditMandate("pools"),
            }}
          />
        </div>
        {allocation}
        <FundSlippageControl
          value={config.slippagePct ?? 2}
          onChange={(slippagePct) => onConfigChange({ ...config, slippagePct })}
          copy={{
            label: copy.slippage.label,
            help: copy.slippage.help,
            helpLabel: copy.moreAbout(copy.slippage.label),
            custom: copy.slippage.custom,
            customLabel: copy.slippage.customLabel,
            max: copy.slippage.max,
          }}
        />
      </>
    );
  },
};

/** A fixture Aave Supply body: the mandate's tokens of the network, an Asset select. */
export const fixtureSupplyBody: PanelBodyDefinition<AaveBlockConfig> = {
  usePick(context) {
    const tokens = context.draft.tokens.filter((token) => token.network === context.network);
    return {
      heading: "Assets in your mandate",
      count: tokens.length,
      filterPlaceholder: "Filter by token",
      rows: tokens.map((token, index) => ({
        id: panelAssetKey(token),
        title: token.symbol,
        subtitle: token.name,
        logos: [{ symbol: token.symbol, network: token.network }],
        metric: {
          label: "Supply APY",
          value: `${(4.1 - index * 1.1).toFixed(1)}%`,
          tone: "success",
        },
        searchText: token.address,
        config: { assetKey: panelAssetKey(token) },
      })),
      caption: `Only the tokens of your mandate that Aave v3 lists on ${context.networkName} (step 3).`,
      link: { prompt: "Need another asset?", label: "Edit mandate · Tokens", step: "tokens" },
      noMatch: {
        title: (typed) => `No asset in your mandate matches ${typed}`,
        caption:
          "Tokens are chosen in the mandate, step 3. Your build stays saved while you edit it.",
      },
      emptyTitle: `No asset of your mandate is on ${context.networkName}`,
    };
  },
  Fields({ context, config, onConfigChange, allocation }) {
    const copy = usePanelCopy();
    const labelId = useId();
    const tokens = context.draft.tokens.filter((token) => token.network === context.network);
    return (
      <>
        <div className="flex flex-col gap-2">
          <PanelFieldLabel
            label="Asset"
            help={`Tokens of your mandate that Aave v3 lists on ${context.networkName}.`}
            helpLabel={copy.moreAbout("Asset")}
            labelId={labelId}
          />
          <PanelSelect
            labelId={labelId}
            options={tokens.map((token) => ({
              id: panelAssetKey(token),
              label: token.symbol,
              logos: [{ symbol: token.symbol, network: token.network }],
              metric: { label: "Supply APY", value: "4.1%", tone: "success" },
            }))}
            value={config.assetKey}
            onChange={(assetKey) => onConfigChange({ ...config, assetKey })}
            footer={{
              prompt: "Need another asset?",
              label: copy.link.tokens,
              onClick: () => context.onEditMandate("tokens"),
            }}
          />
        </div>
        {allocation}
      </>
    );
  },
};

/** The fixture registry: a pool and a Supply body. */
export const FIXTURE_BODIES: PanelBodies = {
  uniswapV4Pool: fixturePoolBody,
  aaveSupply: fixtureSupplyBody,
};

/**
 * The fixture pool body with an apply gate that never opens (review M1): what the Uniswap body does
 * while its live pool read is loading. Stories and tests.
 */
export const fixtureHeldPoolBody: PanelBodyDefinition<PoolBlockConfig> = {
  ...fixturePoolBody,
  useApplyGate: () => ({ ok: false, reason: "Waiting for the live pool price." }),
};

/** A Supply body whose second asset cannot be used, with its reason (review M2). */
export const fixtureLimitedSupplyBody: PanelBodyDefinition<AaveBlockConfig> = {
  ...fixtureSupplyBody,
  usePick(context) {
    const model = fixtureSupplyBody.usePick(context);
    return {
      ...model,
      rows: model.rows.map((row, index) =>
        index === 1 ? { ...row, disabledReason: "Supply cap reached" } : row,
      ),
    };
  },
};
