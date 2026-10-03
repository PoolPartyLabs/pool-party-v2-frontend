/**
 * @id PP-MGR-CMP-064 (POO-2172)
 * @name FundReviewSlot
 * @implements-rules-version v1
 * Real wallet binding and reload-safe launch; mock mode never signs.
 */
"use client";
import { useWallets } from "@privy-io/react-auth";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { createPublicClient, erc20Abi, type Hex, http } from "viem";
import { z } from "zod";
import { getChainById, getUsdcAddress } from "@/lib/chains";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { useUploadMedia } from "@/lib/media/useUploadMedia";
import { isMockMode } from "@/lib/services";
import { isUserRejection, sendBuiltTransaction } from "@/lib/tx/sendTransaction";
import { useEnsureWalletChain } from "@/lib/tx/useEnsureWalletChain";
import type { MandateCatalog } from "../mandateCatalog";
import type { MandateDraft } from "../mandateDraft";
import { toV2MandateSelection } from "../v2Mandate";
import { createLaunchDriver, type FrozenLaunch } from "./driver";
import { createJournal, journalKey, type LaunchJournal, loadJournal, runLaunch } from "./journal";
import { withLaunchLock } from "./lock";
import { type CanvasPlan, deriveLaunchSteps, type ExecutionConfig, type LaunchStep } from "./plan";
import { FundReviewForm } from "./ReviewForm";
import { type FundReview, rawUsdc } from "./review";

export interface FundReviewSlotProps {
  draft: MandateDraft;
  catalog: MandateCatalog;
  onBack: () => void;
}
const defaults = (draft: MandateDraft): FundReview => ({
  name: draft.name ?? "",
  description: "",
  imageUrl: "",
  performanceFeeBps: 2000,
  managementFeeBps: 0,
  payoutFeeBps: 200,
  minimum: "100",
  seed: "100",
});
export function FundReviewSlot(props: FundReviewSlotProps) {
  const { isEnabled } = useFeatureFlags();
  const t = useTranslations("manager");
  if (!isEnabled("fundContracts")) return null;
  if (isMockMode) return <p role="status">{t("fundLaunch.realOnly")}</p>;
  return <RealFundReview {...props} />;
}
function RealFundReview({ draft, catalog, onBack }: FundReviewSlotProps) {
  // PP-INTEGRATION-POINT: real Privy wallet, chain receipts and wallet-scoped staged S3 logo upload.
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const ensureChain = useEnsureWalletChain();
  const upload = useUploadMedia("logo");
  const t = useTranslations("manager");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [journal, setJournal] = useState<LaunchJournal | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const running = useRef(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!wallet) return;
    try {
      setJournal(loadJournal(localStorage, draft.id, wallet.address));
      setHydrated(true);
    } catch {
      setError(true);
    }
    const chain = getChainById(42161);
    if (!chain) return;
    const client = createPublicClient({ chain, transport: http() });
    let active = true;
    client
      .readContract({
        address: getUsdcAddress(42161) as Hex,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.address as Hex],
      })
      .then((value) => {
        if (active) setBalance(value);
      })
      .catch(() => {
        if (active) setBalance(null);
      });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, [draft.id, wallet]);
  let steps: LaunchStep[] = [];
  let gap = false;
  const extended = draft as MandateDraft & {
    plan?: CanvasPlan;
    launchExecution?: Record<string, ExecutionConfig>;
  };
  try {
    if (journal) steps = journal.steps;
    else if (extended.plan)
      steps = deriveLaunchSteps(
        extended.plan,
        extended.launchExecution ?? {},
        true,
        draft.networks.includes("robinhood"),
      );
    else gap = true;
  } catch {
    gap = true;
  }
  if (!wallet || !hydrated || error) return <p role="alert">{t("fundLaunch.walletOrJournal")}</p>;
  const initial = journal ? (journal.frozen as FrozenLaunch).review : defaults(draft);
  return (
    <FundReviewForm
      initial={initial}
      balance={balance}
      steps={steps}
      journal={journal}
      busy={busy}
      gap={gap}
      onBack={onBack}
      onPause={() => abort.current?.abort()}
      onUpload={upload}
      onLaunch={async (review) => {
        if (running.current) return;
        running.current = true;
        setBusy(true);
        const controller = new AbortController();
        abort.current = controller;
        try {
          await withLaunchLock(journalKey(draft.id, wallet.address), async () => {
            let current = loadJournal(localStorage, draft.id, wallet.address);
            if (!current) {
              const selection = toV2MandateSelection(draft, catalog);
              const frozen: FrozenLaunch = {
                plan: extended.plan,
                request: {
                  ...selection,
                  manager: wallet.address,
                  performanceFeeBps: review.performanceFeeBps,
                  managementFeeBps: review.managementFeeBps,
                  payoutFeeBps: review.payoutFeeBps,
                  minFirstDeposit: rawUsdc(review.minimum).toString(),
                  seedAmount: rawUsdc(review.seed).toString(),
                },
                review,
              };
              current = createJournal(draft.id, wallet.address, frozen, steps);
            }
            const driver = createLaunchDriver({
              async send(transaction) {
                const provider = await ensureChain(wallet, transaction.chainId);
                if (abort.current?.signal.aborted) throw new Error("LAUNCH_CANCELLED");
                try {
                  return await sendBuiltTransaction(
                    provider,
                    { tx: transaction, chainId: transaction.chainId },
                    wallet.address,
                    transaction.chainId,
                  );
                } catch (failure) {
                  if (isUserRejection(failure)) throw new Error("USER_REJECTED");
                  throw new Error("SUBMISSION_RECONCILIATION_REQUIRED");
                }
              },
              async receipt(chainId, hash) {
                const chain = getChainById(chainId);
                if (!chain) return null;
                try {
                  return await createPublicClient({
                    chain,
                    transport: http(),
                  }).getTransactionReceipt({
                    hash: z
                      .string()
                      .regex(/^0x[0-9a-fA-F]{64}$/)
                      .parse(hash) as Hex,
                  });
                } catch {
                  return null;
                }
              },
              async sign(message) {
                const provider = await ensureChain(wallet, 42161);
                if (abort.current?.signal.aborted) throw new Error("LAUNCH_CANCELLED");
                return z.string().parse(
                  await provider.request({
                    method: "personal_sign",
                    params: [
                      `0x${Array.from(new TextEncoder().encode(message), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
                      wallet.address,
                    ],
                  }),
                );
              },
            });
            do {
              await runLaunch(current, localStorage, driver, setJournal, controller.signal);
              if (
                Object.values(current.checkpoints).some(
                  (checkpoint) => checkpoint.status === "failed",
                ) ||
                current.steps.every((step) => current?.checkpoints[step.id]?.status === "confirmed")
              )
                break;
              await new Promise<void>((resolve) => {
                const timeout = setTimeout(resolve, 10_000);
                abort.current?.signal.addEventListener(
                  "abort",
                  () => {
                    clearTimeout(timeout);
                    resolve();
                  },
                  { once: true },
                );
              });
            } while (!controller.signal.aborted);
          });
        } finally {
          running.current = false;
          setBusy(false);
        }
      }}
    />
  );
}
