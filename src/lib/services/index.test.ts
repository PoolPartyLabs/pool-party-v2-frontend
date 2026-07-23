import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// POO-659: the dev-login manager's stable identity (address). A plain string constant — importing it
// does not evaluate the env-gated service module, so the dynamic-import pattern below is unaffected.
import { DEV_MANAGER_ADDRESS } from "@/mocks/data/manager";
// `import type` is erased at runtime, so it does not evaluate the module ahead of the
// env-stubbed dynamic import used by every case below.
import type { CreateStrategyInput } from "./index";

/**
 * The factory reads `NEXT_PUBLIC_MOCK_MODE` at module-evaluation time, so each case stubs the
 * env, resets the module registry, and dynamically imports a fresh copy of the module.
 */
type ServicesModule = typeof import("./index");

async function loadServices(): Promise<ServicesModule> {
  vi.resetModules();
  return import("./index");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("service factory exports", () => {
  it("defines all five domain services plus auth", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const services = await loadServices();

    expect(services.tokenService).toBeDefined();
    expect(services.strategyService).toBeDefined();
    expect(services.positionService).toBeDefined();
    expect(services.savingsService).toBeDefined();
    expect(services.transactionService).toBeDefined();
    expect(services.authService).toBeDefined();
  });

  it("exposes the documented method surface on each service", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const services = await loadServices();

    expect(typeof services.tokenService.list).toBe("function");
    expect(typeof services.strategyService.list).toBe("function");
    expect(typeof services.strategyService.getById).toBe("function");
    expect(typeof services.positionService.list).toBe("function");
    expect(typeof services.savingsService.list).toBe("function");
    expect(typeof services.transactionService.list).toBe("function");
    expect(typeof services.authService.loginWithGoogle).toBe("function");
    expect(typeof services.authService.connectWallet).toBe("function");
    expect(typeof services.authService.logout).toBe("function");
  });
});

describe("mock-mode resolution", () => {
  it("treats an unset NEXT_PUBLIC_MOCK_MODE as mock mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const services = await loadServices();
    expect(services.isMockMode).toBe(true);
  });

  it('treats NEXT_PUBLIC_MOCK_MODE="true" as mock mode', async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", "true");
    const services = await loadServices();
    expect(services.isMockMode).toBe(true);
  });

  it('only opts out of mock mode for the explicit string "false"', async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", "false");
    const services = await loadServices();
    expect(services.isMockMode).toBe(false);
  });
});

describe("mock service behavior when mock mode is unset", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
  });

  it("returns the mock token catalog (incl. USDC) from tokenService", async () => {
    const { tokenService } = await loadServices();
    const result = await tokenService.list();
    expect(result.length).toBeGreaterThan(1);
    expect(result.map((token) => token.symbol)).toContain("USDC");
  });

  it("lists only allocatable strategies (closed ones never reach Explore)", async () => {
    const { strategyService } = await loadServices();
    const result = await strategyService.list();
    expect(result.length).toBeGreaterThan(1);
    // strat-stable-yield is the closed-strategy reference (POO-185): delisted, not allocatable.
    expect(result.map((strategy) => strategy.id)).not.toContain("strat-stable-yield");
    expect(result.every((strategy) => strategy.status !== "closed")).toBe(true);
  });

  it("resolves a known strategy id (any status) and null for an unknown one", async () => {
    const { strategyService } = await loadServices();
    // Closed strategies stay reachable by id — holders open the detail through their position.
    expect(await strategyService.getById("strat-stable-yield")).not.toBeNull();
    expect(await strategyService.getById("does-not-exist")).toBeNull();
  });

  // POO-830 R7: mock assetTags derive from the fixture's OWN pair (poolPair ?? detail.poolPair),
  // EXACTLY as the real mappers do — no parallel pair source, no invented pairs.
  it("derives assetTags from the fixture's own pair (mirrors the real path)", async () => {
    const { strategyService } = await loadServices();
    // strat-delta-neutral carries detail.poolPair ETH/USDC → one stable + one eth → [ethereum].
    const delta = await strategyService.getById("strat-delta-neutral");
    expect(delta?.assetTags).toEqual(["ethereum"]);
    expect(delta?.unverifiedTokens).toBeUndefined();
    // A pair-less fixture (multi-asset mandate — no poolPair, no detail.poolPair) carries NO tags.
    const treasury = await strategyService.getById("strat-treasury-plus");
    expect(treasury?.assetTags).toBeUndefined();
    // The fixtures' poolPair is read-only, never mutated (no invest/detail regression).
    expect(treasury?.poolPair).toBeUndefined();
    expect(delta?.poolPair).toBeUndefined();
    // The listed (non-closed) strategies with a pair carry tags; those without carry none — never
    // an empty array (undefined vs a real tag set, mirroring a real pair-less row).
    const list = await strategyService.list();
    for (const strategy of list) {
      if (strategy.assetTags !== undefined) expect(strategy.assetTags.length).toBeGreaterThan(0);
    }
  });

  it("returns the investor's positions and transaction history", async () => {
    const { positionService, transactionService } = await loadServices();
    expect((await positionService.list()).length).toBeGreaterThan(0);
    expect((await transactionService.list()).length).toBeGreaterThan(0);
  });

  it("returns per-period earnings for a known position and zeros for an unknown one", async () => {
    const { positionService } = await loadServices();
    const earnings = await positionService.getEarnings("pos-balanced-growth");
    expect(earnings).toEqual({ "24h": 3.21, "7d": 21.74, "30d": 86.52 });
    // The loss window stays reachable from the mocks (POO-275 R6).
    const loss = await positionService.getEarnings("pos-high-conviction");
    expect(loss["24h"]).toBeLessThan(0);
    expect(await positionService.getEarnings("nope")).toEqual({ "24h": 0, "7d": 0, "30d": 0 });
  });

  it("returns an empty savings list (Savings is out of v1)", async () => {
    const { savingsService } = await loadServices();
    expect(await savingsService.list()).toEqual([]);
  });
});

