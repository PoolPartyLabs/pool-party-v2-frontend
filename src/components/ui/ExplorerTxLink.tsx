/**
 * @id PP-CORE-CMP-050 (POO-514)
 * @name ExplorerTxLink
 * @implements-rules-version v1
 *
 * The one shared "View on explorer" affordance for transaction receipts (POO-514 R2): a full-width
 * secondary link that opens the block explorer OF THE TX NETWORK at /tx/{hash}, assembled by
 * getExplorerTxUrl (POO-505) from the chain config's blockExplorers (Arbiscan / Basescan /
 * Polygonscan). When the URL cannot be assembled (missing network / hash, unsupported network) it
 * renders NOTHING — never an explorer home page and never a fabricated link (no-fake-data). Used by
 * the invest / withdraw / collect / compound / manager-close success receipts so the affordance is
 * identical everywhere.
 */
"use client";

import { useTranslations } from "next-intl";
import { getExplorerTxUrl } from "@/lib/chains/config";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link ExplorerTxLink}. */
export interface ExplorerTxLinkProps {
  /** API network slug the tx settled on (e.g. "base"); no link renders when absent/unsupported. */
  network: string | null | undefined;
  /** The transaction hash; no link renders when absent. */
  hash: string | null | undefined;
  /** Optional class merge for layout tweaks at the call site. */
  className?: string;
}

/** Full-width "View on explorer" receipt link for the transaction's own network. */
export function ExplorerTxLink({ network, hash, className }: ExplorerTxLinkProps) {
  const t = useTranslations("common");
  const url = getExplorerTxUrl(network, hash);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised",
        className,
      )}
    >
      {t("viewOnExplorer")}
    </a>
  );
}
