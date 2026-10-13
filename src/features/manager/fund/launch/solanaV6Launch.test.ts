/**
 * @tests PP-MGR-LIB-101 (POO-2262)
 */
import { describe, expect, it } from "vitest";
import {
  type BuildCreation,
  buildCreationSchema,
  unsignedSolanaBuildSchema,
} from "@/lib/api/v2/solanaSchemas";
import type { BuildPlan } from "../build/plan/buildPlan";
import type { ReviewDraft } from "./review";
import {
  creationAmountsError,
  defaultCreationAmounts,
  initialSolanaLaunch,
  KAMINO_USDC_RESERVE,
  loadSolanaLaunch,
  RAYDIUM_SOL_USDC_POOL,
  raydiumRange,
  SOLANA_LAUNCH_STEPS,
  saveSolanaLaunch,
  solanaBuildToSign,
  solanaCreationRequest,
  solanaLaunchAmounts,
  solanaLaunchKey,
  verifyCreationPlan,
} from "./solanaV6Launch";
import { LIVE_KAMINO_BUILD, LIVE_UNSIGNED_PLAN } from "./solanaV6Launch.fixture";

const MANAGER = "0x000000000000000000000000000000000000dEaD";
const SOLANA_KEY = "G3FF47T19t1F1HchVDxgZLNvNS65eWWA8vs5rdyQjP43";
const FUND_1_SOLANA_MANAGER = "6VTveiPVZVM7H9BWEsUsu4ivsrPjKw9ePrLQqHaFgJaA";

const review: ReviewDraft = {
  name: "Solana demo fund",
  description: "",
  imageUrl: "",
  performanceFeeBps: 1000,
  managementFeeBps: 200,
  payoutFeeBps: 100,
  minimum: "20",
  seed: "20",
};
function plan(options: { kamino?: boolean; raydiumPool?: string | null; share?: number } = {}) {
  const chains: BuildPlan["spokes"][number]["chains"] = [];
  if (options.kamino !== false)
    chains.push({
      id: "kamino",
      sharePct: 20,
      steps: [
        {
          id: "k",
          family: "position",
          kind: "solanaKaminoSupply",
          config: { catalogId: "solana:mainnet-beta:kamino-supply", pair: "USDC / SOL" },
        },
      ],
    });
  if (options.raydiumPool !== null)
    chains.push({
      id: "raydium",
      sharePct: 20,
      steps: [
        {
          id: "r",
          family: "position",
          kind: "solanaRaydiumPool",
          config: {
            catalogId: "solana:mainnet-beta:raydium-clmm",
            pair: "SOL / USDC",
            poolAddress: options.raydiumPool ?? RAYDIUM_SOL_USDC_POOL,
          },
        },
      ],
    });
  return {
    version: 1,
    hub: { chains: [] },
    spokes: [
      { network: "robinhood", sharePct: 10, chains: [] },
      { network: "solana", sharePct: options.share ?? 50, chains },
    ],
  } satisfies BuildPlan;
}
const amounts = { seedAmount: "20000000", minFirstDeposit: "20000000", spokeCap: "20000000" };
const livePlan = (): BuildCreation => buildCreationSchema.parse(LIVE_UNSIGNED_PLAN);

