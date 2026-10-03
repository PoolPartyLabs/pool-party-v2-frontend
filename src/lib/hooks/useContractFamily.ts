/**
 * @id PP-CORE-HOK-038
 * @name useContractFamily
 * @implements-rules-version v1
 * @analytics-events none, the hook holds a preference and emits nothing. The one event the choice
 *   produces (`contract_family_toggled`) belongs to the control the user actually pressed,
 *   `ContractFamilyToggle` (`PP-CORE-CMP-075`): a hook cannot tell a user's click apart from a
 *   cross-tab sync or a hydration read, and counting those as decisions would inflate the series.
 *
 * POO-2120 [R2], epic POO-2119. Which contract family the manager console is looking at: `"v1"`,
 * the live Uniswap v3 single-pool builder, or `"v2"`, the fund-contracts builder. Persisted so the
 * choice survives a reload and a navigation, because a manager mid-mandate who refreshes must not
 * land back in the other builder.
 *
 * A UI PREFERENCE, never an entitlement. It decides which builder renders and nothing about what
 * the user may do, which is what makes `localStorage` the right home for it (the repo's policy:
 * simple non-sensitive preferences only, never roles or balances). The gate that decides whether
 * the choice exists at all is the `fundContracts` feature flag, read by the toggle and by the
 * route switch, never here.
 *
 * ## One value for the tab, not a copy per component
 *
 * The family lives in a MODULE-LEVEL store read through `useSyncExternalStore`, the same shape
 * `useFeatureFlags` uses over `devOverrides`. That is the whole point of this module rather than a
 * detail of it: three components read this hook and exactly one of them writes. The header's
 * `ContractFamilyToggle` is the writer; `BuilderRouteSwitch` and `FundDraftsSlot` only read, and
 * neither is a child of the toggle, so nothing but a shared store can carry a press from one to the
 * others. With per-component state (what this hook held until 2026-10-03) a manager on
 * `/manager/new` pressed V2 and the builder underneath stayed V1 until the page remounted, which is
 * the one thing the toggle exists to do.
 *
 * A `storage` event covers the OTHER tabs, and it always did; it never fires in the tab that wrote.
 *
 * PP-NOTE: when that cross-tab listener exists, stated plainly. It is attached while at least one
 * consumer is mounted and detached when the last one goes, and nothing re-reads storage when a
 * consumer mounts after the first read. In practice the listener is always there, because the header
 * toggle is itself a consumer and the app shell mounts it on every page while the `fundContracts`
 * flag is on. On a page with no consumer at all (the flag off, or a surface outside the shell), a
 * choice made in another tab is picked up at the next page load rather than live. A mount-time
 * re-read is deliberately NOT the answer: when a write was refused the chosen family lives only in
 * memory, and re-reading would overwrite that choice with the older stored value.
 *
 * ## `hydrated` and the first render
 *
 * `hydrated` exists because the first client render has to match the server HTML. On the server and
 * on that first render the family is the default `"v1"`, whatever is stored; `hydrated` turns true
 * once the read has happened, EVEN when nothing was stored, because "nothing stored" is an answer
 * rather than a pending state. Without that distinction a consumer would either flash the wrong
 * builder or skeleton forever on a fresh browser.
 *
 * It is module state too, so the read happens ONCE per page load however many consumers mount: a
 * card that appears later (the Console's drafts slot, when the manager opens that tab) finds the
 * answer already there instead of rendering its unknown-state branch for a frame.
 *
 * The read runs in an effect rather than inside `getSnapshot`, so the first client render still
 * answers `"v1"` and matches the server. `getServerSnapshot` returns the literal default and never
 * the module's value: module state on a Next server is shared by every request, so it must never
 * hold one visitor's choice. For the same reason every mutator is inert outside a browser.
 *
 * Follows `usePersistentState`'s policy (write only on an explicit set, sync across tabs, swallow
 * every storage failure) with one addition it cannot offer: the stored value is VALIDATED. Anything
 * this hook did not write, including valid JSON that is not one of the two families, resolves to
 * `"v1"` rather than becoming a third branch nothing can render.
 *
 * PP-INTEGRATION-POINT: the contract family becomes a per-strategy marker from the backend once
 * funds exist (POO-2116 slice 5, wiring issue POO-2134); today it is a UI preference.
 */
"use client";

import { useEffect, useSyncExternalStore } from "react";

/** Which family of contracts a manager surface is addressing. */
export type ContractFamily = "v1" | "v2";

/** The default family: the live builder, so a first visit and a lost store both land on V1. */
export const DEFAULT_CONTRACT_FAMILY: ContractFamily = "v1";

/** `localStorage` key holding the chosen family, JSON-encoded like every other UI preference. */
export const CONTRACT_FAMILY_STORAGE_KEY = "pp.contractFamily";

