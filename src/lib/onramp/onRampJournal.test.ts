/**
 * @id PP-CORE-LIB-067 (POO-1134, POO-1384)
 * @name on-ramp request journal — spec
 * @implements-rules-version v2 (POO-1129 rules v2)
 *
 * [R7] "one purchase per step, ever": a reload or re-entry must not mint a SECOND `requestId` for a
 * step already in flight. This journal is the persisted record that lets the mint site reuse an
 * in-flight `requestId` instead of creating a new purchase intent. Runs against jsdom's real
 * localStorage, cleared between tests. Mirrors the funding journal's storage discipline (POO-1038).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findExpiredOnRampIntent,
  findResumableOnRampRequest,
  markOnRampPaid,
  markOnRampRequest,
  ONRAMP_JOURNAL_KEY,
  ONRAMP_JOURNAL_MAX_AGE_MS,
  ONRAMP_JOURNAL_MAX_RECORDS,
  ONRAMP_JOURNAL_VERSION,
  ONRAMP_REQUEST_RESUMABLE_MS,
  readOnRampRequests,
  recordOnRampRequest,
  retireOnRampRequest,
} from "./onRampJournal";

const WALLET = "0xAbCdaBcDABcdabCdaBCDabcDABcDABcdABcDaBCd";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("recordOnRampRequest + findResumableOnRampRequest", () => {
  // @rule R7 — the requestId is journaled before the widget opens, so a reload finds it.
  it("persists an open record that is then resumable for that wallet", () => {
    recordOnRampRequest({ requestId: "req-1", wallet: WALLET });
    const found = findResumableOnRampRequest(WALLET);
    expect(found?.requestId).toBe("req-1");
    expect(found?.status).toBe("open");
  });

  // @rule R7 — the guard is per-wallet: another account's in-flight purchase is never resumed.
  it("never returns a record for a different wallet", () => {
    recordOnRampRequest({ requestId: "req-1", wallet: WALLET });
    expect(findResumableOnRampRequest("0x0000000000000000000000000000000000000001")).toBeNull();
  });

  it("matches the wallet case-insensitively (SIWE address casing varies)", () => {
    recordOnRampRequest({ requestId: "req-1", wallet: WALLET });
    expect(findResumableOnRampRequest(WALLET.toLowerCase())?.requestId).toBe("req-1");
  });

  // @rule R7 — recording the SAME requestId again (a re-entry that already has one) does not
  // duplicate it: still exactly one purchase intent.
  it("upserts by requestId rather than duplicating", () => {
    recordOnRampRequest({ requestId: "req-1", wallet: WALLET });
    recordOnRampRequest({ requestId: "req-1", wallet: WALLET });
    expect(readOnRampRequests().filter((r) => r.requestId === "req-1")).toHaveLength(1);
  });
});

describe("markOnRampRequest", () => {
  // @rule R7 — a terminal purchase is done: it is no longer resumable, so a re-entry mints fresh.
  it.each([
    "settled",
    "rejected",
    "cancelled",
    "error",
  ] as const)("makes a %s record non-resumable", (status) => {
    recordOnRampRequest({ requestId: "req-1", wallet: WALLET });
    markOnRampRequest("req-1", status);
    expect(findResumableOnRampRequest(WALLET)).toBeNull();
  });

  it("is a no-op for an unknown requestId", () => {
    expect(() => markOnRampRequest("nope", "settled")).not.toThrow();
  });
});

describe("retireOnRampRequest", () => {
  it("removes a record entirely", () => {
    recordOnRampRequest({ requestId: "req-1", wallet: WALLET });
    retireOnRampRequest("req-1");
    expect(readOnRampRequests()).toEqual([]);
  });
});

describe("pruning (bounded + aged)", () => {
  it("drops records older than the max age on read", () => {
    const now = 1_000_000_000_000;
    recordOnRampRequest({ requestId: "old", wallet: WALLET }, now - ONRAMP_JOURNAL_MAX_AGE_MS - 1);
    recordOnRampRequest({ requestId: "fresh", wallet: WALLET }, now);
    const kept = readOnRampRequests(now);
    expect(kept.map((r) => r.requestId)).toEqual(["fresh"]);
  });

  it(`keeps at most ${ONRAMP_JOURNAL_MAX_RECORDS} records, newest first`, () => {
    const now = 1_000_000_000_000;
    for (let i = 0; i < ONRAMP_JOURNAL_MAX_RECORDS + 2; i++) {
      recordOnRampRequest({ requestId: `req-${i}`, wallet: WALLET }, now + i);
    }
    const kept = readOnRampRequests(now + 100);
    expect(kept).toHaveLength(ONRAMP_JOURNAL_MAX_RECORDS);
    expect(kept[0]?.requestId).toBe(`req-${ONRAMP_JOURNAL_MAX_RECORDS + 1}`);
  });
});

describe("untrusted / unavailable storage", () => {
  it("returns empty (not a throw) when the store is corrupt", () => {
    localStorage.setItem(ONRAMP_JOURNAL_KEY, "not json {");
    expect(readOnRampRequests()).toEqual([]);
  });

  it("ignores a store written by a future version", () => {
    localStorage.setItem(
      ONRAMP_JOURNAL_KEY,
      JSON.stringify({
        version: 999,
        requests: [{ requestId: "x", wallet: WALLET, status: "open", createdAt: 1, updatedAt: 1 }],
      }),
    );
    expect(readOnRampRequests()).toEqual([]);
  });

  it("discards a record that fails validation", () => {
    localStorage.setItem(
      ONRAMP_JOURNAL_KEY,
      JSON.stringify({
        version: 1,
        requests: [{ requestId: "", wallet: WALLET, status: "open", createdAt: 1, updatedAt: 1 }],
      }),
    );
    expect(readOnRampRequests()).toEqual([]);
  });
});

/**
 * POO-1384: reuse of an `open` intent is bounded SEPARATELY from record retention.
 *
 * Retention is 24h because the journal also backs the settled-but-unconverted swap resume, where
 * money HAS moved. Reuse exists only to stop a reload minting a SECOND Paybis intent while funds are
 * landing, and that window is minutes. Conflating them left a dead intent resumable all day, so the
 * next attempt reopened a `requestId` Paybis had expired: "Session timed out", reported twice in prod.
 */
