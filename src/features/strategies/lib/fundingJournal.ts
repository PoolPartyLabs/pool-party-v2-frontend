/**
 * @id PP-STR-LIB-019 (POO-1038, POO-1043)
 * @name funding recovery journal
 * @implements-rules-version v2 (POO-1043 rules v1) · v1 (POO-1038 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The client-persisted record of funding transactions we have put on a chain that the chain has not
 * finished reflecting. `docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3 is the design; this is it.
 *
 * ## Why this exists at all
 *
 * A funding plan is a PURE FUNCTION of current on-chain holdings (§3.1), so re-deriving it cannot
 * repeat a settled leg: the funds that leg would spend are already gone and the fresh derivation
 * simply does not contain it. That closes the settled case completely, for free, and it is a stronger
 * guarantee than any client bookkeeping could give.
 *
 * It leaves exactly one gap. **A transaction that has been broadcast but has not settled is invisible
 * to a balance read**, so "my balances have not changed" is indistinguishable from "nothing happened",
 * and the difference is a double bridge. This journal answers that one question: *which transactions
 * have I already put on a chain?* It is a list of in-flight intents with their hashes. It is not an
 * execution plan, it is not a cache of calldata, and it is **never trusted over the chain** (§3.2):
 * when the two disagree the chain wins and the record is corrected ({@link applyReconciliation}).
 *
 * ## Write ordering is the safety property (§3.4)
 *
 * Per leg, in this order and no other:
 *
 *   1. read `nonceBefore` on the leg's chain, and for a bridge the destination baseline;
 *   2. flush the leg as `planned` with both  ← {@link FundingJournalRecorder.beginLeg}
 *   3. prompt the wallet and broadcast;
 *   4. flush `broadcast` + `txHash` **synchronously, before awaiting the receipt**
 *                                            ← {@link FundingJournalRecorder.recordBroadcast}
 *   5. await settlement, then flush `settled`.
 *
 * Step 2 before step 3 is what makes the nonce test meaningful. Step 4 before the await is what makes
 * the receipt test possible: `sendTransaction` resolves with the hash long before a receipt exists,
 * and a hash learned and then lost to a closed tab is the failure this ordering prevents.
 *
 * ## What is deliberately NOT stored (§3.3)
 *
 * No calldata, no signatures, no permit payloads, no quote objects, no API responses: nothing a
 * replay could be built from. Every leg is re-quoted at execution time, so a stored quote would be at
 * best dead weight and at worst something a future author broadcasts. What it does hold is public
 * chain data plus the user's own address, so a journal read by another script on this origin
 * discloses nothing an explorer does not.
 *
 * ## Untrusted input
 *
 * This blob influences money decisions, so it is validated on EVERY read and a parse failure discards
 * the whole store rather than salvaging part of it (§3.7). Partial trust in a corrupt record is worse
 * than starting clean, because starting clean falls back to re-deriving from the chain, which is
 * always safe for settled legs.
 *
 * PP-INTEGRATION-POINT: `readNonce` on {@link JournalRecorderDeps} is a real
 * `eth_getTransactionCount(wallet, "latest")` on the leg's chain, injected by the caller so this
 * module stays transport-free and unit-testable without a network.
 */
"use client";

import { z } from "zod";

/** Namespaced AND version-pinned: a v2 shape lives at a v2 key and can never be misread as this one. */
export const FUNDING_JOURNAL_KEY = "pp.funding.journal.v1";

/** The only store version this module reads. A record written by a future version is ignored. */
export const FUNDING_JOURNAL_VERSION = 1;

/** Journals older than this are pruned on read (§3.7). A bridge takes minutes, never a day. */
export const JOURNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How many journals the store keeps. Bounded so `localStorage` cannot grow without limit (§3.7). */
export const JOURNAL_MAX_RECORDS = 3;

/**
 * How long a tab's lease survives without a heartbeat (§3.8). A tab refuses to execute a journal
 * whose heartbeat is younger than this and not its own; anything older means the holder is gone.
 */
export const LEASE_TTL_MS = 30_000;

/** The operations provisioning can precede. Mirrors the six wallet flows this repo already ships. */
export type FundingOperationKind =
  | "invest"
  | "withdraw"
  | "collect"
  | "compound"
  | "move-range"
  | "close";

