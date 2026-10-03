/**
 * @id PP-MGR-CMP-039
 * @name LimitsStep.stories
 * @implements-rules-version v1
 *
 * Storybook coverage for Mandate step 5 (POO-2126 [R6] / [R39] to [R43]).
 *
 * The story that earns its place is `Unset` against `Figma`: the difference between "no cap record
 * yet" and "capped at 0%" is the one thing a static mock-up cannot show, and it is what decides
 * whether Next moves (`validateStep("limits")` refuses the first row with no record). `Blocked` is
 * the second: the notice alone does not say WHICH of twelve rows is missing, so the ring is the
 * message.
 *
 * The drafts are seeded DIRECTLY rather than through `withNetworks` / `withProtocols`, because the
 * Figma frame shows Base and the catalog marks it "Coming soon"; the reducer would drop it, and the
 * Limits step still has to render a row for whatever the draft carries.
 *
 * PP-NOTE: Storybook's `stories` glob is `src/features/<area>/components/<file>`, so a story under
 * `steps/` is not loaded today (same note as `NetworksStep.stories.tsx` and
 * `ProtocolsStep.stories.tsx`). Reported to the epic coordinator; the story is written where it
 * belongs rather than moved into the shared-components folder to dodge the glob.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { buildMandateCatalog, type MandateCatalog } from "../mandateCatalog";
import {
  createEmptyDraft,
  isBlocked,
  type MandateCaps,
  type MandateDraft,
  type MandateTokenRef,
  type StepBlock,
  tokenKey,
} from "../mandateDraft";
import { LimitsStep } from "./LimitsStep";

const catalog = buildMandateCatalog({ robinhoodChain: true });

/** The two unlocked tokens the Figma frame shows, as the draft stores them. */
const WETH: MandateTokenRef = {
  address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  symbol: "WETH",
  name: "Ether",
  network: "arbitrum",
  logoUrl: null,
  locked: false,
};
const WBTC: MandateTokenRef = {
  address: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f",
  symbol: "WBTC",
  name: "Wrapped Bitcoin",
  network: "arbitrum",
  logoUrl: null,
  locked: false,
};

/** The selections the Figma frame was drawn from, minus the caps. */
function selections(caps: MandateCaps): MandateDraft {
  const base = createEmptyDraft("2026-10-03T00:00:00.000Z", "story");
  return {
    ...base,
    networks: ["arbitrum", "robinhood", "base"],
    protocols: ["uniswap-v3-swap", "across", "aave-v3", "uniswap-v3", "uniswap-v4"],
    tokens: [...base.tokens, WETH, WBTC],
    caps,
  };
}

/** Exactly the caps printed in the Figma frame. */
const FIGMA_CAPS: MandateCaps = {
  networks: {
    arbitrum: { noCap: true, pct: 0 },
    robinhood: { noCap: false, pct: 40 },
    base: { noCap: true, pct: 0 },
  },
  protocols: {
    "aave-v3": { noCap: false, pct: 60 },
    "uniswap-v3": { noCap: false, pct: 35 },
    "uniswap-v4": { noCap: true, pct: 0 },
  },
  tokens: {
    [tokenKey(WETH)]: { noCap: false, pct: 60 },
    [tokenKey(WBTC)]: { noCap: true, pct: 0 },
  },
};

/** Nothing answered yet: the hub's implicit no-cap is the only record a new draft carries. */
const UNSET_CAPS: MandateCaps = {
  networks: { arbitrum: { noCap: true, pct: 0 } },
  protocols: {},
  tokens: {},
};

/** Closes the controlled-component loop: reducers in, new draft out, refusals surfaced as `block`. */
function Harness({
  catalog: cat,
  initial,
  block: initialBlock = null,
}: {
  catalog: MandateCatalog;
  initial: MandateDraft;
  block?: StepBlock | null;
}) {
  const [draft, setDraft] = useState(initial);
  const [block, setBlock] = useState<StepBlock | null>(initialBlock);

  return (
    <div style={{ maxWidth: 820 }}>
      <LimitsStep
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
  title: "Manager/LimitsStep",
  component: LimitsStep,
  // The step is controlled, so every story renders the harness instead of these args; they are here
  // because `Meta<typeof LimitsStep>` requires the component's own required props to be satisfied.
  args: {
    draft: selections(FIGMA_CAPS),
    catalog,
    update: () => {},
    block: null,
    onBlocked: () => {},
  },
  parameters: {
    docs: {
      description: {
        component:
          "Mandate step 5. Three groups fed by capRows: spoke networks, chosen protocols minus the required two, and tokens minus the deposit row. Every row is a 5% slider with a No cap checkbox that hides it; the hub is locked, because its cap is the remainder rather than a number. Per protocol and per token caps are frontend-only today and no copy here calls them an on-chain guarantee.",
      },
    },
  },
} satisfies Meta<typeof LimitsStep>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The Figma frame: Robinhood 40%, Base No cap, Aave v3 60%, Uniswap v3 35%, v4 No cap, WETH 60%. */
export const Figma: Story = {
  render: () => <Harness catalog={catalog} initial={selections(FIGMA_CAPS)} />,
};

/** Nothing answered: every row reads "Not set" with its slider at rest, and Next would refuse. */
export const Unset: Story = {
  render: () => <Harness catalog={catalog} initial={selections(UNSET_CAPS)} />,
};

/** The hub alone: no spoke, no extra protocol, no token beyond the deposit row (R43). */
export const EveryGroupEmpty: Story = {
  render: () => (
    <Harness catalog={catalog} initial={createEmptyDraft("2026-10-03T00:00:00.000Z", "story")} />
  ),
};

/** R6: Next refused on the first row with no cap. The notice names the rule, the ring names the row. */
export const Blocked: Story = {
  render: () => (
    <Harness
      catalog={catalog}
      initial={selections(UNSET_CAPS)}
      block={{ step: "limits", reason: "cap_missing", rowId: "robinhood" }}
    />
  ),
};
