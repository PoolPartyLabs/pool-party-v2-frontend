/**
 * @id PP-REW (POO-210)
 * @name usePlayDuckShoot
 * @implements-rules-version v1
 *
 * Client hook for a Duck Shoot play. Mock mode resolves the hit via the mock
 * rewardsService; real mode calls the playDuckShootAction Server Action with the
 * connected wallet (the server-side POST happens there). Mirrors the useAuth
 * mock/real split.
 */
"use client";

import { useAuth } from "@/lib/auth/useAuth";
import type { DuckShootOutcome } from "@/lib/rewards/writes";
import { isMockMode, rewardsService } from "@/lib/services";
import { playDuckShootAction } from "../actions";

/** The Duck Shoot play surface. */
export interface PlayDuckShootApi {
  /** Play one try and return the discriminated outcome. */
  play: () => Promise<DuckShootOutcome>;
}

function useMockPlayDuckShoot(): PlayDuckShootApi {
  return {
    play: async () => ({ status: "played", result: await rewardsService.playDuckShoot() }),
  };
}

function useRealPlayDuckShoot(): PlayDuckShootApi {
  const { address } = useAuth();
  return {
    play: async () => (address ? playDuckShootAction(address) : { status: "error" }),
  };
}

/** Play one Duck Shoot try (mock or real, decided at build time by isMockMode). */
export function usePlayDuckShoot(): PlayDuckShootApi {
  // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant; the branch is stable across renders.
  return isMockMode ? useMockPlayDuckShoot() : useRealPlayDuckShoot();
}
