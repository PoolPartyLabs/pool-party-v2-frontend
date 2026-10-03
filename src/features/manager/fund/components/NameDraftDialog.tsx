/**
 * @id PP-MGR-MOD-005
 * @name NameDraftDialog
 * @implements-rules-version v1 (POO-2122 rules v1)
 * @analytics-events none, the dialog reports blocked, saved and failed through its props and the
 *   shell (PP-MGR-SCR-002) emits; a modal that emitted for itself could not name the step the
 *   manager was on, which is the dimension that makes the numbers readable
 *
 * "Name your draft": the one thing the fund builder asks for before it will persist a mandate (R7).
 *
 * ## Why a name is asked for at all
 *
 * The draft is not addressable without one. It is listed on the Console beside other drafts, and
 * "Untitled draft (3)" is not a thing a manager can choose between. The name also prefills the
 * strategy name on Review, so the question is asked once, at the first save, rather than twice.
 *
 * ## Why the primary is never disabled (R6, R8)
 *
 * A disabled Save would be the obvious build and it is the wrong one. It produces no click, no
 * error and no event, so a manager who typed a nine-character name and could not work out why the
 * button was dead leaves no trace at all. The press always lands; what it does is explain. That is
 * also why the length rule shows up twice and differently: the helper turns destructive LIVE while
 * the name is out of range (an ambient warning), and the message under the field only appears after
 * a refused press (an answer to something the manager just did).
 *
 * ## Validation lives here, and is the same function the store applies
 *
 * {@link draftNameError} is what `useMandateDraft.save()` runs too. Checking here first is not a
 * duplicate rule, it is the same rule asked earlier, so the refusal is instant rather than a round
 * trip through storage. The two cannot disagree because there is one function.
 */
"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils/cn";
import { DRAFT_NAME_MAX, draftNameError } from "../mandateDraft";
import type { MandateSaveResult } from "../useMandateDraft";

/** Public props for {@link NameDraftDialog}. */
export interface NameDraftDialogProps {
  open: boolean;
  /**
   * What the save is FOR.
   *
   * `exit` is Save & exit: the manager is leaving, and the primary says so. `complete` is the last
   * step's Next reaching a draft that was never named: the same question, but the answer continues
   * into Build rather than ending the session. One dialog, because the question is identical and a
   * second component would drift from this one on the next copy change.
   */
  mode: "exit" | "complete";
  /** What the draft already holds, printed on the progress line so the save feels like a receipt. */
  counts: { networks: number; protocols: number; tokens: number };
  /** Where the manager is inside the Mandate, 1-based over the VISIBLE steps. */
  position: { index: number; count: number };
  /** Persist under this name. The dialog renders the outcome; it never navigates. */
  onSave: (name: string) => Promise<MandateSaveResult>;
  /** The save landed. The shell toasts, emits `builder_draft_saved` and leaves or continues. */
  onSaved: () => void;
  /** The manager asked to save and the name rule said no. The shell emits the blocked intent. */
  onBlocked: () => void;
  /** Esc, the overlay, the X or Keep editing. Nothing is saved and nothing is lost. */
  onClose: () => void;
}

/** Name-your-draft modal for the first Save & exit (and the first completion). */
export function NameDraftDialog({
  open,
  mode,
  counts,
  position,
  onSave,
  onSaved,
  onBlocked,
  onClose,
}: NameDraftDialogProps) {
  const t = useTranslations("manager");
  const fieldId = useId();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  /** Set by a refused press, cleared by the next keystroke: an answer, not a running commentary. */
  const [error, setError] = useState<"empty" | "length" | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // Ambient, live: out of range the helper is destructive before anything is pressed (R8). An empty
  // field is NOT out of range, it is untouched, so it keeps the muted helper.
  const liveError = draftNameError(name);

  async function handleSave() {
    const refusal = draftNameError(name);
    if (refusal) {
      setError(refusal);
      onBlocked();
      return;
    }
    setError(null);
    setSaveFailed(false);
    setSaving(true);
    try {
      const result = await onSave(name);
      if (result.ok) {
        onSaved();
        return;
      }
      // `empty` and `length` cannot arrive here (the same rule just passed), but mapping them keeps
      // the dialog honest if the store's rule ever moves ahead of this one.
      if (result.error === "storage") setSaveFailed(true);
      else setError(result.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("fundBuilder.draft.title")}</DialogTitle>
          <DialogDescription>{t("fundBuilder.draft.body")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label htmlFor={fieldId} className="font-medium text-foreground text-sm">
            {t("fundBuilder.draft.nameLabel")}
          </label>
          <Input
            id={fieldId}
            size="lg"
            value={name}
            maxLength={DRAFT_NAME_MAX}
            placeholder={t("fundBuilder.draft.namePlaceholder")}
            variant={error ? "error" : "default"}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
              setSaveFailed(false);
            }}
          />
          <div className="flex items-start justify-between gap-4">
            <span
              className={cn(
                "text-xs",
                liveError === "length" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {t("fundBuilder.draft.helper")}
            </span>
            <span className="whitespace-nowrap text-muted-foreground text-xs tabular-nums">
              {t("fundBuilder.draft.counter", { count: name.length, max: DRAFT_NAME_MAX })}
            </span>
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error === "empty" ? t("fundBuilder.draft.empty") : t("review.nameLengthError")}
            </p>
          ) : null}
        </div>

        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
          {t("fundBuilder.draft.progress", {
            networks: counts.networks,
            protocols: counts.protocols,
            tokens: counts.tokens,
            n: position.index,
            count: position.count,
          })}
        </p>

        {saveFailed ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {t("fundBuilder.draft.saveFailed")}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t("fundBuilder.draft.keepEditing")}
          </Button>
          <Button variant="primary" size="md" loading={saving} onClick={handleSave}>
            {mode === "complete"
              ? t("fundBuilder.draft.saveContinue")
              : t("fundBuilder.draft.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