/** What {@link useContractFamily} returns. */
export interface UseContractFamily {
  /** The chosen family. `"v1"` until {@link UseContractFamily.hydrated} says the store was read. */
  family: ContractFamily;
  /** Choose a family and persist it. Never throws, even with storage unavailable. */
  setFamily: (next: ContractFamily) => void;
  /** False on the server and on the first client render; true once the store has been read. */
  hydrated: boolean;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** The family every consumer in this tab reads. Written only by a choice, a sync or the read. */
let family: ContractFamily = DEFAULT_CONTRACT_FAMILY;

/** Whether the one read of the persisted value has happened in this tab. */
let hydrated = false;

/** Every `useSyncExternalStore` subscriber in this tab. */
const listeners = new Set<() => void>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Narrow an unknown parsed payload to a family, or `null` when it is not one. */
function asContractFamily(value: unknown): ContractFamily | null {
  return value === "v1" || value === "v2" ? value : null;
}

/** Read and validate the stored family. Returns `null` for absent, malformed, or unknown values. */
function readStoredFamily(): ContractFamily | null {
  try {
    const raw = window.localStorage.getItem(CONTRACT_FAMILY_STORAGE_KEY);
    if (raw === null) return null;
    return asContractFamily(JSON.parse(raw));
  } catch {
    // Unavailable storage (private mode, blocked site data) or malformed JSON: no stored family.
    return null;
  }
}

/** Tell every consumer in this tab that the store moved. */
function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Another tab wrote the key. Kept one-way on purpose (no write back, so there is no echo loop), and
 * anything this hook would not have written leaves the current family alone rather than resetting
 * it. A `null` new value is a `removeItem`, which is not a choice of a family either.
 */
function onStorage(event: StorageEvent): void {
  if (event.key !== CONTRACT_FAMILY_STORAGE_KEY || event.newValue === null) return;
  try {
    const next = asContractFamily(JSON.parse(event.newValue));
    if (next === null || next === family) return;
    family = next;
    emit();
  } catch {
    // A payload we cannot read leaves the current family alone rather than resetting it.
  }
}

/**
 * Subscribe one consumer. The cross-tab listener is attached while anyone is reading and detached
 * when the last consumer goes, so a page with no manager surface on it carries no listener.
 */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && isBrowser()) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && isBrowser()) window.removeEventListener("storage", onStorage);
  };
}

function getFamilySnapshot(): ContractFamily {
  return family;
}

function getHydratedSnapshot(): boolean {
  return hydrated;
}

/** The server's answer, and the client's first render with it: the default, never module state. */
function getServerFamilySnapshot(): ContractFamily {
  return DEFAULT_CONTRACT_FAMILY;
}

function getServerHydratedSnapshot(): boolean {
  return false;
}

/** The one read of the persisted family, whenever no read has happened yet. Idempotent. */
function hydrateFromStorage(): void {
  if (hydrated || !isBrowser()) return;
  const stored = readStoredFamily();
  // `hydrated` flips either way: an empty or unreadable store is a finished read, not a pending one.
  hydrated = true;
  if (stored !== null) family = stored;
  emit();
}

/**
 * Choose a family for this tab and persist it.
 *
 * A module function rather than a `useCallback`, so its identity never changes and a consumer that
 * memoises on it never re-runs. The in-memory write happens whether or not the persisted one did:
 * when storage is blocked the choice still applies to EVERY consumer for this session, which is the
 * difference between a header that says V2 over a V2 builder and one that says V2 over a V1 builder.
 *
 * It also ends hydration. An explicit choice is an answer about the family, so a consumer waiting
 * for the read must not keep holding its unknown-state branch after the manager has decided.
 */
function setContractFamily(next: ContractFamily): void {
  // Inert outside a browser: module state on the server is shared by every request.
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(CONTRACT_FAMILY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or availability error: the choice still applies in memory for this session.
  }
  if (next === family && hydrated) return;
  family = next;
  hydrated = true;
  emit();
}

/**
 * Drop the in-memory copy so the next consumer re-reads `localStorage`.
 *
 * For tests and for Storybook, the two places where one page lives through several "page loads".
 * Subscribers are notified rather than dropped, because React owns those subscriptions: clearing
 * them would strand a component that is still mounted on a store it no longer hears from.
 */
export function __resetContractFamilyStoreForTests(): void {
  family = DEFAULT_CONTRACT_FAMILY;
  hydrated = false;
  emit();
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** Read the persisted contract family from a client component. */
export function useContractFamily(): UseContractFamily {
  const value = useSyncExternalStore(subscribe, getFamilySnapshot, getServerFamilySnapshot);
  const ready = useSyncExternalStore(subscribe, getHydratedSnapshot, getServerHydratedSnapshot);

  // After the first render, so that render matched the server. Declared after the subscriptions, so
  // the listeners are attached before the read notifies them.
  //
  // Keyed on `ready` rather than mounted once, so a consumer that is ALREADY mounted when the store
  // is dropped (`__resetContractFamilyStoreForTests`, which Storybook calls between stories) reads
  // again instead of sitting on its unknown-state branch until something remounts it. The read is
  // idempotent and always ends hydration, so this settles in one extra pass and cannot loop.
  useEffect(() => {
    if (!ready) hydrateFromStorage();
  }, [ready]);

  return { family: value, setFamily: setContractFamily, hydrated: ready };
}
