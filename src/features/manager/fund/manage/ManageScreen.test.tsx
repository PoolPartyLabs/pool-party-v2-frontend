/**
 * @id PP-MGR-SCR-004
 * @name ManageScreen tests
 * @implements-rules-version v2 (POO-2274); v1 (POO-2226)
 * @analytics-events none, controlled screen tests.
 */
import { type AnchorHTMLAttributes, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUsdcAddress, supportedChainMetas } from "@/lib/chains/config";
import { mockFund } from "@/mocks/data/v2Funds";
import {
  cleanup,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { ManageScreen } from "./ManageScreen";
import { layoutManageGraph } from "./manageLayout";
import type { ManagePosition } from "./manageModel";
import { normalizeManageModel } from "./manageModel";
import type { ManageInspectableNode } from "./manageSelection";

vi.mock("@/i18n/navigation", () => ({
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
vi.mock("@/lib/analytics/useTrackView", () => ({ useTrackView: vi.fn() }));
// jsdom lacks the browser measurement APIs used by the production React Flow host.
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22 = 1;
    },
  );
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  vi.unstubAllGlobals();
});
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
  // @rule R4, R5 (POO-2309): inline operation/draft ownership survives Charts navigation.
  it("keeps the selected panel active and its draft and viewport mounted across Charts", async () => {
    const owners = vi.fn();
    const arbitrum = supportedChainMetas.find((chain) => chain.apiNetworkId === "arbitrum");
    if (!arbitrum || !mockFund.positionsSummary) throw new Error("Missing chart fixture");
    const fund = {
      ...mockFund,
      positionsSummary: {
        ...mockFund.positionsSummary,
        positions: mockFund.positionsSummary.positions.map((position) =>
          position.adapterKind === "uniswap-v4"
            ? {
                ...position,
                chainId: "42161",
                tokens: position.tokens.map((token, index) => ({
                  ...token,
                  address: index === 0 ? getUsdcAddress(42161) : arbitrum.wrappedNative,
                })),
              }
            : position,
        ),
      },
    };
    renderWithProviders(
      <ManageScreen
        fund={fund}
        panel={(position, active) => {
          owners(position?.id, active);
          return <DraftPanel position={position} active={active} />;
        }}
      />,
    );
    const selector = document.querySelectorAll<HTMLElement>("[data-manage-list-position]")[1];
    await userEvent.click(selector as HTMLElement);
    const input = screen.getByRole("textbox", { name: "Uniswap v4 draft" });
    await userEvent.type(input, "pending operation");
    const viewport = document.querySelector(".react-flow__viewport");
    const transform = viewport?.getAttribute("style");
    const calls = owners.mock.calls.length;
    await userEvent.click(screen.getByRole("tab", { name: "Charts" }));
    expect(screen.getByText("ETH / USDC · Binance")).toBeInTheDocument();
    expect(input).toHaveValue("pending operation");
    expect(selector).toHaveAttribute("aria-pressed", "true");
    expect(owners.mock.calls).toHaveLength(calls);
    expect(document.querySelector(".react-flow__viewport")).toBe(viewport);
    expect(viewport?.getAttribute("style")).toBe(transform);
    await userEvent.click(screen.getByRole("tab", { name: "Strategy flow" }));
    expect(screen.getByRole("textbox", { name: "Uniswap v4 draft" })).toBe(input);
    expect(owners.mock.calls).toHaveLength(calls);
    expect(viewport?.getAttribute("style")).toBe(transform);
  });

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

// POO-2274: selection is navigation across all real nodes, not a position operation.
it("lists every actual node by canonical identity and network topology", () => {
  const model = normalizeManageModel(mockFund);
  const nodes = layoutManageGraph(model).nodes.filter((node) => node.kind !== "group");
  renderWithProviders(<ManageScreen fund={mockFund} panel={() => null} />);
  const selectors = [...document.querySelectorAll<HTMLElement>("[data-manage-list-node]")];
  expect(new Set(selectors.map((item) => item.dataset.manageListNode))).toEqual(
    new Set(nodes.map((node) => node.id)),
  );
  const hub = document.querySelector<HTMLElement>(`[data-manage-network="${model.hubChainId}"]`);
  const hubIds = [...(hub?.querySelectorAll<HTMLElement>("[data-manage-list-node]") ?? [])].map(
    (item) => item.dataset.manageListNode,
  );
  expect(hubIds.slice(0, 3)).toEqual([
    "deposit",
    `idle:${model.hubChainId}`,
    `cash:${model.hubChainId}`,
  ]);
  expect(hubIds.slice(-3)).toEqual(["withdrawal", "income", "withdraw"]);
});

it("keeps an LP draft while cash is inspected and Back restores selection and live focus", async () => {
  renderWithProviders(
    <ManageScreen
      fund={mockFund}
      panel={(position, active) => <DraftPanel position={position} active={active} />}
    />,
  );
  const list = document.querySelectorAll<HTMLElement>("[data-manage-list-position]");
  const lp = list[1] as HTMLElement;
  await userEvent.click(lp);
  await userEvent.type(screen.getByRole("textbox", { name: "Uniswap v4 draft" }), "retained");
  const cash = document.querySelector<HTMLElement>("[data-manage-list-node='cash:42161']");
  expect(cash).not.toBeNull();
  await userEvent.click(cash as HTMLElement);
  expect(screen.queryByRole("textbox", { name: "Uniswap v4 draft" })).not.toBeInTheDocument();
  expect(
    document.querySelector('[data-manage-node="cash:42161"] [aria-pressed="true"]'),
  ).not.toBeNull();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Back to blocks" }));
  expect(screen.getByRole("textbox", { name: "Uniswap v4 draft" })).toHaveValue("retained");
  expect(lp).toHaveFocus();
});

