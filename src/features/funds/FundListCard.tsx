/**
 * @id PP-STR-CMP-035 (POO-2181)
 * @name FundListCard
 * @implements-rules-version v2
 * Existing card primitives with an isolated v2 projection.
 */
import { useTranslations } from "next-intl";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { Link } from "@/i18n/navigation";
import { ExplorerFields } from "./ExplorerFields";
import { type FundListEntry, fundListModel } from "./fundListModel";

export interface FundListCardProps {
  fund: FundListEntry;
  managerView?: boolean;
}
export function FundListCard({ fund, managerView = false }: FundListCardProps) {
  const t = useTranslations("strategies.funds");
  const card = fundListModel(fund);
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <header className="flex items-start gap-3">
        <StrategyLogo url={card.image} name={card.name} className="size-10" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">
            <Link
              className="hover:underline focus-visible:outline-2"
              href={`/funds/${fund.coreVault}${managerView ? "?view=manager" : ""}`}
            >
              {card.name}
            </Link>
          </h2>
          <p className="break-all text-sm text-muted-foreground" title={card.manager}>
            {t("manager")}:{" "}
            {card.managerName !== card.manager ? <span>{card.managerName} · </span> : null}
            <ExplorerFields value={card.manager} chainId={42161} />
          </p>
        </div>
        <span className="rounded border border-border px-2 py-1 text-xs">
          {card.protocolVersion}
        </span>
      </header>
      {card.description ? (
        <p className="text-sm text-muted-foreground">{card.description}</p>
      ) : null}
      <p>{card.chains.join(" · ")}</p>
      <p>
        {t("protocols")}: {card.protocols.length ? card.protocols.join(" · ") : t("unavailable")}
      </p>
      <dl className="grid grid-cols-2 gap-3" aria-live="polite">
        <div>
          <dt>{t("sharePrice")}</dt>
          <dd>{card.sharePrice ?? t("unavailable")}</dd>
        </div>
        <div>
          <dt>{t("nav")}</dt>
          <dd>{card.shareAssets ?? t("unavailable")}</dd>
        </div>
      </dl>
      <div>
        <h3 className="font-medium">{t("positions")}</h3>
        {card.positions === null ? (
          <p>{t("unavailable")}</p>
        ) : card.positions.length === 0 ? (
          <p>{t("noPositions")}</p>
        ) : (
          <ul>
            {card.positions.map((position) => (
              <li key={position.key}>
                {position.tokens} · {position.protocol}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="font-medium">{t("limits")}</h3>
        <LimitsSummary value={card.limitsUsage} />
      </div>
      <Link
        href={`/funds/${fund.coreVault}${managerView ? "?view=manager" : ""}`}
        className="mt-auto rounded-md border border-border px-3 py-2 text-center font-medium focus-visible:outline-2"
      >
        {t("viewDetails")}
      </Link>
    </article>
  );
}
function LimitsSummary({ value }: { value: unknown }) {
  const t = useTranslations("strategies.funds");
  if (!value || typeof value !== "object") return <p>{t("unavailable")}</p>;
  const entries = Array.isArray(value)
    ? value
    : Object.values(value)
        .filter((entry) => typeof entry === "object" && entry !== null)
        .flat();
  const limits = entries.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Array.isArray(entry),
  );
  return limits.length ? (
    <ul>
      {limits.map((entry) => (
        <li key={JSON.stringify(entry)}>
          {typeof entry.chainId === "string" ? `${entry.chainId} · ` : ""}
          {typeof entry.currentPercent === "string" || typeof entry.currentPercent === "number"
            ? `${entry.currentPercent}%`
            : t("unavailable")}
          {typeof entry.percent === "number" || typeof entry.percent === "string"
            ? ` / ${entry.percent}%`
            : ""}
        </li>
      ))}
    </ul>
  ) : (
    <p>{t("unavailable")}</p>
  );
}
