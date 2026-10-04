/**
 * @id PP-MGR-CMP-081 (POO-2177)
 * @name FundLaunchJourney
 * @implements-rules-version v1 (POO-2233, POO-2212, POO-2203), preserves v3 (POO-2192)
 * @analytics-events none, useV2LaunchBinding owns launch lifecycle events
 */
"use client";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/Dialog";
import { Link } from "@/i18n/navigation";
import { isMockMode } from "@/lib/services";
import { explorerAddressUrl } from "./journey";
import { useLaunchReportCountdown } from "./useLaunchReportWait";
import { useV2Launch } from "./useV2Launch";

export function FundLaunchJourney({ journeyId }: { journeyId: string }) {
  const t = useTranslations("manager");
  if (isMockMode) return <p role="alert">{t("fundLaunch.realOnly")}</p>;
  return <RealJourney journeyId={journeyId} />;
}
function RealJourney({ journeyId }: { journeyId: string }) {
  const launch = useV2Launch(journeyId);
  return <FundLaunchJourneyView launch={launch} />;
}

export type FundLaunchJourneyState = Pick<
  ReturnType<typeof useV2Launch>,
  | "steps"
  | "addresses"
  | "loadingError"
  | "ready"
  | "busy"
  | "error"
  | "outcome"
  | "sign"
  | "resume"
  | "retry"
  | "cancel"
> & {
  journey: { draft: { review: { name: string; imageUrl?: string } } } | null;
  journal: object | null;
};

