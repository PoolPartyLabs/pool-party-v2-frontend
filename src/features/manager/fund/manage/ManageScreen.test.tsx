/**
 * @id PP-MGR-SCR-004
 * @name ManageScreen tests
 * @implements-rules-version v1 (POO-2226)
 * @analytics-events none, controlled screen tests.
 */
import { type AnchorHTMLAttributes, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { ManageScreen } from "./ManageScreen";
import type { ManagePosition } from "./manageModel";

vi.mock("@/i18n/navigation", () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/lib/analytics/useTrackView", () => ({ useTrackView: vi.fn() }));
function DraftPanel({ position, active }: { position: ManagePosition | null; active: boolean }) {
  const [draft, setDraft] = useState("");
  return (
    <div>
      <h2>Manage test block</h2>
      {position ? (
        <input
          aria-label={`${position.protocol} draft`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <p>No selection</p>
      )}
      <span>{active ? "active" : "inactive"}</span>
    </div>
  );
}
describe("Manage shell", () => {
  it("[R3,R8] synchronizes list and canvas while preserving each position draft in an inline panel", async () => {
    renderWithProviders(
      <ManageScreen
        fund={mockFund}
        panel={(position, active) => <DraftPanel position={position} active={active} />}
      />,
    );
    const list = document.querySelectorAll<HTMLElement>("[data-manage-list-position]");
    await userEvent.click(list[1] as HTMLElement);
    await userEvent.type(screen.getByRole("textbox", { name: "Uniswap v4 draft" }), "edited");
    // POO-2232 R5: an inline position draft does not replace the current on-chain status.
    expect(document.querySelector("[data-manage-range]")).toHaveTextContent("In range");
    expect(document.querySelector("[data-manage-range]")).toHaveClass("text-success");
    expect(document.querySelectorAll('[data-manage-position][aria-pressed="true"]')).toHaveLength(
      1,
    );
    await userEvent.click(list[0] as HTMLElement);
    expect(screen.queryByRole("textbox", { name: "Uniswap v4 draft" })).not.toBeInTheDocument();
    await userEvent.click(list[1] as HTMLElement);
    expect(screen.getByRole("textbox", { name: "Uniswap v4 draft" })).toHaveValue("edited");
    expect(document.querySelector("[data-manage-range]")).toHaveTextContent("In range");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector("[data-manage-grid]")?.className).toContain("grid-cols-1");
  });
  it("[R7] shows empty and unavailable positions as distinct states", () => {
    const view = renderWithProviders(
      <ManageScreen
        fund={{ ...mockFund, positionsSummary: { protocolVersion: "v2", positions: [] } }}
        panel={() => null}
      />,
    );
    expect(screen.getByText("This strategy has no positions yet.")).toBeInTheDocument();
    view.rerender(
      <ManageScreen fund={{ ...mockFund, positionsSummary: undefined }} panel={() => null} />,
    );
    expect(screen.getByText("Positions are not available right now.")).toBeInTheDocument();
  });
  it("[R8] keyboard selection focuses the inline panel heading and Escape returns to its selector", async () => {
    renderWithProviders(
      <ManageScreen
        fund={mockFund}
        panel={(position, active) => <DraftPanel position={position} active={active} />}
      />,
    );
    const selector = document.querySelector<HTMLElement>("[data-manage-list-position]");
    if (!selector) throw new Error("missing selector");
    selector.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Manage test block" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(selector).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Manage test block" })).toHaveFocus();
  });
});
