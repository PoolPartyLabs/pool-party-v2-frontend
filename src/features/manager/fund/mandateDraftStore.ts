/**
 * @id PP-MGR-STO-001
 * @name mandateDraftStore
 * @implements-rules-version v3 (POO-2121 rules v1, POO-2167 rules v3, POO-2151 rules v1)
 * @analytics-events none, a storage module. The builder shell (PP-MGR-SCR-002) emits the save and
 *   abandon events; a store that emitted its own would double-count every write.
 *
 * Where a mandate draft lives between sessions (R7/R9). Framework-free on purpose: every function
 * here is testable without React, and {@link useMandateDraft} is a thin layer on top.
 *
 * PP-INTEGRATION-POINT: mandate drafts move to the backend draft API when it exists (handoff open
 * point 1, wiring issue POO-2132). This module's API is the seam, so that migration swaps the
 * storage behind these six functions and changes nothing in the screens: `listDrafts` becomes a
 * fetch, `upsertDraft` a PUT, `subscribe` a cache invalidation. The payload is versioned for the
 * same reason.
 *
 * Three behaviours are deliberate and are what the tests pin:
 *
 * 1. **Nothing throws.** Storage is unavailable in a private window, over quota, or blocked by a
 *    cookie policy, and a manager mid-mandate must not lose the screen to it. A failed read is an
 *    empty store; a failed write returns null so the caller can say so in the dialog.
 * 2. **A corrupt payload is read as empty and left alone.** Overwriting it on READ would destroy
 *    whatever a future version, another tab, or a half-finished migration put there. It is replaced
 *    only by the next real write, which is a deliberate user action.
 * 3. **No storage access at import time.** This module is imported by a client component that also
 *    renders on the server, where `window` does not exist.
 *
 * And one for the Build plan (POO-2151, PR #31 review F1): **an unreadable plan is never deleted
 * silently.** A draft whose stored plan this build cannot read loads without it and with
 * `planUnreadable: true`, and every write, of any draft, puts that raw plan back untouched until a
 * save of that draft with a new plan replaces it.
 */
import { normalizePlan } from "./build/plan/planStorage";
import {
  MANDATE_STEP_ORDER,
  type MandateDraft,
  type MandateStepKey,
  withoutUnavailableProtocols,
} from "./mandateDraft";

/** The one storage key. Namespaced and versioned, per the repo's localStorage policy. */
export const MANDATE_DRAFTS_KEY = "pp.manager.mandateDrafts.v1";

/** Payload version. A payload of any other version reads as empty rather than being guessed at. */
export const MANDATE_DRAFTS_VERSION = 1;

/** What sits under {@link MANDATE_DRAFTS_KEY}. */
export interface MandateDraftsPayload {
  version: number;
  drafts: Record<string, MandateDraft>;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let storageListenerAttached = false;

/** The browser store, or null whenever it cannot be reached (SSR, private mode, blocked). */
function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // Accessing the property itself throws when the cookie policy blocks it.
    return null;
  }
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One stored entry, as a draft the screens can render, or null when it is not one.
 *
 * The version check above proves the ENVELOPE, not its contents, and the contents are not all
 * written by this build: an older release, a half-finished migration or a hand-edited entry can leave
 * a draft with no `protocols` array. That one reaches the hook untouched and throws inside
 * `visibleSteps` on the builder's first render, which costs the manager every draft rather than the
 * broken one. So each entry is checked on its own and a bad one is dropped.
 *
 * `poolUniverseCount` is the one field that is FILLED IN rather than required: it was added after
 * the first drafts were written, and a draft that predates it is complete in every other way. Null is
 * also its own honest value ("no pool universe resolved yet"), so the default cannot be mistaken for
 * a count.
 *
 * R20 v3 (POO-2167): a protocol the product can no longer operate is dropped here, with its pools
 * and its cap row ({@link withoutUnavailableProtocols}). This is the one read path: `getDraft` (the
 * builder's resume) and `listDrafts` (the Console's counts) both come through it, so neither can show
 * a Uniswap v3 position the manager could no longer remove. Like the rest of this function it only
 * reads; the stored copy is replaced by the next real write.
 *
 * POO-2151 (Build canvas): `plan` and `lastPhase` are OPTIONAL and checked on their own. A plan that
 * fails `normalizePlan` is left out of the draft, which is kept and marked `planUnreadable` (the app
 * then works with the empty plan, never a guess), while the raw plan stays in storage untouched (see
 * {@link readStore} and {@link upsertDraft}). An unknown phase is dropped and reads as the mandate
 * (D16). Neither moves {@link MANDATE_DRAFTS_VERSION}: a draft without them is exactly what this
 * store wrote before. A stored `planUnreadable` is ignored: the marker is derived on every read.
 */
