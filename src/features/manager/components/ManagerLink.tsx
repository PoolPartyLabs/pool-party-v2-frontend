/**
 * @id PP-MGR-CMP-012
 * @name ManagerLink
 * @implements-rules-version v1 (POO-620 rules v1)
 *
 * Renders a manager attribution that links to the manager's public profile. POO-620: the target is
 * `/m/<handle>` when a handle is known, else `/m/<address>` when only the manager's wallet address is
 * known (the generic address-addressable profile, POO-618), else plain text. Used wherever a
 * strategy's manager is shown next to a position or strategy (cards, detail, tables). Server-render
 * safe — no client handlers, so it can sit inside Server Components; in a larger clickable card it is
 * rendered as a sibling of the card link (never nested), so its own navigation wins without breaking
 * the card.
 */
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link ManagerLink}. */
export interface ManagerLinkProps {
  /** The manager's profile handle; preferred link target when set. */
  handle?: string | null;
  /** POO-620: the manager's wallet address — the fallback link target when no handle is set. */
  address?: string | null;
  /** Visible content — the manager name, or an attribution like "by {name}". */
  children: ReactNode;
  /** Extra classes (e.g. `truncate`). */
  className?: string;
}

/** Manager name → public profile link by handle or address (plain text when neither is known). */
export function ManagerLink({ handle, address, children, className }: ManagerLinkProps) {
  // POO-620 R1: prefer the handle; fall back to the wallet address; plain text when neither.
  const slug = handle || address;
  if (!slug) return <span className={className}>{children}</span>;
  return (
    <Link
      href={`/m/${slug}`}
      className={cn("transition-colors hover:text-foreground hover:underline", className)}
    >
      {children}
    </Link>
  );
}
