import { describe, expect, it } from "vitest";
import { mockProfileUser } from "@/mocks/data/profile";
import { managerIncentiveProgram, referral, rubberRush } from "@/mocks/data/rewards";
import {
  cardOfferSchema,
  cardTransactionSchema,
  managerDashboardSchema,
  managerIncentiveProgramSchema,
  ownedCardSchema,
  positionSchema,
  profileUserSchema,
  referralProgramSchema,
  rubberRushSchema,
  savingsMarketSchema,
  strategySchema,
  tokenSchema,
  transactionSchema,
} from "./index";

const validToken = {
  address: "0x1234567890abcdef1234567890ABCDEF12345678",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  logoUrl: "https://example.com/usdc.png",
  chainId: 1,
};

const validStrategy = {
  id: "strat-1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 3,
  minInvestment: 100,
  tvl: 1_000_000,
  investors: 42,
  estReturn: 8.5,
  rateType: "APY" as const,
  status: "active" as const,
};

const validPosition = {
  id: "pos-1",
  strategyId: "strat-1",
  invested: 1000,
  currentValue: 1080,
  totalYield: 80,
  available: 80,
  reinvestment: "auto-compound" as const,
  status: "active" as const,
};

const validSavingsMarket = {
  id: "mkt-1",
  asset: "USDC",
  venue: "Aave",
  netApy: 4.2,
  liquidity: 5_000_000,
  deposited: 250,
};

const validTransaction = {
  id: "tx-1",
  type: "deposit",
  tokenSymbol: "USDC",
  tokenAmount: 100,
  usdValueAtTime: 100,
  status: "completed" as const,
  timestamp: 1_717_000_000_000,
};

