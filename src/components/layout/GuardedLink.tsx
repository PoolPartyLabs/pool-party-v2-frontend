/**
 * @id PP-CORE-CMP-058 (POO-751)
 * @name GuardedLink
 * @implements-rules-version v1
 *
 * A drop-in replacement for the locale-aware {@link Link} that routes its navigation through the
 * unsaved-changes guard (POO-751 [R3]/[R5]). A plain left-click is intercepted: `preventDefault` +
 * `guard(() => router.push(href))`, so when a save-bearing form is dirty the confirm modal appears
 * before navigating; when nothing is dirty it navigates immediately (identical to a plain Link).
 *
 * Modified clicks (cmd/ctrl/shift/alt) and non-primary buttons keep native behavior (open a new
 * tab/window) — those don't leave the current page, so they never need guarding. Prefetch and every
 * other Link prop pass straight through.
 */
"use client";

import type { ComponentProps, MouseEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { useNavigationGuard } from "@/lib/hooks/unsavedChanges";

/** The href type the locale-aware router accepts (assignable to the Link href, stricter object). */
type NavHref = Parameters<ReturnType<typeof useRouter>["push"]>[0];

/** Same props as the locale-aware {@link Link}, with the router-compatible href type. */
type GuardedLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { href: NavHref };

/** A locale-aware Link whose in-app navigation is gated by the unsaved-changes guard. */
export function GuardedLink({ href, onClick, ...props }: GuardedLinkProps) {
  const router = useRouter();
  const guard = useNavigationGuard();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    // Modified / non-primary clicks open a new tab/window and never leave this page — let them be.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    guard(() => router.push(href));
  }

  return <Link href={href} onClick={handleClick} {...props} />;
}