describe("creation request (SOLANA_API_CONTRACT §3.13, API #198 amounts)", () => {
  it("maps the Solana blocks to the admitted venues and the typed amounts", () => {
    expect(solanaCreationRequest(plan(), review, amounts)).toEqual({
      managementFeeBps: 200,
      performanceFeeBps: 1000,
      payoutFeeBps: 100,
      assets: ["usdc", "wsol"],
      venues: [
        { kind: "kamino", reserve: KAMINO_USDC_RESERVE },
        { kind: "raydium", pool: RAYDIUM_SOL_USDC_POOL },
      ],
      seedAmount: "20000000",
      minFirstDeposit: "20000000",
      spokeCap: "20000000",
      bindingTtlSeconds: 14400,
    });
  });
  it("keeps only the venues the plan uses, and the API default pair when it uses none", () => {
    expect(solanaCreationRequest(plan({ raydiumPool: null }), review, amounts).venues).toEqual([
      { kind: "kamino", reserve: KAMINO_USDC_RESERVE },
    ]);
    expect(
      solanaCreationRequest(plan({ kamino: false, raydiumPool: null }), review, amounts).venues,
    ).toHaveLength(2);
  });
  it("never seals a stock pool (DEC-204) or an unadmitted pool", () => {
    expect(() =>
      solanaCreationRequest(
        plan({ raydiumPool: "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF" }),
        review,
        amounts,
      ),
    ).toThrow("SOLANA_STOCK_UNAVAILABLE");
    expect(() =>
      solanaCreationRequest(
        plan({ raydiumPool: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" }),
        review,
        amounts,
      ),
    ).toThrow("SOLANA_POOL_NOT_ADMITTED");
  });
  it("applies the API #198 floors before asking the API", () => {
    expect(creationAmountsError(amounts)).toBeNull();
    expect(creationAmountsError({ ...amounts, seedAmount: "1002505" })).toBe(
      "CREATION_SEED_BELOW_ONE_SHARE",
    );
    expect(creationAmountsError({ ...amounts, seedAmount: "1002506", minFirstDeposit: "0" })).toBe(
      null,
    );
    expect(creationAmountsError({ ...amounts, minFirstDeposit: "20000001" })).toBe(
      "CREATION_SEED_BELOW_MIN_FIRST_DEPOSIT",
    );
    expect(creationAmountsError({ ...amounts, spokeCap: "0" })).toBe("CREATION_SPOKE_CAP_ZERO");
    expect(creationAmountsError({ ...amounts, spokeCap: "1.5" })).toBe("CREATION_AMOUNT_INVALID");
  });
  it("defaults the launch amounts to the Review seed/minimum and a spoke cap the size of the seed", () => {
    expect(defaultCreationAmounts(review)).toEqual(amounts);
    expect(defaultCreationAmounts({ ...review, minimum: "30" }).minFirstDeposit).toBe("20000000");
  });
});

describe("operation amounts", () => {
  it("sends the Solana share of the seed principal, capped by the spoke cap", () => {
    const result = solanaLaunchAmounts(plan(), BigInt(20_000_000), BigInt(20_000_000));
    expect(result.send).toBe("9900000");
    expect(
      BigInt(result.kamino) + BigInt(result.swap) + BigInt(result.raydiumUsdc),
    ).toBeLessThanOrEqual(BigInt(result.send));
    expect(
      solanaLaunchAmounts(plan({ share: 100 }), BigInt(20_000_000), BigInt(5_000_000)).send,
    ).toBe("5000000");
  });
});

describe("plan verification before any signature", () => {
  it("accepts the live unsigned plan for its own Manager keys", () => {
    expect(() =>
      verifyCreationPlan(livePlan(), { manager: MANAGER, solanaKey: SOLANA_KEY }),
    ).not.toThrow();
  });
  it.each([
    ["another Solana key", { solanaKey: FUND_1_SOLANA_MANAGER }],
    ["another Manager", { manager: "0x26cD63ca3fe96e1D963f0160cb7542CEd13A53DE" }],
    ["another Core", { core: "0x1E45E497a734b3BcD67e514F0681F161EC78a718" }],
  ])("refuses a plan bound to %s", (_label, patch) => {
    expect(() =>
      verifyCreationPlan(livePlan(), { manager: MANAGER, solanaKey: SOLANA_KEY, ...patch }),
    ).toThrow("SOLANA_PLAN_MISMATCH");
  });
  it("refuses a tampered factory, program or approve target", () => {
    const factory = livePlan();
    factory.binding.typedData.domain.verifyingContract = MANAGER;
    expect(() => verifyCreationPlan(factory, { manager: MANAGER, solanaKey: SOLANA_KEY })).toThrow(
      "SOLANA_PLAN_MISMATCH",
    );
    const program = livePlan();
    program.binding.typedData.message.program = `0x${"11".repeat(32)}`;
    expect(() => verifyCreationPlan(program, { manager: MANAGER, solanaKey: SOLANA_KEY })).toThrow(
      "SOLANA_PLAN_MISMATCH",
    );
    const approve = livePlan();
    if (approve.transactions.approve) approve.transactions.approve.to = MANAGER;
    expect(() => verifyCreationPlan(approve, { manager: MANAGER, solanaKey: SOLANA_KEY })).toThrow(
      "SOLANA_PLAN_MISMATCH",
    );
  });
});

describe("Solana transactions before the wallet sees them", () => {
  const build = unsignedSolanaBuildSchema.parse(LIVE_KAMINO_BUILD);
  it("decodes the live API build with the API's own blockhash and lifetime", () => {
    const built = solanaBuildToSign(build, FUND_1_SOLANA_MANAGER);
    expect(built.lifetime.blockhash).toBe(build.blockhash);
    expect(built.lifetime.lastValidBlockHeight).toBe(BigInt(build.lastValidBlockHeight));
    expect(built.bytes.length).toBe(build.transactionBytes);
  });
  it("refuses a build whose fee payer is not the Manager's Solana key", () => {
    expect(() => solanaBuildToSign(build, SOLANA_KEY)).toThrow("UNSAFE_SOLANA_TRANSACTION");
  });
  it("refuses a build whose declared blockhash differs from the signed bytes", () => {
    expect(() =>
      solanaBuildToSign({ ...build, blockhash: SOLANA_KEY }, FUND_1_SOLANA_MANAGER),
    ).toThrow("UNSAFE_SOLANA_TRANSACTION");
  });
});

describe("journal storage", () => {
  it("round-trips the v1 state under a per-Manager, per-draft key", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const state = initialSolanaLaunch({
      draftId: "draft-1",
      manager: MANAGER,
      solanaKey: SOLANA_KEY,
      plan: plan(),
      review,
      amounts,
      now: 1,
    });
    saveSolanaLaunch(storage, state);
    expect([...store.keys()]).toEqual([solanaLaunchKey(MANAGER, "draft-1")]);
    expect(loadSolanaLaunch(storage, MANAGER, "draft-1")).toEqual(state);
    expect(Object.keys(state.steps)).toEqual([...SOLANA_LAUNCH_STEPS]);
    store.set(solanaLaunchKey(MANAGER, "draft-1"), JSON.stringify({ version: 2 }));
    expect(() => loadSolanaLaunch(storage, MANAGER, "draft-1")).toThrow(
      "SOLANA_LAUNCH_STORAGE_INVALID",
    );
  });
});

describe("Raydium range", () => {
  it("brackets the current tick by about 5% on the pool grid", () => {
    expect(raydiumRange(-22459, 1)).toEqual({ tickLower: -22959, tickUpper: -21959 });
    const spaced = raydiumRange(-22459, 60);
    expect(Math.abs(spaced.tickLower % 60)).toBe(0);
    expect(Math.abs(spaced.tickUpper % 60)).toBe(0);
    expect(spaced.tickLower).toBeLessThan(-22459);
    expect(spaced.tickUpper).toBeGreaterThan(-22459);
  });
});
