/**
 * @id PP-AUTH (POO-196, POO-200)
 * @name AuthGuard
 * @implements-rules-version v1
 *
 * Client-side auth gate for the (app) route group. Redirects unauthenticated users to /sign-in.
 * In mock mode the guard is a passthrough (no real auth state to check).
 *
 * POO-200: Shows a full AppShell-shaped skeleton while Privy/wagmi state initializes or during
 * the post-login handshake (Privy authenticated, wagmi connecting).
 */
"use client";

import { type ReactNode, useEffect } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { SkeletonHero, SkeletonRows, SkeletonTiles } from "@/components/ui/skeletons";
import { useRouter } from "@/i18n/navigation";
import { isMockMode } from "@/lib/services";
import { useAuth } from "./useAuth";

/**
 * Full-page skeleton that mirrors the AppShell layout: desktop sidebar + header chrome
 * wrapping a Home-like content skeleton. Prevents layout shift when auth state resolves.
 */
function AuthLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      {/* Desktop sidebar skeleton */}
      <aside className="hidden w-64 shrink-0 flex-col bg-surface lg:flex">
        {/* Brand area */}
        <div className="flex h-16 items-center justify-center px-5">
          <div className="flex items-center gap-2">
            <Skeleton width={40} height={40} radius="9999px" />
            <Skeleton width={100} height={20} />
          </div>
        </div>
        {/* Nav items */}
        <nav className="flex flex-col gap-1 p-3">
          {["nav-home", "nav-portfolio", "nav-strategies", "nav-deposit", "nav-profile"].map(
            (key, i) => (
              <div key={key} className="flex items-center gap-3 rounded-md px-3 py-2">
                <Skeleton width={20} height={20} radius="0.25rem" />
                <Skeleton width={80 + i * 10} height={14} />
              </div>
            ),
          )}
        </nav>
      </aside>

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 items-center justify-between border-border border-b bg-surface px-4 lg:hidden">
          <div className="flex items-center gap-2">
            <Skeleton width={32} height={32} radius="9999px" />
            <Skeleton width={80} height={16} />
          </div>
          <Skeleton width={80} height={32} radius="0.5rem" />
        </header>

        {/* Desktop top bar */}
        <header className="hidden h-16 items-center justify-end gap-3 border-border border-b bg-surface px-6 lg:flex">
          <Skeleton width={100} height={32} radius="9999px" />
          <Skeleton width={36} height={36} radius="0.5rem" />
          <Skeleton width={120} height={36} radius="0.5rem" />
        </header>

        {/* Page content skeleton (mirrors Home loading.tsx) */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="flex flex-col gap-8">
            <SkeletonHero />
            <SkeletonTiles count={4} />
            <SkeletonRows count={3} />
          </div>
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="fixed inset-x-0 bottom-0 flex h-16 items-center justify-around border-border border-t bg-surface lg:hidden">
          {["tab-home", "tab-invest", "tab-deposit", "tab-profile"].map((key) => (
            <div key={key} className="flex flex-col items-center gap-1">
              <Skeleton width={24} height={24} />
              <Skeleton width={32} height={8} />
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isMockMode) return;
    if (auth.isLoading) return;
    if (!auth.isAuthenticated) {
      router.push("/sign-in");
    }
  }, [auth.isAuthenticated, auth.isLoading, router]);

  // Mock mode: always render.
  if (isMockMode) return <>{children}</>;

  // Real mode: show AppShell-shaped skeleton while auth state resolves.
  if (auth.isLoading || !auth.isAuthenticated) return <AuthLoadingSkeleton />;

  return <>{children}</>;
}
