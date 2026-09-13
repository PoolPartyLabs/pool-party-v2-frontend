/**
 * @id PP-CORE-LIB-107 (POO-1802)
 * @name on-ramp intent record
 * @implements-rules-version v1 (POO-1802 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * @analytics-events none, this module writes to `localStorage` and emits nothing. Deliberately: an
 *   intent is not a funnel step. The events for the phases recorded here are emitted by the surfaces
 *   that CAUSE them (the adapter in POO-1803, the watcher in POO-1804, the hosts in POO-1807/1808),
 *   where the user action actually happens. Emitting from a storage module would double-count every
 *   transition and would fire on a reload, which moves no money and is not a step.
 *
 * Implements ADR-0007. Privy returns no identifier for a fiat purchase on any path: `AddFundsResult`
 * is `{method, status}`, the status endpoint carries no amount, there is no server-side REST route
 * for the card rail, and `reference_id` exists only on actions we ourselves initiate. Its
 * concurrency guard is also tab-scoped, so it survives neither a reload, nor a second tab, nor a
 * buyer returning the next day.
 *
 * This store is therefore not a copy of anything the provider holds. It is the only place the
 * attempt exists.
 *
 * ## The three questions it exists to answer ([R4])
 *
 * Each has a field, and none of them is answerable today:
 *
 *   1. **Did the buyer change the amount inside the provider's modal?** `requested` is what they
 *      typed on our screen, `prefill` is what we actually passed in (they differ by the buffer). A
 *      third figure arriving on chain that matches neither is a buyer who retyped.
 *   2. **What did the spread actually cost on this purchase?** `prefill` against `delivered`. The
 *      spread belongs to the provider and we never model it as a number of our own (CONTEXT.md), so
 *      measuring it after the fact is the only way the 5% buffer can shrink on evidence rather than
 *      on argument.
 *   3. **Where did a failed attempt stop?** `phase` plus `outcome`.
 *
 * ## Vocabulary (CONTEXT.md, ADR-0006)
 *
 * `phase` is the ADR-0006 lifecycle. Two members carry meaning that is easy to get wrong:
 *
 *   - **`cancelled`** is reserved for a cancellation the PROVIDER reported BEFORE any charge. It is
 *     the only path on which a screen may say "cancelled" at all, because on every other path money
 *     could have moved. An inconclusive exit is `exited`, never this.
 *   - **`unverified`** is the terminal of ADR-0006's PASSIVE observation window: the window closed
 *     without a delta landing. It is not a claim that nothing was charged, only that we never saw
 *     it. Distinguishing those two is precisely what we cannot do, and saying so is the honest
 *     answer.
 *
 * `confirmed` is the provider's claim that it finished charging, which is evidence money MAY have
 * moved. `settled` is the moment the delta appeared on chain, which is the only event that may be
 * called completion. They are different fields' worth of different, and conflating them is the bug
 * ADR-0004 exists to prevent.
 *
 * ## `delivered` is the only figure a screen may print
 *
 * ADR-0004: the observed balance delta on the destination chain is the sole authority on a funded
 * amount. `requested` and `prefill` are spend-side figures and must never be printed as what the
 * buyer received. `delivered` stays `null` until the delta lands, and a null here means "we do not
 * know", never "zero".
 *
 * Inside `delivered`, **`amountRaw` is the authority**: base units, exactly the integer the chain
 * reported, as a decimal string so it survives JSON without ever becoming a float. `amount` sits
 * beside it for a screen and for a support answer, and downstream (POO-1806, POO-1813) reads
 * `amountRaw`, never `amount`, for anything it computes with. `decimals` on the record is what
 * converts between them.
 *
 * ## What the record carries, so the window can resume from the record alone
 *
 * A purchase outlives the screen that started it (ADR-0006's passive window), so the record has to
 * hold everything needed to resume WITHOUT the host that minted it:
 *
 *   - **`wallet`**: the SIWE-session address the intent was minted for, lowercased at mint exactly
 *     as the journal does (`onRampJournal.ts:167`). The store is per browser profile, but a profile
 *     is not a wallet: `WalletSwitchGuard` exists precisely because a buyer switches from A to B
 *     inside one session, and wagmi already persists the connected address in this same profile. An
 *     unscoped read would offer wallet B a reconcile against wallet A's purchase, so every reader
 *     that answers "is there an attempt for THIS caller" takes the wallet.
 *   - **`baselineRaw`** and **`decimals`**: the destination asset's balance in base units as the
 *     host read it BEFORE the checkout opened, and that asset's decimals. The delta is
 *     `balanceNow - baselineRaw`, and the baseline is knowable only before the modal opens, so a
 *     record without it can never be reconciled after a reload. Both are the caller's contract:
 *     `baselineRaw` is a base-unit decimal string, validated on read.
 *
 * ## Scoped readers versus the unscoped one
 *
 * {@link findOpenOnRampIntent} is SCOPED: it takes the caller's wallet and never returns another
 * wallet's record, because its answer gates a money decision. {@link readOnRampIntents} is
 * deliberately UNSCOPED, because it is the pruning read and the support view: retention has to bound
 * the whole store regardless of which wallet is connected, and a support answer is being looked for
 * precisely when the buyer cannot say which address they used. Any future reader whose answer feeds
 * a decision takes a wallet; only the prune stays unscoped.
 *
 * ## Untrusted input
 *
 * `localStorage` is writable by any XSS or browser extension, and this blob gates a money decision
 * (reconcile against an open intent, rather than offer a second purchase). So it is Zod-parsed on
 * every read, and a parse failure discards the WHOLE store rather than salvaging part of it, which
 * degrades to "no open intent" and is always the safe direction.
 *
 * The `.finite()` bounds are load-bearing rather than decoration, and the on-ramp journal
 * (`PP-CORE-LIB-067`) paid for that lesson in production: `z.number()` ACCEPTS `Infinity`, and
 * `JSON.parse('{"createdAt":1e999}')` yields exactly that, so a hand-edited record made
 * `now - createdAt === -Infinity` and passed every age bound, pinning an intent as live forever.
 *
 * ## Scope
 *
 * This is the Privy-era successor of `onRampJournal.ts` (`PP-CORE-LIB-067`), which keeps serving the
 * live Paybis rail untouched until POO-1809 retires it with its consumers. This module ships alone:
 * the adapter mints (POO-1803), the watcher updates (POO-1804), and the hosts reconcile
 * (POO-1807/1808). No consumer is wired here, and nothing external is called: this module touches
 * `localStorage` and nothing else, so it declares no integration seam and adds no row to
 * `docs/INTEGRATION_POINTS.md`. (Spelling the marker token out here would be counted by the seam
 * census in `tests/hackathonDocs.test.ts`, which greps the tree, so it is deliberately not written.)
 */
