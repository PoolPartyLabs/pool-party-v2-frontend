/**
 * @id PP-MGR-SCR-009
 * @name SolanaStrategyPreviewScreen tests
 * @implements-rules-version v2 (POO-2281)
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SolanaStrategyPreviewScreen } from "./SolanaStrategyPreviewScreen";

const { track, registerDirty } = vi.hoisted(() => ({ track: vi.fn(), registerDirty: vi.fn() }));
vi.mock("@/lib/analytics/useAnalytics", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/analytics/useAnalytics")>();
  return {
    useAnalytics: () => {
      const analytics = original.useAnalytics();
      track.mockImplementation(analytics.track);
      return { track };
    },
  };
});
vi.mock("@/lib/hooks/unsavedChanges", () => ({ useUnsavedChanges: registerDirty }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.protocol ? `${key} ${values.protocol}` : key,
  useLocale: () => "en",
  useFormatter: () => ({
    number: (value: number, options: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat("en", options).format(value),
  }),
}));
vi.mock("../build/canvas/CanvasViewport", () => ({
  CanvasViewport: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
// Geometry and canvas chrome are covered by CanvasViewport; these tests lock local flow behavior.
vi.mock("../build/pieces/SpokeGroup", () => ({
  SpokeGroup: ({ networkName }: { networkName: string }) => <div>{networkName}</div>,
}));
vi.mock("../build/pieces/SpineCard", () => ({
  SpineCard: ({ title, caption }: { title: string; caption: string }) => (
    <div>
      {title} {caption}
    </div>
  ),
}));
vi.mock("../build/pieces/FlowPill", () => ({
  FlowPill: ({ content }: { content: { text: string } }) => <span>{content.text}</span>,
}));

function add(protocol: string) {
  fireEvent.click(screen.getByRole("button", { name: `solanaPreview.protocols.${protocol}` }));
}
function allocation(value: string) {
  fireEvent.change(screen.getByLabelText("solanaPreview.allocation"), { target: { value } });
}
beforeEach(() => {
  vi.clearAllMocks();
  window.dataLayer = [];
});

describe("Solana local visual preview", () => {
  it("opens as a visual drawing with native SOL and no execution action", () => {
    render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    expect(screen.getByText("solanaPreview.visualOnly")).toBeVisible();
    expect(screen.getByText("solanaPreview.nativeSol")).toBeVisible();
    expect(screen.queryByRole("button", { name: /launch|sign|execute/i })).not.toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("solana_preview_viewed");
    expect(window.dataLayer).toContainEqual({ event: "solana_preview_viewed" });
  });
  it("applies only local configuration and retains it after invalid edits", () => {
    render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    add("raydium");
    allocation("35");
    expect(screen.getByTestId("preview-allocation-preview-1")).toHaveTextContent("0%");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.apply" }));
    expect(screen.getByTestId("preview-allocation-preview-1")).toHaveTextContent("35%");
    expect(screen.getByText("solanaPreview.localApplied")).toBeVisible();
    allocation("35.5");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.apply" }));
    expect(screen.getByText("solanaPreview.allocationInvalid")).toBeVisible();
    expect(screen.getByTestId("preview-allocation-preview-1")).toHaveTextContent("35%");
    expect(track).toHaveBeenCalledWith("solana_preview_blocked", {
      preview_protocol: "raydium",
      preview_reason: "allocation_invalid",
      has_local_changes: true,
    });
    expect(registerDirty).toHaveBeenLastCalledWith(true);
    expect(window.dataLayer).toContainEqual({
      event: "solana_preview_applied",
      preview_protocol: "raydium",
      has_local_changes: true,
    });
    expect(JSON.stringify(window.dataLayer)).not.toMatch(/0x[a-fA-F0-9]{40}|completed|SOL \/ USDC/);
  });
  it("guards unapplied form changes when adding a different block", () => {
    render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    add("kamino");
    allocation("60");
    add("orca");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("solanaPreview.unsavedBody")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "solanaPreview.keepEditing" }));
    expect(screen.getByLabelText("solanaPreview.allocation")).toHaveValue("60");
    add("orca");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.discardContinue" }));
    expect(screen.getByLabelText("solanaPreview.allocation")).toHaveValue("0");
  });
  // @rule R6/R8: cancel returns to the editable field; confirmed switches focus the new heading.
  it("restores focus after cancel and focuses the new Configure heading after confirmation", async () => {
    render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    add("kamino");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "solanaPreview.configure" })).toHaveFocus(),
    );
    const input = screen.getByLabelText("solanaPreview.allocation");
    input.focus();
    allocation("60");
    add("orca");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.keepEditing" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(input).toHaveFocus());
    add("orca");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.discardContinue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "solanaPreview.configure" })).toHaveFocus(),
    );
    expect(screen.getByLabelText("solanaPreview.allocation")).toHaveValue("0");
  });
  it("requires confirmation before removal and draws LP fees only for liquidity blocks", () => {
    render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    add("kamino");
    expect(screen.queryByText("solanaPreview.collect")).not.toBeInTheDocument();
    expect(screen.getByText(/solanaPreview.noDebtDrawing/)).toBeVisible();
    add("jupiter");
    expect(screen.queryByText("solanaPreview.collect")).not.toBeInTheDocument();
    add("orca");
    expect(screen.getByText("solanaPreview.collect")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "solanaPreview.removeLabel solanaPreview.protocols.orca",
      }),
    );
    expect(screen.getByTestId("preview-allocation-preview-3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.remove" }));
    expect(screen.queryByTestId("preview-allocation-preview-3")).not.toBeInTheDocument();
  });
  it("delegates exit to the parent's guard and reports abandonment only for edited drawings", () => {
    const onExit = vi.fn();
    const view = render(<SolanaStrategyPreviewScreen onExit={onExit} />);
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.exit" }));
    expect(onExit).toHaveBeenCalledOnce();
    add("kamino");
    view.unmount();
    expect(track).toHaveBeenCalledWith("solana_preview_abandoned", { has_local_changes: true });
  });
});
