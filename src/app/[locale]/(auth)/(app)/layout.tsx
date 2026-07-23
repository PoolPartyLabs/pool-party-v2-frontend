import { setRequestLocale } from "next-intl/server";
import { AppShell } from "@/components/layout/AppShell";
import { AuthGuard } from "@/lib/auth/AuthGuard";
import { UnsavedChangesProvider } from "@/lib/hooks/unsavedChanges";

/**
 * The authenticated app surfaces are wallet/data-driven and must render per request, not be
 * statically prerendered at build. In real mode (`NEXT_PUBLIC_MOCK_MODE=false`) their server reads
 * hit pool-party-api, which is NOT reachable during a Docker/CI build — prerendering them (the
 * `[locale]` tree has `generateStaticParams`) would couple the build to a live backend. Forcing
 * dynamic rendering keeps the data fetch at request time and makes the image buildable offline.
 * These routes are auth-gated and per-wallet, so full-route static caching was never appropriate
 * anyway. (INT-DEPLOY)
 */
export const dynamic = "force-dynamic";

/**
 * Layout for the authenticated app surfaces: wraps every page in the {@link AppShell} navigation
 * chrome. Pre-auth screens (sign-in, welcome, connect) live outside this route group and render
 * without the shell. The {@link AuthGuard} redirects unauthenticated users to /sign-in in real
 * mode; in mock mode it is a passthrough.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AuthGuard>
      {/* POO-751: the unsaved-changes guard wraps the shell so both the chrome's nav links
          (GuardedLink) and the page content (useUnsavedChanges) share one confirm modal. */}
      <UnsavedChangesProvider>
        <AppShell>{children}</AppShell>
      </UnsavedChangesProvider>
    </AuthGuard>
  );
}
