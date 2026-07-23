/**
 * @id PP-AUTH-CMP-001
 * @name LegalDocument
 * @implements-rules-version v1
 * Shared chrome for a long-form legal page (Privacy Policy, Terms of Service): the pre-auth
 * AuthShell + a Back action, a title and "last modified" line, and a non-copyable (NoCopy) readable
 * prose column. The document body is passed as semantic children (h2/h3/p/ul/li). Pages that use it
 * are served noindex (page-level robots metadata + an X-Robots-Tag header in next.config.ts).
 * The AuthShell locale switcher is hidden here: this content is hardcoded English, so switching the
 * locale would never change it (POO-663 / POO-664).
 */
"use client";

import { ChevronLeft } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { NoCopy } from "@/components/ui/NoCopy";
import { useRouter } from "@/i18n/navigation";
import { AuthShell } from "./components/AuthShell";

/** Public props for {@link LegalDocument}. */
export interface LegalDocumentProps {
  /** Document title, rendered as the h1. */
  title: string;
  /** Pre-formatted "last modified" line, e.g. "Last modified: July 10, 2025". */
  lastModified: string;
  /** Label for the Back action. Defaults to "Back" (these pages are English-only). */
  backLabel?: string;
  /** The document body as semantic elements (h2/h3/p/ul/li), rendered non-copyable. */
  children: ReactNode;
}

/** Long-form legal document shell. Body is styled via descendant utilities so pages stay semantic. */
export function LegalDocument({
  title,
  lastModified,
  backLabel = "Back",
  children,
}: LegalDocumentProps) {
  const router = useRouter();
  // These pages open in a NEW TAB from the app (POO-795), where the session history has a single
  // entry and router.back() is a dead no-op. Only show Back when we arrived via an in-app navigation
  // (history.length > 1). Computed after mount so the server render and hydration stay in sync.
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);

  return (
    <AuthShell showLocaleSwitcher={false}>
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        {canGoBack ? (
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-6 inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {backLabel}
          </button>
        ) : null}

        <h1 className="font-bold text-2xl text-foreground">{title}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{lastModified}</p>

        <NoCopy className="mt-6 text-left text-muted-foreground text-sm leading-relaxed [&_a]:text-foreground [&_a]:underline [&_h2]:mt-8 [&_h2]:font-semibold [&_h2]:text-base [&_h2]:text-foreground [&_h3]:mt-6 [&_h3]:font-medium [&_h3]:text-foreground [&_li]:mt-2 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-4 [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </NoCopy>
      </div>
    </AuthShell>
  );
}
