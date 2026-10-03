/**
 * @id PP-MGR-CMP-044
 * @name MandateDraftsList.stories
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events none, a story file. The card emits its own open and delete events; a story that
 *   emitted them would put workbench noise in the GA4 series
 *
 * Storybook coverage for the Console's Drafts card (POO-2127 [D1]).
 *
 * The card reads the draft store directly, so each story SEEDS `localStorage` in a decorator rather
 * than passing props. That is deliberate rather than a workaround: it exercises the real read path
 * (and the real relative-time formatting against a real clock), which is where the states a reviewer
 * needs to judge actually come from.
 *
 * The three states to look at are empty, one and many. Empty is the one most likely to be wrong in
 * practice: the card must say why it is empty, because a manager who used Save & exit and then sees
 * a bare heading has no way to tell the drafts from a failure to load them.
 */
import type { Decorator, Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  createEmptyDraft,
  type MandateDraft,
  type MandateStepKey,
  REQUIRED_PROTOCOLS,
  withProtocols,
} from "../mandateDraft";
import { MANDATE_DRAFTS_KEY, MANDATE_DRAFTS_VERSION } from "../mandateDraftStore";
import { MandateDraftsList } from "./MandateDraftsList";

/** Minutes before now, as an ISO stamp, so "updated {when}" has something real to format. */
function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

/** A saved draft, parked on a step. */
function draft(
  id: string,
  name: string | null,
  lastStep: MandateStepKey,
  passed: MandateStepKey[],
  minutesAgo: number,
  withPools = false,
): MandateDraft {
  const base = createEmptyDraft(ago(minutesAgo + 60), id);
  const shaped = withPools ? withProtocols(base, [...REQUIRED_PROTOCOLS, "uniswap-v3"]) : base;
  return {
    ...shaped,
    name,
    lastStep,
    passedSteps: passed,
    savedAt: ago(minutesAgo),
    updatedAt: ago(minutesAgo),
  };
}

/** Put a given set of drafts in the store before the card reads it. */
function seeding(drafts: MandateDraft[]): Decorator {
  return (Story) => {
    const byId: Record<string, MandateDraft> = {};
    for (const entry of drafts) byId[entry.id] = entry;
    try {
      window.localStorage.setItem(
        MANDATE_DRAFTS_KEY,
        JSON.stringify({ version: MANDATE_DRAFTS_VERSION, drafts: byId }),
      );
    } catch {
      // A workbench with site data blocked still renders; the card reads an empty store.
    }
    return (
      <div style={{ maxWidth: 760 }}>
        <Story />
      </div>
    );
  };
}

const meta = {
  title: "Manager/MandateDraftsList",
  component: MandateDraftsList,
  parameters: {
    nextjs: { navigation: { pathname: "/manager" } },
    docs: {
      description: {
        component:
          "The Manager Console's Drafts card: every parked mandate, the step it was parked on, how long ago it was touched, and the two things that can be done to it. Open is the only door back into a saved mandate; Delete asks first.",
      },
    },
  },
} satisfies Meta<typeof MandateDraftsList>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Nothing saved yet. The card says why, rather than showing a bare heading. */
export const Empty: Story = {
  decorators: [seeding([])],
};

/** One parked mandate, mid-flow. */
export const OneDraft: Story = {
  decorators: [
    seeding([draft("d-1", "ETH and BTC on Arbitrum", "tokens", ["networks", "protocols"], 12)]),
  ],
};

/** Several, newest first, including a five-step mandate and an unnamed stale payload. */
export const ManyDrafts: Story = {
  decorators: [
    seeding([
      draft("d-1", "ETH and BTC on Arbitrum", "tokens", ["networks", "protocols"], 8),
      draft(
        "d-2",
        "Blue chips with Aave supply",
        "limits",
        ["networks", "protocols", "tokens", "pools"],
        95,
        true,
      ),
      draft("d-3", "Stable only, hub and spoke", "protocols", ["networks"], 60 * 26),
      // Cannot happen for a draft the dialog named; the card handles it rather than printing an id.
      draft("d-4", null, "networks", [], 60 * 24 * 9),
    ]),
  ],
};

/**
 * The delete confirmation.
 *
 * Not pre-opened: the dialog is the card's own state, and a story that forced it open would be
 * asserting the dialog rather than the row that raises it. Press Delete on the row.
 */
export const DeleteConfirm: Story = {
  decorators: [
    seeding([draft("d-1", "ETH and BTC on Arbitrum", "limits", ["networks", "protocols"], 30)]),
  ],
};