/**
 * What a journaled transaction does. `approve` is journaled too: it is a broadcast like any other.
 *
 * `bridge-gas` carries native coin to a chain that could not otherwise pay for a transaction
 * (POO-1075). It is journaled like every other leg, and it especially must be: it is the one leg
 * whose funds land somewhere the user cannot yet act, so a lost record is money that looks missing.
 *
 * Widening this union widens the persisted schema below. Widening is the safe direction: records
 * written by an older build still parse. The reverse is not true, which is a rollback concern.
 */
export type FundingLegKind = "approve" | "swap-token" | "swap-gas" | "bridge" | "bridge-gas";

/**
 * A leg's lifecycle. `unknown` is the honest verdict for the residual window of §3.9 (the wallet
 * broadcast and the app never learned the hash) and is NOT terminal: it has to be surfaced.
 */
export type FundingLegStatus = "planned" | "broadcast" | "settled" | "failed" | "unknown";

/**
 * A base-unit amount: a decimal STRING, never a float. Every comparison downstream is `BigInt`, so a
 * value that is not a plain sequence of digits is a corrupt record, not a rounding problem.
 */
const baseUnits = z.string().regex(/^\d+$/, "base-unit amounts are decimal strings");

/**
 * A transaction hash, deliberately loose: any 0x-prefixed hex. Strict 32-byte validation would let a
 * provider that formats a hash unusually take down the WHOLE store on a parse failure, and the record
 * we would discard is precisely the "this is in flight" fact that stops a double broadcast. Failing
 * toward keeping the record is the right direction here.
 */
const txHash = z.string().regex(/^0x[0-9a-fA-F]+$/, "a transaction hash is 0x-prefixed hex");

/** An address. Lowercase is not required on read; comparisons normalise. */
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "an address is 20 hex bytes");

const fundingLegSchema = z.object({
  /** Position in the route, which is execution order. */
  index: z.number().int().nonnegative(),
  kind: z.enum(["approve", "swap-token", "swap-gas", "bridge", "bridge-gas"]),
  /** The chain this transaction is broadcast on. For a bridge that is its ORIGIN. */
  chainId: z.number().int().positive(),
  tokenIn: address,
  tokenOut: address,
  /** Bridge legs only: where the funds arrive, and where the settlement test is run (§3.6). */
  destChainId: z.number().int().positive().optional(),
  amountIn: baseUnits,
  /** The floor this leg must deliver. Also the bridge arrival threshold (§3.6). */
  minAmountOut: baseUnits,
  status: z.enum(["planned", "broadcast", "settled", "failed", "unknown"]),
  /** `eth_getTransactionCount(latest)` read BEFORE the wallet was prompted (§3.4 step 1). */
  nonceBefore: z.number().int().nonnegative().optional(),
  txHash: txHash.optional(),
  broadcastAt: z.number().optional(),
  settledAt: z.number().optional(),
  /** Bridge legs only: `balanceOf(wallet, tokenOut)` on `destChainId`, read pre-broadcast (§3.6). */
  destBalanceBefore: baseUnits.optional(),
});

const fundingJournalSchema = z.object({
  journalId: z.string().min(1),
  /** Lowercased. The SIWE-session address the plan was priced for; never a client-supplied one. */
  wallet: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
  operation: z.object({
    kind: z.enum(["invest", "withdraw", "collect", "compound", "move-range", "close"]),
    targetChainId: z.number().int().positive(),
    strategyId: z.string().optional(),
  }),
  legs: z.array(fundingLegSchema),
  /** §3.8, the cross-tab lease. Absent means nobody is driving this journal. */
  activeTabId: z.string().optional(),
  heartbeatAt: z.number().optional(),
});

const fundingJournalStoreSchema = z.object({
  version: z.literal(FUNDING_JOURNAL_VERSION),
  journals: z.array(fundingJournalSchema),
});

export type FundingLeg = z.infer<typeof fundingLegSchema>;
export type FundingJournal = z.infer<typeof fundingJournalSchema>;

/** The intent half of a leg: everything known before the wallet is prompted. */
export type PlannedLegInput = Pick<
  FundingLeg,
  "index" | "kind" | "chainId" | "tokenIn" | "tokenOut" | "amountIn" | "minAmountOut"
> &
  Partial<Pick<FundingLeg, "destChainId" | "destBalanceBefore">>;

/** What {@link createJournal} needs. `legs` is the route, in execution order. */
export interface CreateJournalInput {
  wallet: string;
  operation: FundingJournal["operation"];
  legs: PlannedLegInput[];
}

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

