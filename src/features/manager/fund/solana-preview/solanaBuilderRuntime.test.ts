/**
 * @id PP-MGR-SCR-002
 * @name Solana shared builder runtime regression tests
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, regression assertions.
 */
import { describe, expect, it } from "vitest";
import { applyPanelConfig, validManualSwapConfig } from "../build/plan/auxiliaryConfig";
import { isConfigFor } from "../build/plan/blockConfig";
import { type BuildPlan, createEmptyPlan, isPlanBlocked } from "../build/plan/buildPlan";
import { validatePlan } from "../build/plan/planInvariants";
import { planReadiness } from "../build/plan/planReadiness";
import {
  addChain,
  addSpoke,
  applyBlockConfig,
  insertAt,
  setBlockConfig,
} from "../build/plan/planReducers";
import {
  addToken,
  createEmptyDraft,
  tokenKey,
  validateStep,
  withNetworks,
  withProtocols,
} from "../mandateDraft";
import {
  buildSolanaBuilderCatalog,
  createSolanaBuilderDraft,
  SOLANA_LOCAL_CONFIGS,
} from "./solanaBuilderRuntime";

describe("shared Solana builder identity and visual configuration", () => {
  // @rule R4: Base58 mints remain case sensitive; EVM normalization stays unchanged.
  it("preserves a Solana mint while normalizing an EVM address", () => {
    expect(
      tokenKey({ network: "solana", address: "So11111111111111111111111111111111111111112" }),
    ).toBe("solana:So11111111111111111111111111111111111111112");
    expect(tokenKey({ network: "arbitrum", address: "0xAbCd" })).toBe("arbitrum:0xabcd");
  });
  // @rule R5/R7: local choices are descriptor intent, not a fabricated canonical pool.
  it("accepts a bounded local descriptor without treating it as a Uniswap pool", () => {
    const config = { catalogId: "solana:mainnet-beta:orca-whirlpools", pair: "SOL / USDC" };
    expect(isConfigFor("solanaOrcaPool", config)).toBe(true);
    expect(isConfigFor("uniswapV4Pool", config)).toBe(false);
    expect(isConfigFor("solanaOrcaPool", { ...config, poolId: "invented" })).toBe(false);
    expect(
      isConfigFor("solanaHolding", {
        catalogId: "solana:mainnet-beta:holding",
        pair: "USDC / SOL",
      }),
    ).toBe(true);
  });
});

// @rule R4/R8: drawing readiness never grants execution, including positions with no conversion.
it.each([
  "solanaHolding",
  "solanaKaminoSupply",
] as const)("keeps %s with USDC unavailable in default execution readiness", (kind) => {
  const catalog = buildSolanaBuilderCatalog();
  const selected = withNetworks(
    createSolanaBuilderDraft("now", "execution-gate"),
    ["solana"],
    catalog,
  );
  const draft = withProtocols(selected, [...selected.protocols, "kamino"]);
  if ("blocked" in draft) throw new Error("protocol selection refused");
  const config = SOLANA_LOCAL_CONFIGS[kind];
  if (!config) throw new Error("missing local descriptor");
  const plan: BuildPlan = {
    version: 1,
    hub: { chains: [] },
    spokes: [
      {
        network: "solana",
        sharePct: 20,
        chains: [
          {
            id: "local-chain",
            sharePct: 20,
            steps: [{ id: "local-position", family: "position", kind, config }],
          },
        ],
      },
    ],
  };
  const violations = validatePlan(plan, { draft, catalog });
  expect(violations).toEqual([]);
  expect(planReadiness(plan, violations, "local-visual")).toEqual({ ready: true });
  const unavailable = {
    ready: false,
    refusal: "review_invalid_block",
    target: { kind: "block", blockId: "local-position" },
  };
  expect(planReadiness(plan, violations)).toEqual(unavailable);
  expect(planReadiness(plan, violations, "execution")).toEqual(unavailable);
});

