/**
 * @id PP-CORE-MOD-010
 * @name BuyGasModal
 * @implements-rules-version v4 (POO-1044 rules v1) · v3 (POO-523 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * Standalone pre-flight gas top-up (POO-331). When an op is short on native gas, this captures the
 * amount ($10 / $25 / Custom) and tops it up. Phases: amount → pending (the {@link WalletSteps}
 * handoff) → success | error. No in-app confirm screen and no fees/total row — the Figma abstracts
 * fees into the conversion note (decided 2026-06-30). Mobile renders as a {@link Sheet} bottom sheet.
 *
 * POO-1044 [R5]: the "Powered by Paybis" attribution is gone, and the conversion note no longer
 * says the top-up is paid from USDC. The step that Universal Funding actually implements is a
 * `swap-gas` leg: an on-chain swap of a slice of what the wallet already holds into the chain's
 * native coin, quoted and routed by Uniswap. No fiat rail is involved and no USDC is required, so
 * both pieces of copy described a step that does not exist. The Paybis attribution stays where it is
 * true, on the fiat `buy-usdc` step and the deposit screen.
 *
 * The gas-only branch of the pre-flight gate (POO-418) opens this; the multi-requirement case uses the
 * provisioning wizard (POO-409). On success it emits the chosen {@link GasChoice} via `onDone` so the
 * caller can resume the original op.
 *
 * POO-523: the top-up is a USDC→native swap, so the amount phase carries the shared settings gear
 * ({@link TransactionModalHeader} + {@link TransactionSettingsDialog}) with Max slippage (0.5/1/2,
 * default 2%) + deadline (R1); the chosen slippage threads into `buildGasSteps` (R2) and resets to
 * the 2% default on close (R3, the POO-513 policy). Fees stay abstracted in the conversion note.
 *
 * PP-INTEGRATION-POINT: in real mode the host passes `buildGasSteps` (the rail's USDC→native top-up,
 * POO-414/POO-334); absent it, the mock settle path runs. The amount/quote sizing is the mock planner
 * (POO-420) until the BE lands.
 */
"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ReceiptRows } from "@/components/ui/ReceiptRows";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/Sheet";
import { TransactionModalHeader } from "@/components/ui/TransactionModalHeader";
import type { GasChoice } from "@/lib/provisioning";
import type { TxError } from "@/lib/tx/diagnostics";
import { formatTxHash, formatUsd } from "@/lib/utils/format";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import { DEFAULT_SLIPPAGE_PCT } from "../lib/slippage";
import { GasAmountSelector } from "./provisioning/GasAmountSelector";
import { selectPreset, validateGas } from "./provisioning/gasSelection";
import { settleOutcome, settleTxError, settleTxHash } from "./settle";
import { TransactionErrorActions, useTxErrorBody } from "./TransactionErrorActions";
import { TransactionSettingsDialog } from "./TransactionSettingsDialog";
import { TransactionStatus } from "./TransactionStatus";
import { WalletSteps } from "./WalletSteps";

/** Flow phases for the buy-gas sheet (no confirm step — amount hands straight off to the top-up). */
type Phase = "amount" | "pending" | "success" | "error";

/** Accumulating context is unused (single step); kept generic for the flow runner. */
type GasCtx = Record<string, unknown>;

/** Public props for {@link BuyGasModal}. */
export interface BuyGasModalProps {
  /** Whether the sheet is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** Spendable USDC (USD); over this, the rail on-ramps the shortfall (informational). */
  balanceUsd?: number;
  /** Default-selected preset; defaults to $10 (`GAS_DEFAULT_USD`). */
  defaultPresetUsd?: 10 | 25;
  /**
   * Real-mode gas top-up steps for the chosen amount. When provided they replace the mock settle;
   * when absent the always-success mock runs (mock mode). `slippagePct` is the settings gear's Max
   * slippage, in percent (POO-523 R2), for the rail's USDC→native swap.
   */
  buildGasSteps?: (gas: GasChoice, slippagePct: number) => FlowStep<GasCtx>[];
  /** Emits the chosen gas once the top-up succeeds, so the caller can resume its original op. */
  onDone?: (gas: GasChoice) => void;
  className?: string;
}

