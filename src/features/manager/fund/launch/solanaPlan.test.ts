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
