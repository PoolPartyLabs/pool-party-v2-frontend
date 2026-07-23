/**
 * @id PP-PROF-ACT-002 (POO-110, POO-581, POO-868)
 * @name linked-accounts actions
 * @implements-rules-version v1 (POO-581) · session auth: POO-868 v2
 *
 * The `"use server"` bridge for the linked-accounts disconnect write. POO-868 [R6]: no per-write
 * wallet signature — the wallet already proved ownership at sign-in (Privy connect + SIWE
 * personal_sign), so this action forwards the session Bearer (`getAuthHeader`, the pp-api-minted JWT
 * from the httpOnly cookie — never a client-supplied header) to the session-guarded
 * `DELETE /api/v1/users/me/linked-accounts`. The API verifies the JWT and takes the wallet from its
 * `address` claim, so a caller can still only disconnect THEIR OWN link. On success it busts the
 * per-wallet linked-accounts cache tag so the next server read drops the disconnected row.
 *
 * Connect (`PUT /users/me/linked-accounts`) is intentionally NOT wired here: it requires a user-entered
 * provider link / gmail address whose input UX is undecided (tracked separately) — the screen renders
 * the connect affordance disabled rather than fabricating a link.
 *
 * PP-INTEGRATION-POINT (POO-581): linked-account disconnect → pool-party-api `DELETE /api/v1/users/me/linked-accounts`.
 */
"use server";

import { revalidateTag } from "next/cache";
import { apiFetch } from "@/lib/api/client";
import { getAuthHeader, getSessionWallet } from "@/lib/auth/session";
import { linkedAccountsTag } from "@/lib/profile/fetchLinkedAccounts";
import type { LinkedAccountProvider } from "@/lib/profile/linkedAccountsSchema";

/**
 * Disconnect a provider from the session wallet via the session-guarded `DELETE
 * /users/me/linked-accounts`. The identity is the session JWT (server-read, httpOnly cookie); the
 * body carries only the provider. Busts the per-wallet linked-accounts tag so the next server read
 * reflects the removal. An upstream error (including 401 when signed out) propagates so the caller
 * can surface a retry.
 */
export async function disconnectLinkedAccountAction(body: {
  provider: LinkedAccountProvider;
}): Promise<void> {
  await apiFetch("users/me/linked-accounts", {
    method: "DELETE",
    body,
    headers: await getAuthHeader(),
  });

  // Bust the per-wallet linked-accounts cache so the next server read drops the disconnected row.
  const wallet = await getSessionWallet();
  if (wallet) revalidateTag(linkedAccountsTag(wallet));
}
