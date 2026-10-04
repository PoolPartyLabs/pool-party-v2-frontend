import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../mandateDraft";
import { getDraft, upsertDraft } from "../mandateDraftStore";
import { useV2ReviewDraft } from "./useV2ReviewDraft";

vi.mock("../useV2MandateCatalog", () => ({ useV2MandateCatalog: () => ({}) }));
vi.mock("../v2Mandate", () => ({ toV2MandateSelection: () => ({}) }));
vi.mock("./useV2LaunchWallet", () => ({
  useV2LaunchWallet: () => ({
    manager: `0x${"34".repeat(20)}`,
    balance: BigInt(200000000),
    refreshBalance: vi.fn(),
  }),
}));
vi.mock("@/lib/media/useUploadMedia", () => ({
  useUploadMedia: () => async () => "https://cdn.test/logo.png",
}));
const review = {
  name: "Income fund demo",
  description: "saved",
  imageUrl: "",
  performanceFeeBps: 2000,
  managementFeeBps: 0,
  payoutFeeBps: 200,
  minimum: "100",
  seed: "100",
};
describe("agreed Review draft seam [V1, V2, V5, V8, V9]", () => {
  beforeEach(() => {
    localStorage.clear();
    upsertDraft({
      ...createEmptyDraft("2026-10-04", "review"),
      name: review.name,
      review,
      ...{
        plan: {
          version: 1,
          hub: {
            chains: [
              {
                id: "a",
                sharePct: 100,
                steps: [
                  {
                    id: "aave",
                    family: "position",
                    kind: "aaveSupply",
                    config: { assetKey: "arbitrum:asset" },
                  },
                ],
              },
            ],
          },
          spokes: [],
        },
      },
    });
  });
  it("reads saved fields and preserves them beside the plan on every setter", async () => {
    const { result } = renderHook(() => useV2ReviewDraft("review"));
    await waitFor(() => expect(result.current.review.description).toBe("saved"));
    act(() => result.current.setField("description", "updated"));
    expect(getDraft("review")?.review?.description).toBe("updated");
    act(() => result.current.setMax());
    expect(getDraft("review")?.review?.seed).toBe("200");
    act(() => result.current.setFeePercent("managementFeeBps", "9"));
    expect(getDraft("review")?.review?.managementFeeBps).toBe(500);
    expect(result.current.isReady).toBe(true);
  });
  it("exposes reasons for invalid fields and missing Build, never an unexplained disabled launch", async () => {
    const { result } = renderHook(() => useV2ReviewDraft("review"));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    act(() => result.current.setField("name", "short"));
    expect(result.current.launchBlockers.some((blocker) => blocker.field === "name")).toBe(true);
    expect(result.current.isReady).toBe(false);
    const missing = renderHook(() => useV2ReviewDraft("absent"));
    expect(
      missing.result.current.launchBlockers.some((blocker) => blocker.code === "DRAFT_UNAVAILABLE"),
    ).toBe(true);
  });
});
