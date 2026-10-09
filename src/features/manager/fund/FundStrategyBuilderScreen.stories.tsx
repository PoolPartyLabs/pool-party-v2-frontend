/**
 * @id PP-MGR-SCR-002
 * @name FundStrategyBuilderScreen.stories
 * @implements-rules-version v3 (POO-2142 rules v2, POO-2167 rules v3)
 *
 * Storybook coverage for the fund-contracts builder shell (POO-2122, epic POO-2119).
 *
 * The shell takes no props: where the manager is, is `draft.lastStep`, and the draft comes from the
 * store keyed by `?draft=`. So the two stories drive it the only two ways the product does.
 *
 *   - `FirstStep` clears the drafts store and lets the shell mint a pristine draft: the page header,
 *     the three-phase stepper on Mandate, "STEP 1 OF 5", the Networks body and the sticky Back/Next
 *     bar with Back disabled.
 *   - `ResumedOnLastStep` writes a progressed draft to the store and points the deep link at it,
 *     which is what the Console's "Open" and a browser refresh both do. It is the state the shell
 *     changes most: the overline reads "STEP 5 OF 5", every earlier step in the sub-step header is
 *     reachable, and Next is the completion rather than a step change.
 *
 * `?draft=` is read through `useSearchParams`, which this framework exposes as a mock, so the second
 * story sets its return value in the decorator BODY: the shell reads the query once, in a `useState`
 * initialiser during its first render, so a value set from an effect would arrive too late. If a
 * future framework release stops aliasing `next/navigation`, that story degrades to a pristine
 * draft rather than crashing, and the overline reading "STEP 1 OF 5" is the tell.
 *
 * The screen's own `Skeleton` (the frame before the store has been read) is not a story: `hydrated`
 * flips inside `useMandateDraft`'s mount effect and nothing outside the hook can hold it open.
 * `FundStrategyBuilderScreen.test.tsx` covers it.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useSearchParams } from "@storybook/nextjs-vite/navigation.mock";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { FundStrategyBuilderScreen } from "./FundStrategyBuilderScreen";
import { buildMandateCatalog } from "./mandateCatalog";
import { createEmptyDraft, type MandateDraft, withNetworks, withProtocols } from "./mandateDraft";
import { MANDATE_DRAFTS_KEY, upsertDraft } from "./mandateDraftStore";

/** Fixed so the seeded draft reads the same on every open; `upsertDraft` stamps `updatedAt` itself. */
const SEEDED_AT = "2026-10-03T00:00:00.000Z";

/** The id the seeded draft is stored under and the deep link points at. */
const SEEDED_ID = "story-mandate-draft";

/**
 * The shell's own catalog, where Robinhood Chain is always available (R17 v2, POO-2142), so the
 * stories no longer force the `robinhoodChain` flag for the seeded draft's spoke.
 */
const catalog = buildMandateCatalog();

/** Empty the drafts store so a story never resumes what the one before it left behind. */
function clearDrafts(): void {
  try {
    window.localStorage.removeItem(MANDATE_DRAFTS_KEY);
  } catch {
    // Storage blocked in the preview frame: the shell mints a pristine draft anyway.
  }
}

/**
 * A mandate carried to the last step: hub plus one spoke, lending and liquidity positions (Uniswap
 * v4, R20 v3) added on top of the required two, and the four earlier steps marked passed so they are
 * reachable.
 */
function progressedDraft(): MandateDraft {
  const networks = withNetworks(createEmptyDraft(SEEDED_AT, SEEDED_ID), ["robinhood"], catalog);
  const protocols = withProtocols(networks, [...networks.protocols, "aave-v3", "uniswap-v4"]);
  return {
    ...protocols,
    lastStep: "limits",
    passedSteps: ["networks", "protocols", "tokens", "pools"],
    savedAt: SEEDED_AT,
  };
}

/** Point the deep link at a draft, or clear it. Called during render, before the shell reads it. */
function setQuery(search: string): void {
  useSearchParams.mockReturnValue(
    new URLSearchParams(search) as unknown as ReadonlyURLSearchParams,
  );
}

const meta = {
  title: "Manager/FundStrategyBuilderScreen",
  component: FundStrategyBuilderScreen,
  parameters: {
    nextjs: { navigation: { pathname: "/manager/new" } },
    docs: {
      description: {
        component:
          "The shell the five Mandate steps live in: page header, three-phase stepper, collapsible sub-step header, step body, sticky action bar, Save & exit and the unsaved guard. The current step is the draft's own lastStep, so a deep link and a reload land on the same screen.",
      },
    },
  },
} satisfies Meta<typeof FundStrategyBuilderScreen>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A manager arriving fresh: Mandate, step 1 of 5, nothing chosen, Back disabled. */
export const FirstStep: Story = {
  decorators: [
    (Story) => {
      clearDrafts();
      setQuery("");
      return <Story />;
    },
  ],
};

/** The same shared wizard with an in-memory Solana binding. */
export const SolanaLocalMandate: Story = {
  args: { runtime: "solana-local" },
};

/** Resumed from the Console on the last step, the way "Open" and a refresh both arrive. */
export const ResumedOnLastStep: Story = {
  decorators: [
    (Story) => {
      clearDrafts();
      upsertDraft(progressedDraft());
      setQuery(`draft=${SEEDED_ID}&step=limits`);
      return <Story />;
    },
  ],
};