describe("[R3/R5/R6] local Configure mandate gate", () => {
  function fixture(
    kind: "solanaHolding" | "solanaOrcaPool" | "solanaRaydiumPool" = "solanaHolding",
  ) {
    const catalog = buildSolanaBuilderCatalog();
    const networks = withNetworks(
      createSolanaBuilderDraft("now", "configure"),
      ["solana"],
      catalog,
    );
    const wsol = catalog.tokensFor(["solana"], networks.protocols)[0];
    const initialConfig = SOLANA_LOCAL_CONFIGS[kind];
    if (!wsol || !initialConfig) throw new Error("local fixture missing");
    const selected = addToken(networks, wsol, catalog);
    if ("blocked" in selected) throw new Error("token refused");
    const draft = withProtocols(selected, ["jupiter", "orca", "raydium"]);
    const plan: BuildPlan = {
      version: 1,
      hub: { chains: [] },
      spokes: [
        {
          network: "solana",
          sharePct: 20,
          chains: [
            {
              id: "c",
              sharePct: 20,
              steps:
                kind === "solanaHolding"
                  ? [{ id: "p", family: "position", kind, config: initialConfig }]
                  : [
                      { id: "auto", family: "flow", kind: "swap", auto: true },
                      { id: "p", family: "position", kind, config: initialConfig },
                      { id: "collect", family: "flow", kind: "collectFees", auto: false },
                    ],
            },
          ],
        },
      ],
    };
    const config = { ...initialConfig, pair: "SOL / USDC" as const };
    return { catalog, draft, plan, config, initialConfig, wsol };
  }

  it.each([
    "solanaHolding",
    "solanaOrcaPool",
    "solanaRaydiumPool",
  ] as const)("refuses %s when either exact mint or Jupiter is missing, before config/share writes", (kind) => {
    const { catalog, draft, plan, config, wsol } = fixture(kind);
    for (const changed of [
      { ...draft, tokens: draft.tokens.filter((token) => token.address !== wsol.address) },
      {
        ...draft,
        tokens: draft.tokens.filter((token) => !(token.network === "solana" && token.locked)),
      },
      {
        ...draft,
        tokens: draft.tokens.map((token) =>
          token.address === wsol.address
            ? { ...token, address: token.address.toLowerCase() }
            : token,
        ),
      },
      withProtocols(draft, ["orca", "raydium"]),
      { ...draft, networks: draft.networks.filter((network) => network !== "solana") },
    ]) {
      const ctx = { draft: changed, catalog, newId: () => "new-auto" };
      const before = structuredClone(plan);
      expect(setBlockConfig(plan, ctx, "p", config)).toEqual({
        blocked: { reason: "not_in_mandate", targetId: "p" },
      });
      expect(applyBlockConfig(plan, ctx, "p", config, 40)).toEqual({
        blocked: { reason: "not_in_mandate", targetId: "p" },
      });
      expect(plan).toEqual(before);
    }
  });

  it.each([
    "solanaOrcaPool",
    "solanaRaydiumPool",
  ] as const)("refuses %s after its selected protocol leaves the mandate", (kind) => {
    const { catalog, draft, plan, config } = fixture(kind);
    const ctx = { draft: withProtocols(draft, ["jupiter"]), catalog, newId: () => "new" };
    expect(applyBlockConfig(plan, ctx, "p", config, 30)).toEqual({
      blocked: { reason: "not_in_mandate", targetId: "p" },
    });
  });

  it("allows a correction to USDC Holding while unrelated old branches remain invalid", () => {
    const { catalog, draft, plan, config, initialConfig, wsol } = fixture();
    const chain = plan.spokes[0]?.chains[0];
    if (!chain) throw new Error("local chain missing");
    chain.steps = [
      { id: "auto", family: "flow", kind: "swap", auto: true },
      { id: "p", family: "position", kind: "solanaHolding", config },
    ];
    plan.hub.chains.push({
      id: "old",
      sharePct: 0,
      steps: [
        {
          id: "unrelated",
          family: "position",
          kind: "aaveSupply",
          config: { assetKey: "arbitrum:unknown" },
        },
      ],
    });
    const changed = {
      ...withProtocols(draft, []),
      tokens: draft.tokens.filter((token) => token.address !== wsol.address),
    };
    const ctx = { draft: changed, catalog, newId: () => "new" };
    const result = applyBlockConfig(plan, ctx, "p", initialConfig, 20);
    expect(isPlanBlocked(result)).toBe(false);
    if (isPlanBlocked(result)) throw new Error("correction refused");
    expect(result.spokes[0]?.chains[0]?.steps.map((step) => step.kind)).toEqual(["solanaHolding"]);
    expect(validatePlan(result, ctx).map((violation) => violation.targetId)).toEqual(["unrelated"]);
    expect(isPlanBlocked(setBlockConfig(plan, ctx, "p", null))).toBe(false);
  });
});

