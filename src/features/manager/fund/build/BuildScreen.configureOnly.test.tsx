/**
 * @id PP-MGR-SCR-002
 * @name BuildScreen creation tests: Configure only
 * @implements-rules-version v2 (POO-2342 rules v2: one builder, Configure only during creation)
 * @analytics-events none, test assertions over the creation panel.
 *
 * R12: during the creation of a fund, Build shows the Configure panel only, on every network. It has
 * no Configure and Manage toggle and no Manage panel. Manage exists only after the launch.
 */
import { useCallback, useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../../../tests/utils/renderWithProviders";
import {
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  withNetworks,
  withProtocols,
} from "../mandateDraft";
import {
  buildSolanaBuilderCatalog,
  SOLANA_LOCAL_CONFIGS,
} from "../solana-preview/solanaBuilderRuntime";
import type { UseMandateDraftResult } from "../useMandateDraft";
import { BuildScreen } from "./BuildScreen";
import type { BuildPlan } from "./plan/buildPlan";

vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: vi.fn() }) }));
vi.mock("./graph/BuildGraph", () => ({
  BuildGraph: () => <div data-testid="shared-graph" />,
}));
vi.mock("./canvas/CanvasViewport", () => ({
  CanvasViewport: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const catalog = buildSolanaBuilderCatalog();
const start = withProtocols(withNetworks(createEmptyDraft("now", "d-r12"), ["solana"], catalog), [
  "kamino",
]);
const plan: BuildPlan = {
  version: 1,
  hub: { chains: [] },
  spokes: [
    {
      network: "solana",
      sharePct: 30,
      chains: [
        {
          id: "chain-a",
          sharePct: 30,
          steps: [
            {
              id: "a",
              family: "position",
              kind: "solanaKaminoSupply",
              config: SOLANA_LOCAL_CONFIGS.solanaKaminoSupply ?? null,
            },
          ],
        },
      ],
    },
  ],
};

function Harness() {
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
    <BuildScreen
      draft={draft}
      catalog={catalog}
      update={update}
      initialSelectedId="a"
      onBackToMandate={() => {}}
      onEditMandate={() => {}}
    />
  );
}

// @rule R12
it("[R12] shows no Manage control and no Manage panel for a V2 draft with Solana in Build", () => {
  renderWithProviders(<Harness />);
  expect(screen.getByTestId("shared-graph")).toBeInTheDocument();
  // The Configure panel of the selected block is on screen.
  expect(screen.getAllByRole("slider").length).toBeGreaterThan(0);
  // No toggle: neither the Manage button nor a pressed-state Configure button.
  expect(screen.queryByRole("button", { name: /^Manage/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^(Configure|Manage)( block)?$/ })).toBeNull();
  // No Manage panel and no Manage host.
  expect(document.querySelector("[data-solana-manage-host]")).toBeNull();
  expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Apply now" })).toBeNull();
});
