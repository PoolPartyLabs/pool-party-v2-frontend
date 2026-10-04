/**
 * @id PP-MGR-SCR-002
 * @name BuildScreen.stories
 * @implements-rules-version v1 (POO-2157 rules v1)
 * @analytics-events none, a story file. The screen emits its own view and canvas events through
 *   `useAnalytics`; the workbench has no GTM container, so nothing leaves it
 *
 * Storybook coverage for the Build phase of the fund builder (slice S7, POO-2157): the canvas as a
 * manager meets it, on a draft seeded in the real draft store and read back through the real draft
 * hook, which is how the shell hands it over (the shell's header, Save & exit and stepper are not
 * here: `FundStrategyBuilderScreen.stories` covers them).
 *
 * - `EmptyCanvas`: a mandate just closed, no plan yet (Build state 1, reference canvas D).
 * - `ReferenceCanvasC`: worked example 1 of the handoff as a plan: a WETH / USDC Uniswap v4 pool
 *   with Collect fees at 60% and a USDC Aave v3 Supply at 40%, both configured, as only fixtures can
 *   be in this batch. Press Next: Review to see "Review is not available yet".
 * - `PlanUnreadable`: a draft whose stored plan this build cannot read (D18): the notice over the
 *   empty canvas.
 *
 * No story picks a Uniswap v3 position: they are coming soon (C22, POO-2167).
 * Back: Mandate and the Edit mandate links belong to the shell; here they do nothing.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { MANDATE_DRAFTS_KEY, upsertDraft } from "../mandateDraftStore";
import { useMandateDraft } from "../useMandateDraft";
import { BuildScreen } from "./BuildScreen";
import { withManagerMessages } from "./canvas/canvasStorySupport";
import type { BuildPlan } from "./plan/buildPlan";
import { hubPoolWithFeesPlan, hubSupplyPlan, makeTestDraft } from "./plan/planTestKit";

/** The id every story seeds its draft under. */
const STORY_DRAFT_ID = "story-build-draft";

/** Worked example 1 (reference canvas C): the pool chain at 60% and the Supply chain at 40%. */
function referenceCanvasC(): BuildPlan {
  const pool = hubPoolWithFeesPlan().hub.chains;
  const supply = hubSupplyPlan().hub.chains;
  return { ...hubPoolWithFeesPlan(), hub: { chains: [...pool, ...supply] } };
}

/** Seed the store with a closed two-network mandate (and a plan, or a raw stored value). */
function seed(plan?: unknown): void {
  try {
    window.localStorage.removeItem(MANDATE_DRAFTS_KEY);
  } catch {
    // Storage blocked in the preview frame: the hook then starts a fresh draft.
  }
  upsertDraft({
    ...makeTestDraft(),
    id: STORY_DRAFT_ID,
    savedAt: "2026-10-03T00:00:00.000Z",
    lastPhase: "build",
    ...(plan === undefined ? {} : { plan: plan as BuildPlan }),
  });
}

/** The draft hook over the seeded store, as the shell mounts it, and the Build screen under it. */
function SeededBuildScreen() {
  const { draft, catalog, update, hydrated } = useMandateDraft(STORY_DRAFT_ID);
  if (!hydrated) return null;
  return (
    <BuildScreen
      draft={draft}
      catalog={catalog}
      update={update}
      onBackToMandate={() => {}}
      onEditMandate={() => {}}
    />
  );
}

const meta = {
  title: "Manager/FundBuilder/BuildScreen",
  component: SeededBuildScreen,
  decorators: [withManagerMessages],
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/manager/new" } },
    docs: {
      description: {
        component:
          "The Build phase of the fund strategy builder: palette, canvas and the Configure block panel, with Back: Mandate and Next: Review. The plan is the draft's own, so these stories seed the draft store and read it back through the draft hook.",
      },
    },
  },
} satisfies Meta<typeof SeededBuildScreen>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A mandate just closed: the empty canvas, Add protocol and Add network (Build state 1). */
export const EmptyCanvas: Story = {
  decorators: [
    (Story) => {
      seed();
      return (
        <div className="p-6">
          <Story />
        </div>
      );
    },
  ],
};

/** Worked example 1 (reference canvas C), configured, two return levels and Income (fees). */
export const ReferenceCanvasC: Story = {
  decorators: [
    (Story) => {
      seed(referenceCanvasC());
      return (
        <div className="p-6">
          <Story />
        </div>
      );
    },
  ],
};

/** A stored plan this build cannot read (D18): kept, said, and the empty canvas under it. */
export const PlanUnreadable: Story = {
  decorators: [
    (Story) => {
      seed({ version: 99, hub: { chains: [] }, spokes: [] });
      return (
        <div className="p-6">
          <Story />
        </div>
      );
    },
  ],
};
