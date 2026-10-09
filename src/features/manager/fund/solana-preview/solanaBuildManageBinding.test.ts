/**
 * @id PP-MGR-LIB-076
 * @name Shared Solana Build Manage binding tests
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, pure boundary regressions.
 */
import { expect, it } from "vitest";
import { type BuildPlan, isPlanBlocked, type PlanContext } from "../build/plan/buildPlan";
import { addChain, addSpoke, applyBlockConfig } from "../build/plan/planReducers";
import { addToken, isBlocked, withNetworks, withProtocols } from "../mandateDraft";
import {
  buildSolanaBuilderCatalog,
  createSolanaBuilderDraft,
  SOLANA_LOCAL_CONFIGS,
} from "./solanaBuilderRuntime";
import { applyLocalManageConfig, localManageBlocks } from "./solanaBuildManageBinding";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

function fixture() {
  const catalog = buildSolanaBuilderCatalog();
  const base = withProtocols(
    withNetworks(createSolanaBuilderDraft("now", "local"), ["solana"], catalog),
    ["orca", "jupiter"],
  );
  const token = catalog
    .tokensFor(["solana"], base.protocols)
    .find((value) => value.address === WSOL_MINT);
  if (!token) throw new Error("missing WSOL metadata");
  const tokens = addToken(base, token, catalog);
  if (isBlocked(tokens)) throw new Error("invalid mandate fixture");
  let seq = 0;
  const ctx: PlanContext = { draft: tokens, catalog, newId: () => `local-${++seq}` };
  const accept = (result: ReturnType<typeof addSpoke>): BuildPlan => {
    if (isPlanBlocked(result)) throw new Error(result.blocked.reason);
    return result;
  };
  let plan = accept(addSpoke({ version: 1, hub: { chains: [] }, spokes: [] }, ctx, "solana"));
  plan = accept(addChain(plan, ctx, "solana", "solanaOrcaPool"));
  const id = plan.spokes[0]?.chains[0]?.steps.find((step) => step.family === "position")?.id;
  if (!id) throw new Error("missing local position");
  plan = accept(applyBlockConfig(plan, ctx, id, SOLANA_LOCAL_CONFIGS.solanaOrcaPool ?? null, 30));
  return { ctx, plan, id };
}

// @rule POO-2301 R5/R8: exact stored instance and applied drawing config, no financial identity.
it("adapts applied local cards with exact IDs and no fallback canonical data", () => {
  const { plan, id } = fixture();
  expect(localManageBlocks(plan)).toEqual([
    { id, protocol: "orca", allocationBps: 3000, pair: "SOL / USDC" },
  ]);
  expect(localManageBlocks({ ...plan, spokes: [] })).toEqual([]);
});

// @rule POO-2301 R5/R8: acknowledged Apply uses atomic shared chain/spoke reducers.
it("applies the exact selected card and reconciles its automatic conversions", () => {
  const { plan, ctx, id } = fixture();
  const result = applyLocalManageConfig(plan, ctx, id, {
    allocation: "40",
    pair: "USDC / SOL",
    range: null,
  });
  expect(isPlanBlocked(result)).toBe(false);
  if (isPlanBlocked(result)) return;
  expect(result.spokes[0]?.sharePct).toBe(40);
  expect(result.spokes[0]?.chains[0]?.sharePct).toBe(40);
  expect(localManageBlocks(result)).toEqual([
    { id, protocol: "orca", allocationBps: 4000, pair: "USDC / SOL" },
  ]);
  expect(
    result.spokes[0]?.chains[0]?.steps.filter((step) => step.kind === "swap" && step.auto),
  ).toHaveLength(1);
  expect(plan.spokes[0]?.sharePct).toBe(30);
});

// @rule POO-2301 R5/R8: rejected Apply cannot consume hidden drafts or ignore mandate changes.
it.each([
  "protocol",
  "mint",
  "mint-case",
  "budget",
  "range",
])("refuses stale or unavailable %s without changing the plan", (reason) => {
  const { plan, ctx, id } = fixture();
  if (reason === "protocol")
    ctx.draft = {
      ...ctx.draft,
      protocols: ctx.draft.protocols.filter((protocol) => protocol !== "orca"),
    };
  if (reason === "mint")
    ctx.draft = {
      ...ctx.draft,
      tokens: ctx.draft.tokens.filter((token) => token.address !== WSOL_MINT),
    };
  if (reason === "mint-case")
    ctx.draft = {
      ...ctx.draft,
      tokens: ctx.draft.tokens.map((token) =>
        token.address === WSOL_MINT ? { ...token, address: token.address.toLowerCase() } : token,
      ),
    };
  if (reason === "budget") plan.hub.chains.push({ id: "hub", sharePct: 70, steps: [] });
  const before = structuredClone(plan);
  const result = applyLocalManageConfig(plan, ctx, id, {
    allocation: "40",
    pair: "SOL / USDC",
    range: reason === "range" ? { tickLower: 0, tickUpper: 64, displayInverted: false } : null,
  });
  expect(isPlanBlocked(result)).toBe(true);
  expect(plan).toEqual(before);
  expect(ctx.draft.tokens.some((token) => token.address === USDC_MINT)).toBe(true);
});
