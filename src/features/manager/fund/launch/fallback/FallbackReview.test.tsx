import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../../../../../tests/utils/renderWithProviders";
import { FallbackReview } from "./FallbackReview";

const state = vi.hoisted(() => ({
  mock: false,
  enabled: true,
  draft: true,
  blocked: false,
  rootShare: 100,
  leafShare: 0,
  duplicate: false,
}));
const start = vi.hoisted(() => vi.fn(async (_draft: unknown) => ({ journeyId: "journey" })));
const setField = vi.hoisted(() => vi.fn());
const uploadLogo = vi.hoisted(() => vi.fn(async () => "https://cdn.test/logo.png"));
vi.mock("@/lib/services", () => ({
  get isMockMode() {
    return state.mock;
  },
}));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => state.enabled }),
}));
vi.mock("../index", () => ({
  startFundLaunch: start,
  useV2ReviewDraft: () => ({
    catalog: {
      loading: false,
      error: false,
      depositTokenFor: () => ({ address: `0x${"12".repeat(20)}` }),
      validateDraft: () => true,
    },
    draft: state.draft
      ? {
          id: "draft",
          networks: ["arbitrum"],
          pools: [],
          tokens: [{ network: "arbitrum", address: `0x${"12".repeat(20)}` }],
          aaveV3Reserves: [`0x${"12".repeat(20)}`],
          launchExecution: { supply: { leafSharePct: state.leafShare } },
          plan: {
            version: 1,
            hub: {
              chains: [
                {
                  id: "root",
                  sharePct: state.rootShare,
                  steps: [
                    { id: "supply", kind: "aaveSupply", family: "position", config: {} },
                    ...(state.duplicate
                      ? [{ id: "duplicate", kind: "aaveSupply", family: "position", config: {} }]
                      : []),
                  ],
                },
              ],
            },
            spokes: [],
          },
        }
      : null,
    manager: `0x${"34".repeat(20)}`,
    review: {
      name: "Income fund demo",
      description: "",
      imageUrl: "",
      performanceFeeBps: 2000,
      managementFeeBps: 0,
      payoutFeeBps: 200,
      minimum: "100",
      seed: "100",
    },
    terms: { operatingCash: "0", payoutHours: 72, access: "public" },
    preview: {
      shares: BigInt(99),
      principal: BigInt(99000000),
      fee: BigInt(250000),
      remainder: BigInt(750000),
    },
    balanceDecimal: "200",
    refreshBalance: vi.fn(),
    setMax: vi.fn(),
    launchBlockers: state.blocked
      ? [{ code: "INVALID_REVIEW", field: "seed", messageKey: "fundLaunch.validation" }]
      : [{ code: "BUILD_EXECUTION_GAP", messageKey: "fundLaunch.buildGap" }],
    feeConfiguration: { flowFeeBps: 25, flowSource: "fallback" },
    uploading: false,
    uploadError: null,
    setField,
    uploadLogo,
  }),
}));
vi.mock("../../useV2MandateCatalog", () => ({
  useV2MandateCatalog: () => {
    throw new Error("Fallback must reuse the Review binding catalog, not load a second copy");
  },
}));

