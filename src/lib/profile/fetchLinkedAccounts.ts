/**
 * @id PP-PROF-LIB-008 (POO-110, POO-581)
 * @name fetchLinkedAccounts
 * @implements-rules-version v1
 *
 * Server-side read of a wallet's linked social accounts from pool-party-api. The OPEN read
 * `GET /api/v1/users/:address/linked-accounts` (POO-581 [R4]; api-key only, scoped to `:address` so no
 * cross-wallet leak) returns one row per CONNECTED provider; an empty array means all disconnected.
 * Modeled on {@link fetchInvestorProfile}: a short per-wallet data-cache window collapses a navigation
 * burst into one upstream hit (the backend throttles per API key), and a disconnect write busts the
 * per-wallet tag ({@link linkedAccountsTag}) so the next read drops the disconnected row immediately.
 *
 * {@link loadLinkedAccounts} is the mock/real seam the social settings page imports: mock mode has NO
 * fabricated connections (returns an empty list — every provider disconnected, POO-110 de-mock); real
 * mode reads the SIWE-session wallet's accounts and degrades a read failure to an empty list, so a
 * non-core linked-accounts outage never takes the profile settings screen down.
 *
 * PP-INTEGRATION-POINT (POO-581): linked accounts ← pool-party-api `GET /api/v1/users/:address/linked-accounts`.
 */
import "server-only";

import { apiFetch } from "@/lib/api/client";
import { getSessionWallet } from "@/lib/auth/session";
import { isMockMode } from "@/lib/services";
import { type LinkedAccount, linkedAccountsResponseSchema } from "./linkedAccountsSchema";

/**
 * Short per-wallet data-cache window (seconds) for the linked-accounts read. Mirrors the profile read
 * so a back-and-forth navigation burst collapses into one upstream hit; a disconnect write busts it
 * immediately via {@link linkedAccountsTag}.
 */
const LINKED_ACCOUNTS_REVALIDATE_SECONDS = 30;

/**
 * Per-wallet cache tag for the linked-accounts read. Lowercased so the writer's session wallet and the
 * reader's address resolve to the same tag; `disconnectLinkedAccountAction` busts exactly this tag.
 */
export function linkedAccountsTag(address: string): string {
  return `linked-accounts:${address.toLowerCase()}`;
}

/** Read a wallet's connected linked accounts (an empty array means all disconnected). */
export async function fetchLinkedAccounts(address: string): Promise<LinkedAccount[]> {
  const accounts = await apiFetch(`users/${address}/linked-accounts`, {
    schema: linkedAccountsResponseSchema,
    revalidate: LINKED_ACCOUNTS_REVALIDATE_SECONDS,
    tags: [linkedAccountsTag(address)],
  });
  // A null (204/empty) response degrades to "all disconnected" rather than throwing.
  return accounts ?? [];
}

/**
 * Resolve the current session's linked accounts for the social settings page. Mock mode returns an
 * empty list (no fabricated connections, POO-110 de-mock). Real mode reads the SIWE-session wallet's
 * accounts and degrades any failure to an empty list so a non-core read never crashes the settings
 * screen — the connect affordance stays inert regardless.
 */
export async function loadLinkedAccounts(): Promise<LinkedAccount[]> {
  if (isMockMode) return [];
  const wallet = await getSessionWallet();
  if (!wallet) return [];
  try {
    return await fetchLinkedAccounts(wallet);
  } catch {
    // A linked-accounts read outage must not take down the profile settings screen.
    return [];
  }
}
