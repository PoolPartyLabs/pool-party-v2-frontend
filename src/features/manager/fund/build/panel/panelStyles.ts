/**
 * @id PP-MGR-CMP-061
 * @name panelStyles
 * @implements-rules-version v1 (POO-2187 rules v1)
 * @analytics-events none, class names only
 *
 * The few class strings every control of the configuration panel shares (POO-2187). Rides on
 * PP-MGR-CMP-061 (BlockPanel) and has no id of its own (finding 26: one shared outline pill style,
 * a local constant in the panel folder, not a Button variant).
 *
 * - {@link OUTLINE_PILL}: handoff P10. The app Button has a solid `destructive` variant and no
 *   outline one, while the panel draws `Use`, `Cancel`, `Discard changes` and the Edit mandate pill
 *   as outline pills. {@link OUTLINE_PILL_DESTRUCTIVE} is the confirm's "Remove block", outlined as
 *   drawn.
 * - The Numeric styles (panel shell, "Numbers"): Inter in Figma; the app loads only Poppins, so a
 *   standalone number is Poppins with tabular, lining figures, as the canvas's share label does
 *   (the app wins on type).
 */

/** The focus ring every control of the panel uses. */
export const PANEL_FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface";

/** P10: the outline pill (height 32, padding 5 x 12, Label/Default). */
export const OUTLINE_PILL = `inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-border bg-transparent px-3 font-medium text-foreground text-xs transition-colors hover:bg-surface-raised disabled:pointer-events-none disabled:opacity-50 ${PANEL_FOCUS_RING}`;

/** P10: the confirm's "Remove block", outlined in `destructive`. */
export const OUTLINE_PILL_DESTRUCTIVE = `inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-destructive bg-transparent px-3 font-medium text-destructive text-xs transition-colors hover:bg-destructive/10 ${PANEL_FOCUS_RING}`;

/** A link of the panel (Body/Medium, `primary`). */
export const PANEL_LINK = `rounded-sm font-medium text-primary text-sm hover:underline ${PANEL_FOCUS_RING}`;

/** Numeric/Body: a value beside its label (the allocation, a rate). */
export const NUMERIC_BODY = "font-medium text-sm lining-nums tabular-nums";

/** Numeric/Label: a list or popover metric, a share in a list. */
export const NUMERIC_LABEL = "font-semibold text-[13px] lining-nums tabular-nums";

/** Numeric/Caption: a number in a chip. */
export const NUMERIC_CAPTION = "text-xs lining-nums tabular-nums";
