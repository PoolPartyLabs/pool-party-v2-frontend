/**
 * @id PP-REW (POO-210)
 * @name Rewards write hooks tests (mock branch)
 * @implements-rules-version v1
 *
 * [R6] In mock mode the hooks resolve via the mock rewardsService with no
 * signing and no network, wrapping the result in the discriminated outcome.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sayQuack: vi.fn(),
  playDuckShoot: vi.fn(),
}));

vi.mock("@/lib/services", () => ({
  isMockMode: true,
  rewardsService: { sayQuack: mocks.sayQuack, playDuckShoot: mocks.playDuckShoot },
}));

import { usePlayDuckShoot } from "./usePlayDuckShoot";
import { useSayQuack } from "./useSayQuack";

describe("useSayQuack (mock mode)", () => {
  it("wraps the mock service result as an awarded outcome", async () => {
    mocks.sayQuack.mockResolvedValueOnce({ quacksAwarded: 25, quackedToday: true });
    const { result } = renderHook(() => useSayQuack());

    await expect(result.current.sayQuack()).resolves.toEqual({
      status: "awarded",
      quacksAwarded: 25,
    });
  });
});

describe("usePlayDuckShoot (mock mode)", () => {
  it("wraps the mock service result as a played outcome", async () => {
    const mockResult = { hitIndex: 2, multiplierPct: 100, quacksWon: 480, triesLeft: 6 };
    mocks.playDuckShoot.mockResolvedValueOnce(mockResult);
    const { result } = renderHook(() => usePlayDuckShoot());

    await expect(result.current.play()).resolves.toEqual({ status: "played", result: mockResult });
  });
});
