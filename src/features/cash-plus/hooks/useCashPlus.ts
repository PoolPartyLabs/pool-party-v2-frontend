/** @id PP-CP-HOOK-001 @name Cash+ investor controller @implements-rules-version v1 */
"use client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, type Hash } from "viem";
import {
  buildCashPlusTransaction,
  validateCashPlusTransaction,
} from "@/lib/cash-plus/buildTransaction";
import { createCashPlusClient, verifyCashPlusDeployment } from "@/lib/cash-plus/client";
import { cashPlusErrorCode } from "@/lib/cash-plus/errors";
import { readCashPlusHistory } from "@/lib/cash-plus/history";
import {
  type CashPlusJournal,
  cashPlusJournalKey,
  readCashPlusJournal,
  writeCashPlusJournal,
} from "@/lib/cash-plus/journal";
import {
  assertCashPlusWallet,
  decodeCashPlusReceipt,
  prepareCashPlusIntent,
  simulateCashPlusIntent,
} from "@/lib/cash-plus/operations";
import { readCashPlusSnapshot } from "@/lib/cash-plus/readSnapshot";
import type {
  CashPlusController,
  CashPlusIntent,
  CashPlusTransaction,
} from "@/lib/cash-plus/types";
import { createCashPlusPreviewSnapshot } from "@/mocks/data/cashPlus";
import { useCashPlusEnvironment } from "../CashPlusProvider";
import { useCashPlusDemo } from "./useCashPlusDemo";

