/**
 * @id PP-MGR-CMP-077 (POO-2195)
 * @name ReviewUploadRace.test
 * @implements-rules-version v1
 * @analytics-events none: regression at the existing upload persistence seam.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { hubSupplyPlan, makeTestDraft } from "../build/plan/planTestKit";
import { useV2ReviewDraft } from "../launch/useV2ReviewDraft";
import { buildMandateCatalog } from "../mandateCatalog";
import { getDraft, upsertDraft } from "../mandateDraftStore";

const reviewStoryKit = {
  name: "Arbitrum stable strategy",
  description: "",
  imageUrl: "",
  performanceFeeBps: 2000,
  managementFeeBps: 100,
  payoutFeeBps: 200,
  minimum: "100",
  seed: "2500",
};

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/lib/media/useUploadMedia", () => ({ useUploadMedia: () => mocks.upload }));
vi.mock("../useV2MandateCatalog", () => ({ useV2MandateCatalog: () => buildMandateCatalog() }));
vi.mock("../launch/useV2LaunchWallet", () => ({
  useV2LaunchWallet: () => ({
    manager: null,
    balance: BigInt("5000000000"),
    refreshBalance: vi.fn(),
  }),
}));
vi.mock("../v2Mandate", () => ({ toV2MandateSelection: () => ({}) }));
describe("logo persistence while editing [R1]", () => {
  it("retains concurrent name and seed edits when the upload finishes", async () => {
    localStorage.clear();
    upsertDraft({
      ...makeTestDraft(),
      id: "upload-race",
      plan: hubSupplyPlan(),
      review: reviewStoryKit,
    });
    let resolve: (url: string) => void = () => {};
    mocks.upload.mockImplementation(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    const { result } = renderHook(() => useV2ReviewDraft("upload-race"));
    let pending: Promise<string> | undefined;
    act(() => {
      pending = result.current.uploadLogo(new File(["png"], "logo.png", { type: "image/png" }));
    });
    act(() => result.current.setField("name", "Edited during upload"));
    act(() => result.current.setField("seed", "1200"));
    await act(async () => {
      resolve("https://cdn.test/new.png");
      await pending;
    });
    expect(getDraft("upload-race")?.review).toMatchObject({
      name: "Edited during upload",
      seed: "1200",
      imageUrl: "https://cdn.test/new.png",
    });
  });
});
