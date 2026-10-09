/**
 * @id PP-MGR-LIB-078-TEST
 * @name chartContext tests
 * @description Build pending configuration and Manage position identity chart boundaries.
 * @figma https://www.figma.com/design/jjOf5DL9uVEB7WBR9nGb4A?node-id=8674-15508
 * @linear https://linear.app/yeildbay/issue/POO-2309
 * @implements-rules-version v1 (POO-2309)
 * @analytics-events none, pure context tests.
 */
import { describe, expect, it } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import type { PanelDraftTarget } from "../build/panel/usePanelDraft";
import type { PanelConfig } from "../build/plan/buildPlan";
import { makeTestDraft, TEST_POOL_IDS } from "../build/plan/planTestKit";
import { type ManagePosition, normalizeManageModel } from "../manage/manageModel";
import { type MandateDraft, tokenKey } from "../mandateDraft";
import { SOLANA_LOCAL_CONFIGS } from "../solana-preview/solanaBuilderRuntime";
import { USDC_MINT, WSOL_MINT } from "../solana-preview/solanaSchemas";
import { buildChartSelection, manageChartSelection } from "./chartContext";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture");
  return value;
}

const unavailable = (reason: string) => ({ status: "unavailable", reason });
function target(
  kind: PanelDraftTarget["kind"] = "uniswapV4Pool",
  network: PanelDraftTarget["network"] = "arbitrum",
): PanelDraftTarget {
  return {
    blockId: "selected-block",
    kind,
    network,
    applied: { config: { poolId: "applied-other-pool" }, sharePct: 25 },
  };
}
function solanaDraft(): MandateDraft {
  const base = makeTestDraft();
  return {
    ...base,
    runtime: "solana-local",
    networks: [...base.networks, "solana"],
    tokens: [
      ...base.tokens,
      {
        address: WSOL_MINT,
        symbol: "WSOL",
        name: "Wrapped SOL",
        network: "solana",
        logoUrl: null,
        locked: false,
      },
      {
        address: USDC_MINT,
        symbol: "USDC",
        name: "USD Coin",
        network: "solana",
        logoUrl: null,
        locked: true,
      },
    ],
  };
}
function position(): ManagePosition {
  const base = normalizeManageModel(mockFund).positions.find((item) => item.kind === "liquidity");
  if (!base) throw new Error("Expected liquidity fixture");
  const tokens = makeTestDraft().tokens.filter((token) => token.network === "arbitrum");
  return {
    ...base,
    id: "position-a",
    core: "core-a",
    poolId: "pool-a",
    chainId: 42161,
    network: "arbitrum",
    tokens: tokens.map((token) => ({
      chainId: 42161,
      address: token.address,
      symbol: token.symbol,
      decimals: 18,
      amount: { status: "unavailable", reason: "irrelevant" },
    })),
  };
}