describe("resumable window (POO-1384)", () => {
  const WALLET = "0xAAaAAAaAAAAAAaaAAaAAaAAaAaaAAAAAAAAa";
  const OTHER_WALLET = "0xBBbBBBbBBBBBBbbBBbBBbBBbBbbBBBBBBBBb";
  const T0 = 1_800_000_000_000;

  beforeEach(() => localStorage.clear());

  it("resumes an intent opened moments ago, which is the case the guard exists for", () => {
    recordOnRampRequest({ requestId: "req-fresh", wallet: WALLET }, T0);
    expect(findResumableOnRampRequest(WALLET, T0 + 60_000)?.requestId).toBe("req-fresh");
  });

  it("stops resuming past the window, so a dead intent is never reopened", () => {
    recordOnRampRequest({ requestId: "req-stale", wallet: WALLET }, T0);
    const past = T0 + ONRAMP_REQUEST_RESUMABLE_MS + 1;
    expect(findResumableOnRampRequest(WALLET, past)).toBeNull();
  });

  it("keeps the RECORD past the auto-reuse window, so there is still something to ask about", () => {
    recordOnRampRequest({ requestId: "req-kept", wallet: WALLET }, T0);
    const past = T0 + ONRAMP_REQUEST_RESUMABLE_MS + 1;
    // Not auto-resumable, but still stored: this is the record the user gets asked about.
    expect(findResumableOnRampRequest(WALLET, past)).toBeNull();
    expect(readOnRampRequests(past).some((r) => r.requestId === "req-kept")).toBe(true);
  });

  // The whole point of the discriminator. `timeOut()` deliberately leaves a PAID record `open`
  // because the money may still be landing, and re-minting there is the double charge the journal
  // exists to prevent. An age bound alone cannot tell that record apart from a never-paid one, and
  // would expire exactly the case the guard was built for.
  it("resumes a PAID intent indefinitely, because re-minting there is the double charge", () => {
    recordOnRampRequest({ requestId: "req-paid", wallet: WALLET }, T0);
    markOnRampPaid("req-paid", T0 + 30_000);
    const wayPast = T0 + ONRAMP_REQUEST_RESUMABLE_MS * 10;
    expect(findResumableOnRampRequest(WALLET, wayPast)?.requestId).toBe("req-paid");
  });

  it("expires an intent that was never paid, which is the stuck case", () => {
    recordOnRampRequest({ requestId: "req-unpaid", wallet: WALLET }, T0);
    const past = T0 + ONRAMP_REQUEST_RESUMABLE_MS + 1;
    expect(findResumableOnRampRequest(WALLET, past)).toBeNull();
  });

  it("marking paid is a no-op for an unknown id", () => {
    recordOnRampRequest({ requestId: "req-a", wallet: WALLET }, T0);
    markOnRampPaid("req-nope", T0);
    expect(readOnRampRequests(T0).map((r) => r.requestId)).toEqual(["req-a"]);
  });

  // Security review: `z.number()` ACCEPTS Infinity and `1e999` parses to it, so an unbounded
  // timestamp made `now - createdAt === -Infinity` and passed BOTH age bounds at once.
  it("rejects a non-finite createdAt, which used to defeat every age bound", () => {
    localStorage.setItem(
      ONRAMP_JOURNAL_KEY,
      `{"version":${ONRAMP_JOURNAL_VERSION},"requests":[{"requestId":"req-evil","wallet":"${WALLET.toLowerCase()}","status":"open","createdAt":1e999,"updatedAt":1e999}]}`,
    );
    expect(findResumableOnRampRequest(WALLET, T0)).toBeNull();
    expect(readOnRampRequests(T0)).toEqual([]);
  });

  // The record the user gets ASKED about: aged out, never observed as paid. Neither auto-branch is
  // safe here, so the mint site prompts instead of choosing.
  it("surfaces an aged-out unpaid intent as an explicit question", () => {
    recordOnRampRequest({ requestId: "req-unsure", wallet: WALLET }, T0);
    const past = T0 + ONRAMP_REQUEST_RESUMABLE_MS + 1;
    expect(findResumableOnRampRequest(WALLET, past)).toBeNull();
    expect(findExpiredOnRampIntent(WALLET, past)?.requestId).toBe("req-unsure");
  });

  it("does not surface a PAID intent as a question, because it auto-resumes", () => {
    recordOnRampRequest({ requestId: "req-paid2", wallet: WALLET }, T0);
    markOnRampPaid("req-paid2", T0);
    const past = T0 + ONRAMP_REQUEST_RESUMABLE_MS * 5;
    expect(findExpiredOnRampIntent(WALLET, past)).toBeNull();
    expect(findResumableOnRampRequest(WALLET, past)?.requestId).toBe("req-paid2");
  });

  it("does not surface a still-fresh intent, nor a terminal one, nor another wallet's", () => {
    recordOnRampRequest({ requestId: "req-fresh2", wallet: WALLET }, T0);
    expect(findExpiredOnRampIntent(WALLET, T0 + 60_000)).toBeNull();

    const past = T0 + ONRAMP_REQUEST_RESUMABLE_MS + 1;
    markOnRampRequest("req-fresh2", "cancelled", T0);
    expect(findExpiredOnRampIntent(WALLET, past)).toBeNull();

    recordOnRampRequest({ requestId: "req-other", wallet: OTHER_WALLET }, T0);
    expect(findExpiredOnRampIntent(WALLET, past)).toBeNull();
  });

  it("still refuses a terminal record inside the window", () => {
    recordOnRampRequest({ requestId: "req-done", wallet: WALLET }, T0);
    markOnRampRequest("req-done", "cancelled", T0);
    expect(findResumableOnRampRequest(WALLET, T0 + 1_000)).toBeNull();
  });
});