function normalizeDraft(value: unknown): MandateDraft | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id === "") return null;
  if (!isStringOrNull(value.name)) return null;
  if (typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;
  if (!isStringOrNull(value.savedAt) || !isStringOrNull(value.completedAt)) return null;
  if (!MANDATE_STEP_ORDER.includes(value.lastStep as MandateStepKey)) return null;
  if (!Array.isArray(value.passedSteps)) return null;
  if (!Array.isArray(value.networks) || !Array.isArray(value.protocols)) return null;
  if (!Array.isArray(value.tokens) || !Array.isArray(value.pools)) return null;
  const caps = value.caps;
  if (!isRecord(caps)) return null;
  if (!isRecord(caps.networks) || !isRecord(caps.protocols) || !isRecord(caps.tokens)) return null;
  const universe = value.poolUniverseCount;
  if (universe !== undefined && universe !== null && typeof universe !== "number") return null;
  const {
    plan: storedPlan,
    lastPhase: storedPhase,
    planUnreadable: _derivedOnRead,
    ...rest
  } = value;
  const draft: MandateDraft = {
    ...(rest as unknown as MandateDraft),
    poolUniverseCount: typeof universe === "number" ? universe : null,
  };
  // POO-2151: an unreadable plan costs the plan in memory, never the draft, and is never deleted
  // silently: the draft says so (`planUnreadable`) and the raw plan stays stored (readStore).
  if (storedPlan !== undefined) {
    const plan = normalizePlan(storedPlan);
    if (plan) draft.plan = plan;
    else draft.planUnreadable = true;
  }
  // D16: a phase this build does not know is dropped, and no phase reads as the mandate.
  if (storedPhase === "mandate" || storedPhase === "build") draft.lastPhase = storedPhase;
  return withoutUnavailableProtocols(draft);
}

/**
 * What the store holds: the drafts as the screens read them, plus the RAW stored plan of every draft
 * whose plan this build could not read, by draft id, so a write can put it back byte for byte.
 */
interface StoreState {
  drafts: Record<string, MandateDraft>;
  unreadablePlans: Record<string, unknown>;
}

/** Read the payload. Anything unreadable, foreign or malformed reads as empty, and is NOT written. */
function readStore(): StoreState {
  const empty: StoreState = { drafts: {}, unreadablePlans: {} };
  const store = storage();
  if (!store) return empty;
  try {
    const raw = store.getItem(MANDATE_DRAFTS_KEY);
    if (raw === null) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;
    const payload = parsed as Partial<MandateDraftsPayload>;
    if (payload.version !== MANDATE_DRAFTS_VERSION) return empty;
    if (typeof payload.drafts !== "object" || payload.drafts === null) return empty;
    const state: StoreState = { drafts: {}, unreadablePlans: {} };
    for (const [id, entry] of Object.entries(payload.drafts as Record<string, unknown>)) {
      const draft = normalizeDraft(entry);
      if (!draft) continue;
      state.drafts[id] = draft;
      if (draft.planUnreadable) state.unreadablePlans[id] = (entry as { plan?: unknown }).plan;
    }
    return state;
  } catch {
    return empty;
  }
}

/**
 * One draft as it goes to storage. The `planUnreadable` marker is never stored (it is derived on
 * read), and a draft with no plan of its own gets its unreadable raw plan back, untouched: only a
 * save that carries a NEW plan replaces it (PR #31 review, F1).
 */
