/**
 * @id PP-CORE-CMP-050 (POO-514, POO-1508, POO-1526, POO-1568)
 * @name ExplorerTxLink
 * @implements-rules-version v4 (POO-1568 rules v1) · v3 (POO-1526 rules v1) · v2 (POO-1508 rules v2) · v1
 *
 * The one shared "View on explorer" affordance for transaction receipts (POO-514 R2): a link that
 * opens the block explorer OF THE TX NETWORK at /tx/{hash}, assembled by getExplorerTxUrl (POO-505)
 * from the chain config's blockExplorers (Arbiscan / Basescan / Polygonscan). When the URL cannot be
 * assembled (missing network / hash, unsupported network) it renders NOTHING — never an explorer home
 * page and never a fabricated link (no-fake-data).
 *
 * POO-1508 [R48]/[R59]: the settling screens (`11`, `7f`) want a QUIET text link below a primary
 * `Close`, not the bordered-button look this component always had — "a bordered button pointing at a
 * block explorer contradicts the flow abstracting chains away, and most users cannot read one." Added
 * as an opt-in `variant`, defaulting to `"button"` (the original, unchanged look) so every existing
 * caller (invest / withdraw / collect / compound / manager-close receipts, the recovery banner, the
 * execution carousel's per-row link) is unaffected.
 *
 * ## Provisioning v3 mobile [M5.1], POO-1526
 *
 * That `text` variant shipped as a bare 20px line of copy, which is `View on explorer` — a control
 * POO-1526's own M5.1 list names — at less than half the 44pt floor. It takes the house invisible
 * hit area (POO-840 [R2], `after:-inset-3.5`) rather than a `min-h-11`, because growing the box
 * would push a quiet link into looking like the bordered CTA [R48] deliberately removed.
 *
 * The inset is ASYMMETRIC, and that is the load-bearing part (M5.3: expanded areas may not overlap).
 * The settling screen renders this directly under a `min-h-11` Close inside a `gap-2` column, so a
 * symmetric 14px top would reach 6px into that button. `after:-top-1.5` caps the upward growth at
 * 6px, under the 8px gap, and `after:-bottom-5` spends the difference downward: 6 + 20 + 20 = 46px
 * of touch target with 2px of clearance above. The same override is how `TransactionModalHeader`
 * keeps its gear off the Dialog X (`after:-right-2`).
 *
 * The other `text` caller is the execution carousel's EXPANDED list, where the nearest other link is
 * ~40px away against 26px of combined growth. (Until POO-1568 that caller also had a collapsed-window
 * link 12px under the toggle button; see below for where it went.)
 *
 * ## Provisioning v3 visual QA, POO-1568 [R1]
 *
 * A third variant, `ghost`. The execution screen's link used to render in the carousel's own slot,
 * which sits ABOVE `ProvisioningPanel`'s pinned footer, so a bare `text` line floated over the
 * primary `Done` and read as an afterthought. It now renders inside that footer, after the state
 * button, as the button's own secondary action, and neither shipped variant fits that position:
 * `button` is a bordered CTA that would compete with `Done` directly beneath it, and `text` is the
 * loose line of copy that caused the report. `ghost` is the `button` box with the border, the fill
 * and the foreground weight taken out.
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
  /**
   * POO-1508 [R48]/[R59]: `"button"` (default) is the original full-width bordered look, used
   * everywhere this shipped before. `"text"` is a plain inline underlined link with no border or
   * fill, for the settling screens where a bordered CTA would contradict the flow's own chain
   * abstraction. POO-1568 [R1] adds `"ghost"`, the button's shape without its weight, for the one
   * position where this link sits directly under another button and has to read as its secondary
   * action rather than as a rival CTA or as a stray line of copy.
   */
  variant?: "button" | "text" | "ghost";
}

/**
 * The three looks, keyed by `variant`. A lookup rather than the nested ternary a third branch would
 * have made of the original: each string is long, each carries its own reasoning, and the geometry
 * shared by `button` and `ghost` is only visible as a deliberate match when the two sit side by side.
 */
const VARIANT_CLASS: Record<NonNullable<ExplorerTxLinkProps["variant"]>, string> = {
  button:
    "inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border font-medium text-foreground text-sm transition-colors hover:bg-surface-raised",
  // [M5.1/M5.3, POO-1526] Invisible hit area, biased downward so it cannot reach the Close 8px above
  // it on the settling screen. See the asymmetry note in the file header.
  text: "relative inline-flex items-center gap-1 text-muted-foreground text-sm underline underline-offset-2 after:absolute after:-inset-3.5 after:-top-1.5 after:-bottom-5 after:content-[''] hover:text-foreground",
  // [R1, POO-1568] The `button` geometry EXACTLY (h-11, full width, same radius), minus its border,
  // its fill and its foreground weight. Matching the box is the point: under the execution screen's
  // `Done` it has to look like the same family of control, one rank quieter, which neither of the
  // other two can do. The 44pt floor comes from that real box, so this variant needs none of the
  // `text` variant's invisible hit area — and so cannot grow upward into the button above it.
  ghost:
    "inline-flex h-11 w-full items-center justify-center gap-2 rounded-md font-medium text-muted-foreground text-sm transition-colors hover:text-foreground",
};

/** "View on explorer" receipt link for the transaction's own network. */
export function ExplorerTxLink({
  network,
  hash,
  className,
  variant = "button",
}: ExplorerTxLinkProps) {
  const t = useTranslations("common");
  const url = getExplorerTxUrl(network, hash);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={cn(VARIANT_CLASS[variant], className)}
    >
      {t("viewOnExplorer")}
    </a>
  );
}