describe('mock service behavior when NEXT_PUBLIC_MOCK_MODE is "true"', () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", "true");
  });

  it("still returns the mock token catalog", async () => {
    const { tokenService } = await loadServices();
    const result = await tokenService.list();
    expect(result.map((token) => token.symbol)).toContain("USDC");
  });

  it("still returns positions and history with savings empty", async () => {
    const { positionService, savingsService, transactionService } = await loadServices();
    expect((await positionService.list()).length).toBeGreaterThan(0);
    expect(await savingsService.list()).toEqual([]);
    expect((await transactionService.list()).length).toBeGreaterThan(0);
  });
});

describe("mock account / auth method bodies", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
  });

  it("exposes the account and auth services", async () => {
    const services = await loadServices();
    expect(services.accountService).toBeDefined();
    expect(services.authService).toBeDefined();
  });

  it("resolves every account / auth mock call", async () => {
    const { accountService, authService } = await loadServices();

    expect(await accountService.getUsdcBalance()).toBeGreaterThanOrEqual(0);

    const google = await authService.loginWithGoogle();
    expect(google.method).toBe("google");

    const wallet = await authService.connectWallet("metamask");
    expect(wallet.method).toBe("wallet");

    await expect(authService.logout()).resolves.toBeUndefined();
  });
});