/**
 * Read + validate the raw store, salvaging per journal.
 *
 * §3.7's "no partial trust" is about a RECORD: a journal that does not fully validate is never
 * half-believed, because a half-read recovery record is worse than none. That still holds below,
 * every journal is validated whole or dropped whole.
 *
 * What changed is the blast radius. Validating the store as one object meant a single unreadable
 * journal discarded EVERY sibling, including live in-flight ones belonging to other operations. That
 * is not more trustworthy, only lossier: the sibling records were never in question. The concrete
 * way it bites is a schema that widened (POO-1075 added `bridge-gas`) followed by a frontend
 * rollback, where the older build cannot read the newer record and would take every concurrent
 * operation's recovery data down with it.
 *
 * Losing a journal does not lose money, the transactions are on-chain either way. It loses the app's
 * MEMORY of them: which bridge is still in flight, what has already been broadcast, what may resume.
 * The user is left reconciling by hand from an explorer, which is exactly the state POO-1055 exists
 * to prevent, so containing it to the one bad record is worth the few lines.
 */
function loadStore(): FundingJournal[] {
  const raw = storage()?.getItem(FUNDING_JOURNAL_KEY);
  if (!raw) return [];
  try {
    const decoded: unknown = JSON.parse(raw);
    const whole = fundingJournalStoreSchema.safeParse(decoded);
    // The overwhelmingly common path: everything parses, nothing to salvage.
    if (whole.success) return whole.data.journals;

    // Something in there does not fit the schema. Keep the journals that do.
    if (typeof decoded !== "object" || decoded === null) return [];
    const envelope = decoded as { version?: unknown; journals?: unknown };
    // The version gate is NOT salvageable. A store written by a future build may mean something
    // different by the same fields, and a record that merely happens to satisfy today's schema is
    // not thereby a record today's build understands. Salvage applies WITHIN a version, never across
    // one: without this check, per-entry rescue would silently start honouring future records that
    // the all-or-nothing read correctly refused.
    if (envelope.version !== FUNDING_JOURNAL_VERSION) return [];
    const journals = envelope.journals;
    if (!Array.isArray(journals)) return [];
    return journals.flatMap((entry) => {
      const one = fundingJournalSchema.safeParse(entry);
      return one.success ? [one.data] : [];
    });
  } catch {
    return [];
  }
}

function saveStore(journals: FundingJournal[]): void {
  try {
    storage()?.setItem(
      FUNDING_JOURNAL_KEY,
      JSON.stringify({ version: FUNDING_JOURNAL_VERSION, journals }),
    );
  } catch {
    // A full or unavailable store must never break a funding flow that is otherwise fine. The cost
    // is losing recovery for this route, which degrades to re-deriving from the chain.
  }
}

/** Settled and failed are done with. `unknown` is NOT: an ambiguous leg has to reach the user (§3.9). */
const TERMINAL_STATUSES: ReadonlySet<FundingLegStatus> = new Set(["settled", "failed"]);

function isRetired(journal: FundingJournal): boolean {
  return journal.legs.length > 0 && journal.legs.every((leg) => TERMINAL_STATUSES.has(leg.status));
}

/**
 * Every read prunes (§3.7): expired journals, fully-terminal journals, and anything beyond the most
 * recent {@link JOURNAL_MAX_RECORDS}. Pruning on READ rather than on a timer means the bound holds
 * even for a user who never completes a route.
 */
export function readJournals(now: number = Date.now()): FundingJournal[] {
  const all = loadStore();
  const kept = all
    .filter((journal) => now - journal.createdAt < JOURNAL_MAX_AGE_MS && !isRetired(journal))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, JOURNAL_MAX_RECORDS);

  // Persist the pruned set only when it actually shrank, so a plain read is not a write.
  if (kept.length !== all.length) saveStore(kept);
  return kept;
}

/** One journal by id, or null. Pruned journals are gone, which is the same answer as never existed. */
export function getJournal(journalId: string, now: number = Date.now()): FundingJournal | null {
  return readJournals(now).find((journal) => journal.journalId === journalId) ?? null;
}

/**
 * The journal for the CONNECTED wallet, if one is in flight (§3.5 rule 2).
 *
 * A journal belonging to another address is never returned, never acted on and never modified.
 * Switching accounts mid-bridge is real user behaviour, and resuming another account's route would
 * be the worst bug this file could have.
 */
