/**
 * @id PP-PROF-CMP-003
 * @name SettingsRow
 * @implements-rules-version v1
 *
 * A single settings/menu row inside a {@link SettingsSection}. Renders an optional leading icon
 * tile, a title (+ optional sub), and a trailing slot — a value, a control (e.g. {@link Toggle}),
 * and/or a chevron. Becomes a link (`href`), a button (`onClick`), or a static div based on props.
 */
import { ChevronRight, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link SettingsRow}. */
export interface SettingsRowProps {
  /** Row title. */
  title: string;
  /** Optional secondary line under the title. */
  sub?: string;
  /** Optional right-aligned value text. */
  value?: string;
  /** Optional leading icon tile content. */
  icon?: ReactNode;
  /** Navigate here when set (renders a link). */
  href?: string;
  /**
   * Open `href` in a new tab with the external-link affordance (icon + "opens in new tab" hint)
   * instead of the in-app chevron. Used by the legal rows so they never remount the wallet
   * providers (POO-795). No-op without `href`.
   */
  external?: boolean;
  /** Click handler when set (renders a button). */
  onClick?: () => void;
  /** Trailing control (e.g. a Toggle or a Connect button). */
  trailing?: ReactNode;
  /** Show a chevron (defaults on for link/onClick rows when no trailing). */
  chevron?: boolean;
  /** Render the title in the destructive color (e.g. Log out / Delete). */
  danger?: boolean;
  /** Render as a non-interactive "coming soon" row (muted, no control/chevron). */
  comingSoon?: boolean;
}

/** A settings row. */
export function SettingsRow({
  title,
  sub,
  value,
  icon,
  href,
  external,
  onClick,
  trailing,
  chevron,
  danger,
  comingSoon,
}: SettingsRowProps) {
  const tc = useTranslations("common");
  const interactive = Boolean(href || onClick) && !comingSoon;
  const isExternal = Boolean(external && href) && !comingSoon;
  // External rows swap the in-app chevron for the external-link affordance.
  const showChevron = chevron ?? (interactive && !trailing && value === undefined && !isExternal);
  let titleColor = "text-foreground";
  if (comingSoon) titleColor = "text-muted-foreground";
  else if (danger) titleColor = "text-destructive";

  const inner = (
    <>
      {icon ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-raised">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block font-medium text-sm", titleColor)}>{title}</span>
        {sub ? <span className="mt-0.5 block text-muted-foreground text-xs">{sub}</span> : null}
      </span>
      {value !== undefined ? <span className="text-muted-foreground text-sm">{value}</span> : null}
      {trailing}
      {isExternal ? (
        <>
          <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">{tc("opensInNewTab")}</span>
        </>
      ) : null}
      {showChevron ? (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : null}
    </>
  );

  const className = cn(
    "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
    interactive &&
      "hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
  );

  if (href) {
    return (
      <Link
        href={href}
        className={className}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}