/** Buy-gas (pre-flight gas top-up) sheet. */
export function BuyGasModal({
  open,
  onOpenChange,
  balanceUsd = Number.POSITIVE_INFINITY,
  defaultPresetUsd = 10,
  buildGasSteps,
  onDone,
  className,
}: BuyGasModalProps) {
  const t = useTranslations("strategies");
  const format = useFormatter();
  const [phase, setPhase] = useState<Phase>("amount");
  const [gas, setGas] = useState<GasChoice | null>(() => selectPreset(defaultPresetUsd));
  const [txError, setTxError] = useState<TxError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  // POO-523 R1: the settings gear state — Max slippage (investor default 2%) + deadline.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE_PCT);
  const [deadlineMins, setDeadlineMins] = useState(30);

  // Latest handlers/choice via refs so a parent re-render can't swap them mid-flight.
  const buildGasStepsRef = useRef(buildGasSteps);
  buildGasStepsRef.current = buildGasSteps;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const gasRef = useRef(gas);
  gasRef.current = gas;
  // The gear slippage read at run time (POO-523 R2), same out-of-deps guard.
  const slippageRef = useRef(slippage);
  slippageRef.current = slippage;

  const validity = validateGas(gas, balanceUsd);
  // Guard the display amount: an empty Custom field parses to NaN; show $0.00 (CTA stays disabled).
  const amountUsd = gas && Number.isFinite(gas.amountUsd) ? gas.amountUsd : 0;

  // The top-up as a single runner step. Real mode runs the rail's steps; mock settles after a beat.
  const steps = useMemo<FlowStep<GasCtx>[]>(
    () => [
      {
        key: "topUpGas",
        run: async () => {
          const choice = gasRef.current;
          const buildReal = buildGasStepsRef.current;
          if (buildReal && choice) {
            // PP-INTEGRATION-POINT: real USDC→native gas top-up via the provisioning rail (POO-414).
            // POO-523 R2: the gear's Max slippage threads into the swap build.
            let last: { txHash?: string } = {};
            for (const realStep of buildReal(choice, slippageRef.current)) {
              const result = (await realStep.run({})) ?? {};
              if (result.txHash) last = { txHash: result.txHash };
            }
            return last;
          }
          // PP-MOCK: settle after a beat (always success in mock mode).
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (settleOutcome() === "error") {
            const mockError = settleTxError();
            throw Object.assign(new Error(mockError.message), { code: mockError.code });
          }
          return { txHash: settleTxHash() };
        },
      },
    ],
    [],
  );
  const flow = useWalletSignFlow<GasCtx>(steps, { fallbackErrorCode: "GAS_TOPUP_FAILED" });
  // POO-461 R3: kind-aware error body (generic copy when the failure didn't classify).
  const errorBody = useTxErrorBody(txError);

  // Drive phase off the runner's settlement (started by the CTA / retry).
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") {
      if (flow.txHash) setTxHash(flow.txHash);
      setPhase("success");
      const choice = gasRef.current;
      if (choice) onDoneRef.current?.(choice);
    } else if (flow.status === "error") {
      setTxError(flow.error);
      setPhase("error");
    }
  }, [flow.status, flow.txHash, flow.error, phase]);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setSettingsOpen(false);
      flow.reset();
      setTimeout(() => {
        setPhase("amount");
        setGas(selectPreset(defaultPresetUsd));
        setTxError(null);
        setTxHash(null);
        // POO-523 R3: closing resets the gear to the defaults (POO-513 universal policy).
        setSlippage(DEFAULT_SLIPPAGE_PCT);
        setDeadlineMins(30);
      }, 150);
    }
  }

  // While the top-up is in flight, lock dismissal: no X, no swipe, no Esc/overlay close.
  const locked = phase === "pending";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className={className}
        showClose={!locked}
        disableSwipe={locked}
        aria-describedby={undefined}
        onInteractOutside={(event) => {
          if (locked) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (locked) event.preventDefault();
        }}
      >
        {phase === "amount" ? (
          <>
            {/* POO-523 R1: the shared header carries the settings gear (left of the X). */}
            <TransactionModalHeader
              title={t("provisioning.gas.title")}
              onSettings={() => setSettingsOpen(true)}
              settingsLabel={t("invest.settings.title")}
            />
            <p className="text-muted-foreground text-sm">{t("provisioning.gas.subtitle")}</p>
            <GasAmountSelector value={gas} onChange={setGas} balanceUsd={balanceUsd} />
            <p className="text-muted-foreground text-xs">{t("provisioning.gas.conversionNote")}</p>
            <div className="flex flex-col gap-2">
              <Button
                className="w-full"
                size="lg"
                disabled={!validity.ok}
                onClick={() => {
                  setPhase("pending");
                  void flow.run();
                }}
              >
                {t("provisioning.gas.cta", { amount: formatUsd(amountUsd) })}
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => handleOpenChange(false)}>
                {t("provisioning.gas.dismiss")}
              </Button>
            </div>
          </>
        ) : null}

        {phase === "pending" ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>{t("flow.processing")}</SheetTitle>
            </SheetHeader>
            <WalletSteps
              steps={[
                {
                  key: "topUpGas",
                  label: t("provisioning.gas.signStep"),
                  why: {
                    name: t("sign.explain.confirm.name"),
                    body: t("sign.explain.confirm.body"),
                  },
                },
              ]}
              activeStep={flow.activeStep}
              statuses={flow.statuses}
              txHashes={flow.txHashes}
            />
          </>
        ) : null}

        {phase === "success" ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>{t("provisioning.gas.success.title")}</SheetTitle>
            </SheetHeader>
            <TransactionStatus
              phase="success"
              title={t("provisioning.gas.success.title")}
              body={t("provisioning.gas.success.body")}
            >
              <ReceiptRows
                groups={[
                  [
                    { label: t("flow.receipt.amount"), value: formatUsd(amountUsd) },
                    {
                      label: t("flow.receipt.date"),
                      value: format.dateTime(new Date(), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    },
                    {
                      label: t("flow.receipt.transaction"),
                      value: formatTxHash(txHash ?? settleTxHash()),
                    },
                  ],
                ]}
              />
              <Button className="w-full" size="lg" onClick={() => handleOpenChange(false)}>
                {t("flow.done")}
              </Button>
            </TransactionStatus>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>{t("flow.error.title")}</SheetTitle>
            </SheetHeader>
            <TransactionStatus phase="error" title={t("flow.error.title")} body={errorBody}>
              <TransactionErrorActions
                onRetry={() => {
                  setPhase("pending");
                  void flow.retry();
                }}
                error={txError ?? undefined}
              />
            </TransactionStatus>
          </>
        ) : null}
      </SheetContent>
      {/* POO-523 R1: Max slippage (0.5/1/2, default 2%) + deadline for the USDC→native swap. Fees
          stay abstracted in the conversion note (2026-06-30 decision). */}
      <TransactionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
      />
    </Sheet>
  );
}