// @rule R3/R5/R6: the standard mandate controls feed the shared plan without market fixtures.
it("selects Solana, applies independent LP intent and derives LP-only Collect", () => {
  const catalog = buildSolanaBuilderCatalog();
  let draft = createSolanaBuilderDraft("2026-10-08T00:00:00Z", "local");
  const networks = withNetworks(draft, ["solana"], catalog);
  if ("blocked" in networks) throw new Error("network selection refused");
  draft = networks;
  const protocols = withProtocols(draft, [...draft.protocols, "orca", "kamino", "jupiter"]);
  if ("blocked" in protocols) throw new Error("protocol selection refused");
  draft = protocols;
  const token = catalog.tokensFor(["solana"], draft.protocols)[0];
  expect(token?.address).toBe("So11111111111111111111111111111111111111112");
  expect(token?.priced).toBe(false);
  expect(catalog.networks.map((network) => network.id)).toEqual([
    "arbitrum",
    "robinhood",
    "solana",
  ]);
  expect(draft.networks).toEqual(["arbitrum", "solana"]);
  const next = addToken(draft, token!, catalog);
  if ("blocked" in next) throw new Error("token selection refused");
  draft = next;
  expect(validateStep(draft, "limits", catalog)?.reason).toBe("cap_missing");
  let serial = 0;
  const ctx = { draft, catalog, newId: () => `id-${++serial}` };
  const spoke = addSpoke(createEmptyPlan(), ctx, "solana");
  if (isPlanBlocked(spoke)) throw new Error("spoke refused");
  const chain = addChain(spoke, ctx, "solana", "solanaOrcaPool");
  if (isPlanBlocked(chain)) throw new Error("LP refused");
  const id = chain.spokes[0]!.chains[0]!.steps.find((step) => step.family === "position")!.id;
  const applied = applyBlockConfig(chain, ctx, id, SOLANA_LOCAL_CONFIGS.solanaOrcaPool!, 20);
  if (isPlanBlocked(applied)) throw new Error("Apply refused");
  expect(applied.spokes[0]!.chains[0]!.steps.map((step) => step.kind)).toEqual([
    "swap",
    "solanaOrcaPool",
    "collectFees",
  ]);
  expect(validatePlan(applied, ctx)).toEqual([]);
  // All configured cards and whole allocations are required even for visual Review.
  expect(planReadiness(applied, [], "local-visual")).toEqual({ ready: true });
  const incomplete = structuredClone(applied);
  incomplete.spokes[0]!.chains[0]!.steps.push({
    id: "empty",
    family: "position",
    kind: "solanaHolding",
    config: null,
  });
  expect(planReadiness(incomplete, [], "local-visual")).toMatchObject({
    ready: false,
    refusal: "review_empty_block",
  });
  const zero = structuredClone(applied);
  zero.spokes[0]!.chains[0]!.sharePct = 0;
  expect(planReadiness(zero, [], "local-visual")).toMatchObject({
    ready: false,
    refusal: "review_zero_share",
  });
  expect(planReadiness(applied, [])).toMatchObject({
    ready: false,
    refusal: "review_invalid_block",
  });
});

