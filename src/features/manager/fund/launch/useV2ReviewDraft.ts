/**
 * @id PP-MGR-HOK-018 (POO-2177)
 * @name useV2ReviewDraft
 * @implements-rules-version v1
 */
"use client";
import { useEffect, useState } from "react";
import { readLaunchFundAction } from "@/lib/api/v2/launchActions";
import type { MandateDraft } from "../mandateDraft";
import { getDraft, subscribe, upsertDraft } from "../mandateDraftStore";
import { useV2MandateCatalog } from "../useV2MandateCatalog";
import { toV2MandateSelection } from "../v2Mandate";
import type { FundLaunchDraft } from "./contracts";
import { loadJournal } from "./journal";
import { getLaunchSteps } from "./journey";
import { type CanvasPlan, launchPlanError } from "./plan";
import { useV2LaunchWallet } from "./useV2LaunchWallet";
import { useV2ReviewBinding } from "./useV2ReviewBinding";

export function useV2ReviewDraft(draftId: string) {
  const catalog = useV2MandateCatalog();
  const wallet = useV2LaunchWallet();
  const [draft, setDraft] = useState<(MandateDraft & { plan?: CanvasPlan }) | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [flowFeeBps, setFlowFeeBps] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setFlowFeeBps(null);
    if (!wallet.manager) return;
    try {
      const core = loadJournal(localStorage, draftId, wallet.manager)?.addresses.coreVault;
      if (core)
        void readLaunchFundAction(core).then((result) => {
          if (!active || !result.ok) return;
          const fees = result.data.fees as { flowFeeBps?: unknown } | undefined;
          const rawFee = fees?.flowFeeBps;
          const fee =
            typeof rawFee === "string" && /^\d{1,5}$/.test(rawFee) ? Number(rawFee) : rawFee;
          if (typeof fee === "number" && Number.isInteger(fee) && fee >= 0 && fee < 10000)
            setFlowFeeBps(fee);
        });
    } catch {}
    return () => {
      active = false;
    };
  }, [draftId, wallet.manager]);
  useEffect(() => {
    const read = () => setDraft(getDraft(draftId));
    read();
    return subscribe(read);
  }, [draftId]);
  const placeholder = { id: draftId, name: null } as MandateDraft;
  const binding = useV2ReviewBinding({
    draft: draft ?? placeholder,
    catalog,
    balance: wallet.balance,
    initial: draft?.review,
    flowFeeBps: flowFeeBps ?? 25,
  });
  const persistReview = (review: typeof binding.review) => {
    const latest = getDraft(draftId);
    if (!latest) {
      setStorageError(true);
      return;
    }
    const stored = upsertDraft({ ...latest, review });
    setStorageError(stored === null);
    if (stored) binding.replaceReview(review);
  };
  useEffect(() => {
    if (draft)
      binding.replaceReview(
        draft.review ?? {
          name: draft.name ?? "",
          description: "",
          imageUrl: "",
          performanceFeeBps: 2000,
          managementFeeBps: 0,
          payoutFeeBps: 200,
          minimum: "100",
          seed: "100",
        },
      );
  }, [draft, binding.replaceReview]);
  const launchBlockers: { code: string; field?: string; messageKey: string }[] = binding.errors.map(
    (error) => ({ code: "INVALID_REVIEW", field: error.field, messageKey: error.messageKey }),
  );
  if (!draft)
    launchBlockers.push({ code: "DRAFT_UNAVAILABLE", messageKey: "fundLaunch.walletOrJournal" });
  if (storageError)
    launchBlockers.push({ code: "STORAGE_UNAVAILABLE", messageKey: "fundLaunch.walletOrJournal" });
  if (binding.uploading)
    launchBlockers.push({
      code: "LOGO_UPLOADING",
      field: "imageUrl",
      messageKey: "fundLaunch.uploadFailed",
    });
  if (draft) {
    try {
      toV2MandateSelection(draft, catalog);
      if (!draft.plan) throw new Error("BUILD_EXECUTION_GAP");
      getLaunchSteps({ ...draft, review: binding.review } as FundLaunchDraft);
    } catch (error) {
      launchBlockers.push(launchPlanError(error));
    }
  }
  return {
    ...binding,
    catalog,
    draft,
    manager: wallet.manager,
    setField: <Field extends keyof typeof binding.review>(
      field: Field,
      value: (typeof binding.review)[Field],
    ) => {
      if (!draft) return;
      persistReview({ ...binding.review, [field]: value });
    },
    setMax: () => {
      if (wallet.balance !== null)
        persistReview({ ...binding.review, seed: binding.balanceDecimal ?? "0" });
    },
    setFeePercent: (
      field: "performanceFeeBps" | "managementFeeBps" | "payoutFeeBps",
      value: string,
    ) => {
      if (!/^\d+(\.\d{0,2})?$/.test(value)) throw new Error("INVALID_FEE");
      const bounds =
        field === "performanceFeeBps"
          ? [1000, 9000]
          : field === "managementFeeBps"
            ? [0, 500]
            : [0, 1000];
      persistReview({
        ...binding.review,
        [field]: Math.max(
          bounds[0] ?? 0,
          Math.min(bounds[1] ?? 0, Math.round(Number(value) * 100)),
        ),
      });
    },
    uploadLogo: async (file: File) => {
      const imageUrl = await binding.uploadLogo(file);
      // The upload is async: the manager may have edited identity, fees or seed meanwhile.
      // Merge only the uploaded URL into the latest saved review, never its pre-upload snapshot.
      const latest = getDraft(draftId);
      if (!latest) {
        setStorageError(true);
        return imageUrl;
      }
      persistReview({ ...(latest.review ?? binding.review), imageUrl });
      return imageUrl;
    },
    launchBlockers,
    isReady: launchBlockers.length === 0,
    feeConfiguration: {
      payoutFeeBps: binding.review.payoutFeeBps,
      flowFeeBps: flowFeeBps ?? 25,
      payoutSource: "draft" as const,
      flowSource: flowFeeBps === null ? ("fallback" as const) : ("fund-detail" as const),
    },
    refreshBalance: wallet.refreshBalance,
  };
}
