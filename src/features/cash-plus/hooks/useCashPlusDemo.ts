/** @id PP-CP-HOOK-002 @name Cash+ interactive preview controller @implements-rules-version v1 */
"use client";
import { useEffect, useRef, useState } from "react";
import { cashPlusErrorCode } from "@/lib/cash-plus/errors";
import type { CashPlusController, CashPlusTransaction } from "@/lib/cash-plus/types";
import { CASH_PLUS_PREVIEW_OWNER } from "@/mocks/data/cashPlus";
import {
  advanceCashPlusDemoDay,
  CASH_PLUS_DEMO_STORAGE_KEY,
  type CashPlusDemoReview,
  type CashPlusDemoState,
  createCashPlusDemoState,
  executeCashPlusDemo,
  prepareCashPlusDemo,
  restoreCashPlusDemo,
  serializeCashPlusDemo,
} from "@/mocks/services/cashPlusDemo";

const idle: CashPlusTransaction = { phase: "idle", kind: "deposit" };
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function useCashPlusDemo(enabled: boolean): CashPlusController {
  const [state, setState] = useState<CashPlusDemoState | null>(null);
  const [transaction, setTransaction] = useState<CashPlusTransaction>(idle);
  const [advancing, setAdvancing] = useState(false);
  const current = useRef<CashPlusDemoState | null>(null),
    review = useRef<CashPlusDemoReview | null>(null),
    busy = useRef(false),
    generation = useRef(0);
  function save(next: CashPlusDemoState) {
    current.current = next;
    setState(next);
    try {
      sessionStorage.setItem(CASH_PLUS_DEMO_STORAGE_KEY, serializeCashPlusDemo(next));
    } catch {
      /* A restricted browser still supports this tab's in-memory demonstration. */
    }
  }
  useEffect(() => {
    if (!enabled) return;
    let saved: CashPlusDemoState | null = null;
    try {
      saved = restoreCashPlusDemo(sessionStorage.getItem(CASH_PLUS_DEMO_STORAGE_KEY));
    } catch {
      /* Storage is optional. */
    }
    const next = saved ?? createCashPlusDemoState();
    current.current = next;
    setState(next);
    return () => {
      generation.current += 1;
    };
  }, [enabled]);
  return {
    snapshot: state?.snapshot ?? null,
    status: state ? "ready" : "loading",
    wallet: {
      connected: enabled,
      address: CASH_PLUS_PREVIEW_OWNER,
      correctChain: enabled,
      balanceAssets: state?.walletBalance ?? null,
    },
    transaction,
    async review(kind, amount) {
      if (!enabled || busy.current || !current.current) return;
      try {
        review.current = prepareCashPlusDemo(current.current, kind, amount);
        setTransaction(review.current.transaction);
      } catch (error) {
        review.current = null;
        setTransaction({ phase: "error", kind, errorCode: cashPlusErrorCode(error) });
      }
    },
    async confirm() {
      if (!enabled || busy.current || !current.current || !review.current) return;
      const prepared = review.current,
        epoch = generation.current;
      busy.current = true;
      setTransaction({ ...prepared.transaction, phase: "pending" });
      try {
        await pause(900);
        if (epoch !== generation.current || !current.current) return;
        const result = executeCashPlusDemo(current.current, prepared);
        save(result.state);
        review.current = null;
        setTransaction({ ...prepared.transaction, phase: "success", receipt: result.receipt });
      } catch (error) {
        review.current = null;
        setTransaction({
          ...prepared.transaction,
          phase: "error",
          errorCode: cashPlusErrorCode(error),
        });
      } finally {
        if (epoch === generation.current) busy.current = false;
      }
    },
    resetTransaction() {
      if (!busy.current) {
        review.current = null;
        setTransaction(idle);
      }
    },
    async refresh() {
      if (current.current) setState({ ...current.current });
    },
    connect() {},
    async switchNetwork() {},
    demo: enabled
      ? {
          advancing,
          walletTokens: [
            ...(state?.snapshot.composition[0]
              ? [
                  {
                    address: state.snapshot.composition[0].token,
                    symbol: "USDC",
                    decimals: 6,
                    amount: state.walletBalance,
                  },
                ]
              : []),
            ...(state?.walletTokens ?? []),
          ],
          async advanceDay() {
            if (busy.current || !current.current) return;
            const epoch = generation.current;
            busy.current = true;
            setAdvancing(true);
            try {
              await pause(650);
              if (epoch !== generation.current || !current.current) return;
              save(advanceCashPlusDemoDay(current.current));
              if (review.current) {
                setTransaction({
                  ...review.current.transaction,
                  phase: "error",
                  errorCode: "QUOTE_EXPIRED",
                });
                review.current = null;
              }
            } finally {
              if (epoch === generation.current) {
                busy.current = false;
                setAdvancing(false);
              }
            }
          },
          reset() {
            generation.current += 1;
            busy.current = false;
            review.current = null;
            setAdvancing(false);
            setTransaction(idle);
            save(createCashPlusDemoState());
          },
        }
      : undefined,
  };
}
