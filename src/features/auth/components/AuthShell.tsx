/**
 * @id PP-AUTH-SCR-001
 * @name AuthShell
 * @implements-rules-version v1
 * Shared chrome for the pre-auth screens: dark canvas, the faint brand-illustration backdrop, and
 * (by default) the locale switcher pinned top-right. No app navigation (these screens render before
 * the authenticated AppShell). Each screen lays out its own content inside `children`.
 *
 * The locale switcher is opt-out via `showLocaleSwitcher`: the English-only legal document pages
 * (Risk disclosure, Privacy Policy, Terms of Service) hide it, since their content is hardcoded EN
 * and switching the locale would never change the text (POO-663 / POO-664).
 */
import type { ReactNode } from "react";
import { LocaleSwitcher } from "@/components/ui/LocaleSwitcher";
import { FlyingIllustrations } from "./FlyingIllustrations";

/** Public props for {@link AuthShell}. */
export interface AuthShellProps {
  /** Screen content rendered above the backdrop. */
  children: ReactNode;
  /**
   * Whether to render the top-right locale switcher. Defaults to `true`. Set `false` on the
   * English-only legal document pages, where changing the locale has no effect on the copy.
   */
  showLocaleSwitcher?: boolean;
}

/** Pre-auth page wrapper (background + decoration + optional locale switch). */
export function AuthShell({ children, showLocaleSwitcher = true }: AuthShellProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <FlyingIllustrations />
      {showLocaleSwitcher ? (
        <div className="absolute top-4 right-4 z-20">
          <LocaleSwitcher />
        </div>
      ) : null}
      <div className="relative z-10">{children}</div>
    </main>
  );
}
