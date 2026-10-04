/**
 * @id PP-MGR-CMP-036
 * @name ProtocolsStep.stories
 * @implements-rules-version v4 (POO-2142 rules v2, POO-2143 rules v2, POO-2167 rules v4)
 *
 * Storybook coverage for Mandate step 2 (POO-2123 [R19] to [R22]; rules v4, POO-2167: GMX and Pendle Coming soon;
 * Aave v3 and Uniswap v4 to operate, Uniswap v3 positions "Coming soon").
 *
 * The story that earns its place is `HubAndSpoke` against `HubOnly`: the "On" dots change with the
 * networks of step 1, which is the whole point of that column and the thing a static mock-up cannot
 * show. Aave v3 keeps one dot in both, because it runs on the hub only.

 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { buildMandateCatalog, type MandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  type NetworkId,
  type ProtocolId,
  type StepBlock,
  withNetworks,
  withProtocols,
} from "../mandateDraft";
import { ProtocolsStep } from "./ProtocolsStep";

const catalog = buildMandateCatalog();

/** A draft on the given networks, already holding the given protocols. */
function draftWith(networks: NetworkId[], protocols: ProtocolId[]): MandateDraft {
  const base = withNetworks(
    createEmptyDraft("2026-10-03T00:00:00.000Z", "story"),
    networks,
    catalog,
  );
  return withProtocols(base, [...base.protocols, ...protocols]);
}

/** Closes the controlled-component loop: reducers in, new draft out, refusals surfaced as `block`. */
function Harness({ catalog: cat, initial }: { catalog: MandateCatalog; initial: MandateDraft }) {
  const [draft, setDraft] = useState(initial);
  const [block, setBlock] = useState<StepBlock | null>(null);

  return (
    <div style={{ maxWidth: 820 }}>
      <ProtocolsStep
        draft={draft}
        catalog={cat}
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

const meta = {
  title: "Manager/ProtocolsStep",
  component: ProtocolsStep,
  // The step is controlled, so every story renders the harness instead of these args; they are here
  // because `Meta<typeof ProtocolsStep>` requires the component's own required props to be satisfied.
  args: {
    draft: draftWith([], []),
    catalog,
    update: () => {},
    block: null,
    onBlocked: () => {},
  },
  parameters: {
    docs: {
      description: {
        component:
          "Mandate step 2. The swap adapter and the bridge are locked above a divider; everything below is the choice. The On column shows only the networks of step 1 where a protocol actually runs, and a protocol that runs on none of them is disabled with Coming soon.",
      },
    },
  },
} satisfies Meta<typeof ProtocolsStep>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A hub-only mandate: every On column is a single Arbitrum dot. */
export const HubOnly: Story = {
  render: () => <Harness catalog={catalog} initial={draftWith([], [])} />,
};

/** Robinhood Chain added on step 1: the Uniswap rows gain a dot, Aave v3 does not. */
export const HubAndSpoke: Story = {
  render: () => <Harness catalog={catalog} initial={draftWith(["robinhood"], [])} />,
};

/** Everything selectable chosen, so Select all reads ticked. */
export const EverythingChosen: Story = {
  render: () => (
    <Harness catalog={catalog} initial={draftWith(["robinhood"], ["aave-v3", "uniswap-v4"])} />
  ),
};
