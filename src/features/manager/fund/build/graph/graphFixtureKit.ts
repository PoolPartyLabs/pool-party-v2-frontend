/**
 * @id PP-MGR-CMP-059
 * @name graphFixtureKit
 * @implements-rules-version v1 (POO-2156 rules v1)
 * @analytics-events none, test and Storybook support: it reads fixtures and emits nothing.
 *
 * TEST AND STORY SUPPORT for {@link BuildGraph}: turns a reference canvas of
 * `src/mocks/data/buildCanvasFixtures.ts` (PP-MGR-MCK-004) into the props the renderer takes. In the
 * app those props come from the block registry (slice S5: `describeBlock`, `describeFlow`) and the
 * Build screen (slice S7); the fixtures carry what each card and pill prints as plain data, and this
 * kit maps that data onto the pieces' types. Nothing in the app imports this file.
 *
 * The copy is the English `manager` messages through next-intl's own translator, so a story or a
 * test shows the real strings with their placeholders filled, never a literal of its own. The token
 * of a Swap · auto tooltip is the network's stable (`networkStableSymbol`, D7), as in the app.
 */
import { createTranslator } from "next-intl";
import enManager from "@/i18n/messages/en/manager.json";
import { networkStableSymbol } from "@/lib/chains/config";
import type { BlockContentFixture, BuildCanvasFixture } from "@/mocks/data/buildCanvasFixtures";
import type { GraphLayout, LayoutStep } from "../layout/graphTypes";
import { layoutGraph } from "../layout/layoutGraph";
import type { BlockContent, BlockIcon, FlowContent } from "../pieces/pieceTypes";

/** The `fundBuilder.canvas` copy in English. */
export const fixtureT = createTranslator({
  locale: "en",
  messages: { manager: enManager },
  namespace: "manager.fundBuilder.canvas",
});

const NETWORK_NAMES: Readonly<Record<string, string>> = enManager.fundBuilder.networkNames;

/** The English name of a network, or its id when the copy has none. */
export function fixtureNetworkName(network: string): string {
  return NETWORK_NAMES[network] ?? network;
}

const ICONS: ReadonlySet<string> = new Set<BlockIcon>([
  "layers",
  "bank",
  "swap",
  "coins",
  "bridge",
  "depositIn",
  "withdrawOut",
  "hourglass",
]);

function iconOf(icon: string): BlockIcon {
  if (!ICONS.has(icon)) throw new Error(`fixture icon ${icon} is not a BlockIcon`);
  return icon as BlockIcon;
}

/** The props of {@link BuildGraph} a fixture provides (the rest is the caller's). */
export interface FixtureGraphProps {
  layout: GraphLayout;
  describeBlock(blockId: string): BlockContent;
  describeFlow(blockId: string): FlowContent;
  networkName(network: string): string;
  /** The block the fixture draws selected (Build state 3), or null. */
  selectedId: string | null;
}

export interface FixtureGraphOptions {
  /** The measured start-here sentence (English: 420). */
  startHereWidth?: number;
  /** Per block id, what to print instead of the fixture's content (an invalid or coming-soon card). */
  overrides?: Readonly<Record<string, Partial<BlockContentFixture>>>;
}

interface Located {
  step: LayoutStep;
  network: string;
  next: LayoutStep | undefined;
}

/** Every step of a fixture by id, with its network and the step under it. */
function locate(fixture: BuildCanvasFixture): Map<string, Located> {
  const out = new Map<string, Located>();
  const chains = [
    ...fixture.input.hub.chains.map((chain) => ({ chain, network: fixture.input.hubNetwork })),
    ...fixture.input.spokes.flatMap((spoke) =>
      spoke.chains.map((chain) => ({ chain, network: spoke.network })),
    ),
  ];
  for (const { chain, network } of chains) {
    chain.steps.forEach((step, index) => {
      out.set(step.id, { step, network, next: chain.steps[index + 1] });
    });
  }
  return out;
}

/** The renderer's props for a fixture: its layout and describers built from its content. */
export function fixtureGraphProps(
  fixture: BuildCanvasFixture,
  options: FixtureGraphOptions = {},
): FixtureGraphProps {
  const steps = locate(fixture);
  const contentOf = (blockId: string): BlockContentFixture => {
    const content = fixture.content[blockId];
    if (!content) throw new Error(`fixture has no content for ${blockId}`);
    return { ...content, ...options.overrides?.[blockId] };
  };

  const describeBlock = (blockId: string): BlockContent => {
    const content = contentOf(blockId);
    return {
      title: content.title,
      caption: content.caption,
      icon: iconOf(content.icon),
      state: content.state,
      // The renderer names the card's place (I10); this is what the registry would hand it.
      accessibleName: `${content.title}, ${content.caption}`,
      soonTag: content.state === "comingSoon" ? fixtureT("palette.soon") : undefined,
    };
  };

  const describeFlow = (blockId: string): FlowContent => {
    const content = contentOf(blockId);
    const located = steps.get(blockId);
    if (!located) throw new Error(`fixture has no step ${blockId}`);
    const { step, network, next } = located;
    const token = networkStableSymbol(network);
    let tooltip: string;
    if (step.kind === "collectFees") {
      tooltip = fixtureT("tooltip.collectFees");
    } else if (!step.auto) {
      tooltip = fixtureT("tooltip.swap");
    } else if (next?.kind === "aaveSupply") {
      // The fixture prints "Supply WETH": the asset is the title's last word.
      const asset = contentOf(next.id).title.split(" ").pop() ?? "";
      tooltip = fixtureT("tooltip.swapAutoSupply", { token, asset });
    } else {
      tooltip = fixtureT("tooltip.swapAuto", { token });
    }
    return { text: content.title, tooltip, icon: iconOf(content.icon) };
  };

  const selected = Object.entries(fixture.content).find(([, content]) => content.selected);
  return {
    layout: layoutGraph(fixture.input, { startHereWidth: options.startHereWidth ?? 420 }),
    describeBlock,
    describeFlow,
    networkName: fixtureNetworkName,
    selectedId: selected ? selected[0] : null,
  };
}
