/**
 * @id PP-STR-LIB-019 (POO-1043)
 * @name deferred funding-journal recorder tests
 * @implements-rules-version v1 (POO-1043 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * [R7] The rail is BOUND to its dependencies when the plan is quoted, and the journal is MINTED when
 * the user approves it (`docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §3.7). Those two moments are
 * minutes apart, so a recorder bound to a fixed `journalId` cannot serve both: bind it early and it
 * records into a journal for a route nobody accepted, bind it late and the steps already hold the
 * journal-less closure.
 *
 * A recorder that resolves its journal at CALL time closes that gap, and this is its spec. Real
 * `localStorage`, as the POO-1038 suite uses: the thing under test IS the persistence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeferredJournalRecorder,
  createJournal,
  FUNDING_JOURNAL_KEY,
  type FundingJournal,
} from "./fundingJournal";

const WALLET = "0xC3673ADc0000000000000000000000000000BEEF";
const POLYGON = 137;
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const HASH = `0x${"ab".repeat(32)}`;

/** Read the store WITHOUT `readJournals`, which prunes: these tests assert what was written. */
function storedJournals(): FundingJournal[] {
  const raw = localStorage.getItem(FUNDING_JOURNAL_KEY);
  return raw ? (JSON.parse(raw) as { journals: FundingJournal[] }).journals : [];
}

function mintJournal() {
  return createJournal({
    wallet: WALLET,
    operation: { kind: "invest", targetChainId: 42161, strategyId: "strat-1" },
    legs: [
      {
        index: 0,
        kind: "swap-token",
        chainId: POLYGON,
        tokenIn: WETH_POLYGON,
        tokenOut: USDC_POLYGON,
        amountIn: "1000000000000000000",
        minAmountOut: "2940000000",
      },
    ],
  });
}

const plannedLeg = {
  index: 0,
  kind: "swap-token" as const,
  chainId: POLYGON,
  tokenIn: WETH_POLYGON,
  tokenOut: USDC_POLYGON,
  amountIn: "1000000000000000000",
  minAmountOut: "2940000000",
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-07-25T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDeferredJournalRecorder [R7]", () => {
  it("records nothing at all while no journal is bound", async () => {
    const readNonce = vi.fn(async () => 7);
    const recorder = createDeferredJournalRecorder(() => null, { readNonce });

    await recorder.beginLeg(plannedLeg);
    recorder.recordBroadcast(0, HASH);
    recorder.recordSettled(0);

    // A plan the user never approved has no in-flight transactions to track (§3.7), so nothing is
    // written and the account is never even read.
    expect(storedJournals()).toEqual([]);
    expect(readNonce).not.toHaveBeenCalled();
  });

  it("writes into whichever journal is bound at the moment of the call", async () => {
    let journalId: string | null = null;
    const recorder = createDeferredJournalRecorder(() => journalId, { readNonce: async () => 7 });

    // Bound AFTER the recorder was built, which is the whole point: the rail's closure is older
    // than the journal it writes to.
    journalId = mintJournal().journalId;
    await recorder.beginLeg(plannedLeg);

    expect(storedJournals()[0]?.legs[0]).toMatchObject({
      index: 0,
      status: "planned",
      nonceBefore: 7,
      amountIn: "1000000000000000000",
    });
  });

  it("carries a leg through broadcast and settlement", async () => {
    let journalId: string | null = null;
    const recorder = createDeferredJournalRecorder(() => journalId, { readNonce: async () => 7 });
    journalId = mintJournal().journalId;

    await recorder.beginLeg(plannedLeg);
    recorder.recordBroadcast(0, HASH);
    expect(storedJournals()[0]?.legs[0]).toMatchObject({ status: "broadcast", txHash: HASH });

    recorder.recordSettled(0);
    expect(storedJournals()[0]?.legs[0]).toMatchObject({ status: "settled" });
  });

  it("records a failed leg without losing its hash, which is still evidence", async () => {
    let journalId: string | null = null;
    const recorder = createDeferredJournalRecorder(() => journalId, { readNonce: async () => 7 });
    journalId = mintJournal().journalId;

    await recorder.beginLeg(plannedLeg);
    recorder.recordBroadcast(0, HASH);
    recorder.recordFailed(0);

    expect(storedJournals()[0]?.legs[0]).toMatchObject({ status: "failed", txHash: HASH });
  });

  it("follows a rebind to a NEW route and never writes back into the retired one", async () => {
    let journalId: string | null = null;
    const recorder = createDeferredJournalRecorder(() => journalId, { readNonce: async () => 7 });

    const first = mintJournal();
    journalId = first.journalId;
    await recorder.beginLeg(plannedLeg);
    recorder.recordBroadcast(0, HASH);

    // The user backed out and started again: a second approval mints a second journal.
    const second = mintJournal();
    journalId = second.journalId;
    await recorder.beginLeg(plannedLeg);

    const journals = storedJournals();
    expect(journals.find((j) => j.journalId === second.journalId)?.legs[0]?.status).toBe("planned");
    // The first journal keeps its own record verbatim: a route whose transaction is on a chain is
    // not un-broadcast by the user opening a new one.
    expect(journals.find((j) => j.journalId === first.journalId)?.legs[0]).toMatchObject({
      status: "broadcast",
      txHash: HASH,
    });
  });
});
