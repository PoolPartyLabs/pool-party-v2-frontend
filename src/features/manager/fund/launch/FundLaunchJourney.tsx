/**
 * @id PP-MGR-CMP-081 (POO-2177)
 * @name FundLaunchJourney
 * @implements-rules-version v1 (POO-2212, POO-2203), preserves v3 (POO-2192)
 * @analytics-events none, useV2LaunchBinding owns launch lifecycle events
 */
"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { Link } from "@/i18n/navigation";
import { isMockMode } from "@/lib/services";
import { explorerAddressUrl } from "./journey";
import { useV2Launch } from "./useV2Launch";

export function FundLaunchJourney({ journeyId }: { journeyId: string }) {
  const t = useTranslations("manager");
  if (isMockMode) return <p role="alert">{t("fundLaunch.realOnly")}</p>;
  return <RealJourney journeyId={journeyId} />;
}
function RealJourney({ journeyId }: { journeyId: string }) {
  const launch = useV2Launch(journeyId);
  const [open, setOpen] = useState(true);
  const setModalOpen = (next: boolean) => {
    if (!next) launch.cancel();
    setOpen(next);
  };
  const confirmed = launch.steps.filter((step) => step.status === "confirmed").length;
  const t = useTranslations("manager");
  const currentStep = launch.steps.find((step) => step.status !== "confirmed");
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
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("fundLaunch.resumeJourney")}
      </Button>
      <Dialog open={open} onOpenChange={setModalOpen}>
        <DialogContent className="flex max-h-[90dvh] max-w-xl flex-col gap-4 overflow-hidden">
          <header>
            <DialogTitle>{t("fundLaunch.journeyTitle")}</DialogTitle>
            <p>{launch.journey?.draft.review.name}</p>
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
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <aside
              aria-label={t("fundLaunch.signNext")}
              className="shrink-0 rounded-xl border border-border bg-surface p-4"
            >
              <p className="mb-2 text-sm text-muted-foreground">
                {t("fundLaunch.stepProgress", {
                  n: currentStep ? launch.steps.indexOf(currentStep) + 1 : launch.steps.length,
                  total: launch.steps.length,
                })}
              </p>
              <div
                role="progressbar"
                aria-label={t("fundLaunch.journeyTitle")}
                aria-valuemin={0}
                aria-valuemax={Math.max(1, launch.steps.length)}
                aria-valuenow={confirmed}
                className="mb-4 h-1 rounded bg-surface-raised"
              >
                <div
                  className="h-full rounded bg-primary"
                  style={{
                    width: `${launch.steps.length ? (confirmed / launch.steps.length) * 100 : 0}%`,
                  }}
                />
              </div>
              {currentStep ? (
                <div className="mb-4" aria-live="polite">
                  <h2 className="font-medium">{labels[currentStep.kind]}</h2>
                  <p>
                    {currentStep.chainId === 42161 ? "Arbitrum" : "Robinhood Chain"} ·{" "}
                    {statuses[currentStep.status]}
                  </p>
                </div>
              ) : null}
              {launch.outcome === "completed" ? (
                <p role="status">{t("fundLaunch.journeyComplete")}</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Button
                    disabled={!launch.ready || launch.busy}
                    onClick={() => void launch.sign()}
                  >
                    {t("fundLaunch.signNext")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!launch.journal || launch.busy}
                    onClick={() => void launch.resume()}
                  >
                    {t("fundLaunch.resumeJourney")}
                  </Button>
                  {launch.error ? (
                    <Button
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
            </aside>
            <div className="min-h-0 overflow-y-auto">
              <ol aria-live="polite" className="flex flex-col gap-4">
                {launch.steps.map((step) => (
                  <li key={step.id} className="rounded-xl border border-border bg-surface p-4">
                    <h2 className="font-medium">
                      {labels[step.kind]} ·{" "}
                      {step.chainId === 42161 ? "Arbitrum" : "Robinhood Chain"}
                    </h2>
                    <p>{statuses[step.status]}</p>
                    {step.status === "waiting" && step.waitReason === "discovery" ? (
                      <p role="status">{t("fundLaunch.discoveryWait")}</p>
                    ) : null}
                    {step.kind === "report" && step.status === "waiting" ? (
                      <p role="status">{t("fundLaunch.reportWait")}</p>
                    ) : null}
                    {step.explorerUrl && step.txHash ? (
                      <a
                        className="break-all underline"
                        href={step.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {step.txHash}
                      </a>
                    ) : null}
                    {step.receiptStatus ? (
                      <p>
                        {t("fundLaunch.receiptLabel")}: {receipts[step.receiptStatus]}
                      </p>
                    ) : null}
                    {step.error ? (
                      <p role="alert">
                        {t("fundLaunch.partialFailure")} · {step.error}
                      </p>
                    ) : null}
                    {!step.txHash && step.status === "confirmed" ? (
                      <p>
                        {labels[step.kind]}: {t("fundLaunch.offchainComplete")}
                      </p>
                    ) : null}
                    {step.kind === "discover" && step.result?.discovered ? (
                      <DiscoveredContracts result={step.result.discovered} />
                    ) : null}
                  </li>
                ))}
              </ol>
              {core ? (
                <div className="rounded-xl border border-border p-4">
                  <p>{t("fundLaunch.fundExists")}</p>
                  {addressUrl ? (
                    <a
                      href={addressUrl}
                      className="break-all underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {core}
                    </a>
                  ) : null}
                  <Link href={`/funds/${core}`} className="ml-3 underline">
                    {t("fundLaunch.viewFund")}
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Link href="/manager" className="underline">
        {t("fundLaunch.returnManager")}
      </Link>
    </section>
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
