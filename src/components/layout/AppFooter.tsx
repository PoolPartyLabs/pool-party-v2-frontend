/**
 * @id PP-CORE-LAY-002
 * @name AppFooter
 * @implements-rules-version v1
 *
 * App footer for authenticated screens: a discreet brand lockup + legal links, then a fine-print
 * row (copyright + risk note, and the "Developed by Pool Party Labs" credit). Rendered full-bleed
 * by {@link AppShell} (the chrome is never width-capped — only page content is), and it carries the
 * mobile bottom-tab-bar clearance since it is the last element in the content column on phones.
 *
 * The Terms / Privacy / Risk links point at the real legal pages (/terms, /privacy, /risk). Help
 * opens the existing Profile help screen.
 */
"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** A single footer link: locale-agnostic href, translated label, and whether it opens a new tab. */
interface FooterLink {
  href: string;
  label: string;
  /** Legal pages open in a new tab (POO-795) so the app tab never remounts the wallet providers. */
  external?: boolean;
}

/** App footer with brand lockup, legal links, and fine print. */
export function AppFooter() {
  const t = useTranslations("shell");
  const tc = useTranslations("common");

  const links: FooterLink[] = [
    { href: "/terms", label: t("footer.links.terms"), external: true },
    { href: "/privacy", label: t("footer.links.privacy"), external: true },
    { href: "/risk", label: t("footer.links.risk"), external: true },
    { href: "/profile/help", label: t("footer.links.help") },
  ];

  return (
    <footer className="border-border border-t bg-surface">
      <div className="px-4 pt-8 pb-24 lg:px-6 lg:pb-8">
        {/* Brand lockup + legal links */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
          >
            {/* Decorative: the wordmark beside it names the brand. */}
            <img
              src="/brand/duck-head.png"
              alt=""
              aria-hidden="true"
              className="size-6 object-contain"
            />
            <span className="font-semibold text-foreground text-sm">Pool Party</span>
          </Link>

          <nav
            aria-label="Legal"
            className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground text-sm"
          >
            {links.map((link) =>
              link.external ? (
                <Link
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                >
                  {link.label}
                  <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="sr-only">{tc("opensInNewTab")}</span>
                </Link>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                >
                  {link.label}
                </Link>
              ),
            )}
          </nav>
        </div>

        {/* Fine print */}
        <div className="mt-6 flex flex-col gap-2 border-border border-t pt-6 text-muted-foreground text-xs sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl">{t("footer.copyright")}</p>
          <p className="shrink-0">{t("footer.developedBy")}</p>
        </div>
      </div>
    </footer>
  );
}
