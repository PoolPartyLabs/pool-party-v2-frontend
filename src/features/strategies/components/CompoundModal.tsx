/**
 * @id PP-STR-MOD-006
 * @name CompoundModal
 * @implements-rules-version v3
 *
 * Reinvest an owned position's available yield back into the strategy: confirm → pending → success.
 * Unlike Collect (which routes yield to the wallet's USDC balance), Compound keeps the yield working
 * by adding it to the position's principal, so it starts earning too. This is the manual sibling to
 * the manager-defined auto-compound. The network fee (gas) is paid by the user. (POO-95 R5)
 *
 * v2 (POO-499 R5a): Compound migrated from its cosmetic setTimeout + settleOutcome timer mock to a
 * single-step mock `useWalletSignFlow` identical to CollectModal's mock branch (same 1.2s beat, same
 * settle outcomes, same confirm→pending→success/error phases), so the shared slippage auto-retry
 * orchestration is uniform across all six modals. Behavior-preserving; there is still no real on-chain
 * executor (no `buildCompoundTx`) — when one lands it slots into the same runner via a build step.
 *
 * v3 (POO-514 rules v1): the success receipt shows the FLOW hash (captured from the runner, today
 * the mock settle hash — the executor is mock-only until POO-511) plus the shared ExplorerTxLink
 * (PP-CORE-CMP-050) on the strategy's network. POO-511's real wiring must keep the receipt hash
 * real-only there, mirroring Invest/Withdraw (POO-514 R3).
 */
"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { ReceiptRows } from "@/components/ui/ReceiptRows";
import { TransactionModalHeader } from "@/components/ui/TransactionModalHeader";
import type { Position, Strategy } from "@/lib/schemas";
import type { TxError } from "@/lib/tx/diagnostics";
import { usePostWriteRefresh } from "@/lib/tx/usePostWriteRefresh";
import {
  formatIdentityLabel,
  formatTokenAmount,
  formatTxHash,
  formatUsd,
} from "@/lib/utils/format";
import { useProvisioningGate } from "../hooks/useProvisioningGate";
import { useSlippageAutoRetry } from "../hooks/useSlippageAutoRetry";
import { type FlowStep, useWalletSignFlow } from "../hooks/useWalletSignFlow";
import { provisioningOpLabelKey } from "../lib/buildProvisioningInput";
import { DEFAULT_SLIPPAGE_PCT } from "../lib/slippage";
import { buildFeeRow, type FeeLine } from "./FeeBreakdown";
import { ProvisioningPanel } from "./ProvisioningPanel";
import { StrategyMiniHeader } from "./StrategyMiniHeader";
import { settleOutcomeForSlippage, settleTxError, settleTxHash } from "./settle";
import { TransactionErrorActions, useTxErrorBody } from "./TransactionErrorActions";
import { TransactionSettingsDialog } from "./TransactionSettingsDialog";
import { TransactionStatus } from "./TransactionStatus";
import { WalletSteps } from "./WalletSteps";

/** Flow phases for the compound dialog (pending shows the multistep wallet handoff, POO-295). */
// POO-419: `provision` gates confirm → pending when the wallet needs a pre-flight top-up.
type Phase = "confirm" | "provision" | "pending" | "success" | "error";

/** Flat protocol fee charged on compound, in percent (POO-385 R3). Mirrors invest/collect. */
const PROTOCOL_FEE_PCT = 0.25;

/**
 * Estimated DEX swap fee on compound, in percent (mock). Mirrors invest/collect DEX_FEE_PCT.
 * PP-INTEGRATION-POINT: the real DEX fee comes from the swap-route quote once the compound executor
 * is wired; mocked here so the combined Fees breakdown renders.
 */
const DEX_FEE_PCT = 0.05;

/** Mocked network gas until a gas estimator is wired (mirrors CollectModal's NETWORK_FEE_USD). */
const NETWORK_FEE_USD = 0.3;

/** Public props for {@link CompoundModal}. */
export interface CompoundModalProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The strategy the position belongs to. */
  strategy: Strategy;
  /** The owned position whose yield is being reinvested. */
  position: Position;
  /** Called once the compound succeeds, so the detail screen refreshes the owner's position. */
  onChanged?: () => void;
}

