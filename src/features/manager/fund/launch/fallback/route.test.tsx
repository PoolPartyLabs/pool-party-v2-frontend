import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/[locale]/(auth)/(app)/manager/fund-launch/review/[draftId]/page";

const state = vi.hoisted(() => ({ enabled: true, mock: false }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("404");
  },
}));
vi.mock("next-intl/server", () => ({ setRequestLocale: vi.fn() }));
vi.mock("@/lib/features", () => ({ isFeatureEnabled: () => state.enabled }));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return state.mock;
  },
}));
vi.mock("./FallbackReview", () => ({ FallbackReview: () => null }));

describe("fallback route [R1]", () => {
  beforeEach(() => Object.assign(state, { enabled: true, mock: false }));
  it("renders only real V2 with the flag on", async () => {
    const result = await Page({ params: Promise.resolve({ locale: "en", draftId: "demo" }) });
    expect(result.props.draftId).toBe("demo");
  });
  it.each(["flag", "mock"])("404s for %s", async (mode) => {
    state.enabled = mode !== "flag";
    state.mock = mode === "mock";
    await expect(
      Page({ params: Promise.resolve({ locale: "en", draftId: "demo" }) }),
    ).rejects.toThrow("404");
  });
});