describe("mock rewards service", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
  });

  it("exposes the rewards service surface", async () => {
    const services = await loadServices();
    expect(services.rewardsService).toBeDefined();
    expect(typeof services.rewardsService.getRubberRush).toBe("function");
    expect(typeof services.rewardsService.getManagerIncentiveProgram).toBe("function");
    expect(typeof services.rewardsService.getReferral).toBe("function");
    expect(typeof services.rewardsService.sayQuack).toBe("function");
    expect(typeof services.rewardsService.playDuckShoot).toBe("function");
    expect(typeof services.rewardsService.claimRoles).toBe("function");
  });

  it("runs the Rubber Rush actions (say quack, duck shoot, claim roles)", async () => {
    const { rewardsService } = await loadServices();

    const quack = await rewardsService.sayQuack();
    expect(quack.quackedToday).toBe(true);
    expect(quack.quacksAwarded).toBeGreaterThan(0);

    const shot = await rewardsService.playDuckShoot();
    expect(shot.hitIndex).toBeGreaterThanOrEqual(0);
    expect(shot.multiplierPct).toBeGreaterThanOrEqual(0);
    expect(shot.quacksWon).toBeGreaterThanOrEqual(0);
    expect(shot.triesLeft).toBeGreaterThanOrEqual(0);

    const roles = await rewardsService.claimRoles();
    expect(roles.claimed).toBe(true);
    expect(roles.roles.length).toBeGreaterThan(0);
  });

  it("returns the Rubber Rush and ManagerIncentiveProgram dashboards", async () => {
    const { rewardsService } = await loadServices();

    const rush = await rewardsService.getRubberRush();
    expect(rush.quacks).toBeGreaterThan(0);

    const amb = await rewardsService.getManagerIncentiveProgram();
    expect(amb.tiers.length).toBeGreaterThan(0);
    expect(amb.currentTier).toBeGreaterThanOrEqual(1);
  });

  // POO-290: the referral code starts unset and is created exactly once (immutable).
  it("starts the referral program without a code (empty state)", async () => {
    const { rewardsService } = await loadServices();

    const ref = await rewardsService.getReferral();
    expect(ref.code).toBeNull();
    expect(ref.inviteLink).toBeNull();
    expect(ref.invites).toHaveLength(0);
  });

  it("creates the referral code once, as typed, with the canonical `?ref=` link", async () => {
    const { rewardsService } = await loadServices();

    const created = await rewardsService.createReferralCode("Maria2026");
    // Stored/displayed as typed; the canonical `?ref=` link keeps the casing too (POO-853 R3).
    expect(created.code).toBe("Maria2026");
    expect(created.inviteLink).toBe("app.pool-party.xyz?ref=Maria2026");

    // The session now serves the created code everywhere.
    const ref = await rewardsService.getReferral();
    expect(ref.code).toBe("Maria2026");

    // Immutable: a second creation is rejected by the service, not just the UI (POO-290 R2).
    await expect(rewardsService.createReferralCode("OTHER123")).rejects.toThrow();
  });

  it("rejects malformed referral codes (min 6 alphanumerics)", async () => {
    const { rewardsService } = await loadServices();

    await expect(rewardsService.createReferralCode("abc12")).rejects.toThrow();
    await expect(rewardsService.createReferralCode("has space!")).rejects.toThrow();
  });

  it("accepts a 10-char code but rejects longer ones (backend max — POO-853 R2)", async () => {
    const { rewardsService } = await loadServices();

    // A code longer than the backend's 10-char limit is rejected by the service, not just the UI.
    await expect(rewardsService.createReferralCode("a".repeat(11))).rejects.toThrow();

    // The 10-char boundary is accepted and stored as typed.
    const created = await rewardsService.createReferralCode("MaxTenChar");
    expect(created.code).toBe("MaxTenChar");
  });
});

