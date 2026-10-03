/**
 * @id PP-CORE-CMP-075
 * @name ContractFamilyToggle.stories
 * @implements-rules-version v1
 *
 * Storybook coverage for the header's V1 / V2 contract-family toggle (POO-2120 [R3]).
 *
 * Both the `fundContracts` flag and the chosen family are read from hooks rather than props, so the
 * stories drive them the only honest way: the family through the `localStorage` key the hook
 * hydrates from, and the flag through `setOverride`. Storybook renders client-side, so hydration
 * happens and the stored family wins.
 *
 * POO-2128: the flag used to be set by assigning `process.env.NEXT_PUBLIC_FEATURE_FUND_CONTRACTS`,
 * on the grounds that `resolveFeature` reads `process.env` at call time. It does, but this component
 * does not call it: `useFeatureFlags` reads `getClientFlags()`, which MEMOISES the whole flag map on
 * first call. Any earlier story that read a flag (an `AppShell` one, say) had already filled that
 * cache, so the assignment did nothing, `isEnabled("fundContracts")` stayed false and both stories
 * rendered an empty canvas with no error anywhere. The same silent-blank failure as POO-1086 and
 * POO-1144, one layer further in. `setOverride` invalidates the snapshot and notifies subscribers,
 * so it holds whatever position the story is opened from, and the override is released by key on
 * unmount rather than cleared wholesale, so it cannot leak into the next story either.
 *
 * The "off" state is not a story: with the flag off the component renders nothing at all, which is
 * an empty canvas and tells a reviewer nothing. It is asserted in `ContractFamilyToggle.test.tsx`.
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { setOverride } from "@/lib/features/devOverrides";
import {
  __resetContractFamilyStoreForTests,
  CONTRACT_FAMILY_STORAGE_KEY,
  type ContractFamily,
} from "@/lib/hooks/useContractFamily";
import { ContractFamilyToggle } from "./ContractFamilyToggle";

/**
 * Put the stored family where the hook will find it, and reveal the gate for this preview.
 *
 * A `beforeEach`, NOT the decorator body. A decorator body runs during render, so the reset emitted
 * a store change mid-render, and a decorator that re-renders without remounting its child (a
 * Storybook args or globals update) emitted again at a point where nothing was re-reading storage.
 * `beforeEach` runs before the story renders at all, which is the ordering the hook's read needs,
 * and its returned cleanup releases just this file's flag override, leaving any other in place.
 *
 * The reset is what makes the SECOND story in a session honest. The family is one value per tab,
 * read once, and the preview frame is one long-lived tab: without dropping that copy, every story
 * after the first would show whichever family was opened first.
 */
function withFamily(family: ContractFamily) {
  return () => {
    setOverride("fundContracts", true);
    try {
      window.localStorage.setItem(CONTRACT_FAMILY_STORAGE_KEY, JSON.stringify(family));
    } catch {
      // Storage blocked in the preview frame: the toggle falls back to V1, which is story one.
    }
    __resetContractFamilyStoreForTests();
    return () => setOverride("fundContracts", null);
  };
}

const meta = {
  title: "UI/ContractFamilyToggle",
  component: ContractFamilyToggle,
  parameters: {
    docs: {
      description: {
        component:
          "Header segmented control choosing which contract family /manager/new builds against. Gated by the fundContracts feature flag; off, it renders nothing. Hidden below the md breakpoint, since the builder it switches between is desktop only.",
      },
    },
  },
} satisfies Meta<typeof ContractFamilyToggle>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The default: the live Uniswap v3 single-pool builder. */
export const V1Selected: Story = {
  beforeEach: withFamily("v1"),
};

/** The fund-contracts preview selected. */
export const V2Selected: Story = {
  beforeEach: withFamily("v2"),
};