"use client";

import { z } from "zod";

/** Namespaced AND version-pinned: a v2 shape lives at a v2 key and can never be misread as this one. */
export const ONRAMP_INTENT_KEY = "pp.onramp.intent.v1";

/** The only store version this module reads. A record written by a future build is ignored whole. */
export const ONRAMP_INTENT_SCHEMA_VERSION = 1;

/**
 * How long a record is KEPT. **v1 default, chosen by the epic, and meant to be moved on evidence.**
 *
 * 30 days, against the journal's 24 hours. That window was sized for a rail that resolved in minutes;
 * this one does not. A card purchase can take hours (3DS, a bank app, a manual review), and the
 * SUPPORT question about it arrives days later, from a buyer who has since closed the tab. A record
 * pruned before the question is asked is a question nobody can answer, which is the exact failure
 * this store exists to end.
 *
 * The cost of holding it is one small JSON blob per attempt in the buyer's own browser profile; the
 * cost of pruning it early is an unanswerable "where did my money go".
 */
export const ONRAMP_INTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a NEVER-CONFIRMED intent stays OPEN, as opposed to how long the record is KEPT.
 *
 * These are two different windows and POO-1384 is the incident that proves it. There, retention was
 * the only bound, so an intent left open by a tab that died with no terminal event stayed live for
 * the full retention window and the next attempt resumed a request the vendor had long expired. The
 * journal's fix is `ONRAMP_REQUEST_RESUMABLE_MS` (`onRampJournal.ts:60`) plus the age bound at
 * `onRampJournal.ts:187-205`, and 15 minutes is that constant's value, taken as the precedent
 * rather than re-argued here.
 *
 * The bound applies ONLY before the provider claims a charge. Up to that point an open record is an
 * abandonment: the modal was shut, or the tab died, and nothing is landing, so continuing to watch
 * it on every return costs the buyer a permanent phantom purchase. Once `confirmed` has been
 * observed the opposite holds, money may genuinely still be moving and a card can take hours, so
 * {@link findOpenOnRampIntent} applies no age bound at all and only retention ends it.
 *
 * PP-NOTE: 15 minutes is inherited, not measured. Narrow it if a real abandonment is observed
 * reconciling later than this.
 *
 * POO-1928 [R1]: this constant now has a DEPENDENT. The Privy adapter's `PROVIDER_TIMEOUT_MS`
 * (`usePrivyOnRamp.ts`, `PP-CORE-HOK-035`) is derived as this value minus a named margin, so its
 * stuck-state backstop always fires while the record it is about to write is still OPEN by
 * {@link isStillOpen}'s strict `<`. Before that, both were spelled `15 * 60 * 1000` independently
 * and the two instants coincided: the timeout verdict was written to a record
 * {@link findOpenOnRampIntent} had stopped returning in the same turn. Moving THIS number moves
 * that one with it, which is the point; the adapter's spec asserts the ordering. The derivation
 * lives over there because the import is one-way (the adapter reads this module, this module reads
 * nothing of the adapter's), and deriving in this direction would make it a cycle.
 */
export const ONRAMP_INTENT_OPEN_WINDOW_MS = 15 * 60 * 1000;

/**
 * How many records the store keeps, so `localStorage` cannot grow without bound. **v1 default.**
 *
 * 20, against the journal's 3. Three was a live-intent guard, not a history: it only ever had to
 * hold the purchases plausibly in flight right now. This is a history, and 20 attempts is more than
 * a retail buyer makes in 30 days while still being trivially small on disk.
 */
export const ONRAMP_INTENT_MAX_RECORDS = 20;

/**
 * The ADR-0006 lifecycle. See the header for `cancelled` and `unverified`, the two whose meaning is
 * narrower than their name suggests.
 */
export const ONRAMP_INTENT_PHASES = [
  "created",
  "opened",
  "exited",
  "confirmed",
  "settling",
  "unverified",
  "settled",
  "failed",
  "cancelled",
] as const;

/** How an attempt ended. `null` while it is still open, which is what `findOpenOnRampIntent` reads. */
export const ONRAMP_INTENT_OUTCOMES = ["settled", "failed", "cancelled", "unverified"] as const;

/** A base-unit integer, carried as a decimal string so JSON never turns it into a float. */
const baseUnitSchema = z.string().regex(/^\d+$/);

/** A spend-side figure: what was asked for, or what we passed. Never what arrived. */
const moneySchema = z.object({
  amount: z.number().finite().nonnegative(),
  /** Uppercase ISO 4217, ours rather than the provider's casing. */
  currency: z.string().min(1),
});

/**
 * Where the money is going. Typed as plain strings here on purpose: `chain` is CAIP-2
 * (`eip155:8453`) and `asset` is a token address, and POO-1801 owns the helpers that PRODUCE them.
 * This module stores what it is handed and validates shape, not chain membership, so a new chain
 * does not require a change here.
 */
const destinationSchema = z.object({
  chain: z.string().min(1),
  asset: z.string().min(1),
});

/**
 * The delta, once observed. ADR-0004: the sole authority on a funded amount. `amountRaw` is the
 * authoritative figure and `amount` is its display companion; see the header.
 */
const deliveredSchema = z.object({
  amountRaw: baseUnitSchema,
  amount: z.number().finite().nonnegative(),
  asset: z.string().min(1),
  chain: z.string().min(1),
  observedAt: z.number().int().nonnegative().finite(),
});

const intentSchema = z.object({
  /** Ours, minted before the modal opens ([R1]). Never a provider value: it gives us none. */
  attemptId: z.string().min(1),
  /** Which rail produced it, so a later rail can share this store rather than fork it. */
  rail: z.literal("privy"),
  /** Lowercased SIWE-session wallet the intent was minted for; never a client-supplied one. */
  wallet: z.string().min(1),
  createdAt: z.number().int().nonnegative().finite(),
  updatedAt: z.number().int().nonnegative().finite(),
  /**
   * When the provider first claimed it had charged. Absent means it never got that far, which is
   * what {@link ONRAMP_INTENT_OPEN_WINDOW_MS} bounds. Optional rather than nullable so a record
   * written by an older build reads as "never confirmed", the safe direction: it expires on the
   * openness window instead of staying open for the full retention window.
   */
  confirmedAt: z.number().int().nonnegative().finite().optional(),
  requested: moneySchema,
  prefill: moneySchema,
  destination: destinationSchema,
  /** Destination-asset balance in base units, read BEFORE the checkout opened. The delta's origin. */
  baselineRaw: baseUnitSchema,
  /** Decimals of the destination asset, so base units and the display figure can be converted. */
  decimals: z.number().int().nonnegative().finite(),
  delivered: deliveredSchema.nullable(),
  phase: z.enum(ONRAMP_INTENT_PHASES),
  outcome: z.enum(ONRAMP_INTENT_OUTCOMES).nullable(),
  /** Joins this attempt to its server-side and Sentry records. Null when none was available. */
  traceId: z.string().nullable(),
});

const intentStoreSchema = z.object({
  schemaVersion: z.literal(ONRAMP_INTENT_SCHEMA_VERSION),
  intents: z.array(intentSchema),
});

/** One persisted purchase attempt. */
export type OnRampIntentRecord = z.infer<typeof intentSchema>;
/** A spend-side figure. */
export type OnRampMoney = z.infer<typeof moneySchema>;
/** The CAIP-2 chain plus token address the purchase targets. */
export type OnRampDestination = z.infer<typeof destinationSchema>;
/**
 * The observed delta as this record stores it. Named for the record on purpose: the watcher
 * (POO-1804) has its own `OnRampDelivered`, which is what it reports from a chain read, and two
 * different shapes sharing one name across a stacked lane is how a wrong one gets imported.
 */
export type OnRampIntentDelivered = z.infer<typeof deliveredSchema>;
/** The ADR-0006 lifecycle phase. */
export type OnRampIntentPhase = (typeof ONRAMP_INTENT_PHASES)[number];
/** How an attempt ended. */
export type OnRampIntentOutcome = (typeof ONRAMP_INTENT_OUTCOMES)[number];

/**
 * What a caller supplies to mint. Deliberately has NO `attemptId` field: [R1] says the key is ours,
 * and the record below is built field by field rather than by spreading this input, so a caller
 * cannot smuggle one in even by passing an extra property.
 */
export interface MintOnRampIntentInput {
  /** The SIWE-session wallet. Lowercased here, so a caller may pass checksum casing. */
  wallet: string;
  requested: OnRampMoney;
  prefill: OnRampMoney;
  destination: OnRampDestination;
  /** Base-unit decimal string, read from the chain BEFORE the checkout opened. */
  baselineRaw: string;
  /** Decimals of `destination.asset`. */
  decimals: number;
  traceId?: string | null;
}

/**
 * The fields a later phase may move. Two are absent on purpose:
 *
 *   - `delivered` has its own function, because it is only ever written from an observed delta.
 *   - `outcome: "settled"` is excluded, so {@link recordOnRampDelivery} is the ONLY writer of it.
 *     `outcome` is what {@link findOpenOnRampIntent} reads, so it is the field that actually decides
 *     whether an attempt is finished, and ADR-0004 says only the on-chain delta may decide that.
 *     The runtime refuses it too, because JavaScript reaches this store without a typechecker.
 */
export type OnRampIntentPatch = Partial<Pick<OnRampIntentRecord, "phase" | "traceId">> & {
  outcome?: Exclude<OnRampIntentOutcome, "settled"> | null;
};

/**
 * `localStorage` if this runtime has one. Every access is guarded: SSR, private mode and a browser
 * that denies storage all degrade to "no record", which is the same state as a first visit and
 * therefore safe.
 */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Read + validate the whole store; any failure (corrupt, tampered, future version) discards it. */
function loadStore(): OnRampIntentRecord[] {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(ONRAMP_INTENT_KEY) ?? null;
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = intentStoreSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.intents : [];
  } catch {
    return [];
  }
}

