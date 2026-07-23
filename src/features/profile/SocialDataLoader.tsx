/**
 * @id PP-PROF-SCR-003 (POO-110, POO-581, POO-868)
 * @name Linked-accounts data loader
 * @implements-rules-version v1 (POO-581) · session auth: POO-868 v2
 *
 * Real-mode client boundary for the linked social accounts screen. It injects the session-authenticated
 * disconnect (`useDisconnectLinkedAccount`, POO-868: no per-write signature) into the presentational
 * `SocialScreen` so the screen stays untouched while real-mode disconnects DELETE
 * `/users/me/linked-accounts` under the SIWE session Bearer. Mirrors
 * `PersonalInfoDataLoader`: mounted only when `isMockMode` is false (mock mode renders `SocialScreen`
 * directly with no connected accounts and an inert connect).
 */
"use client";

import type { LinkedAccount } from "@/lib/profile/linkedAccountsSchema";
import { useDisconnectLinkedAccount } from "./hooks/useDisconnectLinkedAccount";
import { SocialScreen } from "./SocialScreen";

/** Public props for {@link SocialDataLoader}. */
export interface SocialDataLoaderProps {
  /** The session wallet's connected accounts, read server-side. */
  accounts: LinkedAccount[];
}

/** Renders the linked-accounts screen wired to the real signed-write disconnect. */
export function SocialDataLoader({ accounts }: SocialDataLoaderProps) {
  const onDisconnect = useDisconnectLinkedAccount();
  return <SocialScreen accounts={accounts} onDisconnect={onDisconnect} />;
}