describe("mock cards service", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
  });

  it("exposes the cards service surface", async () => {
    const services = await loadServices();
    expect(services.cardsService).toBeDefined();
    expect(typeof services.cardsService.getCatalog).toBe("function");
    expect(typeof services.cardsService.getMyCards).toBe("function");
    expect(typeof services.cardsService.getTransactions).toBe("function");
    expect(typeof services.cardsService.requestCard).toBe("function");
    expect(typeof services.cardsService.topUp).toBe("function");
  });

  it("returns the partner marketplace catalog and the investor's held cards", async () => {
    const { cardsService } = await loadServices();
    const catalog = await cardsService.getCatalog();
    expect(catalog.length).toBeGreaterThan(1);
    expect(catalog.map((offer) => offer.partnerId)).toContain("ether-fi");
    expect((await cardsService.getMyCards()).length).toBeGreaterThan(0);
  });

  it("returns a held card's transactions filtered by card id", async () => {
    const { cardsService } = await loadServices();
    const card = (await cardsService.getMyCards())[0];
    if (!card) throw new Error("expected at least one held card");
    const txns = await cardsService.getTransactions(card.id);
    expect(txns.length).toBeGreaterThan(0);
    expect(txns.every((transaction) => transaction.cardId === card.id)).toBe(true);
    expect(await cardsService.getTransactions("no-such-card")).toEqual([]);
  });

  it("requests a card as a referral handoff with an onboarding url", async () => {
    const { cardsService } = await loadServices();
    const result = await cardsService.requestCard("metamask");
    expect(result.status).toBe("requested");
    expect(result.partnerId).toBe("metamask");
    expect(result.onboardingUrl.length).toBeGreaterThan(0);
  });

  it("tops up a held card's rechargeable balance and rejects an unknown card", async () => {
    const { cardsService } = await loadServices();
    const card = (await cardsService.getMyCards())[0];
    if (!card) throw new Error("expected at least one held card");
    const result = await cardsService.topUp({ cardId: card.id, amountUsd: 100, source: "wallet" });
    expect(result.newBalanceUsd).toBeCloseTo(card.balanceUsd + 100);
    await expect(
      cardsService.topUp({ cardId: "no-such-card", amountUsd: 50, source: "wallet" }),
    ).rejects.toThrow();
  });

  it("returns the manager dashboard overview and the manager's strategies", async () => {
    const { managerService } = await loadServices();
    const dashboard = await managerService.getDashboard();
    expect(dashboard.aum).toBeGreaterThan(0);
    // POO-659: the dev-login manager is unfilled — no handle yet; its stable identity is the address.
    expect(dashboard.handle).toBe("");
    expect(dashboard.address).toBe(DEV_MANAGER_ADDRESS);
    expect(dashboard.chart.length).toBeGreaterThan(0);
    const strategies = await managerService.listStrategies();
    expect(strategies.length).toBeGreaterThan(0);
    expect(strategies.every((strategy) => strategy.aum >= 0)).toBe(true);
  });

  it("operates a live position: reads it by strategy, collects fees and compounds", async () => {
    const { managerService } = await loadServices();
    const position = await managerService.getPosition("yield-plus");
    expect(position).not.toBeNull();
    expect(position?.uncollectedFeesUsd).toBeGreaterThan(0);
    expect(await managerService.getPosition("no-such-strategy")).toBeNull();

    const collected = await managerService.collectFees("yield-plus");
    expect(collected.collectedUsd).toBeGreaterThan(0);
    expect(collected.gasCostUsd).toBeGreaterThanOrEqual(0);

    const compounded = await managerService.compound("yield-plus");
    expect(compounded.compoundedUsd).toBeGreaterThan(0);

    const moved = await managerService.moveRange("yield-plus", {
      rangeMin: 3000,
      rangeMax: 3500,
      slippagePct: 0.5,
    });
    expect(moved.rangeMin).toBe(3000);
    expect(moved.rangeMax).toBe(3500);
    expect(moved.full).toBe(false);
    // POO-518 R2: the applied range persists on the session detail, so a manage-view refetch reads
    // the new band back (in range: 3000 <= 3120.5 <= 3500) instead of the untouched fixture.
    const movedDetail = await managerService.getStrategyDetail("yield-plus");
    expect(movedDetail?.range).toMatchObject({ full: false, minPrice: 3000, maxPrice: 3500 });
    expect(movedDetail?.inRange).toBe(true);

    // POO-518 R1/R2: a full move echoes full + lands as the schema's full representation (no bounds).
    const movedFull = await managerService.moveRange("yield-plus", {
      rangeMin: 1e-20,
      rangeMax: 1e20,
      full: true,
      slippagePct: 0.5,
    });
    expect(movedFull.full).toBe(true);
    const fullDetail = await managerService.getStrategyDetail("yield-plus");
    expect(fullDetail?.range).toMatchObject({ full: true, minPrice: null, maxPrice: null });
    expect(fullDetail?.inRange).toBe(true);
  });

  it("lists the Uniswap v3 pool catalog", async () => {
    const { poolService } = await loadServices();
    const pools = await poolService.list();
    expect(pools.length).toBeGreaterThan(0);
    expect(pools.every((pool) => pool.currentPrice > 0 && pool.feeBps > 0)).toBe(true);
  });
});