function saveStore(intents: OnRampIntentRecord[]): void {
  try {
    storage()?.setItem(
      ONRAMP_INTENT_KEY,
      JSON.stringify({ schemaVersion: ONRAMP_INTENT_SCHEMA_VERSION, intents }),
    );
  } catch {
    // A full or unavailable store must never break a purchase flow: it degrades to no record.
  }
}

/** Newest first, aged records gone, capped. Pure: the callers decide when it is persisted. */
function prune(records: OnRampIntentRecord[], now: number): OnRampIntentRecord[] {
  return records
    .filter((record) => now - record.createdAt < ONRAMP_INTENT_RETENTION_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, ONRAMP_INTENT_MAX_RECORDS);
}

/**
 * Whether an unresolved record is still within its openness window. Confirmed records have none:
 * see {@link ONRAMP_INTENT_OPEN_WINDOW_MS}.
 */
function isStillOpen(record: OnRampIntentRecord, now: number): boolean {
  if (record.confirmedAt !== undefined) return true;
  return now - record.createdAt < ONRAMP_INTENT_OPEN_WINDOW_MS;
}

/**
 * Persist ONE record, re-reading the store first and merging by `attemptId`.
 *
 * `localStorage` has no compare-and-swap, so a writer that saves the array it read earlier makes the
 * whole store last-write-wins: a record another tab added in between vanishes. Re-reading inside the
 * write narrows that to last-write-wins PER RECORD, which is the honest granularity, since two tabs
 * editing the same attempt is a contradiction anyway while two tabs each editing their own attempt
 * is routine (a buyer opens a second tab, or returns to a stale one).
 */
