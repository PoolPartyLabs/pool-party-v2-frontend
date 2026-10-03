/**
 * @id PP-MGR-SCR-002
 * @name FundBuildLanding
 * @implements-rules-version v1 (POO-2127 rules v1)
 * @analytics-events builder_build_landing_viewed
 *
 * POO-2127 [B2], epic POO-2119. The second phase of the fund builder, as far as it exists.
 *
 * The Build canvas is still in design, so this is where a manager who just closed a mandate stops.
 * Three decisions make that an honest screen rather than a broken one:
 *
 * 1. **It says what is missing, and that the work is safe.** `fundBuilder.build.pending` is the
 *    whole message: the canvas is in design, the mandate is saved, come back. A blank panel would
 *    read as a failure of the thing the manager just finished.
 * 2. **It prints the mandate back.** The summary is what makes the screen worth arriving at: the
 *    manager has just made five screens of decisions and this is the first place that shows all of
 *    them at once, which is also what makes a mistake findable while Back still leads somewhere.
 * 3. **There is no Next.** Nothing forward exists, so nothing forward is offered, and the one
 *    control is "Back: Mandate" (R5's bar, left side only). The phase stepper's Review pill stays
 *    unreachable by the V1 stepper's own rule: only an EARLIER phase is clickable.
 *
 * ## Why the view event is here and not in the shell
 *
 * The shell already emits `builder_mandate_completed` when a mandate reaches storage, and that is a
 * different count. A completion says a mandate was closed; this says someone arrived at the Build
 * screen and looked at it, which also happens when a Console "Open" resumes a draft that completed
 * earlier, and does NOT happen when a completion is immediately followed by a Save & exit. Mounting
 * is the honest trigger, so the event belongs to the thing that mounts.
 *
 * The chrome (the H1, Save & exit, the phase stepper) stays in {@link FundStrategyBuilderScreen}:
 * it is identical in both phases, and duplicating it here would be two headers to keep in step.
 */
"use client";

import { Hammer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTrackView } from "@/lib/analytics/useTrackView";
import { MandateSummaryCard } from "./components/MandateSummaryCard";
import type { MandateCatalog } from "./mandateCatalog";
import type { MandateDraft } from "./mandateDraft";

/** Public props for {@link FundBuildLanding}. */
export interface FundBuildLandingProps {
  /** The mandate that was just closed, or resumed from a completed draft. */
  draft: MandateDraft;
  /** The catalog the draft was built against. */
  catalog: MandateCatalog;
  /** Whether the mandate carries the Broad flag (R13). See {@link MandateSummaryCard}. */
  broad?: boolean;
  /** Return to the Mandate phase, landing on its last step. */
  onBackToMandate: () => void;
}

/** The Build phase: what is coming, the mandate so far, and the way back to it. */
export function FundBuildLanding({
  draft,
  catalog,
  broad,
  onBackToMandate,
}: FundBuildLandingProps) {
  const t = useTranslations("manager");
  useTrackView("builder_build_landing_viewed");

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-border bg-surface">
        <EmptyState
          icon={<Hammer className="size-10" aria-hidden="true" />}
          title={t("fundBuilder.build.title")}
          description={t("fundBuilder.build.pending")}
        />
      </div>

      <MandateSummaryCard draft={draft} catalog={catalog} broad={broad} />

      {/* R5's bar, left side only: there is nothing forward, so nothing forward is offered. */}
      <div
        data-builder-action-bar=""
        className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-border border-t bg-background py-4"
      >
        <Button variant="ghost" size="md" onClick={onBackToMandate}>
          {t("fundBuilder.build.backMandate")}
        </Button>
        {/* An empty cell rather than a conditional layout, matching `BuilderActionBar`'s own. */}
        <span />
      </div>
    </div>
  );
}