describe("mock manager manage operations (POO-180/POO-181)", () => {
  it("lists the seeded strategies with every lifecycle status present", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    const list = await managerService.listStrategies();
    expect(list).toHaveLength(6);
    const statuses = new Set(list.map((strategy) => strategy.status));
    for (const status of ["active", "paused", "closed", "draft"]) {
      expect(statuses.has(status as never)).toBe(true);
    }
  });

  it("returns the manage detail by id and null for an unknown id", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    const detail = await managerService.getStrategyDetail("stable-yield");
    expect(detail?.pool.token0).toBe("USDC");
    // Mock mode always carries a full per-period series (POO-558: only the real path omits it).
    expect(detail?.performance?.["30d"].length).toBeGreaterThan(1);
    expect(await managerService.getStrategyDetail("nope")).toBeNull();
  });

  it("pauses and resumes deposits (active ↔ paused only)", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    expect((await managerService.setDepositsPaused("stable-yield", true)).status).toBe("paused");
    expect((await managerService.setDepositsPaused("stable-yield", false)).status).toBe("active");
    // Closed and draft strategies never flip from pause/resume.
    expect((await managerService.setDepositsPaused("btc-weekender", true)).status).toBe("closed");
    expect((await managerService.setDepositsPaused("stable-plus", true)).status).toBe("draft");
  });

  it("soft-closes a strategy and delists it from Explore", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    const closed = await managerService.closeStrategy("yield-plus");
    expect(closed.status).toBe("closed");
    expect(closed.showInExplore).toBe(false);
    // The list reflects the session mutation.
    const list = await managerService.listStrategies();
    expect(list.find((strategy) => strategy.id === "yield-plus")?.status).toBe("closed");
  });

  it("collects the claimable fees once and zeroes them", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    const first = await managerService.collectFees("stable-yield");
    expect(first.collectedUsd).toBeCloseTo(312.4);
    const detail = await managerService.getStrategyDetail("stable-yield");
    expect(detail?.claimableFeesUsd).toBe(0);
    expect((await managerService.collectFees("stable-yield")).collectedUsd).toBe(0);
  });

  it("flips the Explore listing and reseeds from the fixtures on reset", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const services = await loadServices();
    expect(
      (await services.managerService.setShowInExplore("stable-yield", false)).showInExplore,
    ).toBe(false);
    services.resetMockManagerState();
    expect((await services.managerService.getStrategyDetail("stable-yield"))?.showInExplore).toBe(
      true,
    );
  });
});

describe("managerService.createStrategy — description carry-through (POO-235 R4)", () => {
  /** A valid builder submission; override only the field under test. */
  function buildInput(overrides: Partial<CreateStrategyInput> = {}): CreateStrategyInput {
    return {
      name: "Blue Chip Yield",
      description: null,
      logoUrl: null,
      poolId: "pool-eth-usdc-30",
      riskLevel: 3,
      category: "Balanced",
      estApyPct: 12.4,
      range: { full: true, minPrice: null, maxPrice: null },
      fees: { entryPct: 0, exitPct: 0, managementPct: 1, performancePct: 20 },
      access: "public",
      asDraft: false,
      ...overrides,
    };
  }

  // @rule R4: a provided description is carried into the created row, trimmed on save.
  it("carries a trimmed description into the created strategy row", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    const { strategy } = await managerService.createStrategy(
      buildInput({ description: "  Stablecoin carry with a delta hedge.  " }),
    );
    expect(strategy.description).toBe("Stablecoin carry with a delta hedge.");
  });

  // @rule R4: optional — a whitespace-only description is dropped (no empty string on the row).
  it("drops a whitespace-only description (optional → undefined)", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    const { strategy } = await managerService.createStrategy(buildInput({ description: "   " }));
    expect(strategy.description).toBeUndefined();
  });

  // @rule R4: optional — a null description is dropped.
  it("drops a null description (optional → undefined)", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    const { strategy } = await managerService.createStrategy(buildInput({ description: null }));
    expect(strategy.description).toBeUndefined();
  });
});

describe("managerService.updateProfile", () => {
  it("merges edits into session state and reseeds on reset", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const services = await loadServices();
    // POO-659: the dev-login manager is keyed by its wallet address (unfilled handle/name).
    const updated = await services.managerService.updateProfile(DEV_MANAGER_ADDRESS, {
      name: "Mendes Capital",
      bio: "Updated bio.",
      bannerUrl: "data:image/png;base64,xyz",
      socials: { x: "https://x.com/new" },
    });
    expect(updated.name).toBe("Mendes Capital");
    expect(updated.socials).toEqual({ x: "https://x.com/new" });

    const read = await services.managerService.getProfile(DEV_MANAGER_ADDRESS);
    expect(read?.bio).toBe("Updated bio.");
    expect(read?.bannerUrl).toBe("data:image/png;base64,xyz");

    await expect(services.managerService.updateProfile("nobody", { name: "X" })).rejects.toThrow(
      /unknown manager/,
    );

    services.resetMockManagerState();
    // Reseeds to the unfilled state — empty name (the UI falls back to the masked address).
    expect((await services.managerService.getProfile(DEV_MANAGER_ADDRESS))?.name).toBe("");
  });
});