describe("Build chart context", () => {
  // @rule R2: current panel choices determine the exact reference, before Apply.
  it("uses the unapplied pool config rather than the target's applied pool", () => {
    const result = buildChartSelection(makeTestDraft(), target(), {
      poolId: TEST_POOL_IDS.arbitrum,
    });
    expect(result.availability).toMatchObject({ status: "available", market: { id: "eth-usdc" } });
    expect(result.identity).toContain(TEST_POOL_IDS.arbitrum);
    expect(result.identity).not.toContain("applied-other-pool");
  });

  // @rule R3: missing selection and configuration never borrow a default market.
  it("distinguishes no selection, no config and unknown pool", () => {
    expect(buildChartSelection(makeTestDraft(), null, null)).toEqual({
      identity: null,
      availability: unavailable("no_selection"),
    });
    expect(buildChartSelection(makeTestDraft(), target(), null).availability).toEqual(
      unavailable("unconfigured"),
    );
    expect(
      buildChartSelection(makeTestDraft(), target(), { poolId: "unknown" }).availability,
    ).toEqual(unavailable("unconfigured"));
  });

  // @rule R2: symbols do not authorize a market, and protocol/network identity must match.
  it("rejects forged labels, wrong pool protocol and wrong network", () => {
    const draft = makeTestDraft();
    required(draft.pools[0]).token0.address = `0x${"f".repeat(40)}`;
    expect(
      buildChartSelection(draft, target(), { poolId: TEST_POOL_IDS.arbitrum }).availability,
    ).toEqual(unavailable("unsupported_pair"));
    const wrongProtocol = makeTestDraft();
    required(wrongProtocol.pools[0]).protocol = "uniswap-v3";
    expect(
      buildChartSelection(wrongProtocol, target(), { poolId: TEST_POOL_IDS.arbitrum }).availability,
    ).toEqual(unavailable("unsupported_pair"));
    expect(
      buildChartSelection(makeTestDraft(), target("uniswapV4Pool", "robinhood"), {
        poolId: TEST_POOL_IDS.arbitrum,
      }).availability,
    ).toEqual(unavailable("unconfigured"));
  });

  // @rule R2: an EVM pool kind cannot authorize a local Solana descriptor's token identities.
  it("rejects a forged Solana pool carrying an EVM protocol", () => {
    const draft = solanaDraft();
    draft.pools = [
      {
        ...required(draft.pools[0]),
        id: "forged-solana-pool",
        network: "solana",
        token0: { address: WSOL_MINT, symbol: "SOL", name: "SOL", logoUrl: null },
        token1: { address: USDC_MINT, symbol: "USDC", name: "USDC", logoUrl: null },
      },
    ];
    expect(
      buildChartSelection(draft, target("uniswapV4Pool", "solana"), {
        poolId: "forged-solana-pool",
      }).availability,
    ).toEqual(unavailable("unsupported_pair"));
  });

  // @rule R6: unrelated mandate assets do not recreate a selected local pair's drawings.
  it("keeps Solana pair identity stable when another mandate token is added", () => {
    const draft = solanaDraft();
    const selected = target("solanaOrcaPool", "solana");
    const config = required(SOLANA_LOCAL_CONFIGS.solanaOrcaPool);
    const identity = buildChartSelection(draft, selected, config).identity;
    draft.tokens.push({
      address: "another-mint",
      symbol: "OTHER",
      name: "Other",
      network: "solana",
      logoUrl: null,
      locked: false,
    });
    expect(buildChartSelection(draft, selected, config).identity).toBe(identity);
  });

  // @rule R2: manual swaps resolve exact mandate token keys, in either ordering.
  it("resolves manual swap keys and rejects foreign or duplicate tokens", () => {
    const draft = makeTestDraft();
    const tokens = draft.tokens.filter((token) => token.network === "arbitrum");
    const config = {
      tokenInKey: tokenKey(required(tokens[0])),
      tokenOutKey: tokenKey(required(tokens[1])),
      slippagePct: 0.5,
    };
    expect(buildChartSelection(draft, target("swap"), config).availability).toMatchObject({
      status: "available",
    });
    expect(
      buildChartSelection(draft, target("swap"), {
        ...config,
        tokenInKey: config.tokenOutKey,
        tokenOutKey: config.tokenInKey,
      }).availability,
    ).toMatchObject({ status: "available" });
    expect(
      buildChartSelection(draft, target("swap"), {
        ...config,
        tokenOutKey: tokenKey(
          required(draft.tokens.find((token) => token.network === "robinhood")),
        ),
      }).availability,
    ).toEqual(unavailable("unsupported_pair"));
    expect(
      buildChartSelection(draft, target("swap"), { ...config, tokenOutKey: config.tokenInKey })
        .availability,
    ).toEqual(unavailable("unsupported_pair"));
  });

  // @rule R2: only local LP descriptors and exact case-sensitive mandate mints select SOL/USDC.
  it.each([
    "solanaOrcaPool",
    "solanaRaydiumPool",
  ] as const)("resolves %s and rejects wrong catalog, pair, runtime or mints", (kind) => {
    const config = required(SOLANA_LOCAL_CONFIGS[kind]);
    const selected = target(kind, "solana");
    expect(buildChartSelection(solanaDraft(), selected, config).availability).toMatchObject({
      status: "available",
      market: { id: "sol-usdc" },
    });
    expect(
      buildChartSelection(solanaDraft(), selected, { ...config, pair: "USDC / SOL" }).availability,
    ).toMatchObject({ status: "available" });
    expect(
      buildChartSelection(solanaDraft(), selected, { ...config, catalogId: "other" }).availability,
    ).toEqual(unavailable("unsupported_pair"));
    expect(
      buildChartSelection(solanaDraft(), selected, {
        ...config,
        pair: "SOL / USDT",
      } as unknown as PanelConfig).availability,
    ).toEqual(unavailable("unsupported_pair"));
    expect(buildChartSelection(makeTestDraft(), selected, config).availability).toEqual(
      unavailable("unsupported_pair"),
    );
    const forged = solanaDraft();
    required(forged.tokens.find((token) => token.address === WSOL_MINT)).address =
      WSOL_MINT.toLowerCase();
    expect(buildChartSelection(forged, selected, config).availability).toEqual(
      unavailable("unsupported_pair"),
    );
    const missing = solanaDraft();
    missing.tokens = missing.tokens.filter((token) => token.address !== USDC_MINT);
    expect(buildChartSelection(missing, selected, config).availability).toEqual(
      unavailable("unconfigured"),
    );
  });

  // @rule R3: holdings select one asset and lending is not a liquidity pair.
  it.each([
    ["aaveSupply", "lending_reference"],
    ["aaveBorrow", "lending_reference"],
    ["solanaKaminoSupply", "lending_reference"],
    ["solanaHolding", "unsupported_block"],
    ["gmxPerp", "unsupported_block"],
    ["spoke", "unsupported_block"],
  ] as const)("keeps %s unavailable as %s", (kind, reason) => {
    expect(buildChartSelection(solanaDraft(), target(kind), null).availability).toEqual(
      unavailable(reason),
    );
  });

  // @rule R6: drawing context excludes financial edits, but separates owner/block/market identities.
  it("retains identity across ticks/slippage/allocation and changes it for draft/block/pool/addresses", () => {
    const draft = makeTestDraft();
    const selected = target();
    const config = {
      poolId: TEST_POOL_IDS.arbitrum,
      tickLower: -10,
      tickUpper: 10,
      slippagePct: 1,
    };
    const identity = buildChartSelection(draft, selected, config).identity;
    expect(
      buildChartSelection(
        draft,
        { ...selected, applied: { ...selected.applied, sharePct: 80 } },
        { ...config, tickLower: -100, tickUpper: 100, slippagePct: 2, displayInverted: true },
      ).identity,
    ).toBe(identity);
    expect(
      buildChartSelection({ ...draft, id: "another-draft" }, selected, config).identity,
    ).not.toBe(identity);
    expect(
      buildChartSelection(draft, { ...selected, blockId: "another-block" }, config).identity,
    ).not.toBe(identity);
    draft.pools.push({ ...required(draft.pools[0]), id: "another-pool" });
    expect(
      buildChartSelection(draft, selected, { ...config, poolId: "another-pool" }).identity,
    ).not.toBe(identity);
    required(draft.pools[0]).token0.address = `0x${"a".repeat(40)}`;
    expect(buildChartSelection(draft, selected, config).identity).not.toBe(identity);
  });
});

