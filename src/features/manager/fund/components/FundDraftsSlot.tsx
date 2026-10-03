/**
 * @id PP-MGR-CMP-044
 * @name FundDraftsSlot
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events none, a gate. It decides whether the drafts card exists in this environment and
 *   emits nothing; the card itself owns the open and delete events, and the family choice is
 *   reported by the control the user pressed, `ContractFamilyToggle` (`PP-CORE-CMP-075`)
 *
 * POO-2127 [D2], epic POO-2119. The one gate between the Manager Console and fund-contract drafts.
 *
 * It exists so the Console's own file changes by ONE line. The three inputs that decide whether the
 * card belongs on screen are all client-side (a feature flag, a persisted preference, and the
 * store), and threading them into `ManagerConsoleScreen` would put three new hooks and two new
 * imports into a V1 screen for a preview it must otherwise be untouched by.
 *
 * ## Off means absent, and absent means nothing at all
 *
 * All three negative branches return `null`, not an empty wrapper and not a skeleton. The promise
 * attached to this slice is that the Strategies tab is byte-for-byte today's tab whenever the
 * preview does not apply, and a wrapper element or a one-frame placeholder would both break it
 * while still "hiding the drafts". `ManagerConsoleScreen.fundDrafts.test.tsx` compares the markup.
 *
 * ## Why the unknown family renders nothing rather than a skeleton
 *
 * `BuilderRouteSwitch` holds the builder's space with a skeleton while the preference is being read,
 * because there the whole screen is either one builder or the other and a flash would be a visible
 * jump. Here nothing on screen is WRONG before the read: the Console is simply today's Console, and
 * a placeholder would push the strategies list down for one frame and pop it back up.
 */
"use client";

import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { useContractFamily } from "@/lib/hooks/useContractFamily";
import { MandateDraftsList } from "./MandateDraftsList";

/** Renders the fund-contract drafts card when the flag is on and the manager is looking at V2. */
export function FundDraftsSlot() {
  const { isEnabled } = useFeatureFlags();
  const { family, hydrated } = useContractFamily();

  // The preview does not exist in this environment: no card, and nothing in its place.
  if (!isEnabled("fundContracts")) return null;
  // The preference has not been read yet. See the file header: nothing is the honest frame.
  if (!hydrated) return null;
  // The manager is looking at the live builder, which has no drafts of this kind.
  if (family !== "v2") return null;

  return <MandateDraftsList />;
}
