/**
 * @id PP-MGR-CMP-035
 * @name NetworksStep.stories
 * @implements-rules-version v2 (POO-2142 rules v2)
 *
 * Storybook coverage for Mandate step 1 (POO-2123 [R15] to [R17]; rules v2, POO-2142: the hub and
 * Robinhood Chain only, both always available).
 *
 * The step is a controlled component: it owns no draft, it hands reducers to `update`. The harness
 * below closes that loop with local state, so the canvas behaves like the real screen (ticking a
 * spoke really does re-render it selected) instead of being a frozen picture.

 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { buildMandateCatalog, type MandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  type NetworkId,
  type StepBlock,
  withNetworks,
} from "../mandateDraft";
import { NetworksStep } from "./NetworksStep";

/** A draft that already holds some spokes, so a story can open on a mid-flow state. */
function draftWith(catalog: MandateCatalog, networks: NetworkId[]): MandateDraft {
  return withNetworks(createEmptyDraft("2026-10-03T00:00:00.000Z", "story"), networks, catalog);
}

/** Closes the controlled-component loop: reducers in, new draft out, refusals surfaced as `block`. */
function Harness({ catalog, initial }: { catalog: MandateCatalog; initial: MandateDraft }) {
  const [draft, setDraft] = useState(initial);
  const [block, setBlock] = useState<StepBlock | null>(null);

  return (
    <div style={{ maxWidth: 820 }}>
      <NetworksStep
        draft={draft}
        catalog={catalog}
        update={(fn) => {
          const next = fn(draft);
          if (isBlocked(next)) setBlock(next.blocked);
          else setDraft(next);
        }}
        block={block}
        onBlocked={setBlock}
      />
    </div>
  );
}

const catalog = buildMandateCatalog();
// PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
// const withoutRobinhood = buildMandateCatalog({ robinhoodChain: false });

const meta = {
  title: "Manager/NetworksStep",
  component: NetworksStep,
  // The step is controlled, so every story renders the harness instead of these args; they are here
  // because `Meta<typeof NetworksStep>` requires the component's own required props to be satisfied.
  args: {
    draft: draftWith(catalog, []),
    catalog,
    update: () => {},
    block: null,
    onBlocked: () => {},
  },
  parameters: {
    docs: {
      description: {
        component:
          "Mandate step 1. The hub is locked and has no control at all; the spokes are the decision. A spoke the fund contracts cannot reach yet is disabled with a Coming soon pill and still takes the click, which the shell reports as a blocked intent.",
      },
    },
  },
} satisfies Meta<typeof NetworksStep>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A fresh mandate: the hub alone, one spoke selectable. */
export const HubOnly: Story = {
  render: () => <Harness catalog={catalog} initial={draftWith(catalog, [])} />,
};

/** Every available spoke chosen, so Select all reads ticked. */
export const EveryAvailableSpoke: Story = {
  render: () => <Harness catalog={catalog} initial={draftWith(catalog, ["robinhood"])} />,
};

// PP-NOTE: buildathon scope (2026-10-03, POO-2142): commented out, restore when the fund contracts reach it.
// /** The `robinhoodChain` flag off: all four spokes are Coming soon and Select all is not offered. */
// export const NothingAvailableYet: Story = {
//   render: () => <Harness catalog={withoutRobinhood} initial={draftWith(withoutRobinhood, [])} />,
// };