// @rule R3/R4/R6: Jupiter owns manual conversion; Holding has no LP collector and mints retain case.
it("requires Jupiter for manual Solana conversion and validates exact mint identity", () => {
  const catalog = buildSolanaBuilderCatalog();
  const draft = withNetworks(createSolanaBuilderDraft("now", "local"), ["solana"], catalog);
  const wsol = catalog.tokensFor(["solana"], draft.protocols)[0]!;
  const tokenDraft = addToken(draft, wsol, catalog);
  if ("blocked" in tokenDraft) throw new Error("token refused");
  let serial = 0;
  const ctx = { draft: tokenDraft, catalog, newId: () => `id-${++serial}` };
  const spoke = addSpoke(createEmptyPlan(), ctx, "solana");
  if (isPlanBlocked(spoke)) throw new Error("spoke refused");
  const chain = addChain(spoke, ctx, "solana", "solanaHolding");
  if (isPlanBlocked(chain)) throw new Error("Holding refused");
  const id = chain.spokes[0]!.chains[0]!.steps[0]!.id;
  const applied = applyBlockConfig(chain, ctx, id, SOLANA_LOCAL_CONFIGS.solanaHolding!, 20);
  if (isPlanBlocked(applied)) throw new Error("Holding Apply refused");
  expect(applied.spokes[0]!.chains[0]!.steps.map((step) => step.kind)).toEqual(["solanaHolding"]);
  const choice = { family: "flow", kind: "swap" } as const;
  expect(insertAt(applied, ctx, { blockId: id, side: "before" }, choice)).toMatchObject({
    blocked: { reason: "not_in_mandate" },
  });
  const jupiter = { ...ctx, draft: withProtocols(ctx.draft, [...ctx.draft.protocols, "jupiter"]) };
  expect(isPlanBlocked(insertAt(applied, jupiter, { blockId: id, side: "before" }, choice))).toBe(
    false,
  );
  const config = {
    tokenInKey: tokenKey(
      jupiter.draft.tokens.find((token) => token.network === "solana" && token.locked)!,
    ),
    tokenOutKey: tokenKey(wsol),
    slippagePct: 0.5,
  };
  expect(validManualSwapConfig(config, jupiter.draft, "solana")).toBe(true);
  expect(
    validManualSwapConfig(
      { ...config, tokenOutKey: config.tokenOutKey.toLowerCase() },
      jupiter.draft,
      "solana",
    ),
  ).toBe(false);
});

// @rule R2: widening the local palette does not widen an EVM mandate.
it("keeps local Solana protocols out of the standard protocol reducer", () => {
  const draft = createEmptyDraft("now", "evm");
  expect(withProtocols(draft, ["jupiter", "orca", "kamino", "raydium"]).protocols).toEqual(
    draft.protocols,
  );
});

// @rule R3/R6: later mandate edits preserve the card and invalidate its obsolete instruction.
it("invalidates local Jupiter after its protocol or exact output mint leaves the mandate", () => {
  const catalog = buildSolanaBuilderCatalog();
  const networks = withNetworks(createSolanaBuilderDraft("now", "local"), ["solana"], catalog);
  const wsol = catalog.tokensFor(["solana"], networks.protocols)[0]!;
  const tokenDraft = addToken(networks, wsol, catalog);
  if ("blocked" in tokenDraft) throw new Error("token refused");
  const draft = withProtocols(tokenDraft, ["jupiter"]);
  const config = {
    tokenInKey: tokenKey(draft.tokens.find((token) => token.network === "solana" && token.locked)!),
    tokenOutKey: tokenKey(wsol),
    slippagePct: 0.5,
  };
  const current: BuildPlan = {
    version: 1,
    hub: { chains: [] },
    spokes: [
      {
        network: "solana",
        sharePct: 20,
        chains: [
          {
            id: "c",
            sharePct: 20,
            steps: [
              { id: "j", family: "flow", kind: "swap", auto: false, config },
              {
                id: "h",
                family: "position",
                kind: "solanaHolding",
                config: SOLANA_LOCAL_CONFIGS.solanaHolding!,
              },
            ],
          },
        ],
      },
    ],
  };
  expect(validatePlan(current, { draft, catalog })).toEqual([]);
  const noProtocol = withProtocols(draft, []);
  const missingProtocol = validatePlan(current, { draft: noProtocol, catalog });
  expect(missingProtocol).toContainEqual({
    invariant: 2,
    code: "kind_not_in_mandate",
    targetId: "j",
  });
  expect(
    applyPanelConfig(current, { draft: noProtocol, catalog, newId: () => "new" }, "j", config),
  ).toMatchObject({
    blocked: { reason: "not_in_mandate", targetId: "j" },
  });
  const noToken = {
    ...draft,
    tokens: draft.tokens.filter((token) => tokenKey(token) !== config.tokenOutKey),
  };
  const missingToken = validatePlan(current, { draft: noToken, catalog });
  expect(missingToken).toContainEqual({
    invariant: 2,
    code: "config_not_in_mandate",
    targetId: "j",
  });
  expect(planReadiness(current, missingToken, "local-visual").ready).toBe(false);
  expect(current.spokes[0]?.chains[0]?.steps[0]?.id).toBe("j");
});

