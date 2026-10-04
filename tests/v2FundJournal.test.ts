import { describe, expect, it } from "vitest";
import { type BroadcastJournal, reserveBroadcast } from "../e2e/helpers/v2Journal";

describe("v2 burner broadcast journal", () => {
  it("reserves the operation before calling the wallet", () => {
    const journal: BroadcastJournal = { transactions: [] };
    reserveBroadcast(journal, "requestPayout");
    expect(journal.pendingBroadcast).toBe("requestPayout");
  });
  it.each([
    "approve",
    "deposit",
    "requestPayout",
  ])("blocks %s after an ambiguous broadcast response", (action) => {
    const journal: BroadcastJournal = { pendingBroadcast: "requestPayout", transactions: [] };
    expect(() => reserveBroadcast(journal, action)).toThrow("inspect burner nonce");
    expect(journal.pendingBroadcast).toBe("requestPayout");
  });
  it.each(["deposit", "requestPayout"])("blocks a repeated %s", (action) => {
    const journal: BroadcastJournal = { transactions: [{ action }] };
    expect(() => reserveBroadcast(journal, action)).toThrow("refusing duplicate");
    expect(journal.pendingBroadcast).toBeUndefined();
  });
});
