/**
 * @id PP-MGR-CMP-098 (POO-2291)
 * @name SolanaLocalManageHost tests
 * @implements-rules-version v1
 * @analytics-events none, bounded parent intent contract tests
 */
import { expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import type { PreviewBlock } from "./previewModel";
import { SolanaLocalManageHost } from "./SolanaLocalManageHost";

const blocks: PreviewBlock[] = [
  { id: "a", protocol: "orca", allocationBps: 3000, pair: "SOL / USDC" },
  { id: "b", protocol: "orca", allocationBps: 3000, pair: "SOL / USDC" },
];
const base = { blocks, selectedId: "a", active: true, onClose: vi.fn() };

// @rule POO-2301 R5/R8: a shared chain has one allocation owner and independent downstream drafts.
it("counts a shared chain once and keeps downstream allocation read-only", async () => {
  const shared = blocks.map((block) => ({ ...block, allocationBps: 6000 }));
  renderWithProviders(
    <SolanaLocalManageHost
      {...base}
      blocks={shared}
      selectedId="b"
      allocations={{
        a: { groupId: "chain", editable: true },
        b: { groupId: "chain", editable: false },
      }}
    />,
  );
  expect(screen.queryByText("The total allocation cannot exceed 100%.")).toBeNull();
  const field = screen.getByRole("textbox", { name: "Allocation (%)" });
  expect(field).toHaveAttribute("readonly");
  expect(field).toHaveValue("60");
  await userEvent.type(field, "9");
  expect(field).toHaveValue("60");
});

// @rule POO-2301 R8: phase-leave discard is explicit; hiding alone preserves each draft.
it("discards each draft only when the parent confirms a discard revision", async () => {
  const view = renderWithProviders(<SolanaLocalManageHost {...base} />);
  await allocation("40");
  view.rerender(<SolanaLocalManageHost {...base} active={false} />);
  view.rerender(<SolanaLocalManageHost {...base} />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("40");
  view.rerender(<SolanaLocalManageHost {...base} active={false} discardRevision={1} />);
  view.rerender(<SolanaLocalManageHost {...base} discardRevision={1} />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("30");
});
async function allocation(value: string) {
  const input = screen.getByRole("textbox", { name: "Allocation (%)" });
  await userEvent.clear(input);
  await userEvent.type(input, value);
}
// @rule R3/R4/R8: unavailable Kamino reads never replace independent local drafts or inline Review.
it("retains two Kamino drafts and inline review while financial reads remain unavailable", async () => {
  const supplies: PreviewBlock[] = blocks.map((block) => ({ ...block, protocol: "kamino" }));
  const host = { ...base, blocks: supplies };
  const view = renderWithProviders(<SolanaLocalManageHost {...host} />);
  expect(screen.getByRole("region", { name: "Supply USDC" })).toBeVisible();
  await allocation("40");
  await userEvent.click(screen.getByRole("button", { name: "Apply now" }));
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
  expect(screen.getByRole("button", { name: "Confirm changes" })).toBeDisabled();
  view.rerender(<SolanaLocalManageHost {...host} selectedId="b" />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("30");
  await allocation("45");
  view.rerender(<SolanaLocalManageHost {...host} active={false} />);
  expect(screen.queryByRole("region", { name: "Supply USDC" })).toBeNull();
  view.rerender(<SolanaLocalManageHost {...host} />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("40");
  expect(screen.getByRole("button", { name: "Confirm changes" })).toBeDisabled();
  expect(screen.getByRole("region", { name: "Account risk" })).toHaveTextContent(
    "Verified account risk is not available.",
  );
  expect(screen.queryByText("No debt")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Min price" })).toBeNull();
  view.rerender(<SolanaLocalManageHost {...host} selectedId="b" />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("45");
});
// @rule R3/R8: drawing allocation is a local draft, never Current or After.
it("renders an editable local instance with unavailable financial snapshots", () => {
  renderWithProviders(<SolanaLocalManageHost {...base} />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("30");
  expect(
    within(screen.getByRole("region", { name: "Current" })).getByText("Not available"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "After" })).getByText("Not available"),
  ).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "Min price" })).toBeNull();
});
// @rule R8: two same-pool drawings retain separate drafts and modes across selections.
it("preserves each instance draft and inline review across selection and hiding", async () => {
  const view = renderWithProviders(<SolanaLocalManageHost {...base} />);
  await allocation("40");
  await userEvent.click(screen.getByRole("button", { name: /Move range/ }));
  await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
  expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeDisabled();
  view.rerender(<SolanaLocalManageHost {...base} selectedId="b" />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("30");
  await allocation("45");
  view.rerender(<SolanaLocalManageHost {...base} active={false} />);
  expect(screen.queryByRole("textbox", { name: "Allocation (%)" })).toBeNull();
  view.rerender(<SolanaLocalManageHost {...base} />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("40");
  expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeDisabled();
  view.rerender(<SolanaLocalManageHost {...base} selectedId="b" />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("45");
});
// @rule R8: a drawing baseline reaching a reviewed draft releases the settings field.
it("ends inline review when the synchronized drawing matches the draft", async () => {
  const view = renderWithProviders(<SolanaLocalManageHost {...base} />);
  await allocation("40");
  await userEvent.click(screen.getByRole("button", { name: /Move range/ }));
  await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
  view.rerender(
    <SolanaLocalManageHost
      {...base}
      blocks={[{ ...(blocks[0] as PreviewBlock), allocationBps: 4000 }, blocks[1] as PreviewBlock]}
    />,
  );
  expect(screen.queryByRole("button", { name: "Confirm & move range" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).not.toHaveAttribute("readonly");
  await allocation("45");
  expect(screen.getByRole("button", { name: /Move range/ })).toBeEnabled();
});
// @rule R8: aggregate dirty state does not depend on current selection or visibility.
it("reports aggregate dirtiness while another instance is selected or the panel is hidden", async () => {
  const dirty = vi.fn();
  const view = renderWithProviders(<SolanaLocalManageHost {...base} onDirtyChange={dirty} />);
  expect(dirty).toHaveBeenLastCalledWith(false);
  await allocation("40");
  expect(dirty).toHaveBeenLastCalledWith(true);
  view.rerender(
    <SolanaLocalManageHost {...base} selectedId="b" active={false} onDirtyChange={dirty} />,
  );
  expect(dirty).toHaveBeenLastCalledWith(true);
});
// @rule R8: drawing changes synchronize baseline/add/remove without recreating another draft.
it("adds and removes drawing instances without resetting another local draft", async () => {
  const view = renderWithProviders(<SolanaLocalManageHost {...base} />);
  await allocation("40");
  const added: PreviewBlock = {
    id: "c",
    protocol: "raydium",
    allocationBps: 0,
    pair: "USDC / SOL",
  };
  view.rerender(<SolanaLocalManageHost {...base} blocks={[...blocks, added]} selectedId="c" />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("0");
  view.rerender(<SolanaLocalManageHost {...base} blocks={[blocks[0] as PreviewBlock, added]} />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("40");
});
// @rule R8: aggregate targets above 100% cannot choose an immediate/future intent.
it("blocks over-allocation before a mode is selected and reports only a bounded intent", async () => {
  const intent = vi.fn();
  renderWithProviders(<SolanaLocalManageHost {...base} onIntent={intent} />);
  await allocation("80");
  await userEvent.click(screen.getByRole("button", { name: /Move range/ }));
  expect(screen.queryByRole("button", { name: "Review move range" })).toBeNull();
  expect(intent).toHaveBeenLastCalledWith("orca", "blocked");
  expect(screen.getByText("The total allocation cannot exceed 100%.")).toBeVisible();
  expect(intent.mock.calls.every((call) => call.length === 2 && call[0] === "orca")).toBe(true);
});
// @rule R8: a baseline update after choosing a mode must recheck aggregate targets before Review.
it("blocks Review when synchronized drawing allocation would exceed the aggregate budget", async () => {
  const intent = vi.fn();
  const view = renderWithProviders(<SolanaLocalManageHost {...base} onIntent={intent} />);
  await allocation("40");
  await userEvent.click(screen.getByRole("button", { name: /Move range/ }));
  view.rerender(
    <SolanaLocalManageHost
      {...base}
      blocks={[blocks[0] as PreviewBlock, { ...(blocks[1] as PreviewBlock), allocationBps: 7000 }]}
      onIntent={intent}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
  expect(screen.queryByRole("button", { name: "Confirm & move range" })).toBeNull();
  expect(intent).toHaveBeenLastCalledWith("orca", "blocked");
});
// @rule R8: close and keyboard navigation change parent visibility, never apply or discard.
it("focuses on activation and closes by button or Escape without discarding", async () => {
  const close = vi.fn();
  const view = renderWithProviders(
    <SolanaLocalManageHost {...base} active={false} onClose={close} />,
  );
  view.rerender(<SolanaLocalManageHost {...base} onClose={close} />);
  expect(screen.getByRole("heading", { name: "Manage block" })).toHaveFocus();
  await allocation("40");
  await userEvent.keyboard("{Escape}");
  expect(close).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Close configuration" }));
  expect(close).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("40");
});
// @rule R8: no selected instance never borrows a fallback position.
it("keeps the mounted host hidden when no position is selected", () => {
  renderWithProviders(<SolanaLocalManageHost {...base} selectedId={null} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Manage block" })).toBeNull();
});
// @rule R8: applying settings updates only drawing configuration, never a financial read.
it("applies a valid local drawing and reports bounded apply and review intents", async () => {
  const apply = vi.fn(() => true);
  const intent = vi.fn();
  const dirty = vi.fn();
  renderWithProviders(
    <SolanaLocalManageHost
      {...base}
      onApplyDrawing={apply}
      onIntent={intent}
      onDirtyChange={dirty}
    />,
  );
  await allocation("40");
  await userEvent.click(screen.getByRole("button", { name: /Move range/ }));
  await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
  expect(intent).toHaveBeenLastCalledWith("orca", "review");
  await userEvent.click(screen.getByRole("button", { name: "Back to settings" }));
  await userEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(apply).toHaveBeenCalledWith("a", { allocation: "40", pair: "SOL / USDC", range: null });
  expect(intent).toHaveBeenLastCalledWith("orca", "apply");
  expect(dirty).toHaveBeenLastCalledWith(false);
  expect(screen.getByText("Changes applied to this preview.")).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Current" })).getByText("Not available"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "After" })).getByText("Not available"),
  ).toBeVisible();
});
// @rule R8: drawing Apply shares the aggregate budget guard with mode/review actions.
it("does not call the drawing callback when aggregate allocation is invalid", async () => {
  const apply = vi.fn(() => true);
  const intent = vi.fn();
  renderWithProviders(<SolanaLocalManageHost {...base} onApplyDrawing={apply} onIntent={intent} />);
  await allocation("80");
  await userEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(apply).not.toHaveBeenCalled();
  expect(intent).toHaveBeenLastCalledWith("orca", "blocked");
});
// @rule R8: applying one position cannot consume unapplied reductions from another draft.
it("checks the selected draft against other drawing baselines before applying", async () => {
  const drawing = [
    blocks[0] as PreviewBlock,
    { ...(blocks[1] as PreviewBlock), allocationBps: 7000 },
  ];
  const apply = vi.fn(() => true);
  const intent = vi.fn();
  const dirty = vi.fn();
  const props = {
    ...base,
    blocks: drawing,
    onApplyDrawing: apply,
    onIntent: intent,
    onDirtyChange: dirty,
  };
  const view = renderWithProviders(<SolanaLocalManageHost {...props} selectedId="b" />);
  await allocation("20");
  view.rerender(<SolanaLocalManageHost {...props} />);
  await allocation("80");
  await userEvent.click(screen.getByRole("button", { name: /Move range/ }));
  await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
  await userEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(apply).not.toHaveBeenCalled();
  expect(intent).toHaveBeenLastCalledWith("orca", "blocked");
  expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeDisabled();
  expect(screen.queryByText("Changes applied to this preview.")).toBeNull();
  expect(dirty).toHaveBeenLastCalledWith(true);
  view.rerender(<SolanaLocalManageHost {...props} selectedId="b" />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("20");
});
// @rule R8: parent acknowledgement is required before releasing the local draft/review.
it("retains its dirty draft and Review when the drawing owner rejects Apply", async () => {
  const apply = vi.fn(() => false);
  const intent = vi.fn();
  const dirty = vi.fn();
  renderWithProviders(
    <SolanaLocalManageHost
      {...base}
      onApplyDrawing={apply}
      onIntent={intent}
      onDirtyChange={dirty}
    />,
  );
  await allocation("40");
  await userEvent.click(screen.getByRole("button", { name: /Move range/ }));
  await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
  await userEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(apply).toHaveBeenCalledWith("a", { allocation: "40", pair: "SOL / USDC", range: null });
  expect(intent).toHaveBeenLastCalledWith("orca", "blocked");
  expect(intent).not.toHaveBeenCalledWith("orca", "apply");
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("40");
  expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeDisabled();
  expect(screen.queryByText("Changes applied to this preview.")).toBeNull();
  expect(dirty).toHaveBeenLastCalledWith(true);
});