describe("tokenSchema", () => {
  it("parses a valid token", () => {
    expect(tokenSchema.parse(validToken)).toEqual(validToken);
  });

  it("rejects an address that is not 0x + 40 hex", () => {
    const result = tokenSchema.safeParse({ ...validToken, address: "0x123" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer decimals value", () => {
    const result = tokenSchema.safeParse({ ...validToken, decimals: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative decimals value", () => {
    const result = tokenSchema.safeParse({ ...validToken, decimals: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a logoUrl that is not a URL", () => {
    const result = tokenSchema.safeParse({ ...validToken, logoUrl: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer chainId", () => {
    const result = tokenSchema.safeParse({ ...validToken, chainId: 1.1 });
    expect(result.success).toBe(false);
  });
});

describe("strategySchema", () => {
  it("parses a valid strategy", () => {
    expect(strategySchema.parse(validStrategy)).toEqual(validStrategy);
  });

  it("rejects a riskLevel below 1", () => {
    const result = strategySchema.safeParse({ ...validStrategy, riskLevel: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects a riskLevel above 5", () => {
    const result = strategySchema.safeParse({ ...validStrategy, riskLevel: 6 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer riskLevel", () => {
    const result = strategySchema.safeParse({ ...validStrategy, riskLevel: 2.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative minInvestment", () => {
    const result = strategySchema.safeParse({ ...validStrategy, minInvestment: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative tvl", () => {
    const result = strategySchema.safeParse({ ...validStrategy, tvl: -1 });
    expect(result.success).toBe(false);
  });

  it("[POO-390] accepts an optional uniswapPoolTvlUsd and rejects a negative one", () => {
    // Investor-facing Uniswap pool TVL: optional (absent on legacy rows / when the API omits it).
    expect(strategySchema.safeParse(validStrategy).success).toBe(true);
    expect(
      strategySchema.safeParse({ ...validStrategy, uniswapPoolTvlUsd: 18_300_000 }).success,
    ).toBe(true);
    expect(strategySchema.safeParse({ ...validStrategy, uniswapPoolTvlUsd: -1 }).success).toBe(
      false,
    );
  });

  it("rejects a non-integer investors count", () => {
    const result = strategySchema.safeParse({ ...validStrategy, investors: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative investors count", () => {
    const result = strategySchema.safeParse({ ...validStrategy, investors: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid rateType", () => {
    const result = strategySchema.safeParse({ ...validStrategy, rateType: "MONTHLY" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid status", () => {
    const result = strategySchema.safeParse({ ...validStrategy, status: "archived" });
    expect(result.success).toBe(false);
  });
});

describe("positionSchema", () => {
  it("parses a valid position", () => {
    expect(positionSchema.parse(validPosition)).toEqual(validPosition);
  });

  it("rejects an invalid reinvestment mode", () => {
    const result = positionSchema.safeParse({ ...validPosition, reinvestment: "drip" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid status", () => {
    const result = positionSchema.safeParse({ ...validPosition, status: "pending" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric invested value", () => {
    const result = positionSchema.safeParse({ ...validPosition, invested: "1000" });
    expect(result.success).toBe(false);
  });

  // @rule R4
  it("parses a position with an openedAt epoch-ms", () => {
    const result = positionSchema.safeParse({ ...validPosition, openedAt: 1_777_000_000_000 });
    expect(result.success).toBe(true);
  });

  // @rule R4
  it("treats openedAt as optional (absent is valid)", () => {
    expect(positionSchema.safeParse(validPosition).success).toBe(true);
  });

  // @rule R4
  it("rejects a non-positive or non-integer openedAt", () => {
    expect(positionSchema.safeParse({ ...validPosition, openedAt: -1 }).success).toBe(false);
    expect(positionSchema.safeParse({ ...validPosition, openedAt: 1.5 }).success).toBe(false);
  });
});

describe("savingsMarketSchema", () => {
  it("parses a valid savings market", () => {
    expect(savingsMarketSchema.parse(validSavingsMarket)).toEqual(validSavingsMarket);
  });

  it("rejects a missing venue", () => {
    const { venue: _venue, ...withoutVenue } = validSavingsMarket;
    const result = savingsMarketSchema.safeParse(withoutVenue);
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric netApy", () => {
    const result = savingsMarketSchema.safeParse({ ...validSavingsMarket, netApy: "high" });
    expect(result.success).toBe(false);
  });
});

describe("transactionSchema", () => {
  it("parses a valid transaction", () => {
    expect(transactionSchema.parse(validTransaction)).toEqual(validTransaction);
  });

  // @rule R1
  it("accepts every canonical transaction type", () => {
    for (const type of ["deposit", "withdraw", "invest", "yield", "swap"]) {
      expect(transactionSchema.safeParse({ ...validTransaction, type }).success).toBe(true);
    }
  });

  // @rule R1
  it("rejects a transaction type outside the enum", () => {
    const result = transactionSchema.safeParse({ ...validTransaction, type: "collect" });
    expect(result.success).toBe(false);
  });

  // @rule R3
  it("accepts the forward-compatible 'failed' status", () => {
    const result = transactionSchema.safeParse({ ...validTransaction, status: "failed" });
    expect(result.success).toBe(true);
  });

  // @rule R3
  it("rejects a status outside completed/pending/failed", () => {
    const result = transactionSchema.safeParse({ ...validTransaction, status: "reverted" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    const result = transactionSchema.safeParse({ ...validTransaction, timestamp: "yesterday" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-numeric usdValueAtTime", () => {
    const result = transactionSchema.safeParse({ ...validTransaction, usdValueAtTime: null });
    expect(result.success).toBe(false);
  });
});

describe("rubberRushSchema", () => {
  it("validates the Rubber Rush fixture", () => {
    expect(rubberRushSchema.parse(rubberRush)).toEqual(rubberRush);
  });

  it("rejects a tierIndex above 4", () => {
    expect(rubberRushSchema.safeParse({ ...rubberRush, tierIndex: 5 }).success).toBe(false);
  });

  it("rejects a negative quacks balance", () => {
    expect(rubberRushSchema.safeParse({ ...rubberRush, quacks: -1 }).success).toBe(false);
  });
});

describe("managerIncentiveProgramSchema", () => {
  it("validates the ManagerIncentiveProgram fixture", () => {
    expect(managerIncentiveProgramSchema.parse(managerIncentiveProgram)).toEqual(
      managerIncentiveProgram,
    );
  });

  it("rejects a currentTier below 1", () => {
    expect(
      managerIncentiveProgramSchema.safeParse({ ...managerIncentiveProgram, currentTier: 0 })
        .success,
    ).toBe(false);
  });

  it("rejects a goal with an unknown key", () => {
    const bad = {
      ...managerIncentiveProgram,
      goals: [{ key: "mystery", trackedExternally: true }],
    };
    expect(managerIncentiveProgramSchema.safeParse(bad).success).toBe(false);
  });
});

describe("referralProgramSchema", () => {
  it("validates the Referral fixture", () => {
    expect(referralProgramSchema.parse(referral)).toEqual(referral);
  });

  it("rejects an invite with an unknown status", () => {
    const bad = { ...referral, invites: [{ name: "X", status: "won" }] };
    expect(referralProgramSchema.safeParse(bad).success).toBe(false);
  });
});

const validCardOffer = {
  partnerId: "ether-fi",
  name: "Ether.fi",
  subtitle: "Cash · crypto debit",
  network: "visa" as const,
  brandColor: "#5B7CFA",
  perks: ["Up to 3% cashback in ETH", "No annual fee", "Spend USDC, USDT or ETH"],
  badge: "active" as const,
  ctaState: "manage" as const,
  onboardingUrl: "https://ether.fi/cash",
};

const validOwnedCard = {
  id: "card-ether-fi",
  partnerId: "ether-fi",
  brand: "ether.fi",
  network: "visa" as const,
  maskedPan: "4242",
  balanceUsd: 248.5,
  type: "debit" as const,
  status: "active" as const,
  brandColor: "#5B7CFA",
};

const validCardTransaction = {
  id: "ctx-1",
  cardId: "card-ether-fi",
  merchant: "Spotify",
  category: "Music",
  tokenSymbol: "USDC",
  tokenAmount: -12.99,
  usdValueAtTime: 12.99,
  timestamp: 1_780_300_500_000,
};

describe("cardOfferSchema", () => {
  it("parses a valid card offer", () => {
    expect(cardOfferSchema.parse(validCardOffer)).toEqual(validCardOffer);
  });

  it("parses a plain offer without a badge", () => {
    const { badge: _badge, ...withoutBadge } = validCardOffer;
    expect(cardOfferSchema.safeParse(withoutBadge).success).toBe(true);
  });

  it("rejects an invalid network", () => {
    expect(cardOfferSchema.safeParse({ ...validCardOffer, network: "amex" }).success).toBe(false);
  });

  it("rejects an invalid ctaState", () => {
    expect(cardOfferSchema.safeParse({ ...validCardOffer, ctaState: "buy" }).success).toBe(false);
  });

  it("rejects a non-hex brandColor", () => {
    expect(cardOfferSchema.safeParse({ ...validCardOffer, brandColor: "blue" }).success).toBe(
      false,
    );
  });

  it("rejects an empty perks list", () => {
    expect(cardOfferSchema.safeParse({ ...validCardOffer, perks: [] }).success).toBe(false);
  });

  it("rejects a non-URL onboardingUrl", () => {
    const bad = { ...validCardOffer, onboardingUrl: "not-a-url" };
    expect(cardOfferSchema.safeParse(bad).success).toBe(false);
  });
});

describe("ownedCardSchema", () => {
  it("parses a valid held card", () => {
    expect(ownedCardSchema.parse(validOwnedCard)).toEqual(validOwnedCard);
  });

  it("rejects a maskedPan that is not four digits", () => {
    expect(ownedCardSchema.safeParse({ ...validOwnedCard, maskedPan: "42" }).success).toBe(false);
  });

  it("rejects a negative balance", () => {
    expect(ownedCardSchema.safeParse({ ...validOwnedCard, balanceUsd: -1 }).success).toBe(false);
  });

  it("rejects an invalid status", () => {
    expect(ownedCardSchema.safeParse({ ...validOwnedCard, status: "cancelled" }).success).toBe(
      false,
    );
  });
});

describe("cardTransactionSchema", () => {
  it("parses a valid card transaction", () => {
    expect(cardTransactionSchema.parse(validCardTransaction)).toEqual(validCardTransaction);
  });

  it("allows a positive amount (a credit such as cashback or top-up)", () => {
    const credit = { ...validCardTransaction, tokenAmount: 1.27 };
    expect(cardTransactionSchema.safeParse(credit).success).toBe(true);
  });

  it("rejects a negative usdValueAtTime (magnitude only)", () => {
    const bad = { ...validCardTransaction, usdValueAtTime: -1 };
    expect(cardTransactionSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    const bad = { ...validCardTransaction, timestamp: "today" };
    expect(cardTransactionSchema.safeParse(bad).success).toBe(false);
  });
});

const validManagerDashboard = {
  name: "Carlos",
  aum: 392_480,
  aumChangePct: 4.2,
  netInflows30d: 8200,
  yieldGenerated: 48_200,
  totalInvestors: 2140,
  totalInvestorsAllTime: 1284,
  activeWoWPct: 4.2,
  referrals: 12,
  earnings: { totalUsd: 10_210.45, performanceUsd: 8_420.1, entryUsd: 1_150.25, exitUsd: 640.1 },
  avgApy: 8.4,
  handle: "carlos",
  chart: [{ value: 318_000, label: "30d ago" }],
};

describe("managerDashboardSchema", () => {
  it("parses a valid dashboard", () => {
    expect(managerDashboardSchema.safeParse(validManagerDashboard).success).toBe(true);
  });

  // @rule R1 — activeWoWPct is number | null: real mode has no weekly-active source, so it is null
  // and the tile renders no delta. Mock mode keeps a plain number.
  it("[POO-560 R1] accepts a null activeWoWPct (no weekly-active source in real mode)", () => {
    const result = managerDashboardSchema.safeParse({
      ...validManagerDashboard,
      activeWoWPct: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.activeWoWPct).toBeNull();
  });

  // @rule R1 — a plain number stays valid (the honest mock, R2).
  it("[POO-560 R1] still accepts a numeric activeWoWPct", () => {
    const result = managerDashboardSchema.safeParse({
      ...validManagerDashboard,
      activeWoWPct: 4.2,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.activeWoWPct).toBe(4.2);
  });

  // @rule R1 — the field is required (null is a value, not "absent"): omitting it is invalid.
  it("[POO-560 R1] rejects an omitted activeWoWPct", () => {
    const { activeWoWPct: _omitted, ...withoutField } = validManagerDashboard;
    expect(managerDashboardSchema.safeParse(withoutField).success).toBe(false);
  });

  // @rule R1 — a non-numeric, non-null value stays invalid.
  it("[POO-560 R1] rejects a string activeWoWPct", () => {
    expect(
      managerDashboardSchema.safeParse({ ...validManagerDashboard, activeWoWPct: "4.2" }).success,
    ).toBe(false);
  });
});

// POO-222 [R4]/[R7]: the profile identity contract the seam clones from and the real GET /me maps to.
describe("profileUserSchema", () => {
  it("accepts the mock profile fixture", () => {
    expect(profileUserSchema.safeParse(mockProfileUser).success).toBe(true);
  });

  it("allows an empty editable subset (name/displayName/email/country may be cleared)", () => {
    const cleared = { ...mockProfileUser, name: "", displayName: "", email: "", country: "" };
    expect(profileUserSchema.safeParse(cleared).success).toBe(true);
  });

  it("rejects a non-integer quacks balance", () => {
    expect(profileUserSchema.safeParse({ ...mockProfileUser, quacks: 1.5 }).success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const { isManager: _omitted, ...withoutField } = mockProfileUser;
    expect(profileUserSchema.safeParse(withoutField).success).toBe(false);
  });

  it("rejects a wrong-typed field", () => {
    expect(profileUserSchema.safeParse({ ...mockProfileUser, emailVerified: "yes" }).success).toBe(
      false,
    );
  });
});
