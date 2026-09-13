/**
 * @id PP-CORE-LIB-067 (POO-1134, POO-1384)
 * @name on-ramp request journal
 * @implements-rules-version v3 (POO-1384 / POO-1129 rules v4) · v2 (POO-1129 rules v2)
 *
 * [R7] "one purchase per step, ever." A Paybis `requestId` is a purchase INTENT; minting a second one
 * for a step already in flight is a double charge waiting to happen. This is the client-persisted
 * record of in-flight intents, so a reload or re-entry can RESUME the existing `requestId` instead of
 * minting a new one. It follows the funding journal's discipline (POO-1038, `fundingJournal.ts`):
 * guarded storage access, a version-pinned key, whole-record validation on read, pruning on read, and
 * a bounded record count. It is deliberately a SEPARATE, smaller store: the funding journal is
 * leg-shaped and holds no `requestId`, and folding a `buy` leg into it is POO-1131 + POO-1135's job,
 * not this hook's.
 *
 * ## The seam
 *
 * This hook (POO-1134) records the `requestId` BEFORE opening the widget and marks it terminal on
 * settlement / rejection. The MINT site (POO-1135's rail, which calls `createOnRampRequestAction`)
 * consults {@link findResumableOnRampRequest} first and reuses an open record's `requestId` rather
 * than minting — that is where [R8] "minted at execution time" and [R7] meet.
 *
 * ## Untrusted input
 *
 * This blob influences a money decision (reuse vs. mint), so it is validated on every read and a parse
 * failure discards the whole store rather than salvaging part of it: falling back to "no in-flight
 * request" is always safe (the mint site simply mints, and Paybis' own idempotency + the backend
 * dedupe on `signature` remain). It holds no secret — a `requestId` plus the user's own address.
 */
"use client";

import { z } from "zod";

/** Namespaced AND version-pinned: a v2 shape would live at a v2 key and never be misread as this one. */
export const ONRAMP_JOURNAL_KEY = "pp.onramp.request.v1";

/** The only store version this module reads. A record written by a future build is ignored. */
export const ONRAMP_JOURNAL_VERSION = 1;

/** A purchase resolves in minutes; a day-old record is stale and pruned on read. */
export const ONRAMP_JOURNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * POO-1384: how long an `open` intent stays RESUMABLE, as opposed to how long the record is KEPT.
 *
 * The two are different windows. RETENTION (24h) is how long the record survives at all, and it is
 * what keeps an aged-out intent around to ASK the user about ({@link findExpiredOnRampIntent}); a
 * pruned record is a question nobody can be asked. AUTO-REUSE is a narrower question: reopening a
 * `requestId` without asking is only safe while it is plausibly still alive at the vendor, and that
 * is minutes.
 *
 * At 24h a tab that died with no terminal event left an intent resumable all day, so the next attempt
 * reopened a `requestId` Paybis had long expired and the user got "Session timed out" with no way
 * forward but clearing localStorage. Reported twice in production.
 *
 * PP-NOTE: 15 minutes is an ASSUMPTION. Paybis does not publish its request TTL, and the value that
 * matters is theirs, not ours. It is deliberately shorter than any plausible vendor session so a
 * stale reuse is near-impossible, while still covering the reload-a-minute-later case the guard was
 * built for. Narrow it further if a live session is observed expiring sooner.
 */
export const ONRAMP_REQUEST_RESUMABLE_MS = 15 * 60 * 1000;

/** How many records the store keeps, so localStorage cannot grow without bound. */
export const ONRAMP_JOURNAL_MAX_RECORDS = 3;

/**
 * A purchase intent's lifecycle. `open` is the only resumable state; the four terminal states mirror
 * the widget's terminal postMessage events ([R5]).
 */
export type OnRampRequestStatus = "open" | "settled" | "rejected" | "cancelled" | "error";

