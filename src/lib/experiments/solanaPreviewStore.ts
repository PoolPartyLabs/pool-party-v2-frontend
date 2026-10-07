/**
 * @id PP-CORE-LIB-125
 * @name solanaPreviewStore
 * @implements-rules-version v2 (POO-2281)
 * @analytics-events none, the toggle and screen own explicit user events.
 *
 * One route-scoped visual preference shared by the header and builder. No persistence,
 * networking, wallet operations or transaction authority. Server snapshots are always standard.
 */
"use client";

import { useEffect, useSyncExternalStore } from "react";
import { advanceSolanaPreviewGesture, createSolanaPreviewGesture } from "./solanaPreviewMode";

export type SolanaPreviewMode = "standard" | "v2-solana";
type Guard = (proceed: () => void) => void;

let mode: SolanaPreviewMode = "standard";
let gesture = createSolanaPreviewGesture();
let generation = 0;
let intent = 0;
let host: { generation: number; accountKey: string } | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function reset() {
  intent++;
  gesture = createSolanaPreviewGesture();
  mode = "standard";
  emit();
}

/** Register only while the V2 builder route is mounted. Identity is a reset key, not an allowlist. */
export function registerSolanaPreviewHost(accountKey: string): () => void {
  if (typeof window === "undefined") return () => {};
  const current = ++generation;
  host = { generation: current, accountKey };
  reset();
  return () => {
    if (host?.generation !== current) return;
    host = null;
    reset();
  };
}

/** Forward a press of the selected V2 segment. A pending guard callback expires on any new intent. */
export function requestSolanaPreview(guard: Guard, now = Date.now(), onEntered?: () => void): void {
  if (typeof window === "undefined" || !host || mode !== "standard") return;
  const currentIntent = ++intent;
  const currentHost = host.generation;
  const next = advanceSolanaPreviewGesture(gesture, now);
  gesture = next.gesture;
  if (!next.ready) return;
  guard(() => {
    if (host?.generation !== currentHost || intent !== currentIntent) return;
    intent++;
    mode = "v2-solana";
    emit();
    onEntered?.();
  });
}

/** Capture the current host so delayed confirmation cannot close a different route/account. */
export function captureSolanaPreviewExit(): () => boolean {
  const currentHost = host?.generation;
  const currentIntent = ++intent;
  gesture = createSolanaPreviewGesture();
  return () => {
    if (host?.generation !== currentHost || intent !== currentIntent) return false;
    reset();
    return true;
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Server and first hydration render never carry a previous visitor's module state. */
export function useSolanaPreviewMode(): SolanaPreviewMode {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => "standard",
  );
}

/** Register the visual editor host under the existing release gate, reset on account/family change. */
export function useSolanaPreviewHost(accountKey: string, enabled: boolean): SolanaPreviewMode {
  const current = useSolanaPreviewMode();
  useEffect(() => {
    if (!enabled) return;
    return registerSolanaPreviewHost(accountKey);
  }, [accountKey, enabled]);
  return enabled && host?.accountKey === accountKey ? current : "standard";
}

/** Test/story isolation only. Never writes any EVM preference or draft. */
export function __resetSolanaPreviewForTests(): void {
  host = null;
  generation++;
  reset();
}
