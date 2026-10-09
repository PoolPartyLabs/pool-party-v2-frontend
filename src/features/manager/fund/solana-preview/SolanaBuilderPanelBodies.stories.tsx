/**
 * @id PP-MGR-CMP-101
 * @name SolanaBuilderPanelBodies.stories
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, isolated local panel states.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { PanelHarness } from "../build/panel/panelTestKit";
import type { BlockKind, BuildPlan } from "../build/plan/buildPlan";
import { addToken, withNetworks, withProtocols } from "../mandateDraft";
import { LOCAL_PANEL_BODIES } from "./SolanaBuilderPanelBodies";
import {
  buildSolanaBuilderCatalog,
  createSolanaBuilderDraft,
  SOLANA_LOCAL_CONFIGS,
} from "./solanaBuilderRuntime";

const catalog = buildSolanaBuilderCatalog();
const networks = withNetworks(
  createSolanaBuilderDraft("2026-10-08T00:00:00Z", "local-panel-story"),
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
    bodies: LOCAL_PANEL_BODIES,
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