const onRampRequestSchema = z.object({
  requestId: z.string().min(1),
  /** Lowercased SIWE-session wallet the intent was minted for; never a client-supplied one. */
  wallet: z.string().min(1),
  status: z.enum(["open", "settled", "rejected", "cancelled", "error"]),
  /**
   * POO-1384 (security review): `.finite()` is load-bearing, not decoration. `z.number()` ACCEPTS
   * `Infinity`, and `JSON.parse('{"createdAt":1e999}')` yields exactly that, so a hand-edited record
   * made `now - createdAt === -Infinity` and passed BOTH age bounds: the 24h prune and the resumable
   * window. That pinned a `requestId` as resumable forever. localStorage is writable by any XSS or a
   * browser extension, and these two timestamps now gate a money decision, so they are untrusted
   * input and get the same bounds as any other. Legacy records all carry finite `Date.now()` values,
   * so nothing real is discarded.
   */
  createdAt: z.number().int().nonnegative().finite(),
  updatedAt: z.number().int().nonnegative().finite(),
  /**
   * POO-1384: when the widget reported the purchase `completed`, i.e. the money was PAID and is now
   * only waiting to land. Absent means it never got that far.
   *
   * OPTIONAL on purpose: records written before this field existed are already in users' localStorage,
   * and a required field would fail the schema and discard the whole store, taking every in-flight
   * intent with it. Absent reads as "never paid", which for a pre-existing record is the safe
   * direction: it expires on the resumable window instead of being resumable forever.
   */
  paidAt: z.number().int().nonnegative().finite().optional(),
});

const onRampJournalStoreSchema = z.object({
  version: z.literal(ONRAMP_JOURNAL_VERSION),
  requests: z.array(onRampRequestSchema),
});

/** One persisted purchase intent. */
export type OnRampRequestRecord = z.infer<typeof onRampRequestSchema>;

/**
 * `localStorage` if this runtime has one. Every access is guarded: private mode, a quota error and
 * SSR all degrade to "no journal", which is the same state as a first visit and therefore safe.
 */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Read + validate the whole store; any failure (corrupt / future version) discards it entirely. */
function loadStore(): OnRampRequestRecord[] {
  const raw = storage()?.getItem(ONRAMP_JOURNAL_KEY);
  if (!raw) return [];
  try {
    const parsed = onRampJournalStoreSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.requests : [];
  } catch {
    return [];
  }
}

function saveStore(requests: OnRampRequestRecord[]): void {
  try {
    storage()?.setItem(
      ONRAMP_JOURNAL_KEY,
      JSON.stringify({ version: ONRAMP_JOURNAL_VERSION, requests }),
    );
  } catch {
    // A full or unavailable store must never break a purchase flow: it degrades to mint-fresh.
  }
}

/**
 * Every read prunes: aged records go, and only the most recent {@link ONRAMP_JOURNAL_MAX_RECORDS}
 * are kept (newest first). Pruning on read keeps the bound even for a user who never resolves a
 * purchase. Persists the pruned set only when it actually shrank, so a plain read is not a write.
 */
export function readOnRampRequests(now: number = Date.now()): OnRampRequestRecord[] {
  const all = loadStore();
  const kept = all
    .filter((record) => now - record.createdAt < ONRAMP_JOURNAL_MAX_AGE_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, ONRAMP_JOURNAL_MAX_RECORDS);
  if (kept.length !== all.length) saveStore(kept);
  return kept;
}

/**
 * Record a purchase intent as `open`, BEFORE the widget opens ([R7]). Upserts by `requestId`, so a
 * re-entry that already holds one never duplicates it. Returns the persisted record.
 */