// @rule R3/R6: removing a selected mint invalidates the position and blocks visual Review.
it("invalidates LP and WSOL Holding after their exact selected mint leaves the mandate", () => {
  const catalog = buildSolanaBuilderCatalog();
  const networks = withNetworks(createSolanaBuilderDraft("now", "local"), ["solana"], catalog);
  const wsol = catalog.tokensFor(["solana"], networks.protocols)[0]!;
  const selected = addToken(networks, wsol, catalog);
  if ("blocked" in selected) throw new Error("token refused");
  const draft = withProtocols(selected, ["orca", "raydium", "jupiter"]);
  const kinds = ["solanaOrcaPool", "solanaRaydiumPool", "solanaHolding"] as const;
  for (const kind of kinds) {
    const config = {
      catalogId: SOLANA_LOCAL_CONFIGS[kind]!.catalogId,
      pair: "SOL / USDC" as const,
    };
    const plan: BuildPlan = {
      version: 1,
      hub: { chains: [] },
      spokes: [
        {
          network: "solana",
          sharePct: 20,
          chains: [
            {
              id: "c",
              sharePct: 20,
              steps: [
                { id: "auto", family: "flow", kind: "swap", auto: true },
                { id: "position", family: "position", kind, config },
              ],
            },
          ],
        },
      ],
    };
    expect(validatePlan(plan, { draft, catalog })).toEqual([]);
    const removed = {
      ...draft,
      tokens: draft.tokens.filter((token) => token.address !== wsol.address),
    };
    const violations = validatePlan(plan, { draft: removed, catalog });
    expect(violations).toContainEqual({
      invariant: 2,
      code: "config_not_in_mandate",
      targetId: "position",
    });
    expect(planReadiness(plan, violations, "local-visual").ready).toBe(false);
    expect(plan.spokes[0]?.chains[0]?.steps[1]?.id).toBe("position");
    const wrongCase = {
      ...draft,
      tokens: draft.tokens.map((token) =>
        token.address === wsol.address ? { ...token, address: token.address.toLowerCase() } : token,
      ),
    };
    expect(validatePlan(plan, { draft: wrongCase, catalog })).toContainEqual({
      invariant: 2,
      code: "config_not_in_mandate",
      targetId: "position",
    });
  }
});
// @rule R3/R6: automatic Jupiter conversions retain their mandate dependency after edits.
it("invalidates automatic local conversion when Jupiter is removed and keeps stable Holding direct", () => {
  const catalog = buildSolanaBuilderCatalog();
  const networks = withNetworks(createSolanaBuilderDraft("now", "local"), ["solana"], catalog);
  const wsol = catalog.tokensFor(["solana"], networks.protocols)[0]!;
  const selected = addToken(networks, wsol, catalog);
  if ("blocked" in selected) throw new Error("token refused");
  const draft = withProtocols(selected, ["jupiter"]);
  const plan: BuildPlan = {
    version: 1,
    hub: { chains: [] },
    spokes: [
      {
        network: "solana",
        sharePct: 20,
        chains: [
          {
            id: "c",
            sharePct: 20,
            steps: [
              { id: "auto", family: "flow", kind: "swap", auto: true },
              {
                id: "holding",
                family: "position",
                kind: "solanaHolding",
                config: { ...SOLANA_LOCAL_CONFIGS.solanaHolding!, pair: "SOL / USDC" },
              },
            ],
          },
        ],
      },
    ],
  };
  expect(validatePlan(plan, { draft, catalog })).toEqual([]);
  const without = withProtocols(draft, []);
  const violations = validatePlan(plan, { draft: without, catalog });
  expect(violations).toContainEqual({
    invariant: 2,
    code: "kind_not_in_mandate",
    targetId: "auto",
  });
  expect(planReadiness(plan, violations, "local-visual").ready).toBe(false);
  expect(violations).toContainEqual({
    invariant: 2,
    code: "kind_not_in_mandate",
    targetId: "holding",
  });
  plan.spokes[0]!.chains[0]!.steps = [
    {
      id: "holding",
      family: "position",
      kind: "solanaHolding",
      config: SOLANA_LOCAL_CONFIGS.solanaHolding!,
    },
  ];
  const stableOnly = {
    ...without,
    tokens: without.tokens.filter((token) => token.address !== wsol.address),
  };
  expect(validatePlan(plan, { draft: stableOnly, catalog })).toEqual([]);
});

