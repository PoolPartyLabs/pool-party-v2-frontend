/**
 * @id PP-MGR-HOK-019 (POO-2177)
 * @name useV2Launch
 * @implements-rules-version v1
 */
"use client";
import { useEffect, useState } from "react";
import { getCatalogReservesAction, getCatalogTokensAction } from "@/lib/api/v2/actions";
import { createRequestSchema } from "@/lib/api/v2/launchSchemas";
import { normalizePlan } from "../build/plan/planStorage";
import { getDraft } from "../mandateDraftStore";
import { buildRealCatalog, toV2MandateSelection } from "../v2Mandate";
import type { LaunchJourney } from "./contracts";
import type { FrozenLaunch } from "./driver";
import { explorerTxUrl, persistJourney, readFrozenJournal, readJourney } from "./journey";
import { hasLaunchTokenAllowance, rawUsdc } from "./review";
import { useV2LaunchBinding } from "./useV2LaunchBinding";
import { useV2LaunchWallet } from "./useV2LaunchWallet";

export function useV2Launch(journeyId: string) {
  const wallet = useV2LaunchWallet();
  const [journey, setJourney] = useState<LaunchJourney | null>(null);
  const [frozen, setFrozen] = useState<FrozenLaunch | undefined>();
  const [loadingError, setLoadingError] = useState(false);
  useEffect(() => {
    let active = true;
    setJourney(null);
    setFrozen(undefined);
    setLoadingError(false);
    try {
      let found = readJourney(journeyId);
      if (!found) {
        const decodedId = decodeURIComponent(journeyId);
        const [, encodedManager, draftId] = /^(0x[0-9a-fA-F]{40}):(.+)$/.exec(decodedId) ?? [];
        if (
          !encodedManager ||
          !draftId ||
          encodedManager.toLowerCase() !== wallet.manager?.toLowerCase()
        ) {
          setLoadingError(true);
          return;
        }
        const manager = encodedManager.toLowerCase();
        const journal = readFrozenJournal(draftId, manager);
        const draft = journal ? getDraft(draftId) : null;
        if (journal && draft) {
          const snapshot = journal.frozen as Required<FrozenLaunch>;
          const plan = normalizePlan(snapshot.plan);
          if (!plan) throw new Error("INVALID_JOURNAL");
          found = persistJourney({ ...draft, plan, review: snapshot.review }, manager);
        }
      }
      if (!found) {
        setLoadingError(true);
        return;
      }
      setJourney(found);
      if (found.journal) {
        setFrozen(found.journal.frozen as FrozenLaunch);
        return;
      }
      Promise.all([
        getCatalogTokensAction(42161),
        getCatalogTokensAction(4663),
        getCatalogReservesAction(),
      ])
        .then(([hub, spoke, reserves]) => {
          if (!active) return;
          if (!hub.ok || !spoke.ok || !reserves.ok) throw new Error("CATALOG_UNAVAILABLE");
          if (!hasLaunchTokenAllowance(found.draft))
            throw new Error("LIMITS_TOKEN_ALLOWANCE_REQUIRED");
          const request = toV2MandateSelection(
            found.draft,
            buildRealCatalog([...hub.data.tokens, ...spoke.data.tokens], reserves.data.reserves),
          );
          setFrozen({
            plan: found.draft.plan,
            review: found.draft.review,
            request: createRequestSchema.parse({
              ...request,
              manager: found.manager,
              performanceFeeBps: found.draft.review.performanceFeeBps,
              managementFeeBps: found.draft.review.managementFeeBps,
              payoutFeeBps: found.draft.review.payoutFeeBps,
              minFirstDeposit: rawUsdc(found.draft.review.minimum).toString(),
              seedAmount: rawUsdc(found.draft.review.seed).toString(),
            }),
          });
        })
        .catch(() => {
          if (active) setLoadingError(true);
        });
    } catch {
      setLoadingError(true);
    }
    return () => {
      active = false;
    };
  }, [journeyId, wallet.manager]);
  const originalWallet = journey?.manager.toLowerCase() === wallet.manager?.toLowerCase();
  const binding = useV2LaunchBinding({
    draftId: journey?.draftId ?? journeyId,
    manager: originalWallet ? wallet.manager : null,
    plan: journey?.draft.plan,
    execution: journey?.draft.launchExecution,
    spoke: journey?.draft.networks.includes("robinhood") ?? false,
    wallet: originalWallet ? wallet.wallet : null,
    frozen,
  });
  const steps = binding.steps.map((step) => {
    const checkpoint = binding.checkpoints[step.id];
    return {
      ...step,
      chainId: step.chain,
      label: `manager.fundLaunch.${step.kind}`,
      status: checkpoint?.status ?? "idle",
      txHash: checkpoint?.txHash ?? null,
      explorerUrl: checkpoint?.txHash ? explorerTxUrl(step.chain, checkpoint.txHash) : null,
      receiptStatus: checkpoint?.receiptStatus ?? null,
      error: checkpoint?.error ?? null,
      waitReason: checkpoint?.waitReason ?? null,
      result: checkpoint?.data ?? null,
    };
  });
  return {
    ...binding,
    journey,
    steps,
    current: steps.find((step) => step.status !== "confirmed") ?? null,
    sign: async () => {
      if (frozen || binding.journal) await binding.sign();
    },
    retry: binding.retry,
    resume: binding.resume,
    cancel: binding.pause,
    outcome:
      binding.status === "complete"
        ? ("completed" as const)
        : loadingError || binding.error
          ? ("failed" as const)
          : ("in-progress" as const),
    ready: !!frozen && originalWallet && !loadingError,
    loadingError,
  };
}
