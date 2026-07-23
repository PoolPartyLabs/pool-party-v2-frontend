/**
 * @id PP-PROF-LIB-007 (POO-110, POO-581)
 * @name Linked-accounts schema tests
 * @implements-rules-version v1
 *
 * The public projection of the linked-accounts read: presence in the list = connected, `handle` is the
 * canonical URL for telegram/x/discord and `null` for google (PII omitted). Extra API keys
 * (`connected`, `connectedAt`) are dropped; an unknown provider fails the parse; the provider list is
 * exactly the four supported (no Apple).
 */
import { describe, expect, it } from "vitest";
import { LINKED_ACCOUNT_PROVIDERS, linkedAccountsResponseSchema } from "./linkedAccountsSchema";

describe("linkedAccountsResponseSchema", () => {
  it("keeps provider + handle and ignores the extra API keys (connected, connectedAt)", () => {
    const raw = [
      {
        provider: "x",
        connected: true,
        handle: "https://x.com/maria",
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
      // google's handle is an email (PII) and comes back null on the open read.
      {
        provider: "google",
        connected: true,
        handle: null,
        connectedAt: "2026-01-02T00:00:00.000Z",
      },
    ];

    expect(linkedAccountsResponseSchema.parse(raw)).toEqual([
      { provider: "x", handle: "https://x.com/maria" },
      { provider: "google", handle: null },
    ]);
  });

  it("accepts an empty list (every provider disconnected)", () => {
    expect(linkedAccountsResponseSchema.parse([])).toEqual([]);
  });

  it("rejects an unknown provider so a contract drift fails loudly", () => {
    expect(() =>
      linkedAccountsResponseSchema.parse([{ provider: "apple", handle: "x" }]),
    ).toThrow();
  });

  it("supports exactly Telegram, X, Discord and Google (POO-110 [R2]: no Apple)", () => {
    expect(LINKED_ACCOUNT_PROVIDERS).toEqual(["telegram", "x", "discord", "google"]);
  });
});