function commitRecord(record: OnRampIntentRecord, now: number): void {
  const current = loadStore().filter((other) => other.attemptId !== record.attemptId);
  saveStore(prune([record, ...current], now));
}

/**
 * Every read prunes: records past {@link ONRAMP_INTENT_RETENTION_MS} go, and only the newest
 * {@link ONRAMP_INTENT_MAX_RECORDS} are kept, newest first. Pruning on read keeps the bound even for
 * a buyer who never resolves an attempt. Persists only when the set actually shrank, so a plain read
 * is not a write.
 *
 * UNSCOPED on purpose: retention bounds the whole store whichever wallet is connected, and the
 * support view needs every attempt this profile made. The reader that gates a decision is
 * {@link findOpenOnRampIntent}, and that one takes a wallet.
 *
 * A TERMINAL record is not pruned by being terminal. It is the support reference, and it survives
 * until the retention window ends like any other.
 */
export function readOnRampIntents(now: number = Date.now()): OnRampIntentRecord[] {
  const all = loadStore();
  const kept = prune(all, now);
  if (kept.length === all.length) return kept;
  // The prune is a write, so it re-reads for the same reason `commitRecord` does.
  const fresh = prune(loadStore(), now);
  saveStore(fresh);
  return fresh;
}

/**
 * Our attempt id ([R1]). `crypto.randomUUID` where it exists, then `getRandomValues`, then a
 * timestamp-plus-random last resort.
 *
 * The fallbacks are not theatre: `randomUUID` is unavailable on an insecure origin in some browsers,
 * and this id must exist before the modal opens or the attempt has no key at all. Uniqueness is what
 * matters here, not unguessability: the id keys a record in the buyer's own browser and is never a
 * capability, a token or anything a server trusts.
 */
