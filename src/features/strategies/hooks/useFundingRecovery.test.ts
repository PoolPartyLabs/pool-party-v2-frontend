/**
 * @id PP-STR-HOK-021 (POO-1055)
 * @name useFundingRecovery — tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * POO-1038 built the journal's readers and POO-1043 made sure records get WRITTEN. Neither reader
 * had a non-test caller, so a user whose tab died mid-bridge had a correct, durable record of
 * exactly what happened and no surface that ever looked at it. This suite is the proof that the
 * reading side now runs in production.
 *
 * The journal is the REAL `localStorage` store and the reconciler is the REAL §3.5 table: the whole
 * point of the issue is that those two run for real, so stubbing either would test nothing. Only the
 * chain is stubbed, through the three read functions the hook injects, and the stub records its
 * calls so "resolved by reading, never by sending" is an assertion rather than a claim.
 *
 * Real timers throughout. Every age the decision table cares about (the poll ceiling, the record's
 * lifecycle window) is expressed as a timestamp relative to now, which is both closer to what the
 * rail actually writes and immune to the fake-timer/`waitFor` interaction.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJournal,
  FUNDING_JOURNAL_KEY,
  type FundingLeg,
  getJournal,
  JOURNAL_MAX_AGE_MS,
  updateLeg,
} from "../lib/fundingJournal";
import { JOURNAL_POLL_CEILING_MS } from "../lib/reconcileFundingJournal";
import { requestFundingRecoveryRecheck, useFundingRecovery } from "./useFundingRecovery";

const WALLET = "0xc3673adc0000000000000000000000000000beef";
const OTHER_WALLET = "0xdeadbeef0000000000000000000000000000cafe";
const POLYGON = 137;
const ARBITRUM = 42161;
const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const USDC_ARBITRUM = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const WETH_POLYGON = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const SWAP_HASH = `0x${"11".repeat(32)}`;
const BRIDGE_HASH = `0x${"22".repeat(32)}`;

const mocks = vi.hoisted(() => ({
  address: undefined as string | undefined,
  /** Every chain read the hook issued, in order. A send would have no entry to make. */
  calls: [] as string[],
  receipts: {} as Record<string, { status: "success" | "reverted" } | null>,
  nonces: {} as Record<number, number>,
  balances: {} as Record<string, bigint>,
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.address }) }));

// PP-INTEGRATION-POINT: the per-chain RPC reads the §3.5 `ChainReader` is assembled from. Stubbed
// here so the decision table runs against known chain state with no network.
vi.mock("@/lib/tokens/readErc20", () => ({
  readTransactionReceiptStatus: async (hash: string, chainId: number) => {
    mocks.calls.push(`receipt:${chainId}:${hash}`);
    return mocks.receipts[hash] ?? null;
  },
  readTransactionCount: async (_owner: string, chainId: number) => {
    mocks.calls.push(`nonce:${chainId}`);
    return mocks.nonces[chainId] ?? 7;
  },
  readErc20Balance: async (token: string, _owner: string, chainId: number) => {
    mocks.calls.push(`balance:${chainId}:${token}`);
    return mocks.balances[`${chainId}:${token}`] ?? BigInt(0);
  },
  readNativeBalance: async (_owner: string, chainId: number) => {
    mocks.calls.push(`native:${chainId}`);
    return BigInt(0);
  },
}));

/** The flagship route: swap WETH to USDC on Polygon, then bridge that USDC to Arbitrum. */
const ROUTE = [
  {
    index: 0,
    kind: "swap-token" as const,
    chainId: POLYGON,
    tokenIn: WETH_POLYGON,
    tokenOut: USDC_POLYGON,
    amountIn: "1000000000000000000",
    minAmountOut: "2940000000",
  },
  {
    index: 1,
    kind: "bridge" as const,
    chainId: POLYGON,
    tokenIn: USDC_POLYGON,
    tokenOut: USDC_ARBITRUM,
    destChainId: ARBITRUM,
    amountIn: "3000000000",
    minAmountOut: "2996000000",
  },
];

