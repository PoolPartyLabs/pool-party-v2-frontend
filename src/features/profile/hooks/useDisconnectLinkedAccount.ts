/**
 * @id PP-PROF-HOOK-002 (POO-110, POO-581, POO-868)
 * @name useDisconnectLinkedAccount
 * @implements-rules-version v1 (POO-581) · session auth: POO-868 v2
 *
 * Real-mode client hook that resolves the linked-account disconnect function. POO-868 [R6]: no
 * per-write personal_sign — the wallet already proved ownership at sign-in (Privy connect + SIWE),
 * so the hook just forwards `{provider}` to `disconnectLinkedAccountAction`; the server action
 * attaches the session Bearer and the API takes the wallet from the verified JWT claim. Only ever
 * mounted by the real-mode `SocialDataLoader`, so there is no mock branch (mock mode renders no
 * connected rows, hence nothing to disconnect).
 */
"use client";

import { disconnectLinkedAccountAction } from "@/lib/profile/linkedAccountsActions";
import type { LinkedAccountProvider } from "@/lib/profile/linkedAccountsSchema";

/** Disconnects a provider and resolves once the session-authenticated write is forwarded. */
export type DisconnectLinkedAccountFn = (provider: LinkedAccountProvider) => Promise<void>;

/** Real mode: forward the disconnect through the session-authenticated server action. */
export function useDisconnectLinkedAccount(): DisconnectLinkedAccountFn {
  return async (provider) => {
    await disconnectLinkedAccountAction({ provider });
  };
}