function toStoredEntry(draft: MandateDraft, unreadablePlan: unknown): Record<string, unknown> {
  const { planUnreadable: _marker, ...entry } = draft;
  if (entry.plan === undefined && unreadablePlan !== undefined) {
    return { ...entry, plan: unreadablePlan };
  }
  return entry;
}

/** Write the drafts. False means the write did not happen, and the caller must say so. */
function writeStore(state: StoreState): boolean {
  const store = storage();
  if (!store) return false;
  const drafts: Record<string, Record<string, unknown>> = {};
  for (const [id, draft] of Object.entries(state.drafts)) {
    drafts[id] = toStoredEntry(draft, state.unreadablePlans[id]);
  }
  try {
    store.setItem(MANDATE_DRAFTS_KEY, JSON.stringify({ version: MANDATE_DRAFTS_VERSION, drafts }));
    return true;
  } catch {
    return false;
  }
}

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/** Every stored draft, newest first, which is the order the Console drafts card shows them in. */
export function listDrafts(): MandateDraft[] {
  return Object.values(readStore().drafts).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

/** One draft by id, or null when it is not stored (a deleted draft, or a link to someone else's). */
export function getDraft(id: string): MandateDraft | null {
  return readStore().drafts[id] ?? null;
}

/**
 * Store a draft and stamp `updatedAt`.
 *
 * The timestamp is set HERE rather than by the reducers so that the pure domain never reads a
 * clock: "when was this last touched" means "when did it last reach storage", which is also what
 * the drafts list shows. Returns the stored draft, or null when the write failed.
 *
 * An unreadable plan is never deleted silently (PR #31 review, F1). Every OTHER draft is written
 * back with its raw stored plan untouched, and so is THIS draft while it carries no `plan` of its
 * own: the returned draft then still says `planUnreadable`. Only a save that carries a new `plan`
 * replaces the raw one, and the marker goes with it.
 */
export function upsertDraft(draft: MandateDraft): MandateDraft | null {
  const state = readStore();
  const keepsUnreadable = draft.plan === undefined && state.unreadablePlans[draft.id] !== undefined;
  const { planUnreadable: _marker, ...base } = draft;
  const stored: MandateDraft = {
    ...base,
    updatedAt: new Date().toISOString(),
    ...(keepsUnreadable ? { planUnreadable: true } : {}),
  };
  const ok = writeStore({ ...state, drafts: { ...state.drafts, [stored.id]: stored } });
  if (!ok) return null;
  notify();
  return stored;
}

/**
 * Remove a draft. Nothing throws; the boolean says whether the draft is gone.
 *
 * The answer matters because the Console's card acts on it: it emits `builder_draft_deleted` and
 * drops the row, and a swallowed failure would report a deletion that did not happen and leave a list
 * the storage disagrees with. An unknown id is `true` (the draft is not there, which is what was
 * asked for); unreachable storage and a refused write are `false`.
 */
export function deleteDraft(id: string): boolean {
  if (!storage()) return false;
  const state = readStore();
  if (!(id in state.drafts)) return true;
  const drafts = { ...state.drafts };
  delete drafts[id];
  if (!writeStore({ ...state, drafts })) return false;
  notify();
  return true;
}

/**
 * Watch the store: in-process writes plus this key's `storage` event, so a draft saved in one tab
 * shows up in the Console list of another.
 *
 * The window listener is attached on the FIRST subscribe rather than at module load, which is what
 * keeps this module importable on the server.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (!storageListenerAttached && typeof window !== "undefined") {
    window.addEventListener("storage", onStorageEvent);
    storageListenerAttached = true;
  }
  return () => {
    listeners.delete(listener);
  };
}

function onStorageEvent(event: StorageEvent): void {
  if (event.key !== MANDATE_DRAFTS_KEY) return;
  notify();
}

/**
 * A new draft id. `crypto.randomUUID` needs a secure context, so the fallback is not theoretical:
 * it is what an http:// preview or an older in-app browser gets. Collision risk is irrelevant here
 * (the ids are scoped to one browser's own draft list), so the fallback stays simple.
 */
export function newDraftId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the time-and-random id below.
  }
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