const idle: CashPlusTransaction = { phase: "idle", kind: "deposit" };
export function useCashPlus(): CashPlusController {
  const environment = useCashPlusEnvironment(),
    { mode, deployment, wallet } = environment;
  const demo = useCashPlusDemo(mode === "preview" && !environment.error);
  const client = useMemo(
    () => (mode !== "preview" && deployment ? createCashPlusClient(deployment) : null),
    [deployment, mode],
  );
  const [windowBlocks, setWindowBlocks] = useState(20000);
  const [transaction, setTransaction] = useState<CashPlusTransaction>(idle);
  const intentRef = useRef<CashPlusIntent | null>(null),
    busy = useRef(false),
    pending = useRef<CashPlusJournal | null>(null);
  const identity = `${mode}:${deployment?.runId}:${wallet.address}:${wallet.correctChain}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const read = useCallback(async () => {
    if (environment.error) throw new Error(environment.error);
    if (mode === "preview")
      return {
        snapshot: createCashPlusPreviewSnapshot(),
        walletBalanceAssets: BigInt(25000000000),
      };
    if (!client || !deployment) throw new Error("DEPLOYMENT_INVALID");
    await verifyCashPlusDeployment(client, deployment);
    const result = await readCashPlusSnapshot(client, deployment, wallet.address);
    try {
      result.snapshot = await readCashPlusHistory(
        client,
        deployment,
        result.snapshot,
        windowBlocks,
      );
    } catch {
      result.snapshot = { ...result.snapshot, historyPartial: true, attributionComplete: false };
    }
    return result;
  }, [client, deployment, mode, wallet.address, windowBlocks, environment.error]);
  const query = useQuery({
    enabled: mode !== "preview" || Boolean(environment.error),
    queryKey: ["cashplus", identity, windowBlocks],
    queryFn: read,
    refetchInterval: mode === "preview" ? false : 15000,
    staleTime: 10000,
    retry: 1,
    retryDelay: 3000,
  });
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query.refetch]);
  const key =
    mode !== "preview" && deployment && wallet.address
      ? cashPlusJournalKey(deployment, wallet.address)
      : null;
  const resolvePending = useCallback(
    async (journal: CashPlusJournal, capturedIdentity: string) => {
      if (!client || !deployment || !wallet.address || !key) return;
      let actualHash = journal.hash,
        cancelled = false;
      try {
        const receipt = await client.waitForTransactionReceipt({
          hash: journal.hash,
          timeout: 30000,
          pollingInterval: 2500,
          onReplaced(replacement) {
            actualHash = replacement.transaction.hash;
            cancelled = replacement.reason === "cancelled";
            journal = {
              ...journal,
              hash: actualHash,
              transaction: { ...journal.transaction, hash: actualHash },
            };
            writeCashPlusJournal(key, journal);
            if (identityRef.current === capturedIdentity) {
              pending.current = journal;
              setTransaction(journal.transaction);
            }
          },
        });
        if (cancelled) throw new Error("TX_CANCELLED");
        if (receipt.status !== "success") throw new Error("TX_REVERTED");
        // A replaced transaction must execute this owner's expected Cash+ event, not merely mine.
        if (journal.stage === "approval") {
          writeCashPlusJournal(key, null);
          if (identityRef.current === capturedIdentity) {
            pending.current = null;
            setTransaction({
              ...journal.transaction,
              phase: "error",
              hash: actualHash,
              errorCode: "QUOTE_EXPIRED",
            });
          }
        } else {
          const decoded = decodeCashPlusReceipt(
            receipt,
            deployment,
            wallet.address,
            journal.transaction.kind,
          );
          writeCashPlusJournal(key, null);
          if (identityRef.current === capturedIdentity) {
            pending.current = null;
            setTransaction({
              ...journal.transaction,
              phase: "success",
              hash: actualHash,
              receipt: decoded,
            });
            await refresh();
          }
        }
      } catch (error) {
        const code = cashPlusErrorCode(error);
        if (["TX_REVERTED", "TX_CANCELLED", "RECEIPT_UNAVAILABLE"].includes(code)) {
          writeCashPlusJournal(key, null);
          if (identityRef.current === capturedIdentity) {
            pending.current = null;
            setTransaction({
              ...journal.transaction,
              phase: "error",
              hash: actualHash,
              errorCode: code,
            });
          }
        } else if (identityRef.current === capturedIdentity)
          setTransaction({
            ...journal.transaction,
            phase: "pending",
            hash: actualHash,
            errorCode: "TX_TIMEOUT",
          });
      }
    },
    [client, deployment, wallet.address, key, refresh],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: network changes must invalidate unsigned intents even with the same journal key.
  useEffect(() => {
    intentRef.current = null;
    busy.current = false;
    const saved = key ? readCashPlusJournal(key) : null;
    pending.current = saved;
    setTransaction(saved?.transaction ?? idle);
  }, [key, identity]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new submitted hash starts receipt recovery after the synchronous flow yields.
  useEffect(() => {
    if (!pending.current) return;
    let stopped = false;
    const poll = async () => {
      if (stopped || busy.current || !pending.current) return;
      busy.current = true;
      try {
        await resolvePending(pending.current, identity);
      } finally {
        busy.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 35000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [identity, resolvePending, transaction.hash]);
  const review: CashPlusController["review"] = async (kind, amount) => {
    if (busy.current || pending.current) return;
    if (mode === "preview") {
      setTransaction({ phase: "error", kind, errorCode: "PREVIEW_ONLY" });
      return;
    }
    const captured = identity;
    busy.current = true;
    setTransaction({ phase: "preflight", kind });
    try {
      if (!client || !deployment || !wallet.address || !wallet.correctChain)
        throw new Error("WALLET_CHANGED");
      const provider = await wallet.getProvider();
      await assertCashPlusWallet(provider, wallet.address, deployment.chainId);
      const fresh = await read();
      if (identityRef.current !== captured) throw new Error("WALLET_CHANGED");
      const prepared = await prepareCashPlusIntent(
        client,
        deployment,
        fresh.snapshot,
        wallet.address,
        fresh.walletBalanceAssets,
        kind,
        amount,
      );
      if (identityRef.current !== captured) throw new Error("WALLET_CHANGED");
      intentRef.current = prepared.intent;
      setTransaction(prepared.transaction);
    } catch (error) {
      if (identityRef.current === captured)
        setTransaction({ phase: "error", kind, errorCode: cashPlusErrorCode(error) });
    } finally {
      busy.current = false;
    }
  };
  const confirm = async () => {
    if (mode === "preview" || busy.current || pending.current || transaction.phase !== "review")
      return;
    const intent = intentRef.current,
      captured = identity;
    if (!intent || !client || !deployment || !wallet.address || !key) return;
    busy.current = true;
    try {
      const provider = await wallet.getProvider();
      const send = async (
        current: CashPlusIntent,
        stage: "approval" | "operation",
      ): Promise<Hash> => {
        if (identityRef.current !== captured) throw new Error("WALLET_CHANGED");
        await verifyCashPlusDeployment(client, deployment);
        await assertCashPlusWallet(provider, current.owner, current.chainId);
        const block = await client.getBlock();
        const built = buildCashPlusTransaction(current);
        validateCashPlusTransaction(built, current, block.timestamp);
        await simulateCashPlusIntent(client, current);
        const estimatedGas = await client.estimateGas({
          account: current.owner,
          to: built.to,
          data: built.data,
          value: BigInt(0),
        });
        const gas = (estimatedGas * BigInt(125) + BigInt(99)) / BigInt(100);
        await assertCashPlusWallet(provider, current.owner, current.chainId);
        if (identityRef.current !== captured) throw new Error("WALLET_CHANGED");
        setTransaction({ ...transaction, phase: stage === "approval" ? "approval" : "signature" });
        // PP-INTEGRATION-POINT: local calldata, exact current wallet, no API or web signing key.
        const result = await provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: built.from,
              to: built.to,
              data: built.data,
              value: "0x0",
              gas: `0x${gas.toString(16)}`,
              chainId: `0x${built.chainId.toString(16)}`,
            },
          ],
        });
        if (typeof result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(result))
          throw new Error("READ_UNAVAILABLE");
        const journal: CashPlusJournal = {
          hash: result as Hash,
          stage,
          transaction: { ...transaction, phase: "pending", hash: result as Hash },
        };
        writeCashPlusJournal(key, journal);
        if (identityRef.current === captured) {
          pending.current = journal;
          setTransaction(journal.transaction);
        }
        return result as Hash;
      };
      if (intent.kind === "deposit") {
        const allowance = await client.readContract({
          address: intent.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [intent.owner, intent.vault],
        });
        if (allowance < intent.amount) {
          const hash = await send({ ...intent, kind: "approve" }, "approval");
          let replaced = false;
          const receipt = await client.waitForTransactionReceipt({
            hash,
            timeout: 30000,
            pollingInterval: 2500,
            onReplaced() {
              replaced = true;
            },
          });
          if (receipt.status !== "success") throw new Error("TX_REVERTED");
          // Never continue an approval replaced/cancelled by the wallet without a new review.
          writeCashPlusJournal(key, null);
          if (identityRef.current === captured) pending.current = null;
          if (replaced) throw new Error("QUOTE_EXPIRED");
        }
      }
      await send(intent, "operation");
      if (pending.current && identityRef.current === captured)
        await resolvePending(pending.current, captured);
    } catch (error) {
      if (identityRef.current === captured) {
        const code = cashPlusErrorCode(error);
        const unresolved = pending.current as CashPlusJournal | null;
        if (unresolved && !["TX_REVERTED", "TX_CANCELLED"].includes(code))
          setTransaction({ ...unresolved.transaction, phase: "pending", errorCode: "TX_TIMEOUT" });
        else {
          pending.current = null;
          writeCashPlusJournal(key, null);
          setTransaction({ ...transaction, phase: "error", errorCode: code });
        }
      }
    } finally {
      busy.current = false;
    }
  };
  const snapshot = query.data?.snapshot ?? null;
  if (mode === "preview" && !environment.error) return demo;
  return {
    snapshot,
    status: query.isError ? (snapshot ? "stale" : "error") : snapshot ? "ready" : "loading",
    error: query.error ? cashPlusErrorCode(query.error) : undefined,
    wallet: {
      connected: wallet.connected,
      address: wallet.address,
      correctChain: wallet.correctChain,
      balanceAssets: query.data?.walletBalanceAssets ?? null,
    },
    transaction,
    review,
    confirm,
    resetTransaction() {
      if (!busy.current && !pending.current) {
        intentRef.current = null;
        setTransaction(idle);
      }
    },
    refresh,
    connect: wallet.connect,
    async switchNetwork() {
      try {
        await wallet.switchNetwork();
      } catch (error) {
        setTransaction({ phase: "error", kind: "deposit", errorCode: cashPlusErrorCode(error) });
      }
    },
    loadEarlierHistory:
      snapshot?.historyPartial && windowBlocks < 200000
        ? async () => {
            setWindowBlocks((value) => Math.min(value + 20000, 200000));
          }
        : undefined,
  };
}
