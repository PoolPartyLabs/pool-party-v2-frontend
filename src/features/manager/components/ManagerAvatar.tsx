/**
 * @id PP-MGR-CMP-033 (POO-771)
 * @name ManagerAvatar
 * @implements-rules-version v1
 *
 * The manager's circular profile avatar, used on the Strategy Detail (the ManagerCard and the hero
 * line "by @handle"). Renders the backend-embedded `managerAvatarUrl` (POO-758) as a rounded image,
 * falling back to an initials monogram when the URL is absent OR the image fails to load (POO-771 R8).
 * POO-702 leaves many registry `avatar_url` values NULL today, so the monogram fallback is the common
 * path until that save-path fix lands.
 *
 * Distinct from {@link StrategyLogo} (the strategy's OWN logo, `logoUrl`): this is the MANAGER's
 * avatar, and unlike StrategyLogo it recovers from a broken/404 image via `onError` (which needs
 * client state, hence "use client"). The monogram derives from the first ALPHANUMERIC character of the
 * name, so an `@handle` never renders "@" as its initial (POO-771/POO-757 R8).
 *
 * Decorative by design: the image uses an empty alt because the manager attribution text is always
 * rendered adjacent (matches the {@link StrategyLogo} / ManagerProfileScreen precedent).
 */
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

/** First alphanumeric character of a name, uppercased (never the leading "@" of an "@handle"); "?" if none. */
function managerMonogram(name: string): string {
  const match = name.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : "?";
}

/** Public props for {@link ManagerAvatar}. */
export interface ManagerAvatarProps {
  /** The manager's avatar URL (https CDN). Absent/empty/null → monogram (or nothing, see below). */
  avatarUrl?: string | null;
  /** The manager attribution text (e.g. "@aave-labs" or a truncated wallet): the monogram source. */
  name: string;
  /** Extra classes: pass the size and text size, e.g. `size-10 text-sm`. */
  className?: string;
  /**
   * When true (default), a missing/failed image falls back to the initials monogram (the ManagerCard).
   * When false, a missing/failed image renders nothing: the present-only detail hero, which keeps its
   * current layout when the manager has no avatar (POO-771 R8).
   */
  showMonogramFallback?: boolean;
}

/** The manager's avatar image with an initials-monogram fallback (recovers from a broken image). */
export function ManagerAvatar({
  avatarUrl,
  name,
  className,
  showMonogramFallback = true,
}: ManagerAvatarProps) {
  const [failed, setFailed] = useState(false);

  if (avatarUrl && !failed) {
    return (
      // Decorative; the adjacent manager attribution carries the meaning.
      <img
        data-testid="manager-avatar-image"
        src={avatarUrl}
        alt=""
        onError={() => setFailed(true)}
        className={cn("shrink-0 rounded-full object-cover", className)}
      />
    );
  }

  if (!showMonogramFallback) return null;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-surface-raised font-semibold text-foreground",
        className,
      )}
    >
      {managerMonogram(name)}
    </span>
  );
}
