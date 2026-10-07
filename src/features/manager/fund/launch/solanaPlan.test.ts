import { beforeEach, expect, it, vi } from "vitest";
import { SOLANA_LP_CHOICES } from "@/lib/solana/lpChoices";
import { createJournal, loadJournal, saveJournal } from "./journal";
import type { LaunchStep } from "./plan";
import { withSolanaLaunchSteps } from "./solanaPlan";

const flags = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => flags.enabled }));
const evm: LaunchStep[] = [
  { id: "create", kind: "create", chain: 42161, dependencies: [] },
  { id: "discover-hub", kind: "discover", chain: 42161, dependencies: ["create"] },
  { id: "profile", kind: "profile", chain: 42161, dependencies: ["discover-hub"] },
];
beforeEach(() => {
  flags.enabled = true;
});
it.each(SOLANA_LP_CHOICES)("persists $label into ratio/open steps and the journal", (choice) => {
  const steps = withSolanaLaunchSteps(evm, {
    sharePct: 50,
    kamino: false,
    raydiumPool: choice.poolId,
    maxPriceImpactBps: 75,
  });
  const journal = createJournal("draft", "manager", {}, steps);
  let serialized = "";
  const storage = {
    getItem: () => serialized || null,
    setItem: (_key: string, value: string) => {
      serialized = value;
    },
  };
  saveJournal(storage, journal);
  const restored = loadJournal(storage, "draft", "manager");
  expect(
    restored?.steps
      .filter((step) => step.kind === "swap-to-ratio" || step.kind === "raydium-open")
      .map((step) => step.config?.poolId),
  ).toEqual([choice.poolId, choice.poolId]);
});
it("rejects arbitrary pools instead of silently selecting a fallback", () => {
  expect(() =>
    withSolanaLaunchSteps(evm, { sharePct: 50, kamino: false, raydiumPool: "unadmitted" }),
  ).toThrow("SOLANA_LP_POOL_NOT_ADMITTED");
});
it("leaves legacy EVM plans unchanged and rejects Solana when disabled", () => {
  flags.enabled = false;
  expect(withSolanaLaunchSteps(evm)).toBe(evm);
  expect(() => withSolanaLaunchSteps(evm, { sharePct: 50, kamino: true })).toThrow(
    "SOLANA_DISABLED",
  );
});
it("carries the Manager impact bound into both swap and LP execution configs", () => {
  const steps = withSolanaLaunchSteps(evm, {
    sharePct: 50,
    kamino: false,
    raydiumPool: SOLANA_LP_CHOICES[0]?.poolId,
    maxPriceImpactBps: 75,
  });
  expect(
    steps.filter((step) => step.group === "solana" && step.config).map((step) => step.config),
  ).toEqual([
    { poolId: SOLANA_LP_CHOICES[0]?.poolId, maxPriceImpactBps: 75 },
    { poolId: SOLANA_LP_CHOICES[0]?.poolId, maxPriceImpactBps: 75 },
  ]);
});
it.each([
  -1, 65536, 1.5,
])("rejects Manager impact %s without constructing a plan", (maxPriceImpactBps) => {
  expect(() =>
    withSolanaLaunchSteps(evm, { sharePct: 50, kamino: true, maxPriceImpactBps }),
  ).toThrow("SOLANA_PRICE_IMPACT_INVALID");
});
it("requires explicit impact for LP but leaves Kamino-only impact absent", () => {
  expect(() =>
    withSolanaLaunchSteps(evm, {
      sharePct: 50,
      kamino: false,
      raydiumPool: SOLANA_LP_CHOICES[0]?.poolId,
    }),
  ).toThrow("SOLANA_PRICE_IMPACT_INVALID");
  expect(withSolanaLaunchSteps(evm, { sharePct: 50, kamino: true })).toBeDefined();
});
it("refuses extra quote/reference fields on the Manager selection", () => {
  expect(() =>
    withSolanaLaunchSteps(evm, { sharePct: 50, kamino: true, quote: "100" } as Parameters<
      typeof withSolanaLaunchSteps
    >[1]),
  ).toThrow("INVALID_SOLANA_PLAN");
});

it.each([
  { kamino: "false" },
  { kamino: 1 },
  { raydiumPool: "" },
  { raydiumPool: null },
])("rejects malformed selection fields %j", (change) => {
  expect(() =>
    withSolanaLaunchSteps(evm, { sharePct: 50, kamino: true, ...change } as Parameters<
      typeof withSolanaLaunchSteps
    >[1]),
  ).toThrow("INVALID_SOLANA_PLAN");
});
