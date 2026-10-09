/**
 * @id PP-MGR-SCR-002
 * @name Shared Build local Manage integration regressions
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, test assertions over bounded local host outcomes.
 */
import { useCallback, useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { BuildScreen } from "../build/BuildScreen";
import type { BuildPlan } from "../build/plan/buildPlan";
import { isBlocked, type MandateDraft, withNetworks, withProtocols } from "../mandateDraft";
import type { UseMandateDraftResult } from "../useMandateDraft";
import {
  buildSolanaBuilderCatalog,
  createSolanaBuilderDraft,
  SOLANA_LOCAL_CONFIGS,
} from "./solanaBuilderRuntime";

vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: vi.fn() }) }));
vi.mock("../build/graph/BuildGraph", () => ({
  BuildGraph: ({
    selectedId,
    onTarget,
  }: {
    selectedId: string | null;
    onTarget(target: { kind: "block"; blockId: string }): void;
  }) => (
    <div data-testid="shared-graph">
      <output>{selectedId}</output>
      <button type="button" onClick={() => onTarget({ kind: "block", blockId: "a" })}>
        Card A
      </button>
      <button type="button" onClick={() => onTarget({ kind: "block", blockId: "b" })}>
        Card B
      </button>
    </div>
  ),
}));
vi.mock("../build/canvas/CanvasViewport", () => ({
  CanvasViewport: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const catalog = buildSolanaBuilderCatalog();
const start = withProtocols(
  withNetworks(createSolanaBuilderDraft("now", "local"), ["solana"], catalog),
  ["kamino"],
);
const plan: BuildPlan = {
  version: 1,
  hub: { chains: [] },
  spokes: [
    {
      network: "solana",
      sharePct: 60,
      chains: ["a", "b"].map((id) => ({
        id: `chain-${id}`,
        sharePct: 30,
        steps: [
          {
            id,
            family: "position",
            kind: "solanaKaminoSupply",
            config: SOLANA_LOCAL_CONFIGS.solanaKaminoSupply ?? null,
          },
        ],
      })),
    },
  ],
};

function Harness({ onBack = () => {} }: { onBack?(): void }) {
  const [draft, setDraft] = useState<MandateDraft>({ ...start, plan });
  const current = useRef(draft);
  current.current = draft;
  const update = useCallback<UseMandateDraftResult["update"]>((fn) => {
    const next = fn(current.current);
    if (isBlocked(next)) return;
    current.current = next;
    setDraft(next);
  }, []);
  return (
    <>
      <BuildScreen
        draft={draft}
        catalog={catalog}
        update={update}
        initialSelectedId="a"
        onBackToMandate={onBack}
        onEditMandate={() => {}}
      />
      <output data-testid="plan">{JSON.stringify(draft.plan)}</output>
    </>
  );
}

async function setAllocation(value: string) {
  const input = screen.getByRole("textbox", { name: "Allocation (%)" });
  await userEvent.clear(input);
  await userEvent.type(input, value);
}

// @rule POO-2301 R1/R5/R8: delivered Manage is reachable in the shared Build panel.
it("retains independent local Manage drafts and Review across shared card selection and hiding", async () => {
  renderWithProviders(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Manage block" }));
  expect(document.querySelectorAll("[data-solana-local-manage-host]")).toHaveLength(1);
  expect(screen.getAllByTestId("shared-graph")).toHaveLength(1);
  await setAllocation("40");
  await userEvent.click(screen.getByRole("button", { name: "Apply now" }));
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
  await userEvent.click(screen.getByRole("button", { name: "Card B" }));
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("30");
  await setAllocation("45");
  await userEvent.click(screen.getByRole("button", { name: "Configure block" }));
  expect(screen.queryByRole("button", { name: "Confirm changes" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Manage block" }));
  await userEvent.click(screen.getByRole("button", { name: "Card A" }));
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("40");
  expect(screen.getByRole("button", { name: "Confirm changes" })).toBeDisabled();
  expect(
    within(screen.getByRole("region", { name: "Current" })).getByText("Not available"),
  ).toBeVisible();
});

// @rule POO-2301 R5/R8: Configure guard resolves changes before switching to local Manage.
it("protects pending Configure Apply before opening local Manage", async () => {
  renderWithProviders(<Harness />);
  screen.getByRole("slider").focus();
  await userEvent.keyboard("{ArrowLeft}");
  await userEvent.click(screen.getByRole("button", { name: "Manage block" }));
  expect(screen.queryByRole("textbox", { name: "Allocation (%)" })).toBeNull();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("30");
});

// @rule POO-2301 R5/R8: Apply acknowledgement is through the current shared plan, never live execution.
it("applies local Manage to the shared plan and does not silently drop it on phase leave", async () => {
  const back = vi.fn();
  renderWithProviders(<Harness onBack={back} />);
  await userEvent.click(screen.getByRole("button", { name: "Manage block" }));
  await setAllocation("40");
  await userEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(screen.getByTestId("plan")).toHaveTextContent('"sharePct":70');
  expect(screen.getByText("Changes applied to this preview.")).toBeVisible();
  await setAllocation("45");
  await userEvent.click(screen.getByRole("button", { name: "Back: Mandate" }));
  expect(back).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Keep editing" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Discard and continue" }));
  expect(back).toHaveBeenCalledTimes(1);
});
