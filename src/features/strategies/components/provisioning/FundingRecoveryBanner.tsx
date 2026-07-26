/**
 * @id PP-STR-CMP-025 (POO-1055)
 * @name FundingRecoveryBanner
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The surface the funding recovery journal was always for
 * (`docs/_hackathon/02_BRIDGE_ARCHITECTURE.md` §5, "Interrupted"). A bridge takes minutes and users
 * close tabs; on the next load this is what tells them their money is fine and what happens next.
 *
 * Mounted app-wide (the {@link AppShell} content area), so it is reached however the user comes
 * back: a fresh session, a different screen, a reload halfway through. Renders NOTHING for the
 * overwhelming majority of loads, where {@link useFundingRecovery} finds no route in flight.
 *
 * ## What it is allowed to do
 *
 * Read, explain, and hand the user back to the operation. It has no broadcast path and cannot have
 * one: everything it knows comes from a record that deliberately stores no calldata, no signatures
 * and no quotes (§3.3), and the only forward affordance is a link back to the operation, whose plan
 * is then derived afresh from current balances. Re-derivation cannot repeat a settled leg because a
 * settled leg has already changed the balances the derivation reads (§3.1).
 *
 * Two consequences worth naming, because both are deliberate:
 *
 * - **While money is in flight there is no dismiss.** Deleting the record of a broadcast transaction
 *   is exactly how the next session fails to recognise it and sends a second one. The user gets
 *   "check again", not "make this go away".
 * - **An ambiguous leg is shown the account, not a retry.** With no hash there is nothing to link to
 *   and nothing safe to re-send (§3.9), so the honest affordance is the user's own wallet activity
 *   on the chain the leg was sent from.
 *
 * ## Copy
 *
 * Investor-facing and abstracted: no leg, nonce, receipt or bridge vocabulary reaches the screen.
 * The tone is the one §3.9 asks for, which is that the money is fine and in transit, not that
 * something broke. Every string is a literal `t()` key so the static i18n usage scan can see it.
 *
 * Amounts are deliberately absent. The journal stores base-unit amounts against token ADDRESSES and
 * carries no decimals (§3.3), so any figure rendered here would either be a raw base-unit integer or
 * a guess. The explorer links carry the exact amounts, from the chain.
 */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { Link } from "@/i18n/navigation";
import { apiNetworkForChain, chainDisplayName, getExplorerAddressUrl } from "@/lib/chains/config";
import { useFundingRecovery } from "../../hooks/useFundingRecovery";
import type {
  FundingJournal,
  FundingLegKind,
  FundingOperationKind,
} from "../../lib/fundingJournal";
import type { JournalAction, LegVerdict } from "../../lib/reconcileFundingJournal";

/**
 * Where the user goes to have the route re-derived: the operation's own screen.
 *
 * `move-range` and `close` only exist in the Manager Console, so they resume there. Everything else
 * resumes on the investor detail, including `collect`, which exists on both paths and is not
 * distinguishable from the record (the journal stores the operation kind, not the surface it was
 * started from). The investor route is the right default for an ambiguous one: it is the far more
 * common origin, and a manager who lands there can still reach their own view.
 */
function resumeHref(operation: FundingJournal["operation"]): string {
  const { kind, strategyId } = operation;
  if (!strategyId) return "/portfolio";
  const managerOnly = kind === "move-range" || kind === "close";
  return managerOnly ? `/manager/strategies/${strategyId}` : `/strategies/${strategyId}`;
}