interface PersistOptions {
  wallet?: string;
  /** When the user approved the route. Backdate it to age the record past its window. */
  createdAt?: number;
}

/** Persist a journal with one patch per leg, exactly as the rail would have left it. */
function persistJournal(patches: Partial<FundingLeg>[], options: PersistOptions = {}): string {
  const now = options.createdAt ?? Date.now();
  const journal = createJournal(
    {
      wallet: options.wallet ?? WALLET,
      operation: { kind: "invest", targetChainId: ARBITRUM, strategyId: "strat-1" },
      legs: ROUTE.slice(0, patches.length),
    },
    now,
  );
  patches.forEach((patch, index) => {
    updateLeg(journal.journalId, index, patch, now);
  });
  return journal.journalId;
}

/** A tab killed while the bridge leg was in flight: source hash recorded, arrival never observed. */
function killedMidBridge(options: PersistOptions = {}): string {
  const at = options.createdAt ?? Date.now();
  return persistJournal(
    [
      { status: "settled", txHash: SWAP_HASH, settledAt: at },
      {
        status: "broadcast",
        txHash: BRIDGE_HASH,
        broadcastAt: at,
        nonceBefore: 8,
        destBalanceBefore: "1000000",
      },
    ],
    options,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.address = "0xC3673ADc0000000000000000000000000000BEEF";
  mocks.calls = [];
  mocks.receipts = {};
  mocks.nonces = {};
  mocks.balances = {};
});

describe("[R1] the journal reaches the user", () => {
  it("surfaces an in-flight route for the connected wallet, with enough detail to act on", async () => {
    const journalId = killedMidBridge();
    mocks.receipts[BRIDGE_HASH] = { status: "success" };

    const { result } = renderHook(() => useFundingRecovery());
    await waitFor(() => expect(result.current.reconciliation).not.toBeNull());

    // WHICH operation, and WHICH leg it got to: the two things a user needs to know.
    expect(result.current.journal?.journalId).toBe(journalId);
    expect(result.current.journal?.operation.kind).toBe("invest");
    expect(result.current.reconciliation?.legs.map((leg) => leg.verdict)).toEqual([
      "settled",
      "pending",
    ]);
    expect(result.current.reconciliation?.action).toBe("wait");
    // The hash is carried so the surface can link out to the transfer.
    expect(result.current.reconciliation?.legs[1]?.txHash).toBe(BRIDGE_HASH);
  });

  it("shows nothing at all when the wallet has no route in flight", async () => {
    const { result } = renderHook(() => useFundingRecovery());

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current.journal).toBeNull();
    expect(mocks.calls).toEqual([]);
  });

  // §3.5 rule 2. Switching accounts mid-bridge is real behaviour, and resuming somebody else's route
  // would be the worst bug this surface could have.
  it("never surfaces a journal that belongs to another account", async () => {
    killedMidBridge({ wallet: OTHER_WALLET });

    const { result } = renderHook(() => useFundingRecovery());

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current.journal).toBeNull();
    expect(mocks.calls).toEqual([]);
  });

  it("surfaces nothing while no wallet is connected", async () => {
    killedMidBridge();
    mocks.address = undefined;

    const { result } = renderHook(() => useFundingRecovery());

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current.journal).toBeNull();
  });
});

