/**
 * @id PP-CARD-CMP-002
 * @name Virtual Card
 * @implements-rules-version v1
 *
 * The card-face visual used across Cards surfaces, in two modes:
 *  - Offer (Explore): brand + faux chip + fully-masked PAN + network mark.
 *  - Owned (My cards): brand + network, the Balance, the masked PAN + a footer label (e.g. "Debit").
 * The brand color is partner data (not a theme token), so it's applied via inline style; face text
 * is white for contrast on the brand color. Presentational.
 */
import type { CardNetwork } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/format";

/** Network wordmark (kept as styled text — no asset dependency). */
const NETWORK_LABEL: Record<CardNetwork, string> = {
  visa: "VISA",
  mastercard: "mastercard",
};

/** The network mark, styled per network. */
function NetworkMark({ network }: { network: CardNetwork }) {
  return (
    <span className={cn("font-bold", network === "visa" ? "text-base italic" : "text-sm")}>
      {NETWORK_LABEL[network]}
    </span>
  );
}

/** Public props for {@link VirtualCard}. */
export interface VirtualCardProps {
  /** Brand wordmark on the card face, e.g. "ether.fi". */
  brand: string;
  /** Card network, rendered as its wordmark. */
  network: CardNetwork;
  /** Brand color (hex) for the card background — partner data, applied inline. */
  brandColor: string;
  /** Last four digits; when omitted the PAN renders fully masked (an offer, not the user's card). */
  maskedPan?: string;
  /** When set, renders the owned-card layout with this spendable balance (USD). */
  balanceUsd?: number;
  /** Label above the balance (e.g. "Balance"); owned mode only. */
  balanceLabel?: string;
  /** Bottom-right label in owned mode (e.g. "Debit"). */
  footerLabel?: string;
  /** Extra classes on the card face. */
  className?: string;
}

/** A brand-colored virtual card face (offer or owned). */
export function VirtualCard({
  brand,
  network,
  brandColor,
  maskedPan,
  balanceUsd,
  balanceLabel,
  footerLabel,
  className,
}: VirtualCardProps) {
  return (
    <div
      className={cn(
        "relative flex aspect-[1.6/1] w-full flex-col justify-between overflow-hidden rounded-xl p-4 text-white",
        className,
      )}
      style={{ backgroundColor: brandColor }}
    >
      {/* Decorative sheen — the lighter circle in the design. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-10 -right-10 size-36 rounded-full bg-white/10"
      />
      <div className="relative flex items-start justify-between gap-2">
        <span className="font-semibold text-sm">{brand}</span>
        {balanceUsd != null ? <NetworkMark network={network} /> : null}
      </div>

      {balanceUsd != null ? (
        <div className="relative">
          <p className="text-white/80 text-xs">{balanceLabel}</p>
          <p className="font-bold text-2xl tabular-nums">{formatUsd(balanceUsd)}</p>
        </div>
      ) : (
        /* Faux EMV chip (offer mode only). */
        <span aria-hidden="true" className="relative h-6 w-8 rounded-md bg-white/80" />
      )}

      <div className="relative flex items-end justify-between gap-2">
        <span className="font-medium text-sm tracking-widest tabular-nums">
          {balanceUsd != null ? `•••• ${maskedPan ?? "••••"}` : `•••• •••• ${maskedPan ?? "••••"}`}
        </span>
        {balanceUsd != null ? (
          <span className="text-white/80 text-xs">{footerLabel}</span>
        ) : (
          <NetworkMark network={network} />
        )}
      </div>
    </div>
  );
}
