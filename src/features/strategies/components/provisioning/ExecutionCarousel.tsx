/**
 * @id PP-CORE-CMP-071
 * @name ExecutionCarousel
 * @implements-rules-version v4 (POO-1786 rules v1) · v3 (POO-1568 rules v1) · v2 (POO-1507 rules v1) · v1 (POO-1504 rules v1)
 * @analytics-events none, and deliberately. The run this renders is reported by `PP-CORE-LIB-058`
 *   from the panel that owns the session: one leg-settled event per leg, one terminal outcome. A
 *   surface that only DISPLAYS those transitions has nothing of its own to add, and an emitter here
 *   would double every row the panel already counts.
 * @hackathon POO-1022 (Universal Funding)
 *
 * The execution surface of the funding flow: **one step visible at a time** (Figma `7` `6550:615`,
 * `7c` expanded `7342:766`, `7d` ticker `7346:766`, `7f` all done `7360:766`, `7i` taking longer
 * `7381:832`).
 *
 * ## Why it stopped showing every step at once (P46)
 *
 * The previous surface rendered all four step bodies simultaneously. Many steps visible at once reads
 * as difficulty, and difficulty read at a glance is abandonment: a user who came to invest $200 sees a
 * machine doing four things and concludes something has gone wrong. So the window shows the step in
 * flight, `Step N of M` says where that sits, and the full list is one tap away ([R21]).
 *
 * ## The rules that are not stylistic
 *
 * **[R23] the progress fraction includes a half step**, `(done + 0.5) / total`. Without it the bar is
 * frozen for the whole of a 60-second bridge and empty on the first step, which are exactly the two
 * moments a user is deciding whether the app is working.
 *
 * **[R57] the liveness loops never stop.** The spinner turns once per 1.2s and the `Processing` dots
 * cycle every 400ms, indefinitely. A frozen indicator on a long on-chain step is indistinguishable
 * from a hung app, and that is what makes people close the tab mid-bridge. The dots run on an interval
 * rather than a CSS keyframe because they are text: a screen reader hears the label, not the animation.
 *
 * **[R58] after 10s on the same step** the box adds "This is taking longer than usual", additively:
 * nothing else changes and no state flips. The timer is keyed on the step, so a route whose legs each
 * take nine seconds never shows it, and a single slow leg does.
 *
 * **[R33] neighbouring rows are not left partially visible at rest.** The iOS-picker look was
 * considered and rejected on measurement: text at 12% opacity measures about 1.1:1 against this
 * surface and fails the contrast premise outright. Partial opacity exists only during the transition.
 *
 * **[R26] `What am I signing?` sits BELOW the window**, which is why this component takes it as a slot
 * and renders it outside the clipped box rather than inside the active row. Putting it in the row would
 * make carousel rows two different heights and the window would jump every time a signature step came
 * up.
 *
 * ## The e2e contract travels with the rows
 *
 * POO-1109 [R3]/[R5]: the harness maps every `[data-testid^="wallet-step-"]` to a leg and POLLS
 * `data-status` to follow a bridge to completion rather than sleeping. So the full list stays MOUNTED
 * while collapsed (`hidden`, which drops it from layout and from the accessibility tree but not from
 * the DOM), exactly as the plan card did. Rendering only the visible step would have left the harness
 * seeing a one-leg route and reporting "nothing to verify on chain" for a bridge that really ran.
 */
"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import type { TxErrorKind } from "@/lib/tx/diagnostics";
import { cn } from "@/lib/utils/cn";
import {
  currentStepPosition,
  executionStepCopy,
  hasExecutionSubtitle,
  progressFraction,
  stepTitleKey,
} from "./executionCopy";
import { labelValues } from "./ProvisioningPlanCard";
import type { PlanRow, PlanView } from "./provisioningView";

/** How long a single step may run before the [R58] line appears, in ms. */
export const TAKING_LONGER_MS = 10_000;

/** One turn of the step spinner ([R57]). Exported so the test asserts against the constant itself. */
export const SPINNER_PERIOD_MS = 1_200;