describe("[R2] the §3.5 decision table has a production caller", () => {
  it("resolves an ambiguous broadcast by READING chain state, never by re-sending", async () => {
    // No receipt at the poll ceiling and the account nonce has moved: the §3.9 residual window.
    persistJournal([
      {
        status: "broadcast",
        txHash: SWAP_HASH,
        broadcastAt: Date.now() - JOURNAL_POLL_CEILING_MS - 1_000,
        nonceBefore: 7,
      },
    ]);
    mocks.receipts[SWAP_HASH] = null;
    mocks.nonces[POLYGON] = 9;

    const { result } = renderHook(() => useFundingRecovery());
    await waitFor(() => expect(result.current.reconciliation).not.toBeNull());

    expect(result.current.reconciliation?.action).toBe("ask");
    // Every call the hook made was a read. There is no send in the list because there is no send in
    // the reader's type at all.
    expect(mocks.calls).toEqual([`receipt:${POLYGON}:${SWAP_HASH}`, `nonce:${POLYGON}`]);
  });

  it("writes the chain's verdict back, so the record can never outrank the chain", async () => {
    const journalId = persistJournal([
      { status: "broadcast", txHash: SWAP_HASH, broadcastAt: Date.now(), nonceBefore: 7 },
      { status: "planned", nonceBefore: 8 },
    ]);
    mocks.receipts[SWAP_HASH] = { status: "reverted" };
    mocks.nonces[POLYGON] = 8;

    const { result } = renderHook(() => useFundingRecovery());
    await waitFor(() => expect(result.current.reconciliation).not.toBeNull());

    expect(getJournal(journalId)?.legs[0]?.status).toBe("failed");
    expect(result.current.reconciliation?.action).toBe("rederive");
  });

  it("re-checks on demand, because a bridge lands minutes after the page did", async () => {
    killedMidBridge();
    mocks.receipts[BRIDGE_HASH] = { status: "success" };
    mocks.balances[`${ARBITRUM}:${USDC_ARBITRUM}`] = BigInt("1000000");

    const { result } = renderHook(() => useFundingRecovery());
    await waitFor(() => expect(result.current.reconciliation?.action).toBe("wait"));

    // The funds arrive.
    mocks.balances[`${ARBITRUM}:${USDC_ARBITRUM}`] = BigInt("3997000000");
    act(() => result.current.recheck());

    // Every leg settled, so there is nothing in flight left to recover and the record is gone (§3.7).
    await waitFor(() => expect(result.current.journal).toBeNull());
  });
});

/**
 * POO-1507 [D5]: `Stop anyway` on the mid-run confirmation closes the panel and wants the app-wide
 * banner to reflect the interruption immediately, not on the next load. The banner's own hook,
 * `useFundingRecovery`, is a SINGLE instance mounted once in `AppShell`, with no ref the panel could
 * hold, so the signal travels as a window event — the same decoupling `pp:consent` already uses in
 * `src/lib/analytics/consent.ts` for an identical shape (one writer far from the one reader).
 */
describe("POO-1507 [D5]: an app-wide recheck signal, for a stop mid-run", () => {
  it("re-reads the journal when the signal fires, without waiting for a recheck() call", async () => {
    killedMidBridge();
    mocks.receipts[BRIDGE_HASH] = { status: "success" };
    mocks.balances[`${ARBITRUM}:${USDC_ARBITRUM}`] = BigInt("1000000");

    const { result } = renderHook(() => useFundingRecovery());
    await waitFor(() => expect(result.current.reconciliation?.action).toBe("wait"));

    // The funds arrive, and the panel (not this hook) hears that the user stopped the run.
    mocks.balances[`${ARBITRUM}:${USDC_ARBITRUM}`] = BigInt("3997000000");
    act(() => requestFundingRecoveryRecheck());

    await waitFor(() => expect(result.current.journal).toBeNull());
  });

  it("does nothing when no instance is mounted to hear it", () => {
    expect(() => requestFundingRecoveryRecheck()).not.toThrow();
  });
});

