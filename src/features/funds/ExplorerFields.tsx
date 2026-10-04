/**
 * @id PP-STR-CMP-034 (POO-2179)
 * @name ExplorerFields
 * @implements-rules-version v1
 * @i18n-namespace strategies.funds
 * Read-only protocol fields preserve identifiers and explicit chain context.
 */
import { useTranslations } from "next-intl";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chain/explorer";
export interface ExplorerFieldsProps {
  value: unknown;
  chainId?: number;
  chainByField?: Record<string, number | undefined>;
  field?: string;
}
export function ExplorerFields({
  value,
  chainId,
  chainByField = {},
  field = "",
}: ExplorerFieldsProps) {
  const t = useTranslations("strategies.funds");
  const labels: Record<string, string> = {
    raw: t("amount"),
    decimal: t("amount"),
    amount0: t("amount"),
    amount1: t("amount"),
    valueUsd: t("value"),
    currentPercent: t("limits"),
    percent: t("limits"),
    enforcedOnChain: t("notOnChain"),
    chainId: t("chains"),
    tokens: t("positions"),
    token: t("positions"),
    unallocatedBalance: t("balance"),
    operatingCash: t("balance"),
    stage: t("state"),
    state: t("state"),
    legs: t("transits"),
    direction: t("transits"),
    amountSent: t("amount"),
    credited: t("paid"),
    nextStepHint: t("notReady"),
    readyForNextStep: t("ready"),
    status: t("state"),
    balancesStatus: t("state"),
    networks: t("chains"),
    network: t("chains"),
    coreVault: t("coreVault"),
    core: t("coreVault"),
    spokeVault: t("spokeVault"),
    manager: t("manager"),
    shareToken: t("shareToken"),
    adapter: t("adapter"),
    transactionHash: t("transactionHash"),
    publishTxHash: t("reportPublish"),
    deliveryTxHash: t("reportDelivery"),
    jobId: t("report"),
    sent: t("transitSend"),
    deposited: t("transitSend"),
    filled: t("transitFill"),
    acknowledged: t("transitAcknowledgement"),
    acknowledgementPublished: t("transitAcknowledgement"),
  };
  if (value === null || value === undefined) return <span>{t("unavailable")}</span>;
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((entry) => (
          <li key={JSON.stringify(entry)}>
            <ExplorerFields
              value={entry}
              chainId={chainId}
              chainByField={chainByField}
              field={field}
            />
          </li>
        ))}
      </ul>
    );
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const currentChain =
      "chainId" in record
        ? Number(record.chainId)
        : "sourceChainId" in record && !("destinationChainId" in record)
          ? Number(record.sourceChainId)
          : chainId;
    const source = Number(record.sourceChainId);
    const destination = Number(record.destinationChainId);
    const transit = "destinationChainId" in record;
    const context: Record<string, number | undefined> = transit
      ? {
          sent: source,
          deposited: source,
          filled: destination,
          credited: destination,
          acknowledgementPublished: currentChain,
          acknowledged: currentChain,
          expired: source,
          refunded: source,
          inputToken: source,
          outputToken: destination,
          bridgeAdapter: source,
          escrow: source,
          spokeVault: record.direction === "spoke-to-hub" ? source : destination,
        }
      : {
          ...chainByField,
          ...("sourceChainId" in record && !("destinationChainId" in record)
            ? { publishTxHash: source }
            : {}),
        };
    return (
      <dl className="space-y-1">
        {Object.entries(record)
          .filter(([key]) => key !== "protocolVersion")
          .map(([key, entry]) => (
            <div className="flex flex-wrap gap-2 break-all text-sm" key={key}>
              <dt>{labels[key] ?? t("value")}</dt>
              <dd>
                <ExplorerFields
                  value={entry}
                  chainId={key in context ? context[key] : currentChain}
                  chainByField={context}
                  field={key}
                />
              </dd>
            </div>
          ))}
      </dl>
    );
  }
  if (typeof value === "string") {
    const url = /(?:transactionHash|txHash)$/i.test(field)
      ? explorerTxUrl(chainId ?? Number.NaN, value)
      : explorerAddressUrl(chainId ?? Number.NaN, value);
    if (url)
      return (
        <a
          className="underline focus-visible:ring-2 focus-visible:ring-primary"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {value}
        </a>
      );
  }
  return <span>{String(value)}</span>;
}