// @rule R3/R6: app-owned entry and fee-return routes depend on Jupiter and both exact mints.
it("validates config-less automatic entry and derived fee conversion dependencies", () => {
  const catalog = buildSolanaBuilderCatalog();
  const networks = withNetworks(createSolanaBuilderDraft("now", "local"), ["solana"], catalog);
  const wsol = catalog.tokensFor(["solana"], networks.protocols)[0]!;
  const selected = addToken(networks, wsol, catalog);
  if ("blocked" in selected) throw new Error("token refused");
  const draft = withProtocols(selected, ["orca", "jupiter"]);
  const plan: BuildPlan = {
    version: 1,
    hub: { chains: [] },
    spokes: [
      {
        network: "solana",
        sharePct: 20,
        chains: [
          {
            id: "c",
            sharePct: 20,
            steps: [
              { id: "auto", family: "flow", kind: "swap", auto: true },
              {
                id: "pool",
                family: "position",
                kind: "solanaOrcaPool",
                config: SOLANA_LOCAL_CONFIGS.solanaOrcaPool!,
              },
              { id: "collect", family: "flow", kind: "collectFees", auto: false },
            ],
          },
        ],
      },
    ],
  };
  expect(validatePlan(plan, { draft, catalog })).toEqual([]);
  // The fee return Swap is presentation-only, so its dependency belongs to the stored collector.
  const withoutJupiter = withProtocols(draft, ["orca"]);
  expect(validatePlan(plan, { draft: withoutJupiter, catalog })).toContainEqual({
    invariant: 2,
    code: "kind_not_in_mandate",
    targetId: "collect",
  });
  const noInput = {
    ...draft,
    tokens: draft.tokens.filter((token) => !(token.network === "solana" && token.locked)),
  };
  const missingInput = validatePlan(plan, { draft: noInput, catalog });
  for (const targetId of ["auto", "pool", "collect"])
    expect(missingInput).toContainEqual({
      invariant: 2,
      code: "config_not_in_mandate",
      targetId,
    });
  const empty = structuredClone(plan);
  const pool = empty.spokes[0]!.chains[0]!.steps[1]!;
  if (pool.family !== "position") throw new Error("position missing");
  pool.config = null;
  expect(validatePlan(empty, { draft: withoutJupiter, catalog })).toContainEqual({
    invariant: 2,
    code: "kind_not_in_mandate",
    targetId: "auto",
  });
});
