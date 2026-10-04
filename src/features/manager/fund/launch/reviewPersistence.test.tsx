import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDraft } from "../mandateDraft";
import { getDraft, upsertDraft } from "../mandateDraftStore";
import { createJournal, saveJournal } from "./journal";
import { deriveLaunchSteps } from "./plan";
import { useV2ReviewDraft } from "./useV2ReviewDraft";

const mocks = vi.hoisted(() => ({ fund: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/api/v2/launchActions", () => ({ readLaunchFundAction: mocks.fund }));

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
  useUploadMedia: () => mocks.upload,
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
    vi.clearAllMocks();
    mocks.upload.mockResolvedValue("https://cdn.test/logo.png");
    mocks.fund.mockResolvedValue({ ok: true, data: { fees: { flowFeeBps: 50 } } });
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
  it("uses deployed flow fees for its estimate instead of silently hardcoding the fallback", async () => {
    const plan = {
      version: 1 as const,
      hub: {
        chains: [
          {
            id: "leaf",
            sharePct: 100,
            steps: [
              {
                id: "aave",
                family: "position" as const,
                kind: "aaveSupply",
                config: { assetKey: "arbitrum:asset" },
              },
            ],
          },
        ],
      },
      spokes: [],
    };
    const journal = createJournal(
      "review",
      `0x${"34".repeat(20)}`,
      {},
      deriveLaunchSteps(plan, {}, true, false),
    );
    journal.addresses.coreVault = `0x${"12".repeat(20)}`;
    saveJournal(localStorage, journal);
    const { result } = renderHook(() => useV2ReviewDraft("review"));
    await waitFor(() => expect(result.current.feeConfiguration.flowSource).toBe("fund-detail"));
    expect(result.current.preview?.fee).toBe(BigInt(500000));
  });
  it("persists staged logo, clamps performance and payout, and refuses malformed fee strings", async () => {
    const { result } = renderHook(() => useV2ReviewDraft("review"));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    await act(async () => {
      await result.current.uploadLogo(new File(["png"], "logo.png", { type: "image/png" }));
    });
    expect(getDraft("review")?.review?.imageUrl).toBe("https://cdn.test/logo.png");
    act(() => result.current.setFeePercent("performanceFeeBps", "1"));
    expect(result.current.review.performanceFeeBps).toBe(1000);
    act(() => result.current.setFeePercent("payoutFeeBps", "90"));
    expect(result.current.review.payoutFeeBps).toBe(1000);
    expect(() => result.current.setFeePercent("payoutFeeBps", "oops")).toThrow("INVALID_FEE");
  });
  it("maps legacy draft identity and reports missing Build before launch", async () => {
    upsertDraft({ ...createEmptyDraft("2026-10-04", "legacy"), name: "Legacy fund name" });
    const { result } = renderHook(() => useV2ReviewDraft("legacy"));
    await waitFor(() => expect(result.current.review.name).toBe("Legacy fund name"));
    expect(
      result.current.launchBlockers.some((blocker) => blocker.code === "BUILD_EXECUTION_GAP"),
    ).toBe(true);
    expect(result.current.feeConfiguration.flowSource).toBe("fallback");
  });
  it("blocks launch while the staged logo is uploading", async () => {
    let finish: ((url: string) => void) | undefined;
    mocks.upload.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useV2ReviewDraft("review"));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    let pending: Promise<string> | undefined;
    act(() => {
      pending = result.current.uploadLogo(new File(["png"], "logo.png", { type: "image/png" }));
    });
    expect(result.current.launchBlockers.some((blocker) => blocker.code === "LOGO_UPLOADING")).toBe(
      true,
    );
    await act(async () => {
      finish?.("https://cdn.test/logo.png");
      await pending;
    });
    expect(result.current.isReady).toBe(true);
  });
});
