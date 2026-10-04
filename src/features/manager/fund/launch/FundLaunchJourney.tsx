/**
 * @id PP-MGR-CMP-081 (POO-2177)
 * @name FundLaunchJourney
 * @implements-rules-version v1
 */
"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
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
  const t = useTranslations("manager");
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
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <header>
        <h1 className="font-semibold text-2xl">{t("fundLaunch.journeyTitle")}</h1>
        <p>{launch.journey?.draft.review.name}</p>
        <p>{t("fundLaunch.journeyWait")}</p>
      </header>
      {launch.loadingError || (!launch.ready && !launch.busy) ? (
        <p role="alert">{t("fundLaunch.walletOrJournal")}</p>
      ) : null}
      {launch.error ? (
        <p role="alert">
          {t(launch.error.messageKey)} · {launch.error.code}
        </p>
      ) : null}
      <ol aria-live="polite" className="flex flex-col gap-4">
        {launch.steps.map((step) => (
          <li key={step.id} className="rounded-xl border border-border bg-surface p-4">
            <h2 className="font-medium">
              {labels[step.kind]} · {step.chainId === 42161 ? "Arbitrum" : "Robinhood Chain"}
            </h2>
            <p>{statuses[step.status]}</p>
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
      {launch.outcome === "completed" ? (
        <p role="status">{t("fundLaunch.journeyComplete")}</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button disabled={!launch.ready || launch.busy} onClick={() => void launch.sign()}>
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
          <Button variant="ghost" onClick={launch.cancel}>
            {t("fundLaunch.pauseJourney")}
          </Button>
        </div>
      )}
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