export function findResumableJournal(
  wallet: string,
  now: number = Date.now(),
): FundingJournal | null {
  const owner = wallet.toLowerCase();
  return readJournals(now).find((journal) => journal.wallet === owner) ?? null;
}

/**
 * Mint a journal. Called when the user APPROVES the cost breakdown (§3.7), not when the plan is
 * computed: a plan nobody accepted has no in-flight transactions to track.
 */
export function createJournal(input: CreateJournalInput, now: number = Date.now()): FundingJournal {
  const journal: FundingJournal = {
    journalId: crypto.randomUUID(),
    wallet: input.wallet.toLowerCase(),
    createdAt: now,
    updatedAt: now,
    operation: input.operation,
    legs: input.legs.map((leg) => ({ ...leg, status: "planned" as const })),
  };
  saveStore([journal, ...readJournals(now)].slice(0, JOURNAL_MAX_RECORDS));
  return journal;
}

/**
 * Patch one leg, by its route index, and flush.
 *
 * Read-modify-write against `localStorage` on every call rather than against an in-memory copy: the
 * write has to be durable at the instant it happens (§3.4), and another tab may have touched the
 * store since we last looked.
 */
export function updateLeg(
  journalId: string,
  index: number,
  patch: Partial<FundingLeg>,
  now: number = Date.now(),
): void {
  writeJournal(journalId, now, (journal) => ({
    ...journal,
    legs: journal.legs.map((leg) => (leg.index === index ? { ...leg, ...patch } : leg)),
  }));
}

/** Delete a journal: every leg settled, or the user abandoned the route (§3.7). */
export function retireJournal(journalId: string): void {
  saveStore(loadStore().filter((journal) => journal.journalId !== journalId));
}

/**
 * Take the lease if it is free, stale, or already ours (§3.8).
 *
 * A LIVENESS guard, not the correctness guard: correctness comes from reconciliation, which would
 * refuse to broadcast an ambiguous leg even if two tabs did race. This just stops two tabs from
 * driving the same route and confusing the user with two step counters.
 */
export function claimLease(journalId: string, tabId: string, now: number = Date.now()): boolean {
  const journal = getJournal(journalId, now);
  if (!journal) return false;
  // UF-28: `heartbeatAt` falls back to `updatedAt`, never to "unheld". The two lease fields are only
  // ever written together, so a holder with no heartbeat is not reachable through this API at all,
  // which means the only way to produce one is a corrupt or hand-crafted store, and reading it as
  // free would hand another tab a live route. `updatedAt` is the right fallback rather than a flat
  // refusal: every write stamps it, so a live holder keeps it fresh and a dead one still goes stale
  // within the TTL instead of deadlocking the journal forever.
  const lastSeen = journal.heartbeatAt ?? journal.updatedAt;
  const heldByOther =
    journal.activeTabId !== undefined &&
    journal.activeTabId !== tabId &&
    now - lastSeen < LEASE_TTL_MS;
  if (heldByOther) return false;
  writeJournal(journalId, now, (entry) => ({ ...entry, activeTabId: tabId, heartbeatAt: now }));
  return true;
}

/** Keep our lease alive. A no-op from a tab that does not hold it. */
export function heartbeatLease(journalId: string, tabId: string, now: number = Date.now()): void {
  writeJournal(journalId, now, (journal) =>
    journal.activeTabId === tabId ? { ...journal, heartbeatAt: now } : journal,
  );
}

/** Give the lease up so another tab can take it without waiting out {@link LEASE_TTL_MS}. */
export function releaseLease(journalId: string, tabId: string, now: number = Date.now()): void {
  writeJournal(journalId, now, (journal) =>
    journal.activeTabId === tabId
      ? { ...journal, activeTabId: undefined, heartbeatAt: undefined }
      : journal,
  );
}

/** Read-modify-write one journal, stamping `updatedAt`. Absent journal: nothing happens. */
function writeJournal(
  journalId: string,
  now: number,
  mutate: (journal: FundingJournal) => FundingJournal,
): void {
  const journals = loadStore();
  const index = journals.findIndex((journal) => journal.journalId === journalId);
  const current = journals[index];
  if (current === undefined) return;
  const next = [...journals];
  next[index] = { ...mutate(current), updatedAt: now };
  saveStore(next);
}

