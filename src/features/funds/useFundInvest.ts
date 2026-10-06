/** @id PP-STR-HOK-023 @name useFundInvest @implements-rules-version v1 (POO-2248) @analytics-events none, modal owns funnel events */
"use client";
import { useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FundBuild, FundHolder, FundView } from "@/lib/api/v2/fundSchemas";
import { useAuth } from "@/lib/auth/useAuth";
import { useSiweSession } from "@/lib/auth/useSiweSession";
import { findWalletForAddress, waitForReceipt } from "@/lib/tx/sendTransaction";
import { withTimeout } from "@/lib/utils/withTimeout";
import {
  buildFundAction,
  loadFundAction,
  pollFundReportAction,
  startFundReportAction,
} from "./fundActions";
import { ensureFreshValuation } from "./fundFlow";
import {
  clearFundInvestJournal,
  type FundInvestJournal,
  readFundInvestJournal,
  writeFundInvestJournal,
} from "./fundInvestJournal";
import { type FundDepositPreview, validateFundDepositBuild } from "./fundInvestModel";
import {
  type FundTransactionRecord,
  fundTransactionCode,
  sendFundTransaction,
} from "./fundTransactions";
export type FundInvestPhase =
  | "idle"
  | "loading"
  | "building"
  | "review"
  | "pending"
  | "success"
  | "error"
  | "unknown";
