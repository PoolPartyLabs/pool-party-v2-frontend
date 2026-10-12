/**
 * @id PP-MGR-CMP-039
 * @name LimitsStep.stories
 * @implements-rules-version v2 (POO-2142 rules v2, POO-2197 rules v2)
 * @implements-rules-version v1 (POO-2332)
 *
 * Storybook coverage for Mandate step 5 (POO-2126 [R6] / [R39] to [R43]).
 *
 * The story that earns its place is `Unset` against `Figma`: the difference between "no cap record
 * yet" and "capped at 0%" is the one thing a static mock-up cannot show, and it is what decides
 * whether Next moves (`validateStep("limits")` refuses the first row with no record). `Blocked` is
 * the second: the notice alone does not say WHICH of twelve rows is missing, so the ring is the
 * message.
 *
 * POO-2332 changes `Unset`: in mock mode a row with no record shows its start value (R8), so the
 * token rows read 0% with the warning border (R12) and the other rows read "No cap". `Mixed` shows
 * the "All tokens" row (R9), `AllTokens` the "Every token" row and the warning (R10), and
 * `ZeroCapBlocked` the 2 blinks on the row Next points at (R13).
 *
 * The drafts are seeded DIRECTLY rather than through `withNetworks` / `withProtocols`, because the
 * Limits step has to render a row for whatever the draft carries. The Figma frame also shows Base;
 * the mandate no longer offers Base (rules v2, POO-2142), so the drafts here leave it out.
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
  setTokenMode,
  tokenKey,
} from "../mandateDraft";
import { LimitsStep } from "./LimitsStep";

const catalog = buildMandateCatalog();

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
    networks: ["arbitrum", "robinhood"],
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

/** The Figma frame minus Base (POO-2142): Robinhood 40%, Aave v3 60%, Uniswap v3 35%, v4 No cap. */
export const Figma: Story = {
  render: () => <Harness catalog={catalog} initial={selections(FIGMA_CAPS)} />,
};

/**
 * Nothing answered. POO-2332 R8: network and protocol rows start at "No cap", token rows at 0% with
 * the warning border (R12), and Next would refuse on the first token row.
 */
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

/** POO-2197 R1/R2: drag any 95% slider to 100% to select No cap, then untick to restore 95%. */
export const HundredSelectsNoCap: Story = {
  render: () => (
    <Harness
      catalog={catalog}
      initial={selections({
        ...FIGMA_CAPS,
        networks: { ...FIGMA_CAPS.networks, robinhood: { noCap: false, pct: 95 } },
        protocols: { ...FIGMA_CAPS.protocols, "aave-v3": { noCap: false, pct: 95 } },
        tokens: { ...FIGMA_CAPS.tokens, [tokenKey(WETH)]: { noCap: false, pct: 95 } },
      })}
    />
  ),
};

/** POO-2197 R3: USDC alone needs another token, with guidance that names Tokens. */
export const AnotherTokenRequired: Story = {
  render: () => (
    <Harness
      catalog={catalog}
      initial={createEmptyDraft("2026-10-03", "story")}
      block={{ step: "limits", reason: "token_allowance_required", rowId: null }}
    />
  ),
};

/**
 * POO-2332 R9: two capped tokens with different caps (WETH 25%, WBTC 10%), so the "All tokens" row
 * reads "Mixed". One drag sets all. No cap on "All tokens", then off again, gives each token its own
 * cap back.
 */
export const Mixed: Story = {
  render: () => (
    <Harness
      catalog={catalog}
      initial={selections({
        ...FIGMA_CAPS,
        tokens: {
          [tokenKey(WETH)]: { noCap: false, pct: 25 },
          [tokenKey(WBTC)]: { noCap: false, pct: 10 },
        },
      })}
    />
  ),
};

/**
 * POO-2332 R10: All tokens mode. One "Every token" row sets the default cap, and the warning shows
 * the "All tokens" tag that depositors see. The default starts at 0%, so the row has the warning
 * border until the cap is above 0% (R12).
 */
export const AllTokens: Story = {
  render: () => <Harness catalog={catalog} initial={setTokenMode(selections(FIGMA_CAPS), "all")} />,
};

/** POO-2332 R12 and R13: Next refused on a token cap at 0%. The row has the border and blinks 2 times. */
export const ZeroCapBlocked: Story = {
  render: () => (
    <Harness
      catalog={catalog}
      initial={selections({
        ...FIGMA_CAPS,
        tokens: { ...FIGMA_CAPS.tokens, [tokenKey(WETH)]: { noCap: false, pct: 0 } },
      })}
      block={{ step: "limits", reason: "cap_zero", rowId: tokenKey(WETH) }}
    />
  ),
};
