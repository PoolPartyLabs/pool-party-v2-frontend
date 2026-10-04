/**
 * @id PP-STR-CMP-033 (POO-2179)
 * @name FundTransactionRecord
 * @implements-rules-version v1
 * @i18n-namespace strategies.funds
 * Full transaction identity and accessible mined or pending status.
 */
import { useTranslations } from "next-intl";
import { explorerTxUrl } from "@/lib/chain/explorer";
import type { FundTransactionRecord as TransactionRecord } from "./fundTransactions";

export interface FundTransactionRecordProps {
  record: TransactionRecord;
}
export function FundTransactionRecord({ record }: FundTransactionRecordProps) {
  const t = useTranslations("strategies.funds");
  const url = explorerTxUrl(record.chainId, record.hash);
  return (
    <div className="space-y-1 break-all text-sm">
      <p>{t(record.action)}</p>
      {url ? (
        <a
          className="underline focus-visible:ring-2 focus-visible:ring-primary"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {record.hash}
        </a>
      ) : (
        <span>{record.hash}</span>
      )}
      <p>
        {record.status === "confirmed"
          ? record.blockNumber != null
            ? t("confirmedBlock", { block: String(record.blockNumber) })
            : t("success")
          : record.status === "reverted"
            ? t("reverted")
            : t("pendingConfirmation")}
      </p>
      {record.reason ? <p>{t(record.reason)}</p> : null}
      {record.errorName ? <p>{t("decodedError", { name: record.errorName })}</p> : null}
      {record.uncertain ? <p>{t("confirmationTimeout")}</p> : null}
    </div>
  );
}