it("Escape from an inspector restores a previous position and only emits bounded navigation", async () => {
  window.dataLayer = [];
  renderWithProviders(
    <ManageScreen
      fund={mockFund}
      panel={(position, active) => <DraftPanel position={position} active={active} />}
    />,
  );
  const lp = document.querySelectorAll<HTMLElement>(
    "[data-manage-list-position]",
  )[1] as HTMLElement;
  await userEvent.click(lp);
  const idle = document.querySelector<HTMLElement>("[data-manage-list-node='withdrawal']");
  expect(idle).not.toBeNull();
  (idle as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("heading", { name: "Manage block" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(lp).toHaveAttribute("aria-pressed", "true");
  expect(lp).toHaveFocus();
  expect(window.dataLayer).toContainEqual(
    expect.objectContaining({
      event: "strategy_block_selected",
      family: "v2",
      surface: "manager",
      node_kind: "idleOutput",
      chain_id: 42161,
    }),
  );
  const events = window.dataLayer.filter((item) => item.event === "strategy_block_selected");
  expect(events.some((item) => JSON.stringify(item).includes(mockFund.coreVault))).toBe(false);
  expect(window.dataLayer.some((item) => String(item.event).endsWith("_completed"))).toBe(false);
});

it("a disappeared prior origin returns safely to blocks and does not retain a detached selector", async () => {
  const view = renderWithProviders(
    <ManageScreen
      fund={mockFund}
      panel={(position, active) => <DraftPanel position={position} active={active} />}
    />,
  );
  const lp = document.querySelectorAll<HTMLElement>(
    "[data-manage-list-position]",
  )[1] as HTMLElement;
  await userEvent.click(lp);
  const cash = document.querySelector<HTMLElement>("[data-manage-list-node='cash:42161']");
  expect(cash).not.toBeNull();
  await userEvent.click(cash as HTMLElement);
  view.rerender(
    <ManageScreen
      fund={{ ...mockFund, positionsSummary: { protocolVersion: "v2", positions: [] } }}
      panel={(position, active) => <DraftPanel position={position} active={active} />}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Back to blocks" }));
  expect(screen.getByText("No selection")).toBeVisible();
  expect(lp.isConnected).toBe(false);
  expect(screen.getByRole("heading", { name: "Strategy blocks" })).toHaveFocus();
});

it("a position-owned flow keeps only its exact origin panel active and retains that draft", async () => {
  const states: Array<{
    position: ManagePosition | null;
    active: boolean;
    inspection?: ManageInspectableNode | null;
  }> = [];
  renderWithProviders(
    <ManageScreen
      fund={mockFund}
      panel={(position, active, inspection) => {
        states.push({ position, active, inspection });
        return <DraftPanel position={position} active={active} />;
      }}
    />,
  );
  const model = normalizeManageModel(mockFund);
  const lp = model.positions.find((position) => position.kind === "liquidity");
  if (!lp) throw new Error("missing liquidity origin");
  await userEvent.click(
    document.querySelector(`[data-manage-list-position="${lp.id}"]`) as HTMLElement,
  );
  await userEvent.type(screen.getByRole("textbox", { name: "Uniswap v4 draft" }), "owned");
  states.length = 0;
  await userEvent.click(
    document.querySelector(`[data-manage-list-node="collect:${lp.id}"]`) as HTMLElement,
  );
  expect(screen.getByRole("textbox", { name: "Uniswap v4 draft" })).toHaveValue("owned");
  const active = states.filter((state) => state.position && state.active);
  expect(active).toHaveLength(1);
  expect(active[0]?.position?.id).toBe(lp.id);
  expect(active[0]?.inspection?.kind).toBe("collectFees");
  expect(active[0]?.inspection?.position?.id).toBe(lp.id);
});

it("history cannot resurrect an origin after removal and reappearance", async () => {
  const renderPanel = (position: ManagePosition | null, active: boolean) => (
    <DraftPanel position={position} active={active} />
  );
  const view = renderWithProviders(<ManageScreen fund={mockFund} panel={renderPanel} />);
  await userEvent.click(
    document.querySelectorAll<HTMLElement>("[data-manage-list-position]")[1] as HTMLElement,
  );
  await userEvent.click(
    document.querySelector("[data-manage-list-node='cash:42161']") as HTMLElement,
  );
  view.rerender(
    <ManageScreen
      fund={{ ...mockFund, positionsSummary: { protocolVersion: "v2", positions: [] } }}
      panel={renderPanel}
    />,
  );
  view.rerender(<ManageScreen fund={mockFund} panel={renderPanel} />);
  await userEvent.click(screen.getByRole("button", { name: "Back to blocks" }));
  expect(screen.getByText("No selection")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Strategy blocks" })).toHaveFocus();
});

it("a core change clears inspection history even when structural IDs survive", async () => {
  const renderPanel = (position: ManagePosition | null, active: boolean) => (
    <DraftPanel position={position} active={active} />
  );
  const view = renderWithProviders(<ManageScreen fund={mockFund} panel={renderPanel} />);
  await userEvent.click(
    document.querySelectorAll<HTMLElement>("[data-manage-list-position]")[1] as HTMLElement,
  );
  await userEvent.click(
    document.querySelector("[data-manage-list-node='cash:42161']") as HTMLElement,
  );
  view.rerender(
    <ManageScreen
      fund={{ ...mockFund, coreVault: "0x0000000000000000000000000000000000000042" }}
      panel={renderPanel}
    />,
  );
  expect(screen.getByText("No selection")).toBeVisible();
  expect(document.querySelector('[data-manage-list-node="cash:42161"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});