function mintAttemptId(): string {
  try {
    const source = globalThis.crypto;
    if (typeof source?.randomUUID === "function") return source.randomUUID();
    if (typeof source?.getRandomValues === "function") {
      const bytes = source.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Fall through to the last resort below.
  }
  return `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Record an attempt BEFORE the provider's modal opens ([R1]), at `phase: "created"` with nothing
 * delivered and no outcome. Returns the persisted record; the caller keeps its `attemptId`.
 */
export function mintOnRampIntent(
  input: MintOnRampIntentInput,
  now: number = Date.now(),
): OnRampIntentRecord {
  const record: OnRampIntentRecord = {
    attemptId: mintAttemptId(),
    rail: "privy",
    wallet: input.wallet.toLowerCase(),
    createdAt: now,
    updatedAt: now,
    requested: {
      amount: input.requested.amount,
      currency: input.requested.currency.toUpperCase(),
    },
    prefill: { amount: input.prefill.amount, currency: input.prefill.currency.toUpperCase() },
    destination: { chain: input.destination.chain, asset: input.destination.asset },
    baselineRaw: input.baselineRaw,
    decimals: input.decimals,
    delivered: null,
    phase: "created",
    outcome: null,
    traceId: input.traceId ?? null,
  };
  // For the prune, not the value: minting is the moment the store is guaranteed to be touched, so
  // it is where retention and the record cap get applied. `commitRecord` then re-reads, which is
  // what keeps a record another tab wrote in between.
  readOnRampIntents(now);
  commitRecord(record, now);
  return record;
}

/**
 * Move an attempt's phase, outcome or trace id, stamping `updatedAt`. Returns the updated record, or
 * `undefined` for an unknown id, writing nothing in that case: an id we do not hold is a record that
 * was pruned or never existed, and inventing one would fabricate an attempt.
 *
 * Also `undefined`, writing nothing, for a patch that tries to set `outcome: "settled"`. The type
 * already excludes it; this is the runtime half of the same rule, because untyped JavaScript reaches
 * this module too and a fabricated settlement is exactly what ADR-0004 forbids.
 *
 * The first move to `phase: "confirmed"` stamps `confirmedAt`, which is what lifts the openness age
 * bound in {@link findOpenOnRampIntent}. First observation wins, mirroring `markOnRampPaid`
 * (`onRampJournal.ts:259-271`): a resumed attempt re-enters this path on a later visit, and moving
 * the stamp forward would restart a window that is supposed to date from the charge.
 */
export function updateOnRampIntent(
  attemptId: string,
  patch: OnRampIntentPatch,
  now: number = Date.now(),
): OnRampIntentRecord | undefined {
  if ((patch.outcome as OnRampIntentOutcome | null | undefined) === "settled") return undefined;
  const current = loadStore().find((record) => record.attemptId === attemptId);
  if (!current) return undefined;
  const updated: OnRampIntentRecord = {
    ...current,
    ...patch,
    confirmedAt: current.confirmedAt ?? (patch.phase === "confirmed" ? now : undefined),
    updatedAt: now,
  };
  commitRecord(updated, now);
  return updated;
}

/**
 * The delta landed: record what actually arrived and close the attempt as settled. This is the ONLY
 * writer of `delivered`, and the only path to `outcome: "settled"`, because ADR-0004 makes the
 * observed delta the sole authority on a funded amount. A provider `confirmed` never reaches here.
 *
 * `amountRaw` is required and is the authority; `amount` rides along for display. See the header.
 *
 * `undefined` for an unknown id, same reasoning as {@link updateOnRampIntent}.
 */
export function recordOnRampDelivery(
  attemptId: string,
  delivered: { amountRaw: string; amount: number; asset: string; chain: string },
  now: number = Date.now(),
): OnRampIntentRecord | undefined {
  const current = loadStore().find((record) => record.attemptId === attemptId);
  if (!current) return undefined;
  const updated: OnRampIntentRecord = {
    ...current,
    delivered: {
      amountRaw: delivered.amountRaw,
      amount: delivered.amount,
      asset: delivered.asset,
      chain: delivered.chain,
      observedAt: now,
    },
    phase: "settled",
    outcome: "settled",
    updatedAt: now,
  };
  commitRecord(updated, now);
  return updated;
}

/**
 * The newest unresolved attempt FOR THIS WALLET, or `null`. This is ADR-0006's reconcile-on-return
 * hook: the passive observation window outlives the screen, so a returning buyer must be reconciled
 * against this rather than offered a second purchase.
 *
 * Three bounds, and each of them is load-bearing:
 *
 *   - **The wallet.** Another wallet's attempt is not this caller's to reconcile, and this profile
 *     genuinely holds several (`WalletSwitchGuard`). Matched lowercased, as the journal does
 *     (`onRampJournal.ts:187-197`).
 *   - **`outcome === null`,** not a phase test. `unverified` is a real terminal even though nothing
 *     was confirmed: the window closed, and re-opening it on every return would watch forever.
 *   - **The openness window,** but only until the provider claims a charge. See
 *     {@link ONRAMP_INTENT_OPEN_WINDOW_MS}: before `confirmedAt`, an aged-out open record is an
 *     abandonment and watching it forever is a phantom purchase; after it, money may still be
 *     moving and only retention may end it.
 */
export function findOpenOnRampIntent(
  wallet: string,
  now: number = Date.now(),
): OnRampIntentRecord | null {
  const owner = wallet.toLowerCase();
  return (
    readOnRampIntents(now).find(
      (record) => record.wallet === owner && record.outcome === null && isStillOpen(record, now),
    ) ?? null
  );
}

/** Empty the store. For tests only; nothing in the app deletes an intent. */
export function clearOnRampIntentsForTests(): void {
  try {
    storage()?.removeItem(ONRAMP_INTENT_KEY);
  } catch {
    // Same reasoning as saveStore: never throw out of a storage guard.
  }
}
