/**
 * @id PP-CORE-HOK-029 (POO-1387, POO-1403, POO-1713)
 * @name useReportRenderedError
 * @implements-rules-version v2 (POO-1713 rules v1: one Sentry issue per failure kind) ·
 *   v1 (POO-1387 rules v1) · v1 (POO-1403 rules v1)
 * @analytics-events none, because this hook files a SENTRY event rather than a GA4 one and calls
 *   `track` nowhere. The GA4 counterpart is `app_error_shown`, emitted by the dialog that renders
 *   the failure. POO-1713's `[R4]` is a rule about a header CLAIM rather than about an emission, so
 *   it is satisfied by the grouping section above and deliberately has no `it()` of its own.
 *
 * File a Sentry event for an error the app CAUGHT and RENDERED, once per distinct failure.
 *
 * ## Grouping, and the assumption that was wrong for two weeks (POO-1713)
 *
 * Every event filed here is built from `new Error(...)` on ONE line below, so every event carries
 * an identical stack. Sentry groups a JavaScript exception by its stack whenever one exists and
 * consults the message only when there is none, so putting the code at the front of the message
 * did nothing for grouping. The header used to claim the opposite, in prose, which is how the
 * assumption survived unexamined from POO-1387.
 *
 * Measured consequence, from a complete enumeration of the group on 2026-08-20: `POOL-PARTY-FRONTEND-1H`
 * held **289 events, 21 distinct error codes, 4 routes**, titled by whichever event arrived last.
 * `TX_SLIPPAGE_EXCEEDED` at 127 events was invisible under `MOVE_RANGE_FAILED` at 38. Three separate
 * Linear issues read that group's 288/46 headline as a single defect's blast radius; a failure mode
 * that first appeared on 2026-08-19 inherited a `firstSeen` of 2026-08-06 and never alerted; and
 * resolving the group after fixing one code reopened it on the next unrelated error.
 *
 * [R2] fixes it with an explicit `fingerprint` of `[event, surface, code]`, which Sentry honours
 * over the stack. Note what is NOT in that key: `reference`, because it is per-pageload or
 * per-request and would file one issue per occurrence, which is the same defect with the opposite
 * sign.
 *
 * Changing a fingerprint does not rewrite history: the old group keeps its 289 events and new
 * events flow into new groups, so it should be resolved or ignored once this ships and any saved
 * search or alert pointing at it needs re-pointing.
 *
 * ## The gap it closes, precisely
 *
 * {@link useReportBoundaryError} (POO-1147) already covers the boundary case: a screen that CRASHES
 * is reported from all three route boundaries. What was never reported is the opposite and far more
 * common case, the one this app is mostly made of: a failure that is caught, classified, and shown to
 * the user in a dialog. It never reaches a boundary, it never reaches `window.onerror`, and there is
 * no `useMutation` on these paths so `MutationCache.onError` never fires either.
 *
 * `clientContext.ts` documented the consequence and deferred the fix as "a deliberate volume
 * decision, tracked separately": roughly nine in ten purely client-side failures resolved to NOTHING
 * in Sentry under the reference printed on the dialog. A user quoted an id at support and support
 * found an empty search. POO-1384's on-ramp incident is the worked example.
 *
 * Rafael took that volume decision on 2026-08-05: **every rendered error dialog files an event**.
 * Read-path and network noise is accepted for now and tuned with ignore rules once real volume is
 * visible, rather than guessed at up front.
 *
 * ## Why the reference is a TAG and not just trace context
 *
 * [R3] wants the event findable by the id the user can see. The SDK attaches the browser's own
 * propagation trace to every event automatically, and when the reference FALLS BACK to
 * `browserTraceId()` those two are the same value, so trace context alone would be enough.
 *
 * They are NOT the same value in the case that matters most. When the failure came from
 * `pool-party-api`, the reference is the BACKEND's `correlationId` (per-request, resolved by
 * `apiFetch`), which is deliberately a different id from the browser's per-pageload trace. Relying on
 * trace context would then index the wrong one of the two, and support would search the id on screen
 * and find nothing, which is exactly today's failure wearing a new hat. So the displayed reference is
 * attached explicitly as an indexed tag. `extra` would not do: Sentry stores it and does not index it.
 *
 * POO-1403 adds a SECOND tag on the same reasoning, for the one failure class where a third party
 * holds the answer. An on-ramp dialog also passes the vendor's `requestId`, so an operator who starts
 * from a Paybis invoice can reach our events, and an operator who starts from our issue can reach the
 * vendor's record, in both cases without the user in the loop. Every other surface passes nothing.
 *
 * ## Once per failure identity, WITHIN ONE MOUNT
 *
 * [R2], as corrected by the POO-1387 review and Rafael's decision on 2026-08-06. Be precise about
 * the guarantee, because an earlier revision of this comment (and the rule, and the registry row)
 * claimed a stronger one than the code has.
 *
 * What is guaranteed: a re-render cannot re-file. The dialog re-renders freely on a parent state
 * change or React's development double-invoke, and the `reference + code` key absorbs all of that,
 * while a genuinely different failure in the same mounted dialog still reports.
 *
 * What is NOT guaranteed, deliberately: one event across RETRIES. The ref dies with the mount, and
 * `ProvisioningPanel` unmounts this subtree on "Try again", so five failed attempts file five events.
 * That is the intended reading: each attempt is its own failure, and when the reference is a backend
 * `correlationId` it is per-REQUEST anyway, so the second attempt genuinely IS a different incident.
 * Volume is bounded by human clicks; there is no automated retry on this path (`useSlippageAutoRetry`
 * suppresses the error view entirely on the attempt it retries, so it files nothing).
 */
