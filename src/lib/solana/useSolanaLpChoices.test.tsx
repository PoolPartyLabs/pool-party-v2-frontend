import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SOLANA_LP_CHOICES, SOLANA_TOKEN_2022_PROGRAM, SOLANA_TOKEN_PROGRAM } from "./lpChoices";
import { useSolanaLpChoices } from "./useSolanaLpChoices";

const flags = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => flags.enabled }),
}));

it("offers no pools while the feature is disabled", () => {
  flags.enabled = false;
  expect(renderHook(() => useSolanaLpChoices()).result.current).toEqual({
    enabled: false,
    choices: [],
  });
});
it("exposes three distinct verified pools with their token programs and fees", () => {
  flags.enabled = true;
  const { choices } = renderHook(() => useSolanaLpChoices()).result.current;
  expect(choices).toBe(SOLANA_LP_CHOICES);
  expect(choices.map((choice) => choice.label)).toEqual(["TSLAx/USDC", "NVDAx/USDC", "SOL/USDC"]);
  expect(choices.map((choice) => choice.poolId)).toEqual([
    "8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF",
    "49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6",
    "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv",
  ]);
  expect(new Set(choices.map((choice) => choice.poolId)).size).toBe(3);
  expect(choices.map((choice) => choice.feeTierBps)).toEqual([10, 10, 4]);
  expect(choices.map((choice) => choice.tokens[0].tokenProgram)).toEqual([
    SOLANA_TOKEN_2022_PROGRAM,
    SOLANA_TOKEN_2022_PROGRAM,
    SOLANA_TOKEN_PROGRAM,
  ]);
  expect(choices.every((choice) => choice.tokens[1].tokenProgram === SOLANA_TOKEN_PROGRAM)).toBe(
    true,
  );
  expect(Object.isFrozen(choices[0]?.tokens[0])).toBe(true);
});