export function recordOnRampRequest(
  input: { requestId: string; wallet: string },
  now: number = Date.now(),
): OnRampRequestRecord {
  const record: OnRampRequestRecord = {
    requestId: input.requestId,
    wallet: input.wallet.toLowerCase(),
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  const others = readOnRampRequests(now).filter((r) => r.requestId !== input.requestId);
  saveStore([record, ...others].slice(0, ONRAMP_JOURNAL_MAX_RECORDS));
  return record;
}

/**
 * The `open` (resumable) intent for the connected wallet, if any. A terminal record, another wallet's
 * record, or one older than {@link ONRAMP_REQUEST_RESUMABLE_MS} is never returned, so the mint site
 * reuses only a genuinely-in-flight purchase.
 *
 * POO-1384: the age bound is the fix. Without it an intent left `open` by a tab that died with no
 * terminal event stayed resumable for the full 24h retention window, so the next attempt reopened a
 * `requestId` Paybis had already expired. Minting fresh instead costs one wallet signature; reusing
 * a dead id costs the user the purchase.
 */
export function findResumableOnRampRequest(
  wallet: string,
  now: number = Date.now(),
): OnRampRequestRecord | null {
  const owner = wallet.toLowerCase();
  return (
    readOnRampRequests(now).find(
      (r) =>
        r.wallet === owner &&
        r.status === "open" &&
        // PAID is what makes a record worth resuming forever, not its age. The age bound applies only
        // to intents that never reached `completed`: those are the abandonment case (the widget was
        // shut, or the tab died, before any card was charged), where nothing is landing and the only
        // thing reuse achieves is reopening a `requestId` Paybis has expired. A paid record is the
        // opposite: `timeOut()` leaves it `open` precisely BECAUSE the money may still be moving, and
        // a bank transfer can take hours, so expiring it on a timer would re-mint into the exact
        // double charge this journal exists to prevent.
        (r.paidAt !== undefined || now - r.createdAt < ONRAMP_REQUEST_RESUMABLE_MS),
    ) ?? null
  );
}

/**
 * An `open` intent for this wallet that {@link findResumableOnRampRequest} will NOT auto-resume: past
 * the resumable window with no `paidAt`. Null when there is none.
 *
 * This exists because "no `paidAt`" does not mean "not paid" — it means WE NEVER SAW the payment, and
 * those are very different claims. `paidAt` is written from one place, the widget's `completed` event,
 * and money can move without us observing it:
 *
 *   - a bank transfer, where the user leaves the widget for their banking app long before `completed`,
 *     which is the very rail the resumable window was written to protect;
 *   - `payment-redirect` (3DS / bank), which unloads our page, taking the listener with it;
 *   - `payment-initiated` and `payout-waiting`, real vendor states we deliberately do not handle;
 *   - a dismissal mid-checkout, now that the modal releases during a buy, which unmounts the frame and
 *     detaches the listener;
 *   - every record already in users' localStorage at the deploy that shipped `paidAt`, including the
 *     pre-POO-1377 ones that are paid-with-no-`paidAt` by construction, because `completed` was not
 *     parseable then;
 *   - a fifth parser drift, this channel having silently dropped events in four prior releases.
 *
 * So the client cannot honestly decide this one, and neither silent branch is safe: auto-resuming
 * reopens a `requestId` Paybis may have expired (the "Session timed out" dead end), while auto-minting
 * may open a SECOND purchase beside funds that are still landing (the double charge). The caller asks
 * the user instead. See {@link ONRAMP_REQUEST_RESUMABLE_MS}.
 */
export function findExpiredOnRampIntent(
  wallet: string,
  now: number = Date.now(),
): OnRampRequestRecord | null {
  const owner = wallet.toLowerCase();
  return (
    readOnRampRequests(now).find(
      (r) =>
        r.wallet === owner &&
        r.status === "open" &&
        r.paidAt === undefined &&
        now - r.createdAt >= ONRAMP_REQUEST_RESUMABLE_MS,
    ) ?? null
  );
}

/**
 * Mark an intent PAID: the widget reported `completed`, so the card was charged and the funds are
 * only waiting to land. No-op if the id is unknown. Called from `useOnRampSettlement`'s
 * `startReconcile`, which is the one place that observes the transition.
 *
 * Deliberately NOT a {@link OnRampRequestStatus}: `paid` is orthogonal to the lifecycle, not a member
 * of it. The record stays `open` (still resumable, still awaiting a delta) and settles or fails from
 * there exactly as before; this only records that money moved, so
 * {@link findResumableOnRampRequest} can stop applying an age bound built for the never-paid case.
 */
export function markOnRampPaid(requestId: string, now: number = Date.now()): void {
  const all = loadStore();
  const index = all.findIndex((r) => r.requestId === requestId);
  if (index === -1) return;
  const current = all[index] as OnRampRequestRecord;
  // First observation wins: `startReconcile` is idempotent by its own guard, but a resumed intent
  // re-enters reconcile on the SECOND visit, and moving `paidAt` forward there would restart a
  // window that is supposed to date from the charge.
  if (current.paidAt !== undefined) return;
  const next = [...all];
  next[index] = { ...current, paidAt: now, updatedAt: now };
  saveStore(next);
}

/** Move an intent to a new status (terminal states make it non-resumable). No-op if absent. */
export function markOnRampRequest(
  requestId: string,
  status: OnRampRequestStatus,
  now: number = Date.now(),
): void {
  const all = loadStore();
  const index = all.findIndex((r) => r.requestId === requestId);
  if (index === -1) return;
  const current = all[index] as OnRampRequestRecord;
  const next = [...all];
  next[index] = { ...current, status, updatedAt: now };
  saveStore(next);
}

/** Delete an intent entirely (e.g. the user abandoned it). */
export function retireOnRampRequest(requestId: string): void {
  saveStore(loadStore().filter((r) => r.requestId !== requestId));
}
