/**
 * @id PP-CORE-CMP-056 (POO-713)
 * @name StrategyLogo
 * @implements-rules-version v1
 *
 * A strategy's circular brand avatar: the manager-uploaded logo (`logo_url`, POO-580/POO-701 media
 * hosting) when present, else the no-image initials monogram. Consolidates the img-or-initials
 * pattern previously duplicated inline across the Manager Console list/detail, the collect modal and
 * the create review step, and adds it to the investor Home lists (POO-713) and Manager Console
 * (POO-715).
 *
 * The monogram prefers a caller-supplied `initials` (the precomputed `ManagerStrategy.initials`, the
 * manager-side no-image fallback), deriving `initialsFor(name)` only when the caller has none — e.g.
 * the investor `Strategy`, which carries no `initials` field.
 *
 * Decorative by design: the image uses an empty alt and the monogram is aria-hidden, because the
 * strategy name is always rendered adjacent to the logo, so it carries no independent a11y meaning
 * (matches the {@link NetworkLogo} precedent). Sizing and typography come from `className` (Tailwind,
 * de-conflicted via `cn`), like the sites it replaces — e.g. `size-10 text-sm`. Server-safe (no
 * hooks), so it renders inside both Server and Client components.
 */
import { cn } from "@/lib/utils/cn";
import { initialsFor } from "@/lib/utils/initials";

/** Public props for {@link StrategyLogo}. */
export interface StrategyLogoProps {
  /** Manager-uploaded logo URL (https CDN or data URI). Absent/empty/null → initials monogram. */
  url?: string | null;
  /** Strategy name: the a11y meaning carrier (adjacent text) and the monogram source when no
   * precomputed `initials` is passed. */
  name: string;
  /** Precomputed no-image monogram (e.g. `ManagerStrategy.initials`); falls back to `initialsFor(name)`. */
  initials?: string;
  /** Extra classes — pass the size and text size, e.g. `size-10 text-sm`. */
  className?: string;
}

/** A strategy's circular logo avatar; initials monogram fallback when there is no logo. */
export function StrategyLogo({ url, name, initials, className }: StrategyLogoProps) {
  if (url) {
    return (
      // Decorative; the adjacent strategy name carries the meaning.
      <img
        src={url}
        alt=""
        aria-hidden="true"
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-surface-raised font-medium text-foreground",
        className,
      )}
    >
      {initials ?? initialsFor(name)}
    </span>
  );
}