describe("[R3] a route that never broadcast asks nothing", () => {
  // The exact shape POO-1043 disclosed: `createJournal` writes every leg `planned` with NO baseline,
  // and the first leg failed before its own `beginLeg` could add one (a `/check_approval` error).
  it("treats a leg the rail never began as safe to re-derive, not as something to ask about", async () => {
    persistJournal([{}, {}]);

    const { result } = renderHook(() => useFundingRecovery());
    await waitFor(() => expect(result.current.reconciliation).not.toBeNull());

    expect(result.current.reconciliation?.legs.map((leg) => leg.verdict)).toEqual([
      "absent",
      "absent",
    ]);
    expect(result.current.reconciliation?.action).toBe("rederive");
    expect(mocks.calls).toEqual([]);
  });
});

describe("[R4] resuming can never re-broadcast a settled leg", () => {
  it("holds nothing a broadcast could be rebuilt from: no calldata, no signature, no quote", async () => {
    killedMidBridge();
    mocks.receipts[BRIDGE_HASH] = { status: "success" };

    const { result } = renderHook(() => useFundingRecovery());
    await waitFor(() => expect(result.current.journal).not.toBeNull());

    // The structural half of the guarantee (§3.3): a resume cannot re-send a leg because the record
    // it resumes from carries no transaction to send. Re-derivation from fresh balances is the only
    // path back into execution, and a settled leg is no longer in a plan derived from them (§3.1).
    for (const leg of result.current.journal?.legs ?? []) {
      for (const forbidden of ["data", "calldata", "signature", "permitData", "quote"]) {
        expect(Object.keys(leg)).not.toContain(forbidden);
      }
    }
  });

  it("never reads, retries or touches a leg the record already calls settled", async () => {
    persistJournal([
      { status: "settled", txHash: SWAP_HASH, settledAt: Date.now() },
      { status: "planned", nonceBefore: 8 },
    ]);
    mocks.nonces[POLYGON] = 8;

    const { result } = renderHook(() => useFundingRecovery());
    await waitFor(() => expect(result.current.reconciliation).not.toBeNull());

    expect(result.current.reconciliation?.legs[0]?.verdict).toBe("settled");
    // The settled leg costs no read and produces no action: only the unstarted one does.
    expect(mocks.calls).toEqual([`nonce:${POLYGON}`]);
    expect(result.current.reconciliation?.action).toBe("rederive");
    // And the surface offers exactly one way forward, which is to re-derive from fresh balances.
    expect(Object.keys(result.current)).not.toContain("broadcast");
    expect(Object.keys(result.current)).not.toContain("retryLeg");
  });
});

describe("[R5] a stale journal is cleaned up rather than nagging forever", () => {
  it("drops a record older than its lifecycle window instead of surfacing it", async () => {
    killedMidBridge({ createdAt: Date.now() - JOURNAL_MAX_AGE_MS - 1_000 });

    const { result } = renderHook(() => useFundingRecovery());

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current.journal).toBeNull();
    expect(window.localStorage.getItem(FUNDING_JOURNAL_KEY)).not.toContain(BRIDGE_HASH);
  });

  it("retires a route that turns out to have completed while the tab was closed", async () => {
    const journalId = killedMidBridge();
    mocks.receipts[BRIDGE_HASH] = { status: "success" };
    // The bridge arrived: the destination delta clears minAmountOut.
    mocks.balances[`${ARBITRUM}:${USDC_ARBITRUM}`] = BigInt("3997000000");

    const { result } = renderHook(() => useFundingRecovery());

    await waitFor(() => expect(result.current.isChecking).toBe(false));
    expect(result.current.journal).toBeNull();
    expect(getJournal(journalId)).toBeNull();
  });

  it("lets the user abandon a route they no longer want tracked", async () => {
    const journalId = persistJournal([{ status: "planned", nonceBefore: 7 }]);
    mocks.nonces[POLYGON] = 7;

    const { result } = renderHook(() => useFundingRecovery());
    await waitFor(() => expect(result.current.reconciliation).not.toBeNull());

    act(() => result.current.abandon());

    expect(result.current.journal).toBeNull();
    expect(getJournal(journalId)).toBeNull();
  });
});
