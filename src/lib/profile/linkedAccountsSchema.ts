/**
 * @id PP-PROF-LIB-007 (POO-110, POO-581)
 * @name Linked-accounts schema
 * @implements-rules-version v1
 *
 * Shared (client + server) types + Zod for the deployed pool-party-api linked-accounts surface
 * (POO-581, rules-v1). The OPEN read `GET /api/v1/users/:address/linked-accounts` returns one row per
 * CONNECTED provider (only connected links persist, so presence in the list IS the connected state).
 * `handle` is the provider-canonical link (URL for telegram/x/discord); it is `null` for `google` on
 * the OPEN read because the google handle is an email (PII) omitted from the public projection. An
 * empty array means every provider is disconnected.
 *
 * NO `server-only` marker: the presentational `SocialScreen` (a client component) imports the
 * `LinkedAccount` type + the provider list, so this module must stay client-safe — only the fetcher
 * (`fetchLinkedAccounts`) and the action (`linkedAccountsActions`) touch `apiFetch` / the session.
 *
 * PP-INTEGRATION-POINT: response contract for the pool-party-api linked-accounts read (POO-581). Only
 * the fields the FE consumes are pinned (provider + handle); the API also carries `connected` (always
 * true for a stored row) and `connectedAt`, both ignored here.
 */
import { z } from "zod";

/**
 * Providers an investor can link (POO-110 [R2]: Telegram, X, Discord, Google — no Apple). Mirrors the
 * pool-party-api `LINKED_ACCOUNT_PROVIDERS`; drift makes a valid provider fail the enum parse.
 */
export const LINKED_ACCOUNT_PROVIDERS = ["telegram", "x", "discord", "google"] as const;
export type LinkedAccountProvider = (typeof LINKED_ACCOUNT_PROVIDERS)[number];

/**
 * One connected linked account (public projection). `handle` is `null` for google on the open read
 * (the email is PII and omitted); it is the canonical URL for telegram/x/discord.
 */
export const linkedAccountSchema = z.object({
  provider: z.enum(LINKED_ACCOUNT_PROVIDERS),
  handle: z.string().nullable(),
});
export type LinkedAccount = z.infer<typeof linkedAccountSchema>;

/** The OPEN read payload: zero-or-more connected accounts (an empty array means all disconnected). */
export const linkedAccountsResponseSchema = z.array(linkedAccountSchema);
