/**
 * @id PP-REW-CMP-014
 * @name ShareInviteButton
 * @implements-rules-version v1
 *
 * Primary "share invite link" action. Uses the Web Share API (native share sheet) when available;
 * otherwise falls back to copying the link and briefly confirming. Client component.
 */
"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { absoluteUrl } from "@/lib/urls";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link ShareInviteButton}. */
export interface ShareInviteButtonProps {
  /** The invite URL to share / copy. */
  url: string;
  /** Button label. */
  label: string;
  /** Label shown briefly after a copy-fallback succeeds. */
  copiedLabel: string;
  /** Extra classes on the button. */
  className?: string;
}

/** Share-or-copy the invite link. */
export function ShareInviteButton({ url, label, copiedLabel, className }: ShareInviteButtonProps) {
  const [copied, setCopied] = useState(false);
  const { track } = useAnalytics();

  // The builders store the link schemeless (display copy); share/clipboard need an absolute URL
  // (navigator.share would resolve it RELATIVE to the current page). absoluteUrl adds the app origin's
  // scheme (http:// on localhost, https:// otherwise) — POO-735.
  const shareUrl = absoluteUrl(url);

  async function handleShare() {
    // Prefer the native share sheet; a dismissed sheet is a no-op.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ url: shareUrl });
        track("reward_referral_shared");
      } catch {
        // user dismissed the share sheet — nothing to do
      }
      return;
    }
    // Fallback: copy the link and confirm briefly.
    try {
      await navigator.clipboard.writeText(shareUrl);
      track("reward_referral_shared");
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
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground text-sm transition-opacity hover:opacity-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {copied ? (
        <Check className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <Share2 className="size-4 shrink-0" aria-hidden="true" />
      )}
      {copied ? copiedLabel : label}
    </button>
  );
}
