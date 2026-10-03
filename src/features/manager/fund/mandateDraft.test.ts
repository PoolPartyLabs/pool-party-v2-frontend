/**
 * @id PP-MGR-LIB-019
 * @name mandateDraft tests
 * @implements-rules-version v1 (POO-2121 rules v1)
 * @analytics-events none, a pure domain; the builder shell owns the mandate events.
 *
 * One `it()` per rule in the S1 brief. Every reducer is also checked for immutability: a draft
 * handed in must come back untouched, because the React hook keeps the previous draft on a block.
 */
import { describe, expect, it } from "vitest";
import { buildMandateCatalog, type MandateCatalogToken } from "./mandateCatalog";
import {
  addPool,
  addToken,
  capRows,
  clearCap,
  clearPools,
  clearTokens,
  createEmptyDraft,
  draftNameError,
  firstUnpassedStep,
  hasDexProtocol,
  isBlocked,
  isBroadMandate,
  isStepReachable,
  MANDATE_STEP_ORDER,
  MAX_TOKEN_SLOTS,
  type MandateDraft,
  type MandatePoolRef,
  nextStep,
  previousStep,
  REQUIRED_PROTOCOLS,
  removePool,
  removeToken,
  removeTokenSymbol,
  type StepBlock,
  selectionCounts,
  selectionFingerprint,
  setCap,
  slotsUsed,
  stepIndex,
  tokenKey,
  validateStep,
  visibleSteps,
  withNetworks,
  withProtocols,
} from "./mandateDraft";

const NOW = "2026-10-03T12:00:00.000Z";
const catalog = buildMandateCatalog({ robinhoodChain: true });

function empty(): MandateDraft {
  return createEmptyDraft(NOW, "draft-1");
}

/** A catalog token on `network` by canonical symbol; throws loudly so a bad fixture is obvious. */
function catalogToken(network: "arbitrum" | "robinhood", symbol: string): MandateCatalogToken {
  const found = catalog
    .tokensFor([network], [...REQUIRED_PROTOCOLS])
    .find((t) => t.symbol === symbol);
  if (!found) throw new Error(`fixture: no ${symbol} on ${network}`);
  return found;
}

/** The first element, failing the test loudly instead of handing a reducer `undefined`. */
function first<T>(items: T[], what: string): T {
  const value = items[0];
  if (value === undefined) throw new Error(`fixture: no ${what}`);
  return value;
}

/** Narrow a reducer result to a draft, failing the test when it blocked instead. */
function draftOf(result: MandateDraft | { blocked: StepBlock }): MandateDraft {
  if (isBlocked(result)) throw new Error(`unexpected block: ${JSON.stringify(result.blocked)}`);
  return result;
}

function pool(over: Partial<MandatePoolRef> = {}): MandatePoolRef {
  const eth = catalogToken("arbitrum", "ETH");
  const usdc = catalog.depositTokenFor("arbitrum");
  if (!usdc) throw new Error("fixture: no arbitrum deposit token");
  return {
    id: "arb-eth-usdc-5",
    address: "0xc6962004f452be9203591991d15f6b388e09e8d0",
    network: "arbitrum",
    protocol: "uniswap-v3",
    token0: { address: eth.address, symbol: eth.symbol, name: eth.name, logoUrl: eth.logoUrl },
    token1: { address: usdc.address, symbol: usdc.symbol, name: usdc.name, logoUrl: usdc.logoUrl },
    feeBps: 5,
    feeTier: 0.05,
    tvlUsd: 42_000_000,
    aprPct: 14.2,
    tierSharePct: 31,
    hasHook: false,
    ...over,
  };
}

/** A draft with a DEX protocol, so the Pools step exists. */
function withDex(): MandateDraft {
  return draftOf(withProtocols(empty(), [...REQUIRED_PROTOCOLS, "uniswap-v3"]));
}

// ---------------------------------------------------------------------------
// Constants and keys
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("fixes the step order, the slot ceiling and the required protocols", () => {
    // @rule R19 @rule R27 @rule R29
    expect(MANDATE_STEP_ORDER).toEqual(["networks", "protocols", "tokens", "pools", "limits"]);
    expect(MAX_TOKEN_SLOTS).toBe(16);
    expect(REQUIRED_PROTOCOLS).toEqual(["uniswap-v3-swap", "across"]);
  });

  it("keys a token by network and lowercased address", () => {
    // @rule R43
    expect(tokenKey({ network: "arbitrum", address: "0xAbCd" })).toBe("arbitrum:0xabcd");
  });
});

// ---------------------------------------------------------------------------
// createEmptyDraft (R15, R19, R24, R40)
// ---------------------------------------------------------------------------