/** Compound-yield dialog. */
export function CompoundModal({
  open,
  onOpenChange,
  strategy,
  position,
  onChanged,
}: CompoundModalProps) {
  const t = useTranslations("strategies");
  // Receipt dates render in the ACTIVE locale (a hard-coded en-US date on a pt-BR receipt is the
  // semantic-i18n class i18n:check cannot catch).
  const format = useFormatter();
  const [phase, setPhase] = useState<Phase>("confirm");
  // POO-419: pre-flight gate (dark-launched flag) — decides confirm → provision → pending.
  // POO-1042 [R2]: the compound runs on the STRATEGY's chain. It reinvests yield the position already
  // holds, so it asks the wallet for no USDC ([R3]) and only ever needs gas there.
  const gate = useProvisioningGate({ op: "compound", network: strategy.network, enabled: open });
  const [txError, setTxError] = useState<TxError | null>(null);
  // POO-514: the flow hash shown on the receipt (today always the mock settle hash — the compound
  // executor is mock-only until POO-511 wires the real one).
  const [txHash, setTxHash] = useState<string | null>(null);
  // POO-461 R3: kind-aware error body (generic copy when the failure didn't classify).
  const errorBody = useTxErrorBody(txError);
  // POO-385 R4: the ⚙ regains Slippage + Deadline (a swap happens when fees are reinvested into the
  // pool's tokens); no Receive-as (compound always stays in the position).
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE_PCT);
  const [deadlineMins, setDeadlineMins] = useState(30);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Post-write freshness: refetch positions + catalog + re-render, with a bounded poll (POO-364).
  const postWriteRefresh = usePostWriteRefresh(onChanged);
  // Compound reinvests the position's CLAIMABLE FEES (the API's totalFeesInUsd, surfaced as
  // `totalYield`), not the withdrawable balance — same source as Collect (former-interface parity).
  const available = position.totalYield;
  // POO-385 R3: the combined "Fees" line (DEX mock + protocol 0.25%). Like CollectModal (POO-384),
  // these fees are INFORMATIONAL: `available` is already backend-net, so they are NOT subtracted from
  // the headline / CTA / success / receipt — those stay on `available`.
  const protocolFeeUsd = (available * PROTOCOL_FEE_PCT) / 100;
  const dexFeeUsd = (available * DEX_FEE_PCT) / 100;
  // Standardization (Part B): ONE consolidated "Fee" row — DEX + Protocol (0.25%) + Network gas —
  // whose tooltip breaks the total down. Supersedes the earlier split Fees + Network fee rows,
  // mirroring CollectModal (POO-434-adjacent). Still INFORMATIONAL (not subtracted from the headline).
  const feeLines: FeeLine[] = [
    { key: "dex", label: t("compound.feesTooltip.dex"), usd: dexFeeUsd },
    { key: "protocol", label: t("compound.feesTooltip.protocol"), usd: protocolFeeUsd },
    { key: "network", label: t("compound.feesTooltip.network"), usd: NETWORK_FEE_USD },
  ];
  // POO-445 R4/R5: one neutral (never red) consolidated Fee row whose tooltip breaks the total down.
  const feeRow = buildFeeRow({
    label: t("compound.fee"),
    lines: feeLines,
    totalLabel: t("compound.feesTooltip.total"),
  });
  // The success receipt records only the network gas actually paid.
  const gasOnlyLines: FeeLine[] = [
    { key: "network", label: t("compound.feesTooltip.network"), usd: NETWORK_FEE_USD },
  ];
  const gasFeeRow = buildFeeRow({
    label: t("compound.fee"),
    lines: gasOnlyLines,
    totalLabel: t("compound.feesTooltip.total"),
  });
  // POO-385 R3: the slippage-protected minimum that lands in the position. Applies ONLY the slippage
  // haircut (a real cost of the compound swap); the informational DEX+protocol fees are NOT subtracted
  // here (that would double-count against the backend-net `available`). PP-MOCK math; the real net
  // comes from the compound executor's quote.
  const compoundAtLeast = Math.max(0, available * (1 - slippage / 100));

  // The gear slippage read at run time by the mock confirm step (POO-499 R6), kept out of step deps.
  const slippageRef = useRef(slippage);
  slippageRef.current = slippage;
  // POO-499 R5a: the compound operation as a single mock runner step, identical in shape to
  // CollectModal's mock branch (same 1.2s beat, same settle outcomes). There is no real executor yet.
  // PP-INTEGRATION-POINT: when a buildCompoundTx / collect-and-reinvest action lands, replace this mock
  // step with the real build → send steps (like useInvest/useCollectFees) driven by the same runner.
  // PP-MOCK: mock-only settle; POO-499 R6 forces a slippage failure when the gear is <= 0.1%.
  const compoundSteps = useMemo<FlowStep<Record<string, unknown>>[]>(
    () => [
      {
        key: "confirm:compound",
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (settleOutcomeForSlippage(slippageRef.current) === "error") {
            const mockError = settleTxError();
            throw Object.assign(new Error(mockError.message), { code: mockError.code });
          }
          return { txHash: settleTxHash() };
        },
      },
    ],
    [],
  );
  const flow = useWalletSignFlow(compoundSteps, { fallbackErrorCode: "COMPOUND_FAILED" });
  // POO-499 (POO-467 R2/R3): shared slippage auto-retry. Compound folds build+send into the single
  // confirm:compound step, so retryFrom("build") falls back to re-running it (R2a).
  const slippageRetry = useSlippageAutoRetry({
    flow,
    flowName: "compound",
    strategyId: strategy.id,
    slippagePct: slippage,
    onOpenSettings: () => setSettingsOpen(true),
  });
  const errorTitle = slippageRetry.slippageError
    ? t("flow.slippage.errorTitle")
    : t("flow.error.title");
  const errorBodyText = slippageRetry.slippageError
    ? t("flow.slippage.errorBody", { value: slippageRetry.slippagePct })
    : errorBody;

  // Drive phase off the runner's outcome (POO-499 R5a: replaces the cosmetic setTimeout). The single
  // step reflects the mock settlement; a thrown step surfaces via flow.error. POO-499 R2 suppresses
  // the error flip during the first slippage failure's automatic retry.
  useEffect(() => {
    if (phase !== "pending") return;
    if (flow.status === "success") {
      // POO-514: capture the flow hash for the receipt row + explorer link.
      if (flow.txHash) setTxHash(flow.txHash);
      setTxError(null);
      setPhase("success");
    } else if (flow.status === "error") {
      if (slippageRetry.autoRetrying) return;
      setTxError(flow.error);
      setPhase("error");
    }
  }, [phase, flow.status, flow.txHash, flow.error, slippageRetry.autoRetrying]);

  // On success, refresh the owner's position state: re-fetch the client positions (yield → 0,
  // principal grew), drop the catalog cache, and re-run the server components.
  useEffect(() => {
    if (phase !== "success") return;
    postWriteRefresh();
  }, [phase, postWriteRefresh]);

  function handleOpenChange(next: boolean) {
    // POO-419 R3: no dismissal while provisioning is executing (ESC / overlay / X are all blocked).
    if (!next && gate.locked) return;
    onOpenChange(next);
    if (!next) {
      setSettingsOpen(false);
      flow.reset();
      setTimeout(() => {
        setPhase("confirm");
        setTxError(null);
        setTxHash(null);
        setSlippage(DEFAULT_SLIPPAGE_PCT);
        setDeadlineMins(30);
        gate.reset();
      }, 150);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        {phase === "confirm" ? (
          <>
            {/* POO-445 R1: shared header — gear (slippage + deadline) next to the Dialog X. */}
            <TransactionModalHeader
              title={t("compound.title")}
              onSettings={() => setSettingsOpen(true)}
              settingsLabel={t("invest.settings.title")}
            />
            <StrategyMiniHeader strategy={strategy} />

            {/* POO-385 R2: hero "Available to compound" = USDC primary + discreet $. */}
            <div className="mt-2 flex flex-col items-center gap-1 rounded-xl border border-border bg-surface-raised p-5 text-center">
              <p className="text-muted-foreground text-sm">{t("compound.available")}</p>
              <p className="font-bold text-3xl text-success">
                {formatTokenAmount(available, "USDC")}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("compound.approxUsd", { usd: formatUsd(available) })}
              </p>
            </div>

            {/* POO-385 R3: combined Fees (w/ tooltip, informational) · Network fee · "You will
                compound at least" (slippage-protected minimum). The fees are NOT subtracted from the
                headline/CTA — those stay on the backend-net `available`, like CollectModal (POO-384). */}
            <ReceiptRows
              groups={[
                [
                  feeRow,
                  {
                    label: t("compound.atLeast"),
                    value: t("compound.approxValue", {
                      amount: formatTokenAmount(compoundAtLeast, "USDC"),
                      usd: formatUsd(compoundAtLeast),
                    }),
                    tone: "emphasis",
                  },
                ],
              ]}
            />

            <p className="text-muted-foreground text-xs">{t("compound.note")}</p>

            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                // POO-419: gas-only pre-flight (no amount arg). If the wallet is short on gas or on
                // the wrong network, provision first, then resume this compound.
                if (gate.evaluate()) {
                  setPhase("provision");
                  return;
                }
                setPhase("pending");
                void flow.run();
              }}
            >
              {t("compound.cta", { amount: formatUsd(available) })}
            </Button>
          </>
        ) : null}

        {phase === "provision" && gate.input ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("provisioning.plan.title")}</DialogTitle>
            </DialogHeader>
            <StrategyMiniHeader strategy={strategy} />
            {/* POO-419: pre-flight top-up, then resume the compound (gas-only; no separate build —
                onDone mirrors the confirm CTA's setPhase("pending") + flow.run() transition exactly). */}
            <ProvisioningPanel
              input={gate.input}
              context={gate.context}
              opLabel={t(provisioningOpLabelKey("compound"), { strategy: strategy.name })}
              onDone={() => {
                gate.setLocked(false);
                setPhase("pending");
                void flow.run();
              }}
              onCancel={() => setPhase("confirm")}
              onLockChange={gate.setLocked}
            />
          </>
        ) : null}

        {phase === "pending" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("flow.processing")}</DialogTitle>
            </DialogHeader>
            <StrategyMiniHeader strategy={strategy} />
            {/* POO-499 R2: the auto-retry notice sits in the pending view while the flow re-runs. */}
            {slippageRetry.autoRetrying ? (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-center text-warning text-sm">
                {t("flow.slippage.retryNotice", { value: slippageRetry.slippagePct })}
              </p>
            ) : null}
            {/* POO-499 R5a: the controlled runner stepper replaces the old cosmetic single-step timer.
                PP-INTEGRATION-POINT: compound has no real on-chain executor yet. When a useCompound
                hook lands (buildSteps → build → send, like useInvest/useCollectFees), add its build
                step to `compoundSteps`; the runner + this stepper stay as-is. */}
            <WalletSteps
              steps={[{ key: "confirm:compound", label: t("sign.steps.confirmCompound") }]}
              activeStep={flow.activeStep}
              statuses={flow.statuses}
              txHashes={flow.txHashes}
            />
          </>
        ) : null}

        {phase === "success" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{t("compound.success.title")}</DialogTitle>
            </DialogHeader>
            <TransactionStatus
              phase="success"
              title={t("compound.success.title")}
              body={t("compound.success.body", {
                amount: formatUsd(available),
                name: strategy.name,
              })}
            >
              {/* Standardized receipt (POO-279 R7/R8) */}
              <ReceiptRows
                groups={[
                  [
                    // POO-841 R2: uniform belt across every receipt strategy row.
                    {
                      label: t("flow.receipt.strategy"),
                      value: formatIdentityLabel(strategy.name),
                    },
                    { label: t("flow.receipt.amount"), value: formatUsd(available) },
                    gasFeeRow,
                  ],
                  [
                    {
                      label: t("flow.receipt.date"),
                      value: format.dateTime(new Date(), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    },
                    {
                      // POO-514 R1: the FLOW hash (mock-only executor today; POO-511's real wiring
                      // must keep this real-only there, like Invest/Withdraw).
                      label: t("flow.receipt.transaction"),
                      value: formatTxHash(txHash ?? settleTxHash()),
                    },
                  ],
                ]}
              />
              <Button className="w-full" size="lg" onClick={() => handleOpenChange(false)}>
                {t("flow.done")}
              </Button>
              {/* POO-514 R2: the shared explorer link on the strategy's network (/tx/{hash}). */}
              <ExplorerTxLink network={strategy.network} hash={txHash ?? settleTxHash()} />
            </TransactionStatus>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>{errorTitle}</DialogTitle>
            </DialogHeader>
            <TransactionStatus phase="error" title={errorTitle} body={errorBodyText}>
              <TransactionErrorActions
                onRetry={() => {
                  setPhase("pending");
                  // POO-499 R3: after a slippage error, re-run from build (Compound's single
                  // confirm:compound folds build+send); R4: non-slippage keeps resume-from-failed-step.
                  if (slippageRetry.slippageError) void flow.retryFrom("build");
                  else void flow.retry();
                }}
                error={txError ?? undefined}
              />
            </TransactionStatus>
          </>
        ) : null}
      </DialogContent>
      {/* POO-385 R4: ⚙ Settings = Slippage + Deadline only (no Receive-as; compound stays in the
          position). */}
      <TransactionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
      />
    </Dialog>
  );
}