/** The interrupted-funding notice. Renders nothing unless a route is actually in flight. */
export function FundingRecoveryBanner() {
  const t = useTranslations("strategies");
  const { journal, reconciliation, isChecking, recheck, abandon } = useFundingRecovery();

  if (!journal || journal.legs.length === 0) return null;

  // Literal keys per value: the i18n usage scan is static, so no key is ever assembled at runtime.
  const operationLabel: Record<FundingOperationKind, string> = {
    invest: t("provisioning.recovery.op.invest"),
    withdraw: t("provisioning.recovery.op.withdraw"),
    collect: t("provisioning.recovery.op.collect"),
    compound: t("provisioning.recovery.op.compound"),
    "move-range": t("provisioning.recovery.op.moveRange"),
    close: t("provisioning.recovery.op.close"),
  };
  const statusLabel: Record<JournalAction, string> = {
    complete: t("provisioning.recovery.status.complete"),
    wait: t("provisioning.recovery.status.wait"),
    rederive: t("provisioning.recovery.status.rederive"),
    ask: t("provisioning.recovery.status.ask"),
  };
  const verdictLabel: Record<LegVerdict, string> = {
    settled: t("provisioning.recovery.leg.settled"),
    pending: t("provisioning.recovery.leg.pending"),
    reverted: t("provisioning.recovery.leg.reverted"),
    absent: t("provisioning.recovery.leg.absent"),
    unknown: t("provisioning.recovery.leg.unknown"),
  };

  // How far the route got: the first leg the chain has not confirmed. Before the verdicts land the
  // record's own statuses answer the same question, less authoritatively but well enough to render.
  const verdicts = reconciliation?.legs;
  const unfinished = verdicts
    ? verdicts.findIndex((leg) => leg.verdict !== "settled")
    : journal.legs.findIndex((leg) => leg.status !== "settled");
  // A fully-settled record is retired by the hook, so this only guards the frame it takes to happen.
  const index = unfinished === -1 ? journal.legs.length - 1 : unfinished;
  const leg = journal.legs[index];
  const verdict = verdicts?.[index]?.verdict;
  const action = reconciliation?.action;

  const network = leg ? (chainDisplayName(leg.chainId) ?? "") : "";
  const legLabel: Record<FundingLegKind, string> = {
    "swap-token": t("provisioning.costs.leg.swapToken", { network }),
    "swap-gas": t("provisioning.costs.leg.swapGas", { network }),
    bridge: t("provisioning.costs.leg.bridge", { network }),
    // [R7] Named distinctly on purpose. If a gas bridge is the leg that stalled, the funds are on
    // the TARGET chain and perfectly safe, they are simply early. "Bridge" alone would read as the
    // funding leg and send the user looking for their money in the wrong place.
    "bridge-gas": t("provisioning.costs.leg.bridgeGas", { network }),
    approve: t("provisioning.captions.approve"),
  };

  const apiNetwork = leg ? apiNetworkForChain(leg.chainId) : undefined;
  // §3.9: with no hash there is no transaction to point at, and the account's own activity is the
  // only place the answer exists.
  const accountUrl =
    verdict === "unknown" ? getExplorerAddressUrl(apiNetwork, journal.wallet) : undefined;
  // A broadcast leg's record must survive until the chain reflects it, so the dismissal is offered
  // only once nothing is in flight.
  const canAbandon = action === "rederive" || action === "ask";

  return (
    <section
      role="status"
      aria-label={t("provisioning.recovery.title")}
      className="mb-4 flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4"
    >
      <div className="text-sm">
        <p className="font-semibold text-foreground">{t("provisioning.recovery.title")}</p>
        <p className="mt-0.5 text-muted-foreground">{operationLabel[journal.operation.kind]}</p>
        <p className="mt-0.5 text-muted-foreground">
          {t("provisioning.recovery.progress", { index: index + 1, total: journal.legs.length })}
          {leg ? ` · ${legLabel[leg.kind]}` : null}
        </p>
      </div>

      {action ? (
        <div className="text-sm">
          <p className="text-foreground">{statusLabel[action]}</p>
          {verdict ? <p className="mt-0.5 text-muted-foreground">{verdictLabel[verdict]}</p> : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{t("provisioning.recovery.checking")}</p>
      )}

      <ExplorerTxLink network={apiNetwork} hash={leg?.txHash} />
      {accountUrl ? (
        <a
          href={accountUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised"
        >
          {t("provisioning.recovery.viewAccount")}
        </a>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        {action === "rederive" || action === "ask" ? (
          <Link
            href={resumeHref(journal.operation)}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-primary font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
          >
            {t("provisioning.recovery.resume")}
          </Link>
        ) : (
          <Button
            variant="secondary"
            className="flex-1"
            loading={isChecking}
            onClick={() => {
              recheck();
            }}
          >
            {t("provisioning.recovery.recheck")}
          </Button>
        )}
        {canAbandon ? (
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => {
              abandon();
            }}
          >
            {t("provisioning.recovery.abandon")}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
