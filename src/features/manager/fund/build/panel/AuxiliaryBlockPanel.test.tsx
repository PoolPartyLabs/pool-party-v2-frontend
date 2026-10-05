/**
 * @id PP-MGR-CMP-087
 * @name AuxiliaryBlockPanel tests
 * @implements-rules-version v1 (POO-2237 rules v1)
 * @analytics-events none, presentation reports through the panel controller
 */
import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../../tests/utils/renderWithProviders";
import { makeDescribeContext } from "../blocks/blockTestKit";
import { hubPoolPlan, makeTestDraft, spokePoolPlan, TEST_ASSET_KEYS } from "../plan/planTestKit";
import { AuxiliaryBlockPanel } from "./AuxiliaryBlockPanel";
import type { PanelDraftTarget, UsePanelDraftResult } from "./usePanelDraft";

function mount(
  kind: "swap" | "spoke",
  config: NonNullable<UsePanelDraftResult["draft"]>["config"],
  sharePct = 0,
) {
  const draft = makeTestDraft();
  const values = { config, sharePct };
  const panel = {
    draft: values,
    applied: values,
    dirty: true,
    leaveBlocked: false,
    leaveAttempt: 0,
    refusal: null,
    setConfig: vi.fn(),
    setShare: vi.fn(),
    apply: vi.fn(() => true),
    discard: vi.fn(),
    use: vi.fn(() => true),
    reset: vi.fn(),
  } satisfies UsePanelDraftResult;
  const ctx = makeDescribeContext(kind === "spoke" ? spokePoolPlan() : hubPoolPlan(), draft);
  const target: PanelDraftTarget = {
    kind,
    network: kind === "spoke" ? "robinhood" : "arbitrum",
    blockId: "aux",
    applied: values,
  };
  const onEditMandate = vi.fn();
  renderWithProviders(
    <AuxiliaryBlockPanel
      target={target}
      panel={panel}
      ctx={ctx}
      onEditMandate={onEditMandate}
      onRemoveRequest={vi.fn()}
    />,
  );
  return { panel, onEditMandate };
}

describe("AuxiliaryBlockPanel", () => {
  it("holds Apply for an incomplete manual swap and provides the token mandate link", async () => {
    const { onEditMandate } = mount("swap", { tokenInKey: "", tokenOutKey: "", slippagePct: 2 });
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Token in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Token out" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit mandate · Tokens" }));
    expect(onEditMandate).toHaveBeenCalledWith("tokens");
  });
  it("shows only mandate tokens on the block network and stages the chosen token", async () => {
    const { panel } = mount("swap", { tokenInKey: "", tokenOutKey: "", slippagePct: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Token in" }));
    expect(screen.queryByRole("option", { name: "USDG" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "USDC" }));
    expect(panel.setConfig).toHaveBeenCalledWith({
      tokenInKey: TEST_ASSET_KEYS.usdcArbitrum,
      tokenOutKey: "",
      slippagePct: 2,
    });
  });
  it("excludes the opposite token and permits Apply for a valid pair", async () => {
    const { panel } = mount("swap", {
      tokenInKey: TEST_ASSET_KEYS.usdcArbitrum,
      tokenOutKey: TEST_ASSET_KEYS.wethArbitrum,
      slippagePct: 2,
    });
    await userEvent.click(screen.getByRole("button", { name: "Token out" }));
    expect(screen.queryByRole("option", { name: "USDC" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(panel.apply).toHaveBeenCalledOnce();
  });
  it("renders the spoke allocation and delegates Discard to the panel draft", async () => {
    const { panel } = mount("spoke", { spoke: true }, 40);
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuemin", "40");
    expect(screen.queryByRole("button", { name: "Remove block" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(panel.discard).toHaveBeenCalledOnce();
  });
});