/** Presentation seam for the real launch binding and wallet-free Storybook states. */
export function FundLaunchJourneyView({ launch }: { launch: FundLaunchJourneyState }) {
  const [open, setOpen] = useState(true);
  const setModalOpen = (next: boolean) => {
    if (!next) launch.cancel();
    setOpen(next);
  };
  const confirmed = launch.steps.filter((step) => step.status === "confirmed").length;
  const t = useTranslations("manager");
  // The report can wait while an independent hub operation asks for a signature.
  // Match the provisioning window: foreground actual work instead of an earlier waiting row.
  const currentStep =
    launch.steps.find((step) => step.status === "signing") ??
    launch.steps.find((step) => step.status === "submitted") ??
    launch.steps.find((step) => step.status === "building") ??
    launch.steps.find((step) => step.status === "failed") ??
    launch.steps.find((step) => step.status === "waiting") ??
    launch.steps.find((step) => step.status === "idle") ??
    launch.steps.at(-1);
  const fraction = launch.steps.length
    ? Math.min(
        1,
        (confirmed + (launch.busy && currentStep?.status !== "confirmed" ? 0.5 : 0)) /
          launch.steps.length,
      )
    : 0;
  const fundName = launch.journey?.draft.review.name;
  const core = launch.addresses.coreVault;
  const addressUrl = core ? explorerAddressUrl(42161, core) : null;
  const labels = {
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
  const receipts = {
    success: t("fundLaunch.receipt_success"),
    reverted: t("fundLaunch.receipt_reverted"),
    unknown: t("fundLaunch.receipt_unknown"),
  };
  return (
    <section className="mx-auto flex w-full flex-col gap-4 p-6">
      <Dialog open={open} onOpenChange={setModalOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary">{t("fundLaunch.resumeJourney")}</Button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[90dvh] max-w-md flex-col gap-4 overflow-hidden rounded-2xl">
          <header className="shrink-0 space-y-4 pr-8">
            {fundName ? (
              <div className="flex items-center gap-3">
                <StrategyLogo
                  url={launch.journey?.draft.review.imageUrl}
                  name={fundName}
                  className="size-10 shrink-0 bg-primary/15 text-primary"
                />
                <p className="min-w-0 break-words font-semibold">{fundName}</p>
              </div>
            ) : null}
            <DialogTitle>{t("fundLaunch.journeyTitle")}</DialogTitle>
            <DialogDescription>{t("fundLaunch.journeyWait")}</DialogDescription>
          </header>
          {launch.loadingError || (!launch.ready && !launch.busy) ? (
            <p role="alert">{t("fundLaunch.walletOrJournal")}</p>
          ) : null}
          {launch.error ? (
            <p role="alert">
              {t(launch.error.messageKey)} · {launch.error.code}
            </p>
          ) : null}
          <div
            data-launch-details=""
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
          >
            {currentStep ? (
              <>
                <div
                  data-launch-current-step={currentStep.id}
                  aria-current="step"
                  className="relative shrink-0 overflow-hidden rounded-2xl border border-border bg-white/[0.04] px-4 pt-4 pb-3"
                >
                  <div
                    role="progressbar"
                    aria-label={t("fundLaunch.journeyTitle")}
                    aria-valuemin={0}
                    aria-valuemax={launch.steps.length}
                    aria-valuenow={confirmed}
                    className="absolute inset-x-0 top-0 h-[3px]"
                  >
                    <div
                      className="h-full bg-primary motion-safe:transition-[width]"
                      style={{ width: `${fraction * 100}%` }}
                    />
                  </div>
                  <div className="flex items-start gap-3" aria-live="polite">
                    {currentStep.status === "confirmed" ? (
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                        <Check aria-hidden="true" className="size-3.5" />
                      </span>
                    ) : launch.busy ? (
                      <span
                        aria-hidden="true"
                        className="size-6 shrink-0 motion-safe:animate-spin rounded-full border-2 border-primary/25 border-t-primary"
                        style={{ animationDuration: "1200ms" }}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="size-6 shrink-0 rounded-full border border-border"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <h2 className="break-words font-medium text-sm">
                        {labels[currentStep.kind]}
                      </h2>
                      <p className="mt-1 text-muted-foreground text-xs">
                        {currentStep.chainId === 42161 ? "Arbitrum" : "Robinhood Chain"} ·{" "}
                        {
                          statuses[
                            currentStep.kind === "report" && currentStep.status === "building"
                              ? "waiting"
                              : currentStep.status
                          ]
                        }
                      </p>
                    </div>
                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                      {t("fundLaunch.stepProgress", {
                        n: launch.steps.indexOf(currentStep) + 1,
                        total: launch.steps.length,
                      })}
                    </span>
                  </div>
                </div>
                <div className="space-y-3 text-sm">
                  {currentStep.status === "waiting" && currentStep.waitReason === "discovery" ? (
                    <p role="status">{t("fundLaunch.discoveryWait")}</p>
                  ) : null}
                  {currentStep.kind === "report" &&
                  currentStep.status !== "confirmed" &&
                  (currentStep.status === "waiting" ||
                    currentStep.status === "building" ||
                    currentStep.reportWaitStartedAt !== undefined) ? (
                    <>
                      <p className="text-muted-foreground">{t("fundLaunch.reportWait")}</p>
                      <ReportCountdown startedAt={currentStep.reportWaitStartedAt} />
                    </>
                  ) : null}
                  {currentStep.explorerUrl && currentStep.txHash ? (
                    <a
                      className="block break-all underline"
                      href={currentStep.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {currentStep.txHash}
                    </a>
                  ) : null}
                  {currentStep.receiptStatus ? (
                    <p>
                      {t("fundLaunch.receiptLabel")}: {receipts[currentStep.receiptStatus]}
                    </p>
                  ) : null}
                  {currentStep.error ? (
                    <p role="alert">
                      {t("fundLaunch.partialFailure")} · {currentStep.error}
                    </p>
                  ) : null}
                  {!currentStep.txHash && currentStep.status === "confirmed" ? (
                    <p>
                      {labels[currentStep.kind]}: {t("fundLaunch.offchainComplete")}
                    </p>
                  ) : null}
                  {currentStep.kind === "discover" && currentStep.result?.discovered ? (
                    <DiscoveredContracts result={currentStep.result.discovered} />
                  ) : null}
                </div>
              </>
            ) : null}
            {core ? (
              <div className="space-y-2 rounded-xl border border-border p-4 text-sm">
                <p>{t("fundLaunch.fundExists")}</p>
                {addressUrl ? (
                  <a
                    href={addressUrl}
                    className="block break-all underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {core}
                  </a>
                ) : null}
                <Link href={`/funds/${core}?view=manager`} className="inline-block underline">
                  {t("fundLaunch.viewFund")}
                </Link>
              </div>
            ) : null}
          </div>
          <footer data-launch-footer="" className="shrink-0">
            {launch.outcome === "completed" ? (
              <p role="status">{t("fundLaunch.journeyComplete")}</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                <Button
                  className="w-full"
                  disabled={!launch.ready || launch.busy}
                  onClick={() => void launch.sign()}
                >
                  {t("fundLaunch.signNext")}
                </Button>
                <Button
                  className="flex-1"
                  variant="secondary"
                  disabled={!launch.journal || launch.busy}
                  onClick={() => void launch.resume()}
                >
                  {t("fundLaunch.resumeJourney")}
                </Button>
                {launch.error ? (
                  <Button
                    className="flex-1"
                    variant="secondary"
                    disabled={!launch.journal || launch.busy}
                    onClick={() => void launch.retry()}
                  >
                    {t("fundLaunch.retryJourney")}
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => setModalOpen(false)}>
                  {t("fundLaunch.pauseJourney")}
                </Button>
              </div>
            )}
          </footer>
        </DialogContent>
      </Dialog>
      <Link href="/manager" className="underline">
        {t("fundLaunch.returnManager")}
      </Link>
    </section>
  );
}

/** Isolating the clock keeps per-second renders outside the launch executor and its live region. */
function ReportCountdown({ startedAt }: { startedAt: number | undefined }) {
  const remaining = useLaunchReportCountdown(startedAt);
  const t = useTranslations("manager");
  if (remaining === null) return null;
  const time = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  return (
    <div className="space-y-2">
      <p role="timer" aria-live="off" className="font-medium tabular-nums">
        {t("fundLaunch.reportCountdown", { time })}
      </p>
      {remaining === 0 ? (
        <p role="status" className="text-muted-foreground">
          {t("fundLaunch.reportDelayed")}
        </p>
      ) : null}
    </div>
  );
}

function DiscoveredContracts({ result }: { result: unknown }) {
  if (!result || typeof result !== "object") return null;
  const chains = (result as { chains?: unknown }).chains;
  if (!Array.isArray(chains)) return null;
  return (
    <ul>
      {chains.flatMap((chain: Record<string, unknown>) =>
        Object.entries(chain).flatMap(([field, value]) => {
          if (typeof value !== "string") return [];
          const url = explorerAddressUrl(Number(chain.chainId), value);
          return url ? (
            <li key={`${chain.chainId}-${field}-${value}`}>
              <a
                href={url}
                className="break-all underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {field}: {value}
              </a>
            </li>
          ) : (
            []
          );
        }),
      )}
    </ul>
  );
}
