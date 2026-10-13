/**
 * @id PP-MGR-CMP-101
 * @name SolanaBuilderPanelBodies.stories
 * @implements-rules-version v1 (POO-2301) + POO-2342 rules v1 (one V2 builder, Solana is a network)
 * @analytics-events none, isolated local panel states.
 *
 * POO-2351 rules v1: R3 (Raydium pick rows), R4/R6 (Kamino token), R2 (empty Uniswap v4 with Solana).
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { PANEL_BODIES } from "../build/panel/panelBodies";
import { PanelHarness } from "../build/panel/panelTestKit";
import type { BlockKind, BuildPlan } from "../build/plan/buildPlan";
import { addToken, createEmptyDraft, withNetworks, withProtocols } from "../mandateDraft";
import { kaminoConfigFor } from "./kaminoToken";
import { SOLANA_PANEL_BODIES } from "./SolanaBuilderPanelBodies";
import { buildSolanaBuilderCatalog, SOLANA_LOCAL_CONFIGS } from "./solanaBuilderRuntime";

const catalog = buildSolanaBuilderCatalog();
const networks = withNetworks(
  createEmptyDraft("2026-10-08T00:00:00Z", "local-panel-story"),
  ["solana"],
  catalog,
);
const token = catalog.tokensFor(["solana"], networks.protocols)[0];
const withToken = token ? addToken(networks, token, catalog) : networks;
const draft = withProtocols("blocked" in withToken ? networks : withToken, [
  "kamino",
  "jupiter",
  "raydium",
  "orca",
]);

function localPlan(kind: Extract<BlockKind, `solana${string}`>, configured = true): BuildPlan {
  const liquidity = kind === "solanaOrcaPool" || kind === "solanaRaydiumPool";
  return {
    version: 1,
    hub: { chains: [] },
    spokes: [
      {
        network: "solana",
        sharePct: 20,
        chains: [
          {
            id: "local-chain",
            sharePct: 20,
            steps: [
              ...(liquidity
                ? [{ id: "auto", family: "flow" as const, kind: "swap" as const, auto: true }]
                : []),
              {
                id: "local-position",
                family: "position",
                kind,
                config: configured ? (SOLANA_LOCAL_CONFIGS[kind] ?? null) : null,
              },
              ...(liquidity && configured
                ? [
                    {
                      id: "fees",
                      family: "flow" as const,
                      kind: "collectFees" as const,
                      auto: false,
                    },
                  ]
                : []),
            ],
          },
        ],
      },
    ],
  };
}

const meta = {
  title: "Manager/Fund builder/Build panel/Solana local",
  component: PanelHarness,
  decorators: [withManagerMessages],
  parameters: { layout: "padded" },
  args: {
    draft,
    catalog,
    plan: localPlan("solanaOrcaPool"),
    selectedId: "local-position",
    bodies: SOLANA_PANEL_BODIES,
  },
} satisfies Meta<typeof PanelHarness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Orca: Story = {};
export const Raydium: Story = { args: { plan: localPlan("solanaRaydiumPool") } };
export const Kamino: Story = { args: { plan: localPlan("solanaKaminoSupply") } };
export const Holding: Story = { args: { plan: localPlan("solanaHolding") } };
export const DescriptorChoice: Story = { args: { plan: localPlan("solanaOrcaPool", false) } };
export const ChangesNotApplied: Story = { args: { scenario: { share: 15 } } };
export const RemoveConfirmation: Story = { args: { removeConfirmOpen: true } };

/** R4: the Kamino block that holds SOL. The token select reads SOL. */
export const KaminoSol: Story = {
  args: {
    plan: (() => {
      const plan = localPlan("solanaKaminoSupply");
      const step = plan.spokes[0]?.chains[0]?.steps.find((entry) => entry.family === "position");
      if (step && step.family === "position") step.config = kaminoConfigFor("SOL");
      return plan;
    })(),
  },
};
/** R3: an empty Raydium block shows the pool rows with two logos and the short address. */
export const RaydiumPick: Story = { args: { plan: localPlan("solanaRaydiumPool", false) } };
/** R4/R6: an empty Kamino block shows one row for each token, with no "Not available". */
export const KaminoPick: Story = { args: { plan: localPlan("solanaKaminoSupply", false) } };
/** R2: Uniswap v4 with no mandate pool on its network. The empty state links to the Pools step. */
export const UniswapV4EmptyWithSolana: Story = {
  args: {
    bodies: PANEL_BODIES,
    plan: {
      version: 1,
      hub: {
        chains: [
          {
            id: "evm",
            sharePct: 0,
            steps: [
              { id: "local-position", family: "position", kind: "uniswapV4Pool", config: null },
            ],
          },
        ],
      },
      spokes: [],
    },
  },
};
