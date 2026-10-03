/**
 * @id PP-MGR-CMP-044
 * @name MandateDraftsList
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events builder_draft_opened, builder_draft_deleted, builder_mandate_error
 *
 * POO-2127 [D1] / [D3], epic POO-2119 (handoff blast radius item 1). The Manager Console's Drafts
 * card: every parked mandate, where it was parked, and the two things that can be done to it.
 *
 * ## Why this card exists at all
 *
 * A mandate that was saved and left has no other door. The builder's own URL carries the draft id,
 * but nothing shows that URL to the manager, so without this card a Save & exit is indistinguishable
 * from losing the work. "Open" is therefore not a convenience; it is the second half of R7.
 *
 * ## Why it reads the store instead of being handed a list
 *
 * The card subscribes. A Save & exit that happened a moment ago in the builder, or in another tab,
 * has to appear here without a reload, and the store already notifies on every write (and on this
 * key's `storage` event). A prop would make the Console responsible for re-reading storage, which
 * is a responsibility it has no reason to hold.
 *
 * ## Why nothing renders before the first read
 *
 * `listDrafts()` touches `localStorage`, which does not exist on the server. The card renders null
 * until the effect has run, so the server HTML and the first client render agree; the empty state is
 * only shown once the store has actually answered "nothing", never while the question is open.
 *
 * ## Dates
 *
 * "updated {when}" is relative, through next-intl's own formatter with an explicit `now`. Explicit
 * because `relativeTime` without one reports an `ENVIRONMENT_FALLBACK` error and reads the wall
 * clock anyway; the `now` is captured with each store read, so a draft saved while the Console is
 * open reads as "1 minute ago" rather than against a stale baseline.
 *
 * PP-INTEGRATION-POINT: the drafts move to the backend draft API with the store itself
 * (`PP-MGR-STO-001`, wiring issue POO-2132); this card changes nothing when they do, because it
 * only ever asked the store.
 */
"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import { useRouter } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { type MandateDraft, stepIndex } from "../mandateDraft";
import { deleteDraft, listDrafts, subscribe } from "../mandateDraftStore";

/** What the card is looking at: the drafts, and the moment they were read. */
interface DraftsSnapshot {
  drafts: MandateDraft[];
  now: Date;
}

/** The Console's Drafts card: open a parked mandate, or delete it. */
export function MandateDraftsList() {
  const t = useTranslations("manager");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const { track } = useAnalytics();
  const headingId = useId();

  const [snapshot, setSnapshot] = useState<DraftsSnapshot | null>(null);
  /** The draft the confirm dialog is asking about. Held whole, so the body can name it. */
  const [pending, setPending] = useState<MandateDraft | null>(null);

  useEffect(() => {
    const read = () => setSnapshot({ drafts: listDrafts(), now: new Date() });
    read();
    return subscribe(read);
  }, []);

  const handleOpen = useCallback(
    (draft: MandateDraft) => {
      // On the press, not on the builder mounting: the press is the intent, and a navigation that
      // never mounts is exactly the case worth being able to see.
      track("builder_draft_opened", { step: draft.lastStep });
      router.push(`/manager/new?draft=${draft.id}&step=${draft.lastStep}`);
    },
    [router, track],
  );

  /**
   * Delete, then report what actually happened.
   *
   * The order is the point. Tracking before the write counted deletions that a blocked or full
   * storage refused: the funnel recorded one, the manager saw no error, and the row reappeared on the
   * next read. `deleteDraft` answers whether the draft is gone, so the event follows the answer and a
   * refusal gets said out loud instead of being swallowed. A cancelled dialog is not a delete either,
   * which is why nothing is tracked when the question opens.
   *
   * Not counting the refusal as a deletion left the other half silent, which premise 11 is the rule
   * against: the manager got a toast and the funnel got nothing, so a storage refusing every delete
   * looked exactly like nobody pressing Delete. The refusal is now its own class, carrying the step
   * the draft was parked on, and `error_origin: "app"` because the write is ours and it is the
   * browser's own storage that said no, not a dependency that failed to answer. It mirrors the
   * shell's `DRAFT_SAVE_FAILED` for the opposite write.
   */
  const handleConfirmDelete = useCallback(() => {
    if (!pending) return;
    const deleted = deleteDraft(pending.id);
    setPending(null);
    if (!deleted) {
      toast.error(t("fundBuilder.drafts.deleteFailed"));
      track("builder_mandate_error", {
        step: pending.lastStep,
        // Spelled as a code: `error_code` is a dimension people group by, and every value in it
        // is shaped `<DOMAIN>_<REASON>` (`isAnalyticsErrorCodeShape`). A free word would be a
        // failure row that groups with nothing.
        error_code: "DRAFT_DELETE_FAILED",
        error_origin: "app",
      });
      return;
    }
    track("builder_draft_deleted", { step: pending.lastStep });
  }, [pending, t, track]);

  // Nothing is known yet: not an empty list, and not a skeleton either. See the file header.
  if (!snapshot) return null;

  const { drafts, now } = snapshot;

  return (
    <>
      <Card
        data-testid="mandate-drafts-card"
        aria-labelledby={headingId}
        className="flex flex-col gap-3 p-6"
      >
        <h2 id={headingId} className="font-semibold text-foreground text-lg">
          {t("fundBuilder.drafts.title")}
        </h2>

        {drafts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("fundBuilder.drafts.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {drafts.map((draft) => {
              const position = stepIndex(draft, draft.lastStep);
              // A saved draft always has a name (the dialog asks for one first), so this is the
              // stale-payload case: a neutral label beats printing an id at the manager.
              const name = draft.name ?? t("fundBuilder.drafts.unnamed");
              const nameId = `${headingId}-${draft.id}`;
              return (
                <li
                  key={draft.id}
                  data-testid="mandate-draft-row"
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    {/* The row actions repeat on every row, so each is DESCRIBED by this name:
                        a screen reader reads "Open, ETH and BTC on Arbitrum" rather than three
                        identical "Open"s. */}
                    <span
                      id={nameId}
                      data-testid="mandate-draft-name"
                      className="truncate font-medium text-foreground text-sm"
                    >
                      {name}
                    </span>
                    <span className="truncate text-muted-foreground text-xs">
                      {t("fundBuilder.drafts.row", {
                        n: position.index,
                        count: position.count,
                        when: format.relativeTime(new Date(draft.updatedAt), now),
                      })}
                    </span>
                  </span>

                  <Button
                    variant="secondary"
                    size="sm"
                    aria-describedby={nameId}
                    onClick={() => handleOpen(draft)}
                  >
                    {t("fundBuilder.drafts.open")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-describedby={nameId}
                    className="text-destructive hover:text-destructive"
                    onClick={() => setPending(draft)}
                  >
                    {t("fundBuilder.drafts.delete")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {pending ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPending(null);
          }}
          title={t("fundBuilder.drafts.deleteTitle")}
          body={t("fundBuilder.drafts.deleteBody", {
            name: pending.name ?? t("fundBuilder.drafts.unnamed"),
          })}
          confirmLabel={t("fundBuilder.drafts.delete")}
          cancelLabel={tCommon("cancel")}
          onConfirm={handleConfirmDelete}
          tone="destructive"
        />
      ) : null}
    </>
  );
}
