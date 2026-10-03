/**
 * @id PP-MGR-CMP-063 (POO-2172)
 * @name FundReviewForm
 * @implements-rules-version v1
 * Fund identity, immutable investor terms, net seed preview and dynamic launch progress.
 */
"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { formatUnits } from "viem";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import type { LaunchJournal } from "./journal";
import type { LaunchStep } from "./plan";
import { type FundReview, previewSeed, rawUsdc, validateLogo, validateReview } from "./review";

export interface FundReviewFormProps {
  initial: FundReview;
  balance: bigint | null;
  steps: LaunchStep[];
  journal: LaunchJournal | null;
  busy: boolean;
  gap: boolean;
  onLaunch: (review: FundReview) => Promise<void>;
  onUpload: (file: File) => Promise<string>;
  onBack: () => void;
  onPause?: () => void;
  className?: string;
}

export function FundReviewForm({
  initial,
  balance,
  steps,
  journal,
  busy,
  gap,
  onLaunch,
  onUpload,
  onBack,
  onPause,
  className,
}: FundReviewFormProps) {
  const t = useTranslations("manager");
  const [review, setReview] = useState(initial);
  const [error, setError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const locked = busy || uploading || journal !== null;
  const update = <Key extends keyof FundReview>(key: Key, value: FundReview[Key]) =>
    setReview((current) => ({ ...current, [key]: value }));
  let preview: ReturnType<typeof previewSeed> | null = null;
  try {
    preview = previewSeed(rawUsdc(review.seed));
  } catch {}
  const labels: Record<LaunchStep["kind"], string> = {
    approve: t("fundLaunch.approve"),
    create: t("fundLaunch.create"),
    discover: t("fundLaunch.discover"),
    spoke: t("fundLaunch.spoke"),
    profile: t("fundLaunch.profile"),
    allocate: t("fundLaunch.allocate"),
    report: t("fundLaunch.report"),
    bridge: t("fundLaunch.bridge"),
    arrival: t("fundLaunch.arrival"),
    swap: t("fundLaunch.swap"),
    open: t("fundLaunch.open"),
  };
  const statuses = {
    idle: t("fundLaunch.idle"),
    building: t("fundLaunch.building"),
    signing: t("fundLaunch.signing"),
    submitted: t("fundLaunch.submitted"),
    waiting: t("fundLaunch.waiting"),
    confirmed: t("fundLaunch.confirmed"),
    failed: t("fundLaunch.failed"),
  };
  const completed =
    journal !== null &&
    journal.steps.every((step) => journal.checkpoints[step.id]?.status === "confirmed");
  const transactions = steps.filter(
    (step) => !["discover", "profile", "report", "arrival"].includes(step.kind),
  );
  return (
    <div className={cn("grid gap-6 lg:grid-cols-[1fr_360px]", className)}>
      <form
        className="flex flex-col gap-6"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(false);
          try {
            if (balance === null && !journal) throw new Error("balance");
            const validated = journal ? initial : validateReview(review, balance ?? BigInt(0));
            await onLaunch(validated);
          } catch {
            setError(true);
          }
        }}
      >
        <h2 className="font-semibold text-xl">{t("review.title")}</h2>
        <fieldset
          disabled={locked}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
        >
          <legend>{t("fundLaunch.identity")}</legend>
          <label className="flex flex-col gap-2">
            {t("review.nameLabel")}
            <input
              className="rounded-lg border border-border bg-background p-3"
              value={review.name}
              onChange={(event) => update("name", event.target.value)}
              aria-invalid={error}
            />
          </label>
          <label className="flex flex-col gap-2">
            {t("fundLaunch.description")}
            <textarea
              className="rounded-lg border border-border bg-background p-3"
              maxLength={280}
              value={review.description}
              onChange={(event) => update("description", event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2">
            {t("fundLaunch.logo")}
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setUploadError(false);
                setUploading(true);
                try {
                  validateLogo(file);
                  update("imageUrl", await onUpload(file));
                } catch {
                  setUploadError(true);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          {review.imageUrl ? <span className="break-all text-sm">{review.imageUrl}</span> : null}
          {uploadError ? <p role="alert">{t("fundLaunch.uploadFailed")}</p> : null}
        </fieldset>
        <fieldset
          disabled={locked}
          className="grid gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-2"
        >
          <legend>{t("review.fees.title")}</legend>
          <label className="flex flex-col gap-2">
            {t("review.fees.performance")}
            <input
              className="rounded-lg border border-border bg-background p-3"
              type="number"
              min="10"
              max="90"
              step="0.01"
              value={review.performanceFeeBps / 100}
              onChange={(event) => update("performanceFeeBps", Number(event.target.value) * 100)}
            />
          </label>
          <label className="flex flex-col gap-2">
            {t("review.fees.management")}
            <input
              className="rounded-lg border border-border bg-background p-3"
              type="number"
              min="0"
              max="5"
              step="0.01"
              value={review.managementFeeBps / 100}
              onChange={(event) => update("managementFeeBps", Number(event.target.value) * 100)}
            />
          </label>
          <p className="text-sm sm:col-span-2">{t("fundLaunch.feesNote")}</p>
        </fieldset>
        <fieldset
          disabled={locked}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
        >
          <legend>{t("fundLaunch.terms")}</legend>
          <label className="flex flex-col gap-2">
            {t("fundLaunch.minimum")}
            <input
              className="rounded-lg border border-border bg-background p-3"
              inputMode="decimal"
              value={review.minimum}
              onChange={(event) => update("minimum", event.target.value.replace(",", "."))}
            />
          </label>
          <label className="flex flex-col gap-2">
            {t("fundLaunch.payoutFee")}
            <input
              className="rounded-lg border border-border bg-background p-3"
              type="number"
              min="0"
              max="10"
              step="0.01"
              value={review.payoutFeeBps / 100}
              onChange={(event) => update("payoutFeeBps", Number(event.target.value) * 100)}
            />
          </label>
          <p>{t("fundLaunch.fixedTerms")}</p>
          <p>
            {t("review.access.public")} · {t("review.access.publicNote")}
          </p>
          <p className="text-sm">{t("fundLaunch.protocolFee")}</p>
        </fieldset>
        <fieldset
          disabled={locked}
          className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
        >
          <legend>{t("fundLaunch.seed")}</legend>
          <div aria-live="polite">
            {balance === null
              ? t("review.seed.loading")
              : t("review.seed.balance", { amount: `${formatUnits(balance, 6)} USDC` })}
          </div>
          <label className="flex flex-col gap-2">
            {t("fundLaunch.seed")}
            <input
              className="rounded-lg border border-border bg-background p-3"
              inputMode="decimal"
              value={review.seed}
              onChange={(event) => update("seed", event.target.value.replace(",", "."))}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={balance === null}
            onClick={() => balance !== null && update("seed", formatUnits(balance, 6))}
          >
            {t("review.seed.max")}
          </Button>
          <p className="text-sm">{t("fundLaunch.seedNote")}</p>
          {preview ? (
            <p aria-live="polite">
              {t("fundLaunch.seedMath", {
                fee: formatUnits(preview.fee, 6),
                principal: formatUnits(preview.principal, 6),
                shares: preview.shares.toString(),
                remainder: formatUnits(preview.remainder, 6),
              })}
            </p>
          ) : null}
          <p>{t("fundLaunch.operatingCash")}</p>
        </fieldset>
        {gap ? <p role="alert">{t("fundLaunch.buildGap")}</p> : null}
        {error ? <p role="alert">{t("fundLaunch.validation")}</p> : null}
        <div className="flex justify-between gap-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={busy || journal !== null}
          >
            {t("builder.steps.build")}
          </Button>
          <Button type="submit" disabled={busy || uploading || gap || completed}>
            {completed
              ? t("fundLaunch.complete")
              : journal
                ? t("fundLaunch.resume")
                : t("review.launch")}
          </Button>
        </div>
      </form>
      <aside className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5 lg:self-start">
        <h3 className="font-semibold">{t("review.preview.title")}</h3>
        <p>{review.name}</p>
        <p>{review.description}</p>
        <p>{t("fundLaunch.fixedLaunch")}</p>
        <h3 className="font-semibold">
          {t("fundLaunch.signatureCount", { count: transactions.length })}
        </h3>
        <p className="text-sm">{t("fundLaunch.signatureNote")}</p>
        <ol aria-live="polite" className="flex flex-col gap-3">
          {steps.map((step) => {
            const checkpoint = journal?.checkpoints[step.id];
            return (
              <li key={step.id} className="text-sm">
                <p>
                  {labels[step.kind]} · {step.chain === 42161 ? "Arbitrum" : "Robinhood Chain"}
                </p>
                <p>{statuses[checkpoint?.status ?? "idle"]}</p>
                {checkpoint?.txHash ? <p className="break-all">{checkpoint.txHash}</p> : null}
                {checkpoint?.status === "failed" ? <p>{t("fundLaunch.partialFailure")}</p> : null}
              </li>
            );
          })}
        </ol>
        <p>{t("fundLaunch.waitNote")}</p>
        {busy && onPause ? (
          <Button type="button" variant="secondary" onClick={onPause}>
            {t("fundBuilder.header.saveExit")}
          </Button>
        ) : null}
        {journal?.addresses.coreVault ? (
          <p className="break-all">{journal.addresses.coreVault}</p>
        ) : null}
      </aside>
    </div>
  );
}