/** What the recorder needs from the chain. Injected: this module never opens a transport itself. */
export interface JournalRecorderDeps {
  /**
   * `eth_getTransactionCount(wallet, "latest")` on `chainId`, read before the wallet is prompted.
   *
   * PP-INTEGRATION-POINT: a real RPC read (viem `getTransactionCount`, or the wallet provider when
   * the leg runs on the chain it is already sitting on).
   */
  readNonce: (args: { chainId: number }) => Promise<number>;
  /** Overridable clock, so the write ordering can be asserted under fake timers. */
  now?: () => number;
}

/**
 * The rail's write surface, shaped by the ordering rule rather than by convenience.
 *
 * {@link recordBroadcast} is **synchronous on purpose**. It is called with the hash the instant the
 * node returns it, before the caller awaits anything, and making it `async` would reintroduce exactly
 * the window it exists to close.
 */
export interface FundingJournalRecorder {
  /** §3.4 steps 1 and 2: read the nonce, flush the leg as `planned` with its baselines. */
  beginLeg(entry: PlannedLegInput): Promise<void>;
  /** §3.4 step 4: SYNCHRONOUS. Flushes `broadcast` + `txHash` + `broadcastAt`. */
  recordBroadcast(index: number, hash: string): void;
  /** §3.4 step 5: the leg settled (for a bridge, ARRIVED, not merely left). */
  recordSettled(index: number): void;
  /** The leg reverted or was abandoned. Its hash is kept: it is still evidence. */
  recordFailed(index: number): void;
}

/**
 * Bind a recorder to one journal. Legs are upserted by index, so a leg the journal was created
 * without (an approval the rail only discovers it needs at execution time) still gets recorded.
 */
export function createJournalRecorder(
  journalId: string,
  deps: JournalRecorderDeps,
): FundingJournalRecorder {
  const clock = deps.now ?? Date.now;

  return {
    async beginLeg(entry) {
      const nonceBefore = await deps.readNonce({ chainId: entry.chainId });
      // One write, after both reads: a half-written record is worse than a late one, because the
      // nonce test on resume is only meaningful if `nonceBefore` predates the prompt.
      upsertLeg(journalId, { ...entry, status: "planned", nonceBefore }, clock());
    },
    recordBroadcast(index, hash) {
      const now = clock();
      updateLeg(journalId, index, { status: "broadcast", txHash: hash, broadcastAt: now }, now);
    },
    recordSettled(index) {
      const now = clock();
      updateLeg(journalId, index, { status: "settled", settledAt: now }, now);
    },
    recordFailed(index) {
      updateLeg(journalId, index, { status: "failed" }, clock());
    },
  };
}

/**
 * A recorder that resolves WHICH journal it writes to at the moment of each call (POO-1043 [R7]).
 *
 * The execution rail is bound to its dependencies when the plan is quoted, and the journal is minted
 * when the user approves that plan (§3.7). Those two moments are a user decision apart, so a recorder
 * bound to a fixed `journalId` cannot serve both: bind it early and it records a route nobody
 * accepted, bind it late and the steps already hold a journal-less closure. Deferring the lookup is
 * what lets the rail be built once and still write to the journal the confirm mints.
 *
 * With nothing bound every call is a silent no-op, which is exactly the pre-POO-1038 behaviour: the
 * route executes identically and simply leaves no in-flight record. `recordBroadcast` stays
 * SYNCHRONOUS for the reason {@link FundingJournalRecorder} states.
 */
export function createDeferredJournalRecorder(
  resolveJournalId: () => string | null,
  deps: JournalRecorderDeps,
): FundingJournalRecorder {
  const bound = (): FundingJournalRecorder | null => {
    const journalId = resolveJournalId();
    return journalId === null ? null : createJournalRecorder(journalId, deps);
  };

  return {
    beginLeg: async (entry) => {
      // Resolved BEFORE the nonce read, so an unbound recorder never spends an RPC call either.
      await bound()?.beginLeg(entry);
    },
    recordBroadcast: (index, hash) => bound()?.recordBroadcast(index, hash),
    recordSettled: (index) => bound()?.recordSettled(index),
    recordFailed: (index) => bound()?.recordFailed(index),
  };
}

/** Insert or replace a leg by index, preserving route order. */
function upsertLeg(journalId: string, leg: FundingLeg, now: number): void {
  writeJournal(journalId, now, (journal) => {
    const legs = journal.legs.some((existing) => existing.index === leg.index)
      ? journal.legs.map((existing) =>
          existing.index === leg.index ? { ...existing, ...leg } : existing,
        )
      : [...journal.legs, leg].sort((a, b) => a.index - b.index);
    return { ...journal, legs };
  });
}
