/**
 * @id PP-MGR-CMP-034
 * @name SocialChips
 * @implements-rules-version v1
 *
 * The public manager profile's social logo chips (X / Telegram / Discord / YouTube / Website), the
 * interactive client counterpart of the server-rendered {@link ManagerProfileScreen}. It derives the
 * visible chips itself from {@link SOCIAL_NETWORKS} + the manager's stored socials, so it takes ONLY
 * the serializable socials record as a prop and never receives a component / `Icon` ref across the RSC
 * boundary (a Server Component cannot pass function refs to a Client Component).
 *
 * POO-552: only links that pass `safeHttpUrl` render, so a stored `javascript:` / `data:` URL (or
 * garbage) never becomes a live href on the public page (defense in depth vs the input-side validation).
 *
 * POO-850 (rules v1): the WEBSITE chip is the only unpinned destination. Its SOCIAL_NETWORKS entry has
 * `domains: null`, so a manager can point it at any host, and Pool Party has not verified it. Clicking
 * it therefore opens an external-link confirm ({@link ConfirmDialog}, `tone="info"`) that names the
 * destination domain and warns it is an UNVERIFIED external site before opening it in a new tab (R1).
 * The other four chips are domain-pinned by the SOCIAL_NETWORKS allow-list, so they keep opening
 * DIRECTLY as plain anchors, no confirm (R2). The website chip is identified by `key === "website"`.
 */
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { ManagerSocials } from "@/lib/schemas";
import { safeHttpUrl } from "@/lib/utils/sanitize";
import { SOCIAL_NETWORKS } from "./socialNetworks";

/** Public props for {@link SocialChips}. */
export interface SocialChipsProps {
  /** The manager's stored social links (serializable; the brand icons are derived internally). */
  socials: ManagerSocials;
}

/** The display host of a URL (the website chip shows the domain, not "Website"). */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The manager's public social chips, with an external-link confirm on the website chip (POO-850). */
export function SocialChips({ socials }: SocialChipsProps) {
  const t = useTranslations("manager");
  // POO-552: only safeHttpUrl-valid links render, carrying the sanitized href (never the raw stored value).
  const chips = SOCIAL_NETWORKS.map((network) => ({
    ...network,
    href: safeHttpUrl(socials[network.key]),
  })).filter((chip): chip is typeof chip & { href: string } => chip.href !== null);

  // POO-850 R1: the website chip defers navigation to a confirm; this holds the pending destination
  // (null = the confirm is closed). Only one website chip can exist, so a single slot is enough.
  const [pendingWebsite, setPendingWebsite] = useState<string | null>(null);

  if (chips.length === 0) return null;

  return (
    <>
      <ul className="flex flex-wrap items-center gap-2 px-1">
        {chips.map(({ key, label, Icon, href }) => {
          const isWebsite = key === "website";
          return (
            <li key={key}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={isWebsite ? hostOf(href) : label}
                // POO-850 R1/R2: only the website chip is intercepted; the domain-pinned chips keep the
                // plain-anchor behavior (no onClick), so they open directly.
                onClick={
                  isWebsite
                    ? (event) => {
                        event.preventDefault();
                        setPendingWebsite(href);
                      }
                    : undefined
                }
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {isWebsite ? <span>{hostOf(href)}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
      {/* POO-850 R1: warn before leaving to the unverified external website. */}
      <ConfirmDialog
        open={pendingWebsite !== null}
        onOpenChange={(open) => {
          if (!open) setPendingWebsite(null);
        }}
        tone="info"
        title={t("profile.externalLink.title")}
        body={t("profile.externalLink.body", {
          domain: pendingWebsite ? hostOf(pendingWebsite) : "",
        })}
        confirmLabel={t("profile.externalLink.continue")}
        cancelLabel={t("profile.externalLink.cancel")}
        onConfirm={() => {
          // PP-SECURITY: keep noopener,noreferrer on the programmatic open too (no window.opener leak).
          if (pendingWebsite) window.open(pendingWebsite, "_blank", "noopener,noreferrer");
        }}
      />
    </>
  );
}
