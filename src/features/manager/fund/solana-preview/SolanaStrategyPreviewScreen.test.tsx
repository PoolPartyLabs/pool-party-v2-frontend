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
  FlowPill: ({
    content,
    onActivate,
  }: {
    content: { text: string };
    onActivate?: (anchor: HTMLElement) => void;
  }) =>
    onActivate ? (
      <button type="button" onClick={(event) => onActivate(event.currentTarget)}>
        {content.text}
      </button>
    ) : (
      <span>{content.text}</span>
    ),
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
  // @rule POO-2291 R8/R9: fixed/automatic panels identify their network and exact local owner.
  it("distinguishes the selected Collect owner and the hub/spoke Idle inspectors", () => {
    const view = render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    add("orca");
    add("raydium");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.localManage.title" }));
    fireEvent.click(
      view.container.querySelector('[data-preview-node="preview-1-collect"] button') as HTMLElement,
    );
    const orca = screen.getByRole("complementary", { name: "solanaPreview.collect" });
    expect(orca).toHaveTextContent("solanaPreview.protocols.orca");
    expect(orca).toHaveTextContent("SOL / USDC");
    expect(orca).toHaveTextContent("Solana");
    fireEvent.click(
      view.container.querySelector('[data-preview-node="preview-2-collect"] button') as HTMLElement,
    );
    const raydium = screen.getByRole("complementary", { name: "solanaPreview.collect" });
    expect(raydium).toHaveTextContent("solanaPreview.protocols.raydium");
    expect(raydium).not.toHaveTextContent("solanaPreview.protocols.orca");
    fireEvent.click(
      view.container.querySelector('[data-preview-node="hub-idle"] button') as HTMLElement,
    );
    expect(screen.getByRole("complementary", { name: "manageV2.idleInput" })).toHaveTextContent(
      "Arbitrum",
    );
    fireEvent.click(
      view.container.querySelector('[data-preview-node="solana-idle"] button') as HTMLElement,
    );
    expect(screen.getByRole("complementary", { name: "manageV2.idleInput" })).toHaveTextContent(
      "Solana",
    );
  });

  // @rule POO-2291 R8: confirmation focus follows the visible Manage panel, including removals.
  it("focuses visible Manage after confirming a mode switch and removal of another block", async () => {
    render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    add("orca");
    add("raydium");
    allocation("30");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.localManage.title" }));
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.discardContinue" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("heading", { name: "title" })).toHaveFocus());
    fireEvent.click(
      screen.getByRole("button", {
        name: "solanaPreview.removeLabel solanaPreview.protocols.orca",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.remove" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("heading", { name: "title" })).toHaveFocus());
  });

  // @rule POO-2291 R8: local Manage drafts survive panel/mode selection; they are never Current.
  it("preserves Manage drafts across canvas selection, closing and Configure switching", async () => {
    const view = render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    add("orca");
    allocation("30");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.apply" }));
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.localManage.title" }));
    const localInput = () => screen.getByRole("textbox", { name: "allocation" });
    fireEvent.change(localInput(), { target: { value: "40" } });
    expect(localInput()).toHaveValue("40");
    add("orca");
    expect(localInput()).toHaveValue("0");
    const first = view.container.querySelector('[data-preview-node="preview-1"] button');
    fireEvent.click(first as HTMLElement);
    expect(localInput()).toHaveValue("40");
    fireEvent.click(screen.getByRole("button", { name: "closePanel" }));
    expect(localInput).toThrow();
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.click(first as HTMLElement);
    expect(localInput()).toHaveValue("40");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.configure" }));
    expect(screen.getByLabelText("solanaPreview.allocation")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.localManage.title" }));
    expect(localInput()).toHaveValue("40");
    expect(screen.getAllByRole("region", { name: "current" })[0]).toHaveTextContent("notAvailable");
    expect(screen.getAllByRole("region", { name: "after" })[0]).toHaveTextContent("notAvailable");
    expect(track).toHaveBeenCalledWith(
      "solana_preview_interacted",
      expect.objectContaining({
        preview_action: "edit",
        preview_mode: "manage",
        preview_protocol: "orca",
      }),
    );
    expect(track).toHaveBeenCalledWith(
      "solana_preview_interacted",
      expect.objectContaining({
        preview_action: "select",
        preview_mode: "manage",
        node_kind: "position",
      }),
    );
    expect(JSON.stringify(window.dataLayer)).not.toMatch(/preview-\d|SOL \/ USDC|completed/);
  });

  // @rule POO-2291 R8/R9: selecting a fixed node opens inspection, preserving independent drafts.
  it("inspects fixed nodes without borrowing a position or discarding its draft", () => {
    const view = render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    add("orca");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.localManage.title" }));
    fireEvent.change(screen.getByRole("textbox", { name: "allocation" }), {
      target: { value: "25" },
    });
    const income = view.container.querySelector('[data-preview-node="hub-income"] button');
    fireEvent.click(income as HTMLElement);
    expect(screen.getByRole("complementary", { name: "solanaPreview.income" })).toHaveTextContent(
      "solanaPreview.marketUnavailable",
    );
    expect(screen.queryByRole("textbox", { name: "allocation" })).toBeNull();
    expect(track).toHaveBeenCalledWith(
      "solana_preview_interacted",
      expect.objectContaining({ preview_action: "select", node_kind: "income" }),
    );
    fireEvent.click(
      view.container.querySelector('[data-preview-node="preview-1"] button') as HTMLElement,
    );
    expect(screen.getByRole("textbox", { name: "allocation" })).toHaveValue("25");
  });

  // @rule POO-2291 R8: Manage Apply is a drawing update; unavailable financial state stays unavailable.
  it("applies only the local drawing and guards unapplied Configure edits before switching", () => {
    render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    add("orca");
    allocation("30");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.localManage.title" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.keepEditing" }));
    expect(screen.getByLabelText("solanaPreview.allocation")).toHaveValue("30");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.apply" }));
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.localManage.title" }));
    fireEvent.change(screen.getByRole("textbox", { name: "allocation" }), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "apply" }));
    expect(screen.getByTestId("preview-allocation-preview-1")).toHaveTextContent("45%");
    expect(screen.getByRole("region", { name: "current" })).toHaveTextContent("notAvailable");
    expect(screen.getByRole("region", { name: "after" })).toHaveTextContent("notAvailable");
    expect(track).toHaveBeenCalledWith(
      "solana_preview_applied",
      expect.objectContaining({ preview_protocol: "orca", has_local_changes: true }),
    );
    expect(registerDirty).toHaveBeenLastCalledWith(true);
  });

  it("adds independent custody blocks with local configuration and bounded Holding events", () => {
    render(<SolanaStrategyPreviewScreen onExit={vi.fn()} />);
    const addHolding = () =>
      fireEvent.click(screen.getByRole("button", { name: "solanaPreview.holding.title" }));
    addHolding();
    expect(screen.getByRole("region", { name: "title" })).toHaveAttribute(
      "data-holding-mode",
      "choice",
    );
    expect(screen.getByRole("button", { name: "buy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "sell" })).toBeDisabled();
    expect(screen.queryByText("solanaPreview.collect")).toBeNull();
    expect(track).toHaveBeenCalledWith("solana_preview_started", { preview_protocol: "holding" });
    allocation("20");
    fireEvent.click(screen.getByRole("button", { name: "solanaPreview.apply" }));
    expect(track).toHaveBeenCalledWith("solana_preview_applied", {
      preview_protocol: "holding",
      has_local_changes: true,
    });
    addHolding();
    expect(screen.getByTestId("preview-allocation-preview-1")).toHaveTextContent("20%");
    expect(screen.getByTestId("preview-allocation-preview-2")).toHaveTextContent("0%");
    expect(track).not.toHaveBeenCalledWith("solana_preview_completed", expect.anything());
  });
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
    // A local Supply drawing cannot establish an account's debt or liquidation state.
    expect(screen.getByText("accountUnavailable")).toBeVisible();
    expect(screen.queryByText("noDebt")).not.toBeInTheDocument();
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
