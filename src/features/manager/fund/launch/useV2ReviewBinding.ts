/**
 * @id PP-MGR-HOK-018 (POO-2177)
 * @name useV2ReviewBinding
 * @implements-rules-version v1
 */
"use client";
import { useCallback, useState } from "react";
import { formatUnits } from "viem";
import { type MediaUploadFn, useUploadMedia } from "@/lib/media/useUploadMedia";
import type { MandateCatalog } from "../mandateCatalog";
import type { MandateDraft } from "../mandateDraft";
import { toV2MandateSelection } from "../v2Mandate";
import type { FrozenLaunch } from "./driver";
import type { CanvasPlan } from "./plan";
import {
  type FundReview,
  previewSeed,
  rawUsdc,
  reviewSchema,
  validateLogo,
  validateReview,
} from "./review";

export interface V2ReviewDraftOptions {
  draft: MandateDraft & { plan?: CanvasPlan };
  catalog: MandateCatalog;
  balance: bigint | null;
  initial?: FundReview;
  upload?: MediaUploadFn;
  flowFeeBps?: number;
}
export interface ReviewFieldError {
  field: keyof FundReview | "balance";
  messageKey: "fundLaunch.validation";
}
export function useV2ReviewBinding({
  draft,
  catalog,
  balance,
  initial,
  upload,
  flowFeeBps = 25,
}: V2ReviewDraftOptions) {
  const stagedUpload = useUploadMedia("logo");
  const [review, setReview] = useState<FundReview>(
    () =>
      initial ?? {
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
  const [uploading, setUploading] = useState(false);
  const replaceReview = useCallback((value: FundReview) => setReview(value), []);
  const [uploadError, setUploadError] = useState<"fundLaunch.uploadFailed" | null>(null);
  const errors: ReviewFieldError[] = [];
  let preview: ReturnType<typeof previewSeed> | null = null;
  try {
    preview = previewSeed(rawUsdc(review.seed), flowFeeBps);
  } catch {}
  try {
    if (balance === null) errors.push({ field: "balance", messageKey: "fundLaunch.validation" });
    else validateReview(review, balance);
  } catch (failure) {
    const issues =
      failure !== null && typeof failure === "object" && "issues" in failure
        ? (failure as { issues: { path: string[] }[] }).issues
        : [];
    for (const issue of issues)
      errors.push({
        field: (issue.path[0] ?? "seed") as keyof FundReview,
        messageKey: "fundLaunch.validation",
      });
    if (!issues.length) errors.push({ field: "seed", messageKey: "fundLaunch.validation" });
  }
  const setField = <Field extends keyof FundReview>(field: Field, value: FundReview[Field]) =>
    setReview((current) => ({ ...current, [field]: value }));
  const prepare = (manager: string): FrozenLaunch => {
    if (balance === null || uploading) throw new Error("INVALID_DEPOSIT");
    const validated = validateReview(review, balance);
    return {
      plan: draft.plan,
      review: validated,
      request: {
        ...toV2MandateSelection(draft, catalog),
        manager,
        performanceFeeBps: validated.performanceFeeBps,
        managementFeeBps: validated.managementFeeBps,
        payoutFeeBps: validated.payoutFeeBps,
        minFirstDeposit: rawUsdc(validated.minimum).toString(),
        seedAmount: rawUsdc(validated.seed).toString(),
      },
    };
  };
  return {
    review,
    replaceReview,
    setField,
    errors,
    valid: errors.length === 0 && !uploading,
    preview,
    balance,
    balanceDecimal: balance === null ? null : formatUnits(balance, 6),
    setMax: () => {
      if (balance !== null) setField("seed", formatUnits(balance, 6));
    },
    setFeePercent: (
      field: "performanceFeeBps" | "managementFeeBps" | "payoutFeeBps",
      value: string,
    ) => {
      if (!/^\d+(\.\d{0,2})?$/.test(value)) throw new Error("INVALID_FEE");
      setField(field, Math.round(Number(value) * 100));
    },
    terms: {
      operatingCash: "0",
      payoutHours: 72,
      access: "public",
      protocolFeeBps: 25,
      feesCanOnlyDecrease: true,
      managementFeePaidAtClosure: true,
      launchTermsImmutable: true,
    } as const,
    prepare,
    uploading,
    uploadError,
    uploadLogo: async (file: File) => {
      setUploadError(null);
      setUploading(true);
      try {
        validateLogo(file);
        const imageUrl = await (upload ?? stagedUpload)(file);
        reviewSchema.shape.imageUrl.parse(imageUrl);
        setField("imageUrl", imageUrl);
        return imageUrl;
      } catch {
        setUploadError("fundLaunch.uploadFailed");
        throw new Error("INVALID_LOGO");
      } finally {
        setUploading(false);
      }
    },
  };
}
export type V2ReviewBinding = ReturnType<typeof useV2ReviewBinding>;