/** How often the `Processing` dots advance ([R57]). Exported for the same reason. */
export const DOTS_PERIOD_MS = 400;

/**
 * One ticker, in ms ([R31]). Kept in step with the `.pp-ticker-*` classes in `globals.css`: this is how
 * long the departing row stays in the DOM, and if it were shorter than the animation the row would
 * vanish mid-travel.
 */
export const TICKER_MS = 320;

/** Public props for {@link ExecutionCarousel}. */
export interface ExecutionCarouselProps {
  /** The key-matched plan view, statuses and hashes included. */
  view: PlanView;
  /** Title for the op anchor row, e.g. "Invest in Stable Yield". */
  opLabel: string;
  /**
   * What the sub-line of a FAILED row needs to name its cause with the plan's own figures, passed
   * through to {@link executionStepCopy} exactly as the plan card passes it.
   */
  execution?: {
    /** Has any step already failed? Changes what an unstarted step means (`Not started`, not `Waiting`). */
    routeFailed?: boolean;
    /** The classification of the failure, for the row that failed. */
    errorKind?: TxErrorKind;
    /** The plan's OWN max-slippage, so the slippage line quotes what this user set. */
    slippagePct?: number;
  };
  /**
   * The explorer link for a row, when it has a hash to link ([R2] of POO-1037). EXPANDED LIST ONLY
   * since POO-1568 [R1]: the collapsed window's own copy of it moved out of this component entirely,
   * into the panel's pinned footer under the state button.
   *
   * The caller decides which rows get one, and legitimately returns nothing for a row that HAS a
   * hash: `ProvisioningPanel` skips the CURRENT step, whose link the footer already renders
   * unconditionally, so expanding the list cannot put the running leg's link on screen twice. This
   * component does not second-guess that — it renders whatever comes back, for whichever row.
   */
  rowLink?: (row: PlanRow) => ReactNode;
  /**
   * [R26] The clear-vs-blind signing disclosure for the step the wallet is asking about, rendered
   * BELOW the window so carousel rows keep one height. Absent for provider and non-signing steps.
   */
  disclosure?: ReactNode;
  className?: string;
}

/** The `Processing` dots, cycling one to three indefinitely ([R57]). */
export function ProcessingDots({ label }: { label: string }): ReactNode {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setCount((n) => (n % 3) + 1), DOTS_PERIOD_MS);
    return () => clearInterval(id);
  }, []);
  return (
    <>
      {/* POO-1786 [R1]: the label is an element React owns, never a bare text node. Every host swaps
          these dots for plain text once its wait ends (the invest CTA, the panel's state button,
          WalletSteps), and unmounting them ran `removeChild` on the label's text node; Chrome page
          translation replaces that node with `<font>` wrappers while React keeps the old one, so the
          removal threw NotFoundError into the route error boundary (the POO-1762 crash shape, see
          `Button.tsx`). A bare span is one flex item where the anonymous one was: same layout. */}
      <span>{label}</span>
      {/* The dots are decoration on a label a screen reader already reads in full, so they are hidden
          from the accessibility tree rather than announced three times a second. */}
      <span aria-hidden="true">{".".repeat(count)}</span>
    </>
  );
}

/** Done, running or not started, as the design's three marks. */
function StatusMark({ status }: { status: PlanRow["status"] }): ReactNode {
  if (status === "done") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="size-3.5" aria-hidden="true" />
      </span>
    );
  }
  if (status === "active") {
    // [R57] One turn per 1.2s, linear and continuous. `animate-spin` is Tailwind's 1s ease-linear
    // keyframe; only the duration is overridden, so the motion itself stays the shared one.
    return (
      <span
        className="size-6 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
        style={{ animationDuration: `${SPINNER_PERIOD_MS}ms` }}
        aria-hidden="true"
      />
    );
  }
  return <span className="size-6 shrink-0 rounded-full border border-border" aria-hidden="true" />;
}

