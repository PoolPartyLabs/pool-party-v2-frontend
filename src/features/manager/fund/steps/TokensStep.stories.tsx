/**
 * @id PP-MGR-CMP-037
 * @name TokensStep.stories
 * @implements-rules-version v1
 *
 * Storybook coverage for Mandate step 3 (POO-2124 [R23] to [R28]).
 *
 * The story that earns its place is `SlotsNearlyFull`. The slot rule is the one thing about this
 * screen a static mock-up cannot show: a token costs one slot per network it runs on, so on a
 * hub-and-spoke mandate with one slot left ARB is still addable and ETH is not, and the two Add
 * buttons sit side by side in the same grid looking almost identical. `Default` and `HubAndSpoke`
 * are the before-and-after of that same arithmetic with room to spare.
 *
 * Every story is live: the harness holds the draft, runs the real reducers, and surfaces a refusal
 * as the inline notice, so adding, removing, searching and "Add all" all behave as they will in the
 * builder rather than as a frozen snapshot.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { buildMandateCatalog, type MandateCatalog } from "../mandateCatalog";
import {
  addToken,
  createEmptyDraft,
  isBlocked,
  type MandateDraft,
  type MandateTokenRef,
  type NetworkId,
  type StepBlock,
  withNetworks,
} from "../mandateDraft";
import { TokensStep } from "./TokensStep";

const catalog = buildMandateCatalog({ robinhoodChain: true });

/** A draft on the hub plus the given spokes, with its locked deposit rows already in place. */
function draftOn(spokes: NetworkId[] = []): MandateDraft {
  return withNetworks(createEmptyDraft("2026-10-03T00:00:00.000Z", "story"), spokes, catalog);
}

/** Put a symbol in the draft through the real reducer, as the screen's own Add does. */
function withToken(draft: MandateDraft, symbol: string): MandateDraft {
  const entry = catalog
    .tokensFor(draft.networks, draft.protocols)
    .find((token) => token.symbol === symbol);
  if (!entry) return draft;
  const next = addToken(draft, entry, catalog);
  return isBlocked(next) ? draft : next;
}

/**
 * Obvious placeholders, so a draft can sit at an exact slot count.
 *
 * The static token lists carry 7 priced tokens on the hub and 1 on the spoke, which is not enough
 * entries to reach 15 of 16 with real data. These rows stand in for the longer mandate a real price
 * registry will allow, and they are named so nobody mistakes them for tokens the product ships.
 */
function standIns(count: number): MandateTokenRef[] {
  return Array.from({ length: count }, (_, index) => ({
    address: `0x${index.toString(16).padStart(40, "f")}`,
    symbol: `TKN${index + 1}`,
    name: `Stand-in token ${index + 1}`,
    network: "arbitrum" as NetworkId,
    logoUrl: null,
    locked: false,
  }));
}

/** Closes the controlled-component loop: reducers in, new draft out, refusals surfaced as `block`. */
function Harness({ catalog: cat, initial }: { catalog: MandateCatalog; initial: MandateDraft }) {
  const [draft, setDraft] = useState(initial);
  const [block, setBlock] = useState<StepBlock | null>(null);

  return (
    <div style={{ maxWidth: 1120 }}>
      <TokensStep
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
      />
    </div>
  );
}

const meta = {
  title: "Manager/TokensStep",
  component: TokensStep,
  // The step is controlled, so every story renders the harness instead of these args; they are here
  // because `Meta<typeof TokensStep>` requires the component's own required props to be satisfied.
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
          "Mandate step 3. The catalog on the left lists only the tokens the hub can price, with the rest reachable through the search; the card on the right is the mandate itself, with the deposit token locked and the slot counter under it. A token costs one slot on each network it runs on, so the Add of a token that would pass sixteen is disabled and reports the refusal instead of swallowing it.",
      },
    },
  },
} satisfies Meta<typeof TokensStep>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A fresh hub-only mandate: the deposit token alone, and the seven priced tokens of the hub. */
export const Default: Story = {
  render: () => <Harness catalog={catalog} initial={draftOn()} />,
};

/** Robinhood Chain added on step 1: a second deposit row (USDG), and ETH on both networks. */
export const HubAndSpoke: Story = {
  render: () => {
    const base = draftOn(["robinhood"]);
    return <Harness catalog={catalog} initial={withToken(withToken(base, "ETH"), "WBTC")} />;
  },
};

/** 15 of 16 slots: ARB costs one and is still addable, ETH costs two and is not. */
export const SlotsNearlyFull: Story = {
  render: () => {
    const base = draftOn(["robinhood"]);
    return (
      <Harness catalog={catalog} initial={{ ...base, tokens: [...base.tokens, ...standIns(13)] }} />
    );
  },
};

/** 16 of 16: every Add is disabled, and every click on one still reports the refusal. */
export const SlotsFull: Story = {
  render: () => {
    const base = draftOn(["robinhood"]);
    return (
      <Harness catalog={catalog} initial={{ ...base, tokens: [...base.tokens, ...standIns(14)] }} />
    );
  },
};

/** Every priced token already in the mandate, so the catalog has nothing left to offer. */
export const NothingLeftToAdd: Story = {
  render: () => {
    const base = ["ARB", "DAI", "ETH", "LINK", "USDT", "WBTC", "wstETH"].reduce(
      withToken,
      draftOn(),
    );
    return <Harness catalog={catalog} initial={base} />;
  },
};
