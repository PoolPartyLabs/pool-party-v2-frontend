/**
 * @id PP-CORE-CMP-048 (POO-453)
 * @name StillLoadingNote
 * @implements-rules-version v2
 *
 * [R6] A subtle, non-alarming note shown while a transient read failure (e.g. a backend throttle)
 * is being retried in the background. It replaces the old hard error ("Couldn't load your
 * dashboard") on the first navigation-burst 429: the user sees reassurance instead of an error
 * boundary. Announced politely to assistive tech via `role="status"` + `aria-live="polite"`.
 * Presentational; the caller decides when to render it.
 *
 * v2 (POO-453 R7): a compact `inline` variant + optional message key so the SAME polite note also
 * serves the populated-view "updating" affordance — when positions are already on screen and a
 * background refresh is retrying, callers render `<StillLoadingNote variant="inline"
 * messageKey="updating" />` as an unobtrusive line instead of the block form used under a skeleton.
 */
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

/** Visual form of the note. `block` sits centered under a skeleton; `inline` is a compact line. */
export type StillLoadingNoteVariant = "block" | "inline";

/** Public props for {@link StillLoadingNote}. */
export interface StillLoadingNoteProps {
  /**
   * `common` message key for the copy. Defaults to `stillLoading` (first-load skeleton companion);
   * pass `updating` for the populated-view background-refresh affordance ([R7]).
   */
  messageKey?: "stillLoading" | "updating";
  /** `block` (default, centered under a skeleton) or `inline` (compact, for a populated view). */
  variant?: StillLoadingNoteVariant;
}

/** A quiet, polite "still loading / updating" note for a background retry. */
export function StillLoadingNote({
  messageKey = "stillLoading",
  variant = "block",
}: StillLoadingNoteProps = {}) {
  const t = useTranslations("common");
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "text-muted-foreground text-sm",
        variant === "block" ? "text-center" : "inline-flex items-center gap-1.5",
      )}
    >
      {t(messageKey)}
    </p>
  );
}