describe("createEmptyDraft", () => {
  it("starts on the hub alone", () => {
    // @rule R15
    const draft = empty();
    expect(draft.networks).toEqual(["arbitrum"]);
    expect(draft.id).toBe("draft-1");
    expect(draft.createdAt).toBe(NOW);
    expect(draft.updatedAt).toBe(NOW);
    expect(draft.name).toBeNull();
    expect(draft.savedAt).toBeNull();
    expect(draft.completedAt).toBeNull();
    expect(draft.lastStep).toBe("networks");
    expect(draft.passedSteps).toEqual([]);
    expect(draft.pools).toEqual([]);
  });

  it("starts with the two required protocols", () => {
    // @rule R19
    expect(empty().protocols).toEqual(["uniswap-v3-swap", "across"]);
  });

  it("starts with the hub deposit token as a locked row", () => {
    // @rule R24
    const draft = empty();
    expect(draft.tokens).toHaveLength(1);
    expect(draft.tokens[0]).toMatchObject({
      symbol: "USDC",
      name: "USD Coin",
      network: "arbitrum",
      locked: true,
    });
    expect(slotsUsed(draft)).toBe(1);
  });

  it("writes the hub's implicit no-cap record explicitly", () => {
    // @rule R40
    const draft = empty();
    expect(draft.caps.networks.arbitrum).toEqual({ noCap: true, pct: 0 });
    expect(draft.caps.protocols).toEqual({});
    expect(draft.caps.tokens).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// withNetworks (R15, R16, R17, R24, R43)
// ---------------------------------------------------------------------------

describe("withNetworks", () => {
  it("never removes the hub", () => {
    // @rule R15
    expect(withNetworks(empty(), [], catalog).networks).toEqual(["arbitrum"]);
    expect(withNetworks(empty(), ["robinhood"], catalog).networks).toEqual([
      "arbitrum",
      "robinhood",
    ]);
  });

  it("accepts any subset of the available spokes in catalog order", () => {
    // @rule R16
    const next = withNetworks(empty(), ["robinhood", "arbitrum"], catalog);
    expect(next.networks).toEqual(["arbitrum", "robinhood"]);
  });

  it("ignores a network the catalog marks unavailable", () => {
    // @rule R17
    const next = withNetworks(empty(), ["base", "polygon", "unichain", "robinhood"], catalog);
    expect(next.networks).toEqual(["arbitrum", "robinhood"]);
  });

  it("ignores a flag-gated network while its flag is off", () => {
    // @rule R17
    const off = buildMandateCatalog({ robinhoodChain: false });
    expect(withNetworks(empty(), ["robinhood"], off).networks).toEqual(["arbitrum"]);
  });

  it("adds and removes the locked deposit row per selected network", () => {
    // @rule R24
    const two = withNetworks(empty(), ["robinhood"], catalog);
    expect(two.tokens.filter((t) => t.locked).map((t) => t.network)).toEqual([
      "arbitrum",
      "robinhood",
    ]);
    const back = withNetworks(two, [], catalog);
    expect(back.tokens.filter((t) => t.locked).map((t) => t.network)).toEqual(["arbitrum"]);
  });

  it("drops the tokens, pools and caps of a network it removed", () => {
    // @rule R43
    let draft = withNetworks(withDex(), ["robinhood"], catalog);
    draft = draftOf(addToken(draft, catalogToken("robinhood", "ETH"), catalog));
    draft = setCap(draft, "networks", "robinhood", { noCap: false, pct: 40 });
    const rhKey = tokenKey({
      network: "robinhood",
      address: catalogToken("robinhood", "ETH").address,
    });
    draft = setCap(draft, "tokens", rhKey, { noCap: false, pct: 20 });
    expect(draft.tokens.some((t) => t.network === "robinhood" && !t.locked)).toBe(true);

    const pruned = withNetworks(draft, [], catalog);
    expect(pruned.tokens.every((t) => t.network === "arbitrum")).toBe(true);
    expect(pruned.pools.every((p) => p.network === "arbitrum")).toBe(true);
    expect(pruned.caps.networks.robinhood).toBeUndefined();
    expect(pruned.caps.tokens[rhKey]).toBeUndefined();
    expect(pruned.caps.networks.arbitrum).toEqual({ noCap: true, pct: 0 });
  });

  it("leaves the input draft untouched", () => {
    // @rule R9
    const draft = empty();
    const snapshot = JSON.stringify(draft);
    const next = withNetworks(draft, ["robinhood"], catalog);
    expect(JSON.stringify(draft)).toBe(snapshot);
    expect(next).not.toBe(draft);
  });
});

// ---------------------------------------------------------------------------
// withProtocols (R19, R21, R29, R43)
// ---------------------------------------------------------------------------

describe("withProtocols", () => {
  it("never removes the two required protocols", () => {
    // @rule R19
    expect(draftOf(withProtocols(empty(), [])).protocols).toEqual(["uniswap-v3-swap", "across"]);
    expect(draftOf(withProtocols(empty(), ["aave-v3"])).protocols).toEqual([
      "uniswap-v3-swap",
      "across",
      "aave-v3",
    ]);
  });

  it("ignores an unavailable protocol", () => {
    // @rule R21
    const next = draftOf(withProtocols(empty(), [...REQUIRED_PROTOCOLS, "gmx", "aave-v3"]));
    expect(next.protocols).not.toContain("gmx");
    expect(next.protocols).toContain("aave-v3");
  });

  it("orders the protocols by the catalog, not by the argument", () => {
    // @rule R20
    const next = draftOf(withProtocols(empty(), ["uniswap-v4", "aave-v3", ...REQUIRED_PROTOCOLS]));
    expect(next.protocols).toEqual(["uniswap-v3-swap", "across", "aave-v3", "uniswap-v4"]);
  });

  it("clears the pools and unmarks the step when the last DEX protocol leaves", () => {
    // @rule R29
    let draft = withDex();
    draft = draftOf(addPool(draft, pool(), catalog));
    draft = { ...draft, passedSteps: ["networks", "protocols", "tokens", "pools"] };
    expect(draft.pools).toHaveLength(1);

    const next = draftOf(withProtocols(draft, [...REQUIRED_PROTOCOLS]));
    expect(hasDexProtocol(next)).toBe(false);
    expect(next.pools).toEqual([]);
    expect(next.passedSteps).toEqual(["networks", "protocols", "tokens"]);
    // Tokens are not touched by dropping a protocol.
    expect(next.tokens.some((t) => t.symbol === "ETH")).toBe(true);
  });

  it("drops the pools of the position protocol it removed and keeps the rest", () => {
    // @rule R29 @rule R13 - a mandate is a closed list, so a reducer that drops something drops
    // everything downstream of it. Keeping the v3 pools after Uniswap v3 left described a fund that
    // cannot exist, and it inflated the pool count the Broad mandate flag divides by.
    let draft = draftOf(
      withProtocols(empty(), [...REQUIRED_PROTOCOLS, "uniswap-v3", "uniswap-v4"]),
    );
    draft = draftOf(addPool(draft, pool(), catalog));
    draft = draftOf(
      addPool(draft, pool({ id: "arb-eth-usdc-v4", protocol: "uniswap-v4" }), catalog),
    );
    expect(draft.pools).toHaveLength(2);

    const next = draftOf(withProtocols(draft, [...REQUIRED_PROTOCOLS, "uniswap-v4"]));

    expect(next.pools.map((p) => p.id)).toEqual(["arb-eth-usdc-v4"]);
    // The step still exists, so passing it is still true.
    expect(hasDexProtocol(next)).toBe(true);
  });

  it("prunes the cap row of a protocol it dropped", () => {
    // @rule R43
    let draft = draftOf(withProtocols(empty(), [...REQUIRED_PROTOCOLS, "aave-v3"]));
    draft = setCap(draft, "protocols", "aave-v3", { noCap: false, pct: 60 });
    const next = draftOf(withProtocols(draft, [...REQUIRED_PROTOCOLS]));
    expect(next.caps.protocols["aave-v3"]).toBeUndefined();
  });

  it("leaves the input draft untouched", () => {
    // @rule R9
    const draft = empty();
    const snapshot = JSON.stringify(draft);
    withProtocols(draft, [...REQUIRED_PROTOCOLS, "aave-v3"]);
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Tokens (R24, R27, R28)
// ---------------------------------------------------------------------------

describe("addToken", () => {
  it("adds one entry per selected network where the token exists", () => {
    // @rule R27
    const two = withNetworks(empty(), ["robinhood"], catalog);
    const next = draftOf(addToken(two, catalogToken("arbitrum", "ETH"), catalog));
    const eth = next.tokens.filter((t) => t.symbol === "ETH");
    expect(eth.map((t) => t.network).sort()).toEqual(["arbitrum", "robinhood"]);
    expect(slotsUsed(next)).toBe(4);
    expect(eth.every((t) => t.locked === false)).toBe(true);
  });

  it("adds a single entry when the token exists on one selected network only", () => {
    // @rule R27
    const next = draftOf(addToken(empty(), catalogToken("arbitrum", "ARB"), catalog));
    expect(next.tokens.filter((t) => t.symbol === "ARB")).toHaveLength(1);
  });

  it("is a no-op when the token is already in the draft", () => {
    // @rule R27
    const once = draftOf(addToken(empty(), catalogToken("arbitrum", "ARB"), catalog));
    const twice = addToken(once, catalogToken("arbitrum", "ARB"), catalog);
    expect(isBlocked(twice)).toBe(false);
    expect(draftOf(twice).tokens).toHaveLength(2);
  });

  it("blocks and changes nothing when the add would pass the slot ceiling", () => {
    // @rule R27
    const token = catalogToken("arbitrum", "ARB");
    let draft = empty();
    // Fill every remaining slot with synthetic entries, leaving no room for one more.
    const filler = Array.from({ length: MAX_TOKEN_SLOTS - 1 }, (_, i) => ({
      address: `0x${String(i).padStart(40, "0")}`,
      symbol: `FILL${i}`,
      name: `Filler ${i}`,
      network: "arbitrum" as const,
      logoUrl: null,
      locked: false,
    }));
    draft = { ...draft, tokens: [...draft.tokens, ...filler] };
    expect(slotsUsed(draft)).toBe(MAX_TOKEN_SLOTS);

    const result = addToken(draft, token, catalog);
    expect(isBlocked(result)).toBe(true);
    if (isBlocked(result)) {
      expect(result.blocked).toEqual({
        step: "tokens",
        reason: "no_slots",
        rowId: tokenKey(token),
      });
    }
  });

  it("blocks a token with no hub price feed", () => {
    // @rule R28
    const unpriced = catalog
      .tokensFor(["arbitrum"], [...REQUIRED_PROTOCOLS])
      .find((t) => !t.priced);
    if (!unpriced) throw new Error("fixture: expected an unpriced arbitrum token");
    const result = addToken(empty(), unpriced, catalog);
    expect(isBlocked(result)).toBe(true);
    if (isBlocked(result)) {
      expect(result.blocked.reason).toBe("not_priced");
      expect(result.blocked.step).toBe("tokens");
      expect(result.blocked.rowId).toBe(tokenKey(unpriced));
    }
  });

  it("leaves the input draft untouched", () => {
    // @rule R9
    const draft = empty();
    const snapshot = JSON.stringify(draft);
    addToken(draft, catalogToken("arbitrum", "ARB"), catalog);
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});

describe("removeToken and clearTokens", () => {
  it("never removes a locked deposit row", () => {
    // @rule R24
    const draft = empty();
    const locked = first(draft.tokens, "locked deposit row");
    expect(removeToken(draft, tokenKey(locked)).tokens).toHaveLength(1);
    expect(clearTokens(draft).tokens).toEqual(draft.tokens);
  });

  it("removes one network entry and the pools on that network that hold it", () => {
    // @rule R33
    let draft = withDex();
    draft = draftOf(addPool(draft, pool(), catalog));
    const eth = draft.tokens.find((t) => t.symbol === "ETH");
    if (!eth) throw new Error("fixture: ETH should have been added by the pool");
    draft = setCap(draft, "tokens", tokenKey(eth), { noCap: false, pct: 25 });

    const next = removeToken(draft, tokenKey(eth));
    expect(next.tokens.some((t) => t.symbol === "ETH")).toBe(false);
    expect(next.pools).toEqual([]);
    expect(next.caps.tokens[tokenKey(eth)]).toBeUndefined();
  });

  it("removes every network entry of a symbol through removeTokenSymbol", () => {
    // @rule R27
    const two = withNetworks(empty(), ["robinhood"], catalog);
    const added = draftOf(addToken(two, catalogToken("arbitrum", "ETH"), catalog));
    const next = removeTokenSymbol(added, "ETH");
    expect(next.tokens.some((t) => t.symbol === "ETH")).toBe(false);
    expect(next.tokens.filter((t) => t.locked)).toHaveLength(2);
  });

  it("clears every unlocked token and the pools that held them", () => {
    // @rule R24
    let draft = withDex();
    draft = draftOf(addPool(draft, pool(), catalog));
    draft = draftOf(addToken(draft, catalogToken("arbitrum", "ARB"), catalog));
    const next = clearTokens(draft);
    expect(next.tokens.every((t) => t.locked)).toBe(true);
    expect(next.pools).toEqual([]);
    expect(next.caps.tokens).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Pools (R33, R34, R38)
// ---------------------------------------------------------------------------

describe("addPool", () => {
  it("refuses a pool with a hook", () => {
    // @rule R34
    const result = addPool(withDex(), pool({ hasHook: true, protocol: "uniswap-v4" }), catalog);
    expect(isBlocked(result)).toBe(true);
    if (isBlocked(result)) {
      expect(result.blocked).toEqual({
        step: "pools",
        reason: "has_hook",
        rowId: "arb-eth-usdc-5",
      });
    }
  });

  it("adds the missing pool token before the pool itself", () => {
    // @rule R33
    const before = withDex();
    expect(before.tokens.some((t) => t.symbol === "ETH")).toBe(false);
    const next = draftOf(addPool(before, pool(), catalog));
    expect(next.tokens.some((t) => t.symbol === "ETH" && t.network === "arbitrum")).toBe(true);
    expect(next.pools.map((p) => p.id)).toEqual(["arb-eth-usdc-5"]);
  });

  it("propagates the slot block instead of adding the pool", () => {
    // @rule R33
    let draft = withDex();
    const filler = Array.from({ length: MAX_TOKEN_SLOTS - 1 }, (_, i) => ({
      address: `0x${String(i).padStart(40, "0")}`,
      symbol: `FILL${i}`,
      name: `Filler ${i}`,
      network: "arbitrum" as const,
      logoUrl: null,
      locked: false,
    }));
    draft = { ...draft, tokens: [...draft.tokens, ...filler] };
    const result = addPool(draft, pool(), catalog);
    expect(isBlocked(result)).toBe(true);
    if (isBlocked(result)) expect(result.blocked.reason).toBe("no_slots");
  });

  it("is a no-op for a pool already in the draft", () => {
    // @rule R33
    const once = draftOf(addPool(withDex(), pool(), catalog));
    const twice = draftOf(addPool(once, pool(), catalog));
    expect(twice.pools).toHaveLength(1);
  });

  it("refuses a pool on a network the mandate does not name", () => {
    // @rule R34
    const result = addPool(withDex(), pool({ network: "base" }), catalog);
    expect(isBlocked(result)).toBe(true);
    if (isBlocked(result)) {
      expect(result.blocked).toEqual({
        step: "pools",
        reason: "coming_soon",
        rowId: "arb-eth-usdc-5",
      });
    }
  });

  it("refuses a pool of a protocol the mandate does not name", () => {
    // @rule R34 @rule R13 - a pasted address can find a pool on a protocol nobody chose, and a
    // mandate that holds a position on a protocol it does not name is as invalid as one on a
    // network it does not name. Same refusal, for the same reason.
    const result = addPool(
      withDex(),
      pool({ id: "arb-eth-usdc-v4", protocol: "uniswap-v4" }),
      catalog,
    );
    expect(isBlocked(result)).toBe(true);
    if (isBlocked(result)) {
      expect(result.blocked).toEqual({
        step: "pools",
        reason: "coming_soon",
        rowId: "arb-eth-usdc-v4",
      });
    }
  });

  it("blocks a pool whose other token has no price feed", () => {
    // @rule R28
    const result = addPool(
      withDex(),
      pool({
        id: "arb-weird-usdc-30",
        token0: {
          address: "0x1111111111111111111111111111111111111111",
          symbol: "WEIRD",
          name: "Weird token",
          logoUrl: null,
        },
      }),
      catalog,
    );
    expect(isBlocked(result)).toBe(true);
    if (isBlocked(result)) {
      expect(result.blocked.reason).toBe("not_priced");
      expect(result.blocked.rowId).toBe("arb-weird-usdc-30");
    }
  });
});

describe("removePool and clearPools", () => {
  it("removes a pool and never touches the tokens", () => {
    // @rule R33
    const draft = draftOf(addPool(withDex(), pool(), catalog));
    const next = removePool(draft, "arb-eth-usdc-5");
    expect(next.pools).toEqual([]);
    expect(next.tokens).toEqual(draft.tokens);
  });

  it("clears every pool and never touches the tokens", () => {
    // @rule R33
    const draft = draftOf(addPool(withDex(), pool(), catalog));
    const next = clearPools(draft);
    expect(next.pools).toEqual([]);
    expect(next.tokens).toEqual(draft.tokens);
  });
});

// ---------------------------------------------------------------------------
// Caps (R39, R40, R43)
// ---------------------------------------------------------------------------

describe("setCap", () => {
  it("rounds the percentage to the nearest 5 and clamps it to 0..100", () => {
    // @rule R39
    const draft = empty();
    expect(
      setCap(draft, "networks", "robinhood", { noCap: false, pct: 42 }).caps.networks.robinhood,
    ).toEqual({ noCap: false, pct: 40 });
    expect(
      setCap(draft, "networks", "robinhood", { noCap: false, pct: 43 }).caps.networks.robinhood,
    ).toEqual({ noCap: false, pct: 45 });
    expect(
      setCap(draft, "networks", "robinhood", { noCap: false, pct: 420 }).caps.networks.robinhood,
    ).toEqual({ noCap: false, pct: 100 });
    expect(
      setCap(draft, "networks", "robinhood", { noCap: false, pct: -8 }).caps.networks.robinhood,
    ).toEqual({ noCap: false, pct: 0 });
  });

  it("stores a no-cap row and leaves the other scopes alone", () => {
    // @rule R39
    const next = setCap(empty(), "tokens", "arbitrum:0xabc", { noCap: true, pct: 35 });
    expect(next.caps.tokens["arbitrum:0xabc"]).toEqual({ noCap: true, pct: 35 });
    expect(next.caps.protocols).toEqual({});
  });

  it("leaves the input draft untouched", () => {
    // @rule R9
    const draft = empty();
    const snapshot = JSON.stringify(draft);
    setCap(draft, "protocols", "aave-v3", { noCap: false, pct: 50 });
    expect(JSON.stringify(draft)).toBe(snapshot);
  });
});

/**
 * Unset is a THIRD state, and the only reducer that can reach it.
 *
 * `setCap` can write "capped at 0%" and it can write "no cap", but nothing could take a row back to
 * having no record at all, which is what the Limits step needs when a manager ticks "No cap" on a row
 * they never gave a share to and then changes their mind. Without this, that round trip leaves
 * `{ noCap: false, pct: 0 }` behind: a 0% ceiling `validateStep` happily accepts, so Next passes on a
 * cap nobody chose.
 */
describe("clearCap", () => {
  it("removes the row's record, so the row is unset again", () => {
    // @rule R39
    const capped = setCap(empty(), "networks", "robinhood", { noCap: true, pct: 0 });
    const cleared = clearCap(capped, "networks", "robinhood");

    expect(cleared.caps.networks.robinhood).toBeUndefined();
    expect("robinhood" in cleared.caps.networks).toBe(false);
  });

  it("prunes nothing else: the other rows, scopes and selections stay", () => {
    // @rule R39
    let draft = setCap(empty(), "networks", "robinhood", { noCap: false, pct: 40 });
    draft = setCap(draft, "networks", "base", { noCap: false, pct: 20 });
    draft = setCap(draft, "protocols", "aave-v3", { noCap: false, pct: 60 });
    draft = setCap(draft, "tokens", "arbitrum:0xabc", { noCap: true, pct: 0 });

    const cleared = clearCap(draft, "networks", "robinhood");

    expect(cleared.caps.networks.base).toEqual({ noCap: false, pct: 20 });
    expect(cleared.caps.networks.arbitrum).toEqual(draft.caps.networks.arbitrum);
    expect(cleared.caps.protocols["aave-v3"]).toEqual({ noCap: false, pct: 60 });
    expect(cleared.caps.tokens["arbitrum:0xabc"]).toEqual({ noCap: true, pct: 0 });
    expect(cleared.networks).toEqual(draft.networks);
    expect(cleared.tokens).toEqual(draft.tokens);
  });

  it("is a no-op on a row that has no record, and never mutates its input", () => {
    // @rule R9
    const draft = setCap(empty(), "networks", "robinhood", { noCap: false, pct: 40 });
    const snapshot = JSON.stringify(draft);

    expect(clearCap(draft, "networks", "base")).toBe(draft);
    clearCap(draft, "networks", "robinhood");
    expect(JSON.stringify(draft)).toBe(snapshot);
  });

  it("takes the row back to the state validateStep refuses", () => {
    // @rule R6
    let draft = withNetworks(empty(), ["robinhood"], catalog);
    draft = setCap(draft, "networks", "robinhood", { noCap: true, pct: 0 });
    expect(validateStep(draft, "limits", catalog)).toBeNull();

    draft = clearCap(draft, "networks", "robinhood");

    expect(validateStep(draft, "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_missing",
      rowId: "robinhood",
    });
  });
});

/**
 * The fingerprint is what "the manager changed something" means.
 *
 * Two callers need the same answer and must not each invent one: the leave-page prompt (a draft
 * nobody edited must not arm it) and the completion stamp (a selection changed after the mandate
 * closed invalidates it). Bookkeeping is deliberately out of scope: where the manager is standing is
 * not an edit.
 */
describe("selectionFingerprint", () => {
  it("ignores where the manager is standing and when the draft was touched", () => {
    // @rule R9
    const draft = empty();
    const moved: MandateDraft = {
      ...draft,
      lastStep: "limits",
      passedSteps: ["networks", "protocols", "tokens"],
      poolUniverseCount: 14,
      updatedAt: "2026-12-25T00:00:00.000Z",
      savedAt: "2026-12-25T00:00:00.000Z",
    };

    expect(selectionFingerprint(moved)).toBe(selectionFingerprint(draft));
  });

  it("changes when any of the five selections does", () => {
    // @rule R9
    const draft = empty();
    const base = selectionFingerprint(draft);

    expect(selectionFingerprint(withNetworks(draft, ["robinhood"], catalog))).not.toBe(base);
    expect(selectionFingerprint(withProtocols(draft, [...REQUIRED_PROTOCOLS, "aave-v3"]))).not.toBe(
      base,
    );
    expect(
      selectionFingerprint(draftOf(addToken(draft, catalogToken("arbitrum", "ETH"), catalog))),
    ).not.toBe(base);
    expect(
      selectionFingerprint(setCap(draft, "networks", "robinhood", { noCap: true, pct: 0 })),
    ).not.toBe(base);

    const dex = withDex();
    expect(selectionFingerprint(draftOf(addPool(dex, pool(), catalog)))).not.toBe(
      selectionFingerprint(dex),
    );
  });
});

describe("capRows", () => {
  it("lists spokes only, chosen protocols only and unlocked tokens only", () => {
    // @rule R40 @rule R43
    let draft = withNetworks(withDex(), ["robinhood"], catalog);
    draft = draftOf(withProtocols(draft, [...REQUIRED_PROTOCOLS, "aave-v3", "uniswap-v3"]));
    draft = draftOf(addToken(draft, catalogToken("arbitrum", "ARB"), catalog));

    const rows = capRows(draft, catalog);
    expect(rows.networks).toEqual(["robinhood"]);
    expect(rows.protocols).toEqual(["aave-v3", "uniswap-v3"]);
    expect(rows.tokens.map((t) => t.symbol)).toEqual(["ARB"]);
    expect(rows.tokens.every((t) => !t.locked)).toBe(true);
  });

  it("never gives the hub a cap row", () => {
    // @rule R40
    expect(capRows(empty(), catalog).networks).toEqual([]);
  });

  it("drops a row the catalog no longer knows", () => {
    // @rule R43
    const stale = { ...empty(), networks: ["arbitrum", "atlantis"] } as unknown as MandateDraft;
    expect(capRows(stale, catalog).networks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step visibility, order and reachability (R9, R29)
// ---------------------------------------------------------------------------

describe("visibleSteps and stepIndex", () => {
  it("drops the Pools step when no DEX protocol is chosen", () => {
    // @rule R29
    expect(hasDexProtocol(empty())).toBe(false);
    expect(visibleSteps(empty())).toEqual(["networks", "protocols", "tokens", "limits"]);
    expect(visibleSteps(withDex())).toEqual(["networks", "protocols", "tokens", "pools", "limits"]);
  });

  it("counts over the visible steps, so Limits is step 4 of 4 without pools", () => {
    // @rule R29
    expect(stepIndex(empty(), "limits")).toEqual({ index: 4, count: 4 });
    expect(stepIndex(withDex(), "limits")).toEqual({ index: 5, count: 5 });
    expect(stepIndex(empty(), "networks")).toEqual({ index: 1, count: 4 });
    expect(stepIndex(empty(), "pools")).toEqual({ index: 0, count: 4 });
  });

  it("skips the hidden Pools step when walking forward and back", () => {
    // @rule R29
    expect(nextStep(empty(), "tokens")).toBe("limits");
    expect(previousStep(empty(), "limits")).toBe("tokens");
    expect(nextStep(withDex(), "tokens")).toBe("pools");
    expect(previousStep(withDex(), "limits")).toBe("pools");
    expect(nextStep(empty(), "limits")).toBeNull();
    expect(previousStep(empty(), "networks")).toBeNull();
  });
});

describe("firstUnpassedStep and isStepReachable", () => {
  it("points at the first visible step nobody has passed", () => {
    // @rule R9
    expect(firstUnpassedStep(empty())).toBe("networks");
    expect(firstUnpassedStep({ ...empty(), passedSteps: ["networks"] })).toBe("protocols");
    expect(firstUnpassedStep({ ...empty(), passedSteps: ["networks", "protocols"] })).toBe(
      "tokens",
    );
  });

  it("falls back to Limits once every visible step is passed", () => {
    // @rule R9
    const noDex = { ...empty(), passedSteps: ["networks", "protocols", "tokens", "limits"] };
    expect(firstUnpassedStep(noDex as MandateDraft)).toBe("limits");
  });

  it("skips the hidden Pools step", () => {
    // @rule R29
    const noDex = { ...empty(), passedSteps: ["networks", "protocols", "tokens"] };
    expect(firstUnpassedStep(noDex as MandateDraft)).toBe("limits");
  });

  it("reaches the passed steps and the first unpassed one, nothing further", () => {
    // @rule R9
    const draft = { ...empty(), passedSteps: ["networks"] } as MandateDraft;
    expect(isStepReachable(draft, "networks")).toBe(true);
    expect(isStepReachable(draft, "protocols")).toBe(true);
    expect(isStepReachable(draft, "tokens")).toBe(false);
    expect(isStepReachable(draft, "limits")).toBe(false);
  });

  it("never reaches a hidden step", () => {
    // @rule R29
    const draft = {
      ...empty(),
      passedSteps: ["networks", "protocols", "tokens"],
    } as MandateDraft;
    expect(isStepReachable(draft, "pools")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateStep (R6)
// ---------------------------------------------------------------------------

describe("validateStep", () => {
  it("never blocks Networks, Protocols or Tokens", () => {
    // @rule R6
    const draft = empty();
    expect(validateStep(draft, "networks", catalog)).toBeNull();
    expect(validateStep(draft, "protocols", catalog)).toBeNull();
    expect(validateStep(draft, "tokens", catalog)).toBeNull();
  });

  it("blocks Pools with nothing selected while the step is visible", () => {
    // @rule R6
    expect(validateStep(withDex(), "pools", catalog)).toEqual({
      step: "pools",
      reason: "nothing_selected",
      rowId: null,
    });
  });

  it("does not block a hidden Pools step", () => {
    // @rule R6 @rule R29
    expect(validateStep(empty(), "pools", catalog)).toBeNull();
  });

  it("passes Pools once one pool is in the draft", () => {
    // @rule R6
    const draft = draftOf(addPool(withDex(), pool(), catalog));
    expect(validateStep(draft, "pools", catalog)).toBeNull();
  });

  it("blocks Limits on the first row with no cap, networks before protocols before tokens", () => {
    // @rule R6 @rule R43
    let draft = withNetworks(empty(), ["robinhood"], catalog);
    draft = draftOf(withProtocols(draft, [...REQUIRED_PROTOCOLS, "aave-v3"]));
    draft = draftOf(addToken(draft, catalogToken("arbitrum", "ARB"), catalog));

    expect(validateStep(draft, "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_missing",
      rowId: "robinhood",
    });

    draft = setCap(draft, "networks", "robinhood", { noCap: true, pct: 0 });
    expect(validateStep(draft, "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_missing",
      rowId: "aave-v3",
    });

    draft = setCap(draft, "protocols", "aave-v3", { noCap: false, pct: 60 });
    const arbRow = first(capRows(draft, catalog).tokens, "ARB cap row");
    expect(validateStep(draft, "limits", catalog)).toEqual({
      step: "limits",
      reason: "cap_missing",
      rowId: tokenKey(arbRow),
    });

    draft = setCap(draft, "tokens", tokenKey(arbRow), { noCap: false, pct: 30 });
    expect(validateStep(draft, "limits", catalog)).toBeNull();
  });

  it("passes Limits when the draft has no cap rows at all", () => {
    // @rule R6 @rule R40
    expect(validateStep(empty(), "limits", catalog)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isBroadMandate (R13)
// ---------------------------------------------------------------------------

describe("isBroadMandate", () => {
  /** Every priced catalog token added, which is the token half of the flag. */
  function allPricedTokens(base: MandateDraft): MandateDraft {
    let draft = base;
    for (const token of catalog.tokensFor(draft.networks, draft.protocols)) {
      if (!token.priced) continue;
      const result = addToken(draft, token, catalog);
      if (!isBlocked(result)) draft = result;
    }
    return draft;
  }

  it("is false while a priced catalog token is missing", () => {
    // @rule R13
    const draft = draftOf(addPool(withDex(), pool(), catalog));
    expect(isBroadMandate(draft, catalog, 1)).toBe(false);
  });

  it("is true only when every priced token and every pool is selected", () => {
    // @rule R13
    let draft = allPricedTokens(withDex());
    draft = draftOf(addPool(draft, pool(), catalog));
    expect(isBroadMandate(draft, catalog, 1)).toBe(true);
    expect(isBroadMandate(draft, catalog, 2)).toBe(false);
  });

  it("is false with no pool universe to compare against", () => {
    // @rule R13
    const draft = allPricedTokens(withDex());
    expect(isBroadMandate(draft, catalog, 0)).toBe(false);
  });

  it("selecting every network alone raises nothing", () => {
    // @rule R13
    const draft = withNetworks(withDex(), ["robinhood", "base", "polygon", "unichain"], catalog);
    expect(isBroadMandate(draft, catalog, 1)).toBe(false);
  });

  it("selecting every protocol alone raises nothing", () => {
    // @rule R13
    const draft = draftOf(
      withProtocols(empty(), [...REQUIRED_PROTOCOLS, "aave-v3", "uniswap-v3", "uniswap-v4"]),
    );
    expect(isBroadMandate(draft, catalog, 1)).toBe(false);
  });

  it("covers every selected network, not just the hub", () => {
    // @rule R13
    let draft = withNetworks(withDex(), ["robinhood"], catalog);
    draft = draftOf(addPool(draft, pool(), catalog));
    // Arbitrum's priced tokens only; the Robinhood side is still missing.
    for (const token of catalog.tokensFor(["arbitrum"], draft.protocols)) {
      if (!token.priced) continue;
      const result = addToken(draft, token, catalog);
      if (!isBlocked(result)) draft = result;
    }
    const missing = catalog
      .tokensFor(draft.networks, draft.protocols)
      .filter((t) => t.priced)
      .filter((t) => !draft.tokens.some((d) => tokenKey(d) === tokenKey(t)));
    if (missing.length > 0) expect(isBroadMandate(draft, catalog, 1)).toBe(false);
    else expect(isBroadMandate(draft, catalog, 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Counts and the draft name (R8)
// ---------------------------------------------------------------------------

describe("selectionCounts", () => {
  it("counts what the Save and exit dialog shows", () => {
    // @rule R8
    let draft = withNetworks(withDex(), ["robinhood"], catalog);
    draft = draftOf(addPool(draft, pool(), catalog));
    expect(selectionCounts(draft)).toEqual({
      networks: 2,
      protocols: 3,
      tokens: draft.tokens.length,
      pools: 1,
    });
  });
});

describe("draftNameError", () => {
  it("rejects an empty name", () => {
    // @rule R8
    expect(draftNameError("")).toBe("empty");
    expect(draftNameError("   ")).toBe("empty");
  });

  it("rejects a trimmed length outside 10 to 50", () => {
    // @rule R8
    expect(draftNameError("ETH only")).toBe("length");
    expect(draftNameError("a".repeat(9))).toBe("length");
    expect(draftNameError("a".repeat(51))).toBe("length");
  });

  it("accepts a trimmed length of 10 to 50", () => {
    // @rule R8
    expect(draftNameError("a".repeat(10))).toBeNull();
    expect(draftNameError("a".repeat(50))).toBeNull();
    expect(draftNameError("  ETH and BTC on Arbitrum  ")).toBeNull();
  });
});

/**
 * The denominator is a MEASUREMENT, and it expires.
 *
 * `poolUniverseCount` is the number of pools the Pools step found for the networks, protocols and
 * tokens the draft had at that moment. Change any of those three and the number describes a universe
 * that no longer exists, while a manager can still walk to the Build landing without passing through
 * Pools again (the sub-step header jumps to any passed step). So every reducer that actually moves
 * one of the three lists hands back `null`, and unknown keeps meaning "no flag".
 */
describe("poolUniverseCount, the Broad mandate denominator kept on the draft", () => {
  /** A draft that has been measured, as the Pools step leaves it. */
  function measured(draft: MandateDraft, count: number): MandateDraft {
    return { ...draft, poolUniverseCount: count };
  }

  it("starts unknown, so a draft that never searched pools cannot be broad", () => {
    // @rule R13
    const draft = createEmptyDraft("2026-10-01T00:00:00.000Z", "d-universe");
    expect(draft.poolUniverseCount).toBeNull();
    expect(isBroadMandate(draft, buildMandateCatalog({ robinhoodChain: false }), 0)).toBe(false);
  });

  it("is cleared by withNetworks, which changes what the universe was measured over", () => {
    // @rule R13
    const draft = measured(withDex(), 11);
    expect(withNetworks(draft, ["robinhood"], catalog).poolUniverseCount).toBeNull();
  });

  it("is cleared by withProtocols", () => {
    // @rule R13
    const draft = measured(withDex(), 11);
    expect(
      draftOf(withProtocols(draft, [...REQUIRED_PROTOCOLS, "uniswap-v3", "uniswap-v4"]))
        .poolUniverseCount,
    ).toBeNull();
  });

  it("is cleared by addToken", () => {
    // @rule R13
    const draft = measured(withDex(), 11);
    expect(
      draftOf(addToken(draft, catalogToken("arbitrum", "ARB"), catalog)).poolUniverseCount,
    ).toBeNull();
  });

  it("is cleared by removeToken", () => {
    // @rule R13
    let draft = draftOf(addToken(withDex(), catalogToken("arbitrum", "ARB"), catalog));
    const arb = first(
      draft.tokens.filter((t) => t.symbol === "ARB"),
      "ARB entry",
    );
    draft = measured(draft, 11);
    expect(removeToken(draft, tokenKey(arb)).poolUniverseCount).toBeNull();
  });

  it("is cleared by removeTokenSymbol", () => {
    // @rule R13
    let draft = draftOf(addToken(withDex(), catalogToken("arbitrum", "ARB"), catalog));
    draft = measured(draft, 11);
    expect(removeTokenSymbol(draft, "ARB").poolUniverseCount).toBeNull();
  });

  it("is cleared by clearTokens", () => {
    // @rule R13
    let draft = draftOf(addToken(withDex(), catalogToken("arbitrum", "ARB"), catalog));
    draft = measured(draft, 11);
    expect(clearTokens(draft).poolUniverseCount).toBeNull();
  });

  it("is cleared by an addPool that pulled a token into the mandate", () => {
    // @rule R13
    const draft = measured(withDex(), 11);
    expect(draft.tokens.some((t) => t.symbol === "ETH")).toBe(false);
    expect(draftOf(addPool(draft, pool(), catalog)).poolUniverseCount).toBeNull();
  });

  it("survives a pool added or removed with no token change, and every cap write", () => {
    // @rule R13 - the universe is measured over the networks, the protocols and the tokens. Picking
    // a pool out of a universe that is already known does not change the universe, and a cap is a
    // limit on a selection rather than a selection.
    let draft = draftOf(addToken(withDex(), catalogToken("arbitrum", "ETH"), catalog));
    draft = measured(draft, 11);

    const added = draftOf(addPool(draft, pool(), catalog));
    expect(added.poolUniverseCount).toBe(11);
    expect(removePool(added, "arb-eth-usdc-5").poolUniverseCount).toBe(11);
    expect(clearPools(added).poolUniverseCount).toBe(11);

    const capped = setCap(draft, "protocols", "uniswap-v3", { noCap: false, pct: 40 });
    expect(capped.poolUniverseCount).toBe(11);
    expect(clearCap(capped, "protocols", "uniswap-v3").poolUniverseCount).toBe(11);
  });

  it("survives a call that changes nothing", () => {
    // @rule R13 - re-selecting what is already selected is not a change, and a manager who opens a
    // step and leaves it alone must not lose the flag their mandate had earned.
    const draft = measured(withDex(), 11);

    expect(withNetworks(draft, [...draft.networks], catalog).poolUniverseCount).toBe(11);
    expect(draftOf(withProtocols(draft, [...draft.protocols])).poolUniverseCount).toBe(11);
    expect(removeToken(draft, "arbitrum:0xnothinghere").poolUniverseCount).toBe(11);
    expect(removeTokenSymbol(draft, "ARB").poolUniverseCount).toBe(11);
    // Only the locked deposit row is in this draft, and Clear all never touches those.
    expect(clearTokens(draft).poolUniverseCount).toBe(11);

    const withArb = measured(
      draftOf(addToken(withDex(), catalogToken("arbitrum", "ARB"), catalog)),
      11,
    );
    expect(
      draftOf(addToken(withArb, catalogToken("arbitrum", "ARB"), catalog)).poolUniverseCount,
    ).toBe(11);
  });

  it("is never resurrected by a reducer: unknown stays unknown", () => {
    // @rule R13
    const draft = withDex();
    expect(draft.poolUniverseCount).toBeNull();
    expect(withNetworks(draft, ["robinhood"], catalog).poolUniverseCount).toBeNull();
    expect(draftOf(addPool(draft, pool(), catalog)).poolUniverseCount).toBeNull();
  });
});
