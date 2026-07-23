/**
 * @id PP-MGR-CMP-020
 * @name ShareProfileButton
 * @implements-rules-version v1 · v1 (POO-901: sharer's referral code on the shared URL)
 *
 * Circular ghost share action for the public manager profile header (POO-288 R1). Uses the Web
 * Share API (native sheet) when available; otherwise copies the profile link and briefly confirms
 * with a check mark. Client component (the profile screen itself renders on the server) — which is
 * exactly why the referral append lives HERE (POO-901 [R3]): the SHARER is whoever is signed in on
 * the client (owner or visitor), so the server screen passes only the profile slug and this button
 * resolves the sharer's code via the shared `useReferral` state. With a code the shared/copied URL
 * is `managerProfileReferralUrl(slug, code)`; logged out or code-less it is the plain
 * `managerProfileUrl(slug)`.
 */
"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { useReferral } from "@/features/rewards/useReferral";
import { absoluteUrl, managerProfileReferralUrl, managerProfileUrl } from "@/lib/urls";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link ShareProfileButton}. */
export interface ShareProfileButtonProps {
  /** The profile's public slug (handle when claimed, else the wallet address). */
  slug: string;
  /** Accessible label ("Share profile"). */
  label: string;
  /** Announced + shown briefly after a copy-fallback succeeds. */
  copiedLabel: string;
  /** Extra classes on the button. */
  className?: string;
}

/** Share-or-copy the public profile link (with the sharer's referral code when one exists). */
export function ShareProfileButton({
  slug,
  label,
  copiedLabel,
  className,
}: ShareProfileButtonProps) {
  const [copied, setCopied] = useState(false);
  // POO-901 [R3]: the SHARER's code (null while loading / logged out / not created) — the URL
  // upgrades in place when the shared referral state resolves with a code.
  const { program } = useReferral();
  const code = program?.code ?? null;
  const url = absoluteUrl(code ? managerProfileReferralUrl(slug, code) : managerProfileUrl(slug));

  async function handleShare() {
    // Prefer the native share sheet; a dismissed sheet is a no-op.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ url });
      } catch {
        // user dismissed the share sheet — nothing to do
      }
      return;
    }
    // Fallback: copy the link and confirm briefly.
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context / unsupported)
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-raised text-foreground transition-colors hover:bg-surface-raised/80",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {copied ? (
        <Check className="size-4 text-success" aria-hidden="true" />
      ) : (
        <Share2 className="size-4" aria-hidden="true" />
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ""}
      </span>
    </button>
  );
}
