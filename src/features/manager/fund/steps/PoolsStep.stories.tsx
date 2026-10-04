/**
 * @id PP-MGR-CMP-038
 * @name PoolsStep.stories
 * @implements-rules-version v3 (POO-2142 rules v2, POO-2167 rules v3)
 *
 * Storybook coverage for Mandate step 4 (POO-2125 [R29] to [R38]).
 *
 * The story that earns its place is `AllSelectedBroadMandate`. The Broad-mandate flag (R13) needs
 * two facts at once, every priced token AND every pool, and the state is almost impossible to reach
 * by clicking: it takes a mandate with nothing left to add on either step. Side by side with
 * `AllSelected`, which has every pool but not every token and raises nothing, it is the only way to
 * see that the flag is about both halves rather than about a long list.
 *
 * `Default` is the universe load every manager meets first, and the fixtures include two hooked pools
 * so the disabled row (R38) and its refusal are reachable without an API. Those two are also why the
 * flag is reachable at all: a pool nobody can add is not part of "every pool", so the universe counts
 * only what this mandate could hold. Counting the hooked rows put the state permanently out of reach.
 *
 * The network select on `HubAndSpoke` is display only. Filtering to one network narrows the rows, the
 * tab counts and the results head, and leaves the universe alone, so adding every pool of one
 * network does not raise the flag for a mandate that holds none of the other's.
 *
 * Every story is live: the harness holds the draft and runs the real reducers, so adding, removing,
 * "Add all", "Show more" and "Clear all" behave as they will in the builder. The pools themselves
 * come from the real adapter running in mock mode, latency and rare failure included, so the loading
 * state and the error state are both reachable here by waiting and by reloading.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { buildMandateCatalog, type MandateCatalog } from "../mandateCatalog";
import {
  addToken,
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  REQUIRED_PROTOCOLS,
  type StepBlock,
  withNetworks,
  withProtocols,
} from "../mandateDraft";
import { PoolsStep } from "./PoolsStep";

const catalog = buildMandateCatalog();

/** A mandate that can hold liquidity positions (Uniswap v4, R20 v3), so step 4 exists (R29). */
function draftOn(spokes: "robinhood"[] = []): MandateDraft {
  const base = withNetworks(createEmptyDraft("2026-10-03T00:00:00.000Z", "story"), spokes, catalog);
  return withProtocols(base, [...REQUIRED_PROTOCOLS, "uniswap-v4"]);
}

/** Every priced token the catalog offers, which is one of the two halves of the Broad flag (R13). */
function withEveryToken(draft: MandateDraft): MandateDraft {
  let next = draft;
  for (const token of catalog
    .tokensFor(draft.networks, draft.protocols)
    .filter((entry) => entry.priced)) {
    const result = addToken(next, token, catalog);
    if (!isBlocked(result)) next = result;
  }
  return next;
}

/** Closes the controlled-component loop: reducers in, new draft out, refusals surfaced as `block`. */
function Harness({ catalog: cat, initial }: { catalog: MandateCatalog; initial: MandateDraft }) {
  const [draft, setDraft] = useState(initial);
  const [block, setBlock] = useState<StepBlock | null>(null);

  return (
    <div style={{ maxWidth: 1120 }}>
      <PoolsStep
        draft={draft}
        catalog={cat}
        update={(fn) => {
          const next = fn(draft);
          if (isBlocked(next)) setBlock(next.blocked);
          else {
            setBlock(null);
            setDraft(next);
          }
        }}
        block={block}
        onBlocked={setBlock}
        onError={() => undefined}
      />
    </div>
  );
}

const meta = {
  title: "Manager/PoolsStep",
  component: PoolsStep,
  // The step is controlled, so every story renders the harness instead of these args; they are here
  // because `Meta<typeof PoolsStep>` requires the component's own required props to be satisfied.
  args: {
    draft: draftOn(),
    catalog,
    update: () => {},
    block: null,
    onBlocked: () => {},
  },
  parameters: {
    docs: {
      description: {
        component:
          "Mandate step 4. The list loads before anything is typed, because a mandate's pools are a closed set fixed at launch and the manager has to see what the choice is. Search by token, by pair or by pasting a pool address; a pool found on a network the mandate does not hold says so instead of reading as no match. A pool with a Uniswap v4 hook is listed and disabled, and clicking it still reports that someone wanted it.",
      },
    },
  },
} satisfies Meta<typeof PoolsStep>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The universe load: every pool holding a mandate token, five at a time. */
export const Default: Story = {
  render: () => <Harness catalog={catalog} initial={draftOn()} />,
};

/** Hub and spoke, with ETH and WBTC already chosen: more tokens, so a wider universe. */
export const HubAndSpoke: Story = {
  render: () => {
    let draft = draftOn(["robinhood"]);
    for (const symbol of ["ETH", "WBTC"]) {
      const entry = catalog
        .tokensFor(draft.networks, draft.protocols)
        .find((token) => token.symbol === symbol);
      if (!entry) continue;
      const result = addToken(draft, entry, catalog);
      if (!isBlocked(result)) draft = result;
    }
    return <Harness catalog={catalog} initial={draft} />;
  },
};

/**
 * Every priced token already in the mandate, one half of the Broad flag.
 *
 * Use "Add all" on this story to reach the other half: the results empty out, the all-selected
 * message replaces them, and the Broad-mandate notice appears under both cards (R13, R37).
 */
export const AllSelectedBroadMandate: Story = {
  render: () => <Harness catalog={catalog} initial={withEveryToken(draftOn())} />,
};

/** A mandate that has not passed step 2's DEX protocols: the step renders nothing at all (R29). */
export const NoDexProtocol: Story = {
  render: () => (
    <Harness catalog={catalog} initial={withProtocols(draftOn(), [...REQUIRED_PROTOCOLS])} />
  ),
};