describe("Manage chart context", () => {
  // @rule R2: current liquidity token identities resolve independently of labels and financial reads.
  it("resolves the exact current pair in either order", () => {
    const current = position();
    expect(manageChartSelection(current).availability).toMatchObject({
      status: "available",
      market: { id: "eth-usdc" },
    });
    expect(
      manageChartSelection({ ...current, tokens: [...current.tokens].reverse() }).availability,
    ).toMatchObject({ status: "available" });
  });

  // @rule R3: fixed nodes, supply and unsupported kinds never masquerade as an LP.
  it("rejects fixed, lending, unsupported and incomplete positions", () => {
    expect(manageChartSelection(null)).toEqual({
      identity: null,
      availability: unavailable("no_selection"),
    });
    expect(manageChartSelection({ ...position(), kind: "supply" }).availability).toEqual(
      unavailable("lending_reference"),
    );
    expect(manageChartSelection({ ...position(), kind: "unsupported" }).availability).toEqual(
      unavailable("unsupported_block"),
    );
    expect(manageChartSelection({ ...position(), tokens: [] }).availability).toEqual(
      unavailable("unconfigured"),
    );
  });

  // @rule R2: position network, token chain and actual addresses must agree.
  it("rejects forged symbols and mismatched chain identities", () => {
    const current = position();
    expect(
      manageChartSelection({
        ...current,
        tokens: current.tokens.map((token) => ({ ...token, address: `0x${"f".repeat(40)}` })),
      }).availability,
    ).toEqual(unavailable("unsupported_pair"));
    expect(manageChartSelection({ ...current, network: "base" }).availability).toEqual(
      unavailable("unsupported_pair"),
    );
    expect(
      manageChartSelection({
        ...current,
        tokens: [{ ...required(current.tokens[0]), chainId: 8453 }, required(current.tokens[1])],
      }).availability,
    ).toEqual(unavailable("unsupported_pair"));
  });

  // @rule R6: separate core/position/pool identities own separate drawings; reads do not recreate them.
  it("preserves drawings through financial reads and isolates owner, position, pool and tokens", () => {
    const current = position();
    const identity = manageChartSelection(current).identity;
    expect(
      manageChartSelection({
        ...current,
        valueUsd: { status: "available", value: "98765", source: "read" },
      }).identity,
    ).toBe(identity);
    for (const patch of [{ core: "core-b" }, { id: "position-b" }, { poolId: "pool-b" }])
      expect(manageChartSelection({ ...current, ...patch }).identity).not.toBe(identity);
    expect(
      manageChartSelection({
        ...current,
        tokens: [
          { ...required(current.tokens[0]), address: `0x${"a".repeat(40)}` },
          required(current.tokens[1]),
        ],
      }).identity,
    ).not.toBe(identity);
  });
});