function normalizedCode(error: unknown): string {
  let current = error;
  for (let n = 0; n < 5 && current && typeof current === "object"; n++) {
    if ("code" in current && current.code === 4001) return "4001";
    current = "cause" in current ? current.cause : null;
  }
  return fundTransactionCode(error);
}
type Snapshot = { fund: FundView; holder: FundHolder; wallet: string };
export function useFundInvest({
  core,
  enabled,
  onSettled,
}: {
  core: string;
  enabled: boolean;
  onSettled?: () => void;
}) {
  const { address } = useAuth();
  const { isSignedIn } = useSiweSession();
  const { wallets } = useWallets();
  const identity = `${core.toLowerCase()}:${address?.toLowerCase()}:${enabled}:${isSignedIn}`;
  const liveIdentity = useRef(identity);
  liveIdentity.current = identity;
  const run = useRef(0);
  const locked = useRef(false);
  const stored = useRef<FundInvestJournal | null>(null);
  const snapshotIdentity = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [phase, setPhase] = useState<FundInvestPhase>("idle");
  const [preview, setPreview] = useState<FundDepositPreview | null>(null);
  const [built, setBuilt] = useState<FundBuild | null>(null);
  const [budget, setBudget] = useState("");
  const [errorCode, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<FundTransactionRecord[]>([]);
  const active = useCallback(
    (id: number, ctx = identity) => run.current === id && liveIdentity.current === ctx,
    [identity],
  );
  const read = useCallback(async (): Promise<Snapshot> => {
    if (!enabled || !address || !isSignedIn) throw new Error("V2_SESSION");
    const reply = await withTimeout(loadFundAction(core), 30000, "V2_READ_TIMEOUT");
    if (!reply.ok) throw new Error(reply.error.code);
    const { fund, holder, wallet } = reply.data;
    if (
      !holder ||
      !wallet ||
      wallet.toLowerCase() !== address.toLowerCase() ||
      fund.coreVault.toLowerCase() !== core.toLowerCase() ||
      Number(fund.mandate.hubChainId) !== 42161 ||
      !/^0x[\da-f]{40}$/i.test(fund.mandate.usdc)
    )
      throw new Error("V2_SESSION");
    return { fund, holder, wallet };
  }, [enabled, address, isSignedIn, core]);
  async function refresh() {
    if (locked.current) return;
    const id = ++run.current;
    try {
      const next = await read();
      if (active(id)) {
        snapshotIdentity.current = identity;
        setSnapshot(next);
        setError(null);
        setPhase((previous) =>
          previous === "error" || previous === "loading" ? "idle" : previous,
        );
      }
    } catch (e) {
      if (active(id)) {
        setSnapshot(null);
        setError(fundTransactionCode(e));
        setPhase("error");
      }
    }
  }
  useEffect(() => {
    run.current++;
    snapshotIdentity.current = identity;
    setError(null);
    setBudget("");
    setSnapshot(null);
    setBuilt(null);
    setPreview(null);
    setRecords([]);
    stored.current = null;
    locked.current = false;
    if (!enabled || !address || !isSignedIn) {
      setPhase("idle");
      return;
    }
    const id = run.current;
    setPhase("loading");
    void read()
      .then((next) => {
        if (!active(id)) return;
        snapshotIdentity.current = identity;
        setSnapshot(next);
        try {
          const journal = readFundInvestJournal(core, next.wallet);
          stored.current = journal;
          if (journal) setBudget(journal.budget);
          if (journal?.record) setRecords([journal.record]);
          if (journal && !["confirmed", "reverted"].includes(journal.state)) {
            locked.current = true;
            setPhase("unknown");
            setError("TX_CONFIRMATION_UNKNOWN");
          } else setPhase("idle");
        } catch {
          locked.current = true;
          setError("V2_RECOVERY_UNAVAILABLE");
          setPhase("unknown");
        }
      })
      .catch((e) => {
        if (active(id)) {
          setError(fundTransactionCode(e));
          setPhase("error");
        }
      });
    return () => {
      run.current++;
    };
  }, [active, read, core, enabled, address, isSignedIn, identity]);
  async function fresh(id: number) {
    return ensureFreshValuation({
      active: () => active(id),
      refreshing: () => {},
      read: async () => {
        const next = await read();
        if (active(id)) {
          snapshotIdentity.current = identity;
          setSnapshot(next);
        }
        return next.fund;
      },
      start: async () => {
        const r = await startFundReportAction(core);
        if (!r.ok) throw new Error(r.error.code);
        return r.data.jobId;
      },
      poll: async (job) => {
        const r = await pollFundReportAction(core, job);
        if (!r.ok) throw new Error(r.error.code);
        return r.data.status;
      },
      wait: () => new Promise((r) => setTimeout(r, 15000)),
    });
  }
  async function prepare(amountRaw: string) {
    if (locked.current) return;
    try {
      if (address) {
        const existing = readFundInvestJournal(core, address);
        if (existing && !["confirmed", "reverted"].includes(existing.state)) {
          stored.current = existing;
          locked.current = true;
          setPhase("unknown");
          return;
        }
      }
    } catch {
      locked.current = true;
      setError("V2_RECOVERY_UNAVAILABLE");
      setPhase("unknown");
      return;
    }
    const id = ++run.current;
    setError(null);
    setPhase("building");
    try {
      if (!/^[1-9]\d{0,77}$/.test(amountRaw)) throw new Error("V2_INVALID_AMOUNT");
      const next = await read();
      if (next.fund.state !== "Open") throw new Error("FundNotOpen");
      if (
        BigInt(next.holder.shares) === BigInt("0") &&
        BigInt(amountRaw) < BigInt(next.fund.mandate.minFirstDeposit)
      )
        throw new Error("BelowMinFirstDeposit");
      await fresh(id);
      if (!active(id)) return;
      const r = await withTimeout(
        buildFundAction(core, {
          action: "deposit",
          amount: amountRaw,
          minShares: "0",
        }),
        30000,
        "V2_BUILD_TIMEOUT",
      );
      if (!r.ok) throw new Error(r.error.code);
      const checked = validateFundDepositBuild(
        r.data,
        core,
        next.wallet,
        next.fund.mandate.usdc,
        amountRaw,
        "0",
      );
      if (!active(id)) return;
      setSnapshot(next);
      setBudget(amountRaw);
      setBuilt(r.data);
      setPreview(checked);
      setPhase("review");
    } catch (e) {
      if (active(id)) {
        setError(fundTransactionCode(e));
        setPhase("error");
      }
    }
  }
  async function confirm() {
    if (locked.current || !built || !snapshot || phase !== "review") return;
    locked.current = true;
    const id = ++run.current;
    const ctx = identity;
    setError(null);
    setPhase("building");
    try {
      const existing = readFundInvestJournal(core, snapshot.wallet);
      if (existing && !["confirmed", "reverted"].includes(existing.state)) {
        stored.current = existing;
        setPhase("unknown");
        setError("TX_CONFIRMATION_UNKNOWN");
        return;
      }
      const next = await read();
      await fresh(id);
      if (!active(id, ctx)) return;
      const min = preview?.sharesMinted ?? "0";
      const r = await withTimeout(
        buildFundAction(core, { action: "deposit", amount: budget, minShares: min }),
        30000,
        "V2_BUILD_TIMEOUT",
      );
      if (!r.ok) throw new Error(r.error.code);
      const checked = validateFundDepositBuild(
        r.data,
        core,
        next.wallet,
        next.fund.mandate.usdc,
        budget,
        min,
      );
      if (!active(id, ctx)) return;
      if (!!r.data.nextAction !== !!built.nextAction) {
        setBuilt(r.data);
        setPreview(checked);
        setPhase("review");
        return;
      }
      if (!r.data.nextAction && (!preview || JSON.stringify(checked) !== JSON.stringify(preview))) {
        setBuilt(r.data);
        setPreview(checked);
        setPhase("review");
        return;
      }
      const selected = findWalletForAddress(wallets, next.wallet);
      if (!selected) throw new Error("V2_SESSION");
      await selected.switchChain(42161);
      const provider = await selected.getEthereumProvider();
      if (!active(id, ctx)) return;
      const kind = r.data.nextAction ? "approve" : "deposit";
      const journal: FundInvestJournal = {
        core,
        wallet: next.wallet,
        budget,
        kind,
        state: "signing",
      };
      writeFundInvestJournal(journal);
      stored.current = journal;
      setPhase("pending");
      const tx = r.data.transactions[0];
      if (!tx) throw new Error("V2_INVALID_RESPONSE");
      await sendFundTransaction(provider, tx, next.wallet, kind, (record) => {
        journal.record = record;
        journal.state =
          record.status === "confirmed"
            ? "confirmed"
            : record.status === "reverted"
              ? "reverted"
              : record.uncertain
                ? "unknown"
                : "pending";
        writeFundInvestJournal(journal);
        if (active(id, ctx)) setRecords([record]);
      });
      if (!active(id, ctx)) return;
      clearFundInvestJournal(core, next.wallet);
      stored.current = null;
      locked.current = false;
      if (kind === "approve") {
        await prepare(budget);
        return;
      }
      setBuilt(null);
      setPhase("success");
      onSettled?.();
    } catch (e) {
      if (active(id, ctx)) {
        const code = normalizedCode(e);
        setError(code);
        const journal = stored.current;
        if (
          journal &&
          !journal.record &&
          ["4001", "USER_REJECTED", "ACTION_REJECTED"].includes(code)
        ) {
          clearFundInvestJournal(core, journal.wallet);
          stored.current = null;
          locked.current = false;
          setPhase("review");
          return;
        }
        if (journal && !["confirmed", "reverted"].includes(journal.state)) {
          journal.state = "unknown";
          writeFundInvestJournal(journal);
          setBuilt(null);
          setPhase("unknown");
        } else setPhase("error");
      }
    } finally {
      if (!stored.current || ["confirmed", "reverted"].includes(stored.current.state))
        locked.current = false;
    }
  }
  async function reconcile() {
    const journal = stored.current;
    if (!journal?.record) {
      setError("V2_RECOVERY_UNAVAILABLE");
      return;
    }
    const id = ++run.current;
    try {
      const next = await read();
      const selected = findWalletForAddress(wallets, next.wallet);
      if (!selected) throw new Error("V2_SESSION");
      await selected.switchChain(42161);
      const receipt = await waitForReceipt(
        await selected.getEthereumProvider(),
        journal.record.hash as `0x${string}`,
        { timeoutMs: 10000 },
      );
      journal.record = {
        ...journal.record,
        status: "confirmed",
        uncertain: false,
        blockNumber: receipt.blockNumber,
      };
      writeFundInvestJournal({ ...journal, state: "confirmed" });
      clearFundInvestJournal(core, next.wallet);
      stored.current = null;
      locked.current = false;
      if (!active(id)) return;
      setRecords([journal.record]);
      setError(null);
      if (journal.kind === "approve") await prepare(journal.budget);
      else {
        setPhase("success");
        onSettled?.();
      }
    } catch (e) {
      if (active(id)) {
        const code = normalizedCode(e);
        setError(code);
        if (code === "TX_REVERTED") {
          clearFundInvestJournal(core, journal.wallet);
          stored.current = null;
          locked.current = false;
          setRecords([{ ...journal.record, status: "reverted", uncertain: false }]);
          setPhase("error");
        } else setPhase("unknown");
      }
    }
  }
  function reset() {
    if (locked.current) return;
    run.current++;
    setBuilt(null);
    setPreview(null);
    setError(null);
    setPhase("idle");
  }
  return {
    snapshot: snapshotIdentity.current === identity ? snapshot : null,
    phase:
      snapshotIdentity.current === identity
        ? phase
        : enabled
          ? ("loading" as const)
          : ("idle" as const),
    preview: snapshotIdentity.current === identity ? preview : null,
    approvalRequired: snapshotIdentity.current === identity && !!built?.nextAction,
    records: snapshotIdentity.current === identity ? records : [],
    errorCode: snapshotIdentity.current === identity ? errorCode : null,
    amountRaw: snapshotIdentity.current === identity ? budget : "",
    prepare,
    confirm,
    reset,
    reconcile,
    refresh,
  };
}