describe("fallback Review [R1, R5]", () => {
  beforeEach(() => {
    Object.assign(state, {
      mock: false,
      enabled: true,
      draft: true,
      blocked: false,
      rootShare: 100,
      leafShare: 0,
      duplicate: false,
    });
    vi.clearAllMocks();
  });
  it("renders terms and signatures without launching on mount", async () => {
    renderWithProviders(<FallbackReview draftId="draft" />);
    expect(
      screen.getByText("Default execution settings (fallback until block panels ship)"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Launch · 5 signatures/ })).toBeEnabled();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Launch ·/ }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      plan: {
        hub: { chains: [{ steps: [{ config: { assetKey: `arbitrum:0x${"12".repeat(20)}` } }] }] },
      },
    });
  });
  it("shows the duplicate reserve blocker and disables Launch", () => {
    state.duplicate = true;
    renderWithProviders(<FallbackReview draftId="draft" />);
    expect(
      screen.getByText(
        "Only one Aave Supply block per reserve is allowed on each network. Remove the duplicate before launch.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Launch ·/ })).toBeDisabled();
    expect(start).not.toHaveBeenCalled();
  });
  it("preserves non-execution blockers", () => {
    state.blocked = true;
    renderWithProviders(<FallbackReview draftId="draft" />);
    expect(screen.getByRole("button", { name: /Launch ·/ })).toBeDisabled();
  });
  it("shows editable defaults for zero shares and validates edits before launch", () => {
    state.rootShare = 0;
    renderWithProviders(<FallbackReview draftId="draft" />);
    const root = screen.getByLabelText("arbitrum chain root: fund share (%)");
    const leaf = screen.getByLabelText("Position supply: share of this chain (%)");
    expect(root).toHaveValue(100);
    expect(root).not.toHaveAttribute("readonly");
    expect(leaf).toHaveValue(100);
    fireEvent.change(leaf, { target: { value: "99" } });
    expect(screen.getByRole("button", { name: /Launch ·/ })).toBeDisabled();
    fireEvent.change(leaf, { target: { value: "100" } });
    expect(screen.getByRole("button", { name: /Launch ·/ })).toBeEnabled();
  });
  it("shows panel-written root and leaf shares read-only", () => {
    state.leafShare = 100;
    renderWithProviders(<FallbackReview draftId="draft" />);
    expect(screen.getByLabelText("arbitrum chain root: fund share (%)")).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText(/Position supply:/)).toHaveAttribute("readonly");
  });
  it("keeps each invalid fee blocked even when another fee is valid", () => {
    renderWithProviders(<FallbackReview draftId="draft" />);
    fireEvent.change(screen.getByLabelText("Performance fee (%)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Instant fee (%)"), { target: { value: "10" } });
    expect(screen.getByRole("button", { name: /Launch ·/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Performance fee (%)"), { target: { value: "20" } });
    expect(screen.getByRole("button", { name: /Launch ·/ })).toBeEnabled();
  });
  it("rejects out-of-range Instant fees and accepts an exact locale decimal", () => {
    renderWithProviders(<FallbackReview draftId="draft" />);
    fireEvent.change(screen.getByLabelText("Instant fee (%)"), { target: { value: "10.01" } });
    expect(setField).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Launch ·/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Instant fee (%)"), { target: { value: "0,29" } });
    expect(setField).toHaveBeenCalledWith("payoutFeeBps", 29);
    expect(screen.getByRole("button", { name: /Launch ·/ })).toBeEnabled();
  });
  it.each(["mock", "disabled", "missing"])("fails closed when %s", (mode) => {
    state.mock = mode === "mock";
    state.enabled = mode !== "disabled";
    state.draft = mode !== "missing";
    renderWithProviders(<FallbackReview draftId="draft" />);
    expect(screen.queryByRole("button", { name: /Launch ·/ })).not.toBeInTheDocument();
  });
  it("persists Instant fee in bps and validates logo before upload", async () => {
    renderWithProviders(<FallbackReview draftId="draft" />);
    fireEvent.change(screen.getByLabelText("Instant fee (%)"), { target: { value: "10" } });
    expect(setField).toHaveBeenCalledWith("payoutFeeBps", 1000);
    fireEvent.change(screen.getByLabelText("Logo (PNG/JPG, up to 10 MiB)"), {
      target: { files: [new File(["bad"], "logo.svg", { type: "image/svg+xml" })] },
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(uploadLogo).not.toHaveBeenCalled();
  });
  it("shows a safe failure and re-enables launch for retry", async () => {
    start.mockRejectedValueOnce(new Error("private upstream failure"));
    renderWithProviders(<FallbackReview draftId="draft" />);
    fireEvent.click(screen.getByRole("button", { name: /Launch ·/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("private upstream failure")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Launch ·/ })).toBeEnabled();
  });
});
