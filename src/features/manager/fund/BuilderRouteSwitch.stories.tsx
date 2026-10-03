/**
 * @id PP-MGR-SCR-002
 * @name BuilderRouteSwitch.stories
 * @implements-rules-version v1
 *
 * Storybook coverage for the `/manager/new` route switch (POO-2120 [R6]).
 *
 * The switch draws almost nothing itself, so the story that earns its place is the PASSTHROUGH:
 * `FlagOff` renders the `v1` node with no wrapper, no skeleton and no frame around it, which is the
 * guarantee R6 actually makes. Put next to `FamilyV2`, the pair shows the whole decision.
 *
 * Both inputs are read from hooks, not props, and each story drives them the way their caches
 * require:
 *
 *   - The flag goes through `setOverride`, NOT through `process.env`. `useFeatureFlags` reads
 *     `getClientFlags()`, which memoises its map on first call, so mutating the env var only works
 *     for whichever story happens to read flags first in a session. `setOverride` invalidates that
 *     snapshot and notifies subscribers, so it works from any position in the sidebar. The override
 *     is released on unmount, by key, so it does not leak into the next story.
 *   - The family goes through the `localStorage` key `useContractFamily` hydrates from, written in
 *     a `beforeEach` rather than in the decorator body. That ordering is the point: a decorator body
 *     runs DURING render, so the store reset it carried emitted mid-render, and a decorator that
 *     re-renders without remounting its child (a Storybook args or globals update) emitted again at
 *     a point where nothing was re-reading storage. `beforeEach` runs before the story renders at
 *     all, so the value is in place when the hook reads and nothing is mutated during a render.
 *
 * The third branch, flag on with the family not yet read, is the one frame where `BuilderSkeleton`
 * shows. It is not a story because `hydrated` flips in the hook's own mount effect and nothing
 * outside it can hold that state open; `BuilderRouteSwitch.test.tsx` asserts it instead.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { setOverride } from "@/lib/features/devOverrides";
import {
  __resetContractFamilyStoreForTests,
  CONTRACT_FAMILY_STORAGE_KEY,
  type ContractFamily,
} from "@/lib/hooks/useContractFamily";
import { BuilderRouteSwitch } from "./BuilderRouteSwitch";

/**
 * Stand-in for the live V1 builder, which the real page builds from server reads and this preview
 * therefore cannot mount. Deliberately unmistakable: the thing to look for in `FlagOff` is that it
 * arrives unchanged, so it has to be recognisable at a glance.
 */
const v1Placeholder = (
  <div
    style={{
      border: "1px dashed #4b5563",
      borderRadius: 12,
      padding: "2rem",
      textAlign: "center",
      color: "#a1a1aa",
    }}
  >
    The live V1 single-pool builder, rendered by the page's server reads and passed in as `v1`.
  </div>
);

/**
 * Force the flag and the stored family for one story, before it renders.
 *
 * Returns the `beforeEach` hook itself, whose own cleanup releases just this story's flag override
 * and leaves any other in place. The reset is what makes the SECOND story in a session honest: the
 * family is one value per tab, read once, and the preview frame is one long-lived tab, so without
 * dropping that copy every story after the first would render whichever family was opened first.
 */
function withState(flag: boolean, family: ContractFamily) {
  return () => {
    setOverride("fundContracts", flag);
    try {
      window.localStorage.setItem(CONTRACT_FAMILY_STORAGE_KEY, JSON.stringify(family));
    } catch {
      // Storage blocked in the preview frame: the hook falls back to V1, the FamilyV1 story.
    }
    __resetContractFamilyStoreForTests();
    return () => setOverride("fundContracts", null);
  };
}

const meta = {
  title: "Manager/BuilderRouteSwitch",
  component: BuilderRouteSwitch,
  args: { v1: v1Placeholder },
  // Layout only. Nothing here touches the flag store or the family store, so a decorator re-render
  // cannot move either of them.
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "Chooses which builder /manager/new renders. With the fundContracts flag off it returns the V1 builder untouched, so the one screen a manager uses to earn is never gated behind the preview. With the flag on it follows the manager's persisted V1/V2 choice.",
      },
    },
  },
} satisfies Meta<typeof BuilderRouteSwitch>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Flag off: the V1 builder, verbatim, with nothing added around it. The family is ignored. */
export const FlagOff: Story = {
  beforeEach: withState(false, "v2"),
};

/** Flag on, V1 chosen: the same passthrough, this time because the manager asked for it. */
export const FamilyV1: Story = {
  beforeEach: withState(true, "v1"),
};

/** Flag on, V2 chosen: the fund-contracts builder replaces it, starting on Mandate step 1. */
export const FamilyV2: Story = {
  beforeEach: withState(true, "v2"),
};