"use client";

import { useEffect, useRef } from "react";
import { reportClientError } from "./reportClientError";

/** The minimum an error view carries. Structurally compatible with `TxError` (PP-CORE-LIB-012). */
export interface RenderedErrorLike {
  /** Machine code, e.g. `ONRAMP_ERROR`, `-32603`, `PROVISIONING_GAS_BLOCKED`. */
  code: string;
  /** Raw provider/backend message, as shown in the error-details box. */
  message: string;
  /** POO-461 classification, when the thrower attached one. */
  kind?: string;
}

/**
 * Report a rendered error dialog, exactly once per distinct failure.
 *
 * @param surface - Stable token naming WHERE it rendered, e.g. `"provisioning"`, `"invest"`. Becomes
 *   the `surface` field, so "which flow is failing" is a filter rather than a guess.
 * @param error - The structured error the view is displaying, or `undefined`/`null` when it is
 *   displaying none. Passing nothing is the normal state and reports nothing.
 * @param reference - The support id shown on the dialog (backend `correlationId`, else the browser
 *   trace id). Attached as an indexed tag so the value a user quotes is the value that finds the
 *   event. Absent when neither could be resolved, in which case no tag is written.
 * @param paybisRequestId - POO-1403 [R3]: the VENDOR's own id for a fiat purchase, when this failure
 *   is one. It earns a second tag rather than a field for the same reason `reference` does: an
 *   operator holding a Paybis invoice needs to SEARCH it, and `extra` is stored but never indexed.
 *   That is what lets the pivot from our issue to the vendor's record happen without the user in the
 *   loop. Absent on every non-on-ramp surface, and an absent value writes no tag [R4].
 */
export function useReportRenderedError(
  surface: string,
  error: RenderedErrorLike | null | undefined,
  reference?: string,
  paybisRequestId?: string,
): void {
  /** Last failure reported IN THIS MOUNT, so a re-render cannot re-file it ([R2]; see the header). */
  const lastReported = useRef<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const identity = `${reference ?? "-"}|${error.code}`;
    if (lastReported.current === identity) return;
    lastReported.current = identity;

    // [R5] Never throw into a render path: a reporting call that can fail would turn a handled
    // error into an unhandled one, on the screen whose whole job is to handle it gracefully.
    try {
      // A real Error, not the plain object: the SDK wants one, and the code leads the message so a
      // human reading the issue sees the failure kind first.
      // [R4] `reportClientError` already drops an expected non-outage, and the SDK's `ignoreErrors`
      // still drops a user-rejected wallet prompt, so neither is re-implemented here.
      //
      // POO-1713 [R2]: the EXPLICIT fingerprint is what makes that Error groupable. An earlier
      // revision of this comment claimed "the code leads the message so grouping is by failure KIND
      // rather than by upstream prose", and that was simply false: Sentry groups a JavaScript
      // exception by its STACK whenever one exists, and only falls back to the message when there is
      // none. Every Error here is constructed on the line below, so every event carried an identical
      // stack and the message was never consulted. The result was one issue holding 21 distinct
      // codes across 4 routes, titled by whichever event arrived last.
      //
      // The key is what the failure IS. `reference` is deliberately absent from it: it is
      // per-pageload or per-request, so including it would file a separate issue for every single
      // occurrence, which is the same defect wearing the opposite sign. [R3] an absent code
      // contributes the literal "unknown" rather than shortening the array, because an array that
      // silently loses an element re-collapses these groups invisibly.
      reportClientError(
        "tx.error_shown",
        new Error(`${error.code}: ${error.message}`),
        {
          surface,
          code: error.code,
          ...(error.kind ? { kind: error.kind } : {}),
          ...(reference ? { reference } : {}),
        },
        {
          ...(reference ? { pp_reference: reference } : {}),
          ...(paybisRequestId ? { pp_paybis_request_id: paybisRequestId } : {}),
        },
        ["tx.error_shown", surface, error.code || "unknown"],
      );
    } catch {
      // Best-effort by definition.
    }
  }, [surface, error, reference, paybisRequestId]);
}