describe("managerService.getProfile by handle or address (POO-618 / POO-659)", () => {
  // @rule POO-618 R1 / POO-659: the lookup accepts a wallet address OR a handle. The dev-login manager
  // is now address-keyed (unfilled handle), so its address resolves; a named manager still resolves by
  // handle; an unknown address/handle and the empty string → null (no wildcard, never throws).
  it("[POO-618 R1 / POO-659] resolves by address and by handle; empty/unknown → null", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    // The dev-login manager resolves by its wallet address (case-insensitive), with an empty handle.
    const byAddress = await managerService.getProfile(DEV_MANAGER_ADDRESS);
    expect(byAddress?.address?.toLowerCase()).toBe(DEV_MANAGER_ADDRESS.toLowerCase());
    expect(byAddress?.handle).toBe("");
    // A different, unknown address → null.
    expect(
      await managerService.getProfile("0x77d2e9a1b3c5d7f9a0b1c2d3e4f5a6b7c8d9e0f1"),
    ).toBeNull();
    // A named manager still resolves by handle; an unknown handle and the empty string → null.
    expect((await managerService.getProfile("aave-labs"))?.handle).toBe("aave-labs");
    expect(await managerService.getProfile("no-such-handle")).toBeNull();
    expect(await managerService.getProfile("")).toBeNull();
  });
});

describe("managerService handle lifecycle (POO-575 / POO-659)", () => {
  // @rule POO-575 R5 / POO-659 R4: uniqueness scans the profile map; a handle held by ANOTHER manager
  // is unavailable; a brand-new slug is free; the empty handle is never "taken"; the caller's own
  // entry (by stable id) is excluded from the check.
  it("[POO-575 R5 / POO-659 R4] reports taken/free handles and excludes self", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const { managerService } = await loadServices();
    // "aave-labs" is another seeded manager → taken for the dev manager (keyed by its address).
    expect(await managerService.isHandleAvailable("aave-labs", DEV_MANAGER_ADDRESS)).toBe(false);
    // A brand-new slug is free.
    expect(await managerService.isHandleAvailable("fresh-fund", DEV_MANAGER_ADDRESS)).toBe(true);
    // The empty handle is never "taken" (R4).
    expect(await managerService.isHandleAvailable("", DEV_MANAGER_ADDRESS)).toBe(true);
    // A manager's own handle is available to itself (self excluded by stable id = handle).
    expect(await managerService.isHandleAvailable("aave-labs", "aave-labs")).toBe(true);
  });

  // @rule POO-575 R6/R7 / POO-659 R5: the dev-login manager starts unlocked; saving a handle while
  // unlocked persists it AND locks the profile. The map key is the (stable) address, so claiming the
  // handle never re-keys the entry — the profile resolves by BOTH the address and the new handle.
  it("[POO-575 R6/R7 / POO-659 R5] claims the handle and locks on first save (address-keyed)", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const services = await loadServices();
    // Seed is unlocked (R7).
    expect((await services.managerService.getProfile(DEV_MANAGER_ADDRESS))?.handleLocked).toBe(
      false,
    );

    const saved = await services.managerService.updateProfile(DEV_MANAGER_ADDRESS, {
      handle: "mendes-defi",
    });
    expect(saved.handle).toBe("mendes-defi");
    expect(saved.handleLocked).toBe(true);

    // Resolves by BOTH the stable address and the newly-claimed handle.
    expect((await services.managerService.getProfile(DEV_MANAGER_ADDRESS))?.handle).toBe(
      "mendes-defi",
    );
    expect((await services.managerService.getProfile("mendes-defi"))?.handle).toBe("mendes-defi");

    // Now locked: a subsequent updateProfile (by address) can never change the handle.
    const again = await services.managerService.updateProfile(DEV_MANAGER_ADDRESS, {
      handle: "someone-else",
    });
    expect(again.handle).toBe("mendes-defi");
    expect(again.handleLocked).toBe(true);

    services.resetMockManagerState();
  });

  // @rule POO-575 R5/R6: saving a handle already taken by another manager is rejected (the UI gates
  // this, but the mock enforces it too so the lifecycle is honest).
  it("[POO-575 R5] rejects saving a handle taken by another manager", async () => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_MODE", undefined);
    const services = await loadServices();
    await expect(
      services.managerService.updateProfile(DEV_MANAGER_ADDRESS, {
        handle: "aave-labs",
      }),
    ).rejects.toThrow(/taken/i);
    services.resetMockManagerState();
  });
});