/** The execution carousel: one step in a clipped window, the whole list one tap away. */
export function ExecutionCarousel({
  view,
  opLabel,
  execution,
  rowLink,
  disclosure,
  className,
}: ExecutionCarouselProps) {
  const t = useTranslations("strategies");
  const listId = useId();
  const [expanded, setExpanded] = useState(false);

  /**
   * The rows the rail RUNS, which is what `Step N of M` counts and what the progress bar measures.
   *
   * The op anchor is excluded on purpose: it is a label for the operation this route funds, not a step
   * the rail executes, so counting it would report `Step 1 of 5` for a four-leg route and leave the bar
   * short of full when everything has finished. It stays in the expanded list, because there it is the
   * plan. Same definition the funnel's `fundingLegCount` uses.
   */
  const steps = useMemo(() => view.rows.filter((row) => !row.isOp), [view.rows]);
  const total = steps.length;
  /**
   * The step in flight, or the first one that has not finished, or the last one when all have.
   *
   * POO-1507 [R29]: the SAME selection lives in `executionCopy.ts`'s `currentStepPosition`, extracted
   * so the stop-confirmation's `Step N of M` cannot drift from what this window is showing — two
   * copies of a 4-branch fallback chain is exactly how the two would eventually disagree.
   */
  const position = useMemo(() => currentStepPosition(view.rows), [view.rows]);
  const current = position
    ? (steps.find((row) => row.key === position.key) ?? steps[total - 1])
    : undefined;
  const currentIndex = position ? position.index - 1 : 0;

  /**
   * [R23] `(done + 0.5) / total`, capped at 1. The half counts the step in flight, which is the only
   * reason the bar moves at all during a leg; at `allDone` there is no step in flight, so the half is
   * dropped rather than pushing the bar past full. POO-1505: extracted to `executionCopy.ts` so the
   * buy-step mini summary's own bar cannot drift from this one.
   */
  const fraction = useMemo(() => progressFraction(view.rows), [view.rows]);

  /**
   * [R31] The row on its way out, for the length of one ticker.
   *
   * Held in state rather than derived, because a transition is a thing that HAPPENED (the step
   * changed) and not a thing that IS: once the animation is over the departing row must leave the DOM,
   * or every completed step would pile up invisibly inside the window.
   *
   * `prevRowRef` carries the last row the window rendered. Reading `current` directly would give the
   * NEW row on the render that changes it, so there would be nothing to animate away.
   */
  const [outgoing, setOutgoing] = useState<PlanRow | null>(null);
  const prevRowRef = useRef<PlanRow | undefined>(current);
  useEffect(() => {
    const previous = prevRowRef.current;
    prevRowRef.current = current;
    if (!previous || !current || previous.key === current.key) return;
    setOutgoing(previous);
    const id = setTimeout(() => setOutgoing(null), TICKER_MS);
    return () => clearTimeout(id);
  }, [current]);

  /**
   * [R58] Ten seconds on the SAME step. Keyed on the step's own key, so the timer restarts with each
   * leg and a route of nine-second legs never shows the line, while one slow leg does.
   */
  const [slow, setSlow] = useState(false);
  const currentKey = current?.key;
  const currentStatus = current?.status;
  useEffect(() => {
    setSlow(false);
    // `currentKey` is read so the dependency is visible to the linter as well as to the reader: the
    // timer has to RESTART when the run moves to another step, not merely when its status changes.
    if (!currentKey || currentStatus !== "active") return;
    const id = setTimeout(() => setSlow(true), TAKING_LONGER_MS);
    return () => clearTimeout(id);
  }, [currentKey, currentStatus]);

  /**
   * `departing` is the row on its way out during a ticker ([R31]). It renders with the window's layout,
   * because it has to occupy the same space it is leaving, but it must NOT claim to be the current step:
   * for those 320ms both copies are in the DOM, and two rows saying `aria-current="step"` is a surface
   * telling a screen reader that two things are running at once. Caught by POO-1041 [R6]'s "exactly one
   * live row" assertion, which is the whole reason that test counts rather than merely checking one.
   */
  function renderRow(row: PlanRow, inWindow: boolean, departing = false): ReactNode {
    const titleKey = stepTitleKey({
      type: row.type,
      status: row.status,
      isApproval: row.isApproval,
      isOp: row.isOp,
      labelKey: row.labelKey,
    });
    const title = row.isOp ? opLabel : t(titleKey, labelValues(row));
    /**
     * [R25] Only when the user must act or there is a real warning. `Done` and `Waiting` are the mark
     * repeated in words, and a row that says both says one thing twice while looking like it says two.
     *
     * The bridge ETA is the other half of "a real warning": it is the one caption that tells a user why
     * a step they are watching is not finishing, so it survives on an `active` bridge row.
     */
    const copy = hasExecutionSubtitle(row.status)
      ? executionStepCopy({
          status: row.status,
          // POO-1136: the fiat buy's active state is the embedded widget, not a wallet prompt.
          ...(row.type === "buy" ? { inIframe: true } : {}),
          ...(execution?.routeFailed === undefined ? {} : { routeFailed: execution.routeFailed }),
          ...(row.status === "error" && execution?.errorKind !== undefined
            ? { errorKind: execution.errorKind }
            : {}),
          ...(execution?.slippagePct === undefined ? {} : { slippagePct: execution.slippagePct }),
        })
      : null;
    const subtitle = copy ? t(copy.key, copy.values ?? {}) : undefined;
    const eta =
      row.status === "active" && row.eta ? t(row.eta.key, row.eta.values ?? {}) : undefined;
    const link = rowLink?.(row);
    return (
      <li
        key={row.key}
        className="flex items-start gap-3 py-2"
        /**
         * One row per leg carries each of these, never two, and which copy carries which is the point.
         *
         * The current step is in the DOM TWICE: once in the window, which is what a person sees, and
         * once in the full list, which stays mounted while collapsed so the POO-1109 e2e contract
         * survives the collapse. So the two identities are split rather than duplicated.
         *
         * `aria-current` goes on the WINDOW row, because that is the one in the accessibility tree: the
         * list is `hidden` and a screen reader is not told about it at all.
         *
         * The e2e attributes go on the LIST row, because the harness reads them with a querySelector
         * over `[data-testid^="wallet-step-"]` and maps one node to one leg. Emitting them from both
         * would double every leg it sees, which is the same class of defect as the index-matched
         * stepper POO-1041 [R6] was opened to fix. Funding legs only: the op anchor is not a leg.
         */
        {...(inWindow && !departing && row.status === "active"
          ? { "aria-current": "step" as const }
          : {})}
        {...(inWindow || row.isOp ? {} : { "data-testid": `wallet-step-${row.key}` })}
        {...(inWindow || row.isOp
          ? {}
          : { "data-status": row.status === "idle" ? "pending" : row.status })}
        {...(inWindow || row.txHash === undefined ? {} : { "data-tx-hash": row.txHash })}
      >
        <StatusMark status={row.status} />
        <div className="min-w-0 flex-1">
          <p className="min-w-0 break-words font-medium text-foreground text-sm">{title}</p>
          {inWindow && subtitle ? (
            <p className="mt-0.5 min-w-0 break-words text-muted-foreground text-xs">{subtitle}</p>
          ) : null}
          {/* The bridge's own "this takes longer than the others" ([R25]'s real warning), on the row it
              describes rather than as a centred line under the list, which never said which leg. */}
          {inWindow && eta ? (
            <p className="mt-0.5 min-w-0 break-words text-muted-foreground text-xs">{eta}</p>
          ) : null}
          {/* [R58] Additive: it appears under the running step and nothing else changes. Only in the
              window, because the expanded list is a plan rather than a status report. */}
          {inWindow && slow && row.status === "active" ? (
            <p className="mt-0.5 min-w-0 break-words text-muted-foreground text-xs">
              {t("provisioning.exec.takingLonger")}
            </p>
          ) : null}
          {/* POO-1037 [R2]: every hashed row keeps its explorer link, including a leg that settled
              two steps ago — the expanded list is how a user verifies it. Never in the WINDOW copy,
              for two independent reasons: the window lives inside the toggle `<button>` and a button
              may not wrap an anchor, and POO-1568 [R1] gave the running leg's link one home, in the
              panel's footer under the state button. That home is why `rowLink` returns nothing for
              the CURRENT step: its link is already on screen below, and rendering it here as well
              is the duplicate expanding the list used to produce. */}
          {!inWindow && link ? <div className="mt-1">{link}</div> : null}
        </div>
      </li>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/**
       * [R21] The box is the only click target, and it is a real `<button>` so the keyboard and the
       * accessibility tree get the same affordance the pointer does. There is no chevron: [R22]'s
       * `Step N of M` is what makes the collapse visible, which is why that count is never removed.
       *
       * The accessible name derives from the CONTENT (the step title, its subtitle, the taking-longer
       * line, the count), never from an `aria-label`: an override here would replace everything the
       * window says with a static toggle label, so a screen reader would hear "Show every step" and
       * never the step it is watching. `aria-expanded` is what carries the disclosure state.
       *
       * [R31]/[R33] The window CLIPS (`overflow-hidden`), which is what makes "only one step is ever
       * fully readable" true rather than merely intended, and it is also why nothing has to be drawn at
       * partial opacity: at rest there is exactly one row in the box.
       */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((open) => !open)}
        className="relative w-full overflow-hidden rounded-2xl border border-border bg-white/[0.04] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* [R23] On the box's own top edge, 3px, clipped by the radius above. Never on the modal edge:
            the bar is about the step, and a bar across the whole surface reads as the page loading. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px] bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
        <div className="flex flex-col gap-1 px-4 pt-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            {/**
             * [R31] The ticker. The step that is leaving is taken OUT OF FLOW and animated up and away
             * while the arriving one animates in from below, so the two never fight over the row's
             * height and the box does not jump mid-transition. Both halves run the same 320ms curve from
             * one place (`globals.css`), and under `prefers-reduced-motion` that same pair cross-fades
             * with no travel.
             *
             * The departing copy is `aria-hidden`: for the 320ms it exists there are two rows in the
             * DOM, and a screen reader must be told about the one that is arriving, not the one that is
             * already gone. It also keeps the window's testid on the in-flow list alone, so a scoped
             * query can never match a row that is on its way out.
             */}
            <div className="relative min-w-0 flex-1 overflow-hidden">
              {outgoing && !expanded ? (
                <div aria-hidden="true" className="pp-ticker-out absolute inset-x-0 top-0">
                  <ol className="list-none">{renderRow(outgoing, true, true)}</ol>
                </div>
              ) : null}
              <ol
                data-testid="provisioning-exec-window"
                className={cn("list-none", outgoing && !expanded && "pp-ticker-in")}
              >
                {expanded ? null : current ? renderRow(current, true) : null}
              </ol>
            </div>
            {/* [R22] Right-aligned and quiet, digits in Inter (`tabular-nums` binds the numeric face),
                at the 12px token floor rather than the spec's 11px, which `tokens:check` rejects. */}
            <span className="shrink-0 pt-3 text-muted-foreground text-xs tabular-nums">
              {t("sign.stepOf", { current: currentIndex + 1, total })}
            </span>
          </div>
        </div>
      </button>

      {/**
       * The full list, revealed under the box. Kept MOUNTED while collapsed so the POO-1109 e2e contract
       * and the toggle's `aria-controls` target survive the collapse; `hidden` is what drops it from
       * layout and from the accessibility tree.
       *
       * [R21] says the box is the only click target, and it is taken literally: the box stays put when
       * expanded, carrying the count and the progress bar, and pressing it again collapses. The spec also
       * describes tapping the LIST to collapse, which was built and removed on review, because these rows
       * contain explorer anchors: a `<button>` may not wrap an anchor, and a bare `onClick` on the list
       * would be a control the keyboard cannot reach. One real button beats two half-affordances.
       */}
      <div id={listId} hidden={!expanded} data-testid="provisioning-exec-list">
        <ol className="flex flex-col rounded-2xl border border-border bg-white/[0.04] px-4 py-2">
          {view.rows.map((row) => renderRow(row, false))}
        </ol>
      </div>

      {/* [R26] Below the window, so every carousel row keeps one height. */}
      {disclosure}
    </div>
  );
}
