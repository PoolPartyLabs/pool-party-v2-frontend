/**
 * @id PP-STR-CMP-041 (POO-2262)
 * @name FundNetworks
 * @implements-rules-version v1 (POO-2262, pool-party-api `docs/SOLANA_API_CONTRACT.md` §3.8, §3.9)
 * @i18n-namespace strategies.funds
 * A v6 Fund's networks (Hub Arbitrum, Robinhood, Solana): each spoke's report age and Usable or
 * Refreshing, and the Solana accounts with Solscan links. Read-only rows and badges placed inside
 * the existing investor and manager frames; no layout of its own beyond a list.
 */
import { useTranslations } from "next-intl";
import { Fragment } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import type { FundView } from "@/lib/api/v2/fundSchemas";
import { solscanAccountUrl } from "@/lib/solana/explorer";
import { cn } from "@/lib/utils/cn";
import { type FundNetworkRow, fundNetworkRows } from "./fundModel";

const ACCOUNTS = ["program", "fund", "vault", "usdcAta"] as const;
const short = (account: string) => `${account.slice(0, 4)}…${account.slice(-4)}`;

/** A spoke's Hub-accepted report: its age in minutes, and whether a deposit can use it now. */
export function FundReportBadge({ report }: { report: FundNetworkRow["report"] }) {
  const t = useTranslations("strategies.funds");
  if (!report) return null;
  return (
    <span
      data-fund-report={report.usable ? "usable" : "refreshing"}
      className="inline-flex items-center gap-1.5 rounded border border-border px-1.5 py-0.5 text-xs"
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", report.usable ? "bg-success" : "bg-warning")}
      />
      {report.ageMinutes === null
        ? t("networks.noReport")
        : t("networks.reportAge", { minutes: report.ageMinutes })}
      {" · "}
      {report.usable ? t("networks.usable") : t("networks.refreshing")}
    </span>
  );
}

export function FundNetworks({ fund }: { fund: Pick<FundView, "chains" | "mandate" | "spokes"> }) {
  const t = useTranslations("strategies.funds");
  const labels: Record<(typeof ACCOUNTS)[number], string> = {
    program: t("networks.program"),
    fund: t("networks.fundAccount"),
    vault: t("networks.vault"),
    usdcAta: t("networks.usdcAccount"),
  };
  return (
    <ul data-fund-networks="" className="flex min-w-0 flex-col gap-3">
      {fundNetworkRows(fund).map((row) => (
        <li
          key={row.chainId}
          data-fund-network={row.chainId}
          className="flex min-w-0 flex-col gap-1"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <NetworkLogo network={row.slug ?? row.chainId} name={row.name} />
            <span className="font-medium">{row.name}</span>
            <span className="text-muted-foreground text-xs">
              {row.hub ? t("networks.hub") : t("networks.spoke")}
              {row.status === "pending" ? ` · ${t("pending")}` : ""}
            </span>
            <FundReportBadge report={row.report} />
          </div>
          {row.slug === "solana" ? (
            row.solana ? (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 pl-6 text-xs">
                {ACCOUNTS.map((key) => {
                  const account = row.solana?.[key] ?? "";
                  const url = solscanAccountUrl(account);
                  return (
                    <Fragment key={key}>
                      <dt className="text-muted-foreground">{labels[key]}</dt>
                      <dd className="min-w-0 truncate font-mono">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={account}
                            aria-label={`${labels[key]} ${account}`}
                            className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {short(account)}
                          </a>
                        ) : (
                          account
                        )}
                      </dd>
                    </Fragment>
                  );
                })}
              </dl>
            ) : (
              <p className="pl-6 text-muted-foreground text-xs">
                {t("networks.accountsUnavailable")}
              </p>
            )
          ) : null}
        </li>
      ))}
    </ul>
  );
}
