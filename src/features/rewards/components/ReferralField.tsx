/**
 * @id PP-REW-CMP-012
 * @name ReferralField
 * @implements-rules-version v1
 *
 * A labelled, read-only referral value (code or link) with a copy-to-clipboard button that briefly
 * confirms the copy. Client component (uses the Clipboard API); the copy silently no-ops where the
 * API is unavailable (e.g. insecure context).
 */
"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useAnalytics } from "@/lib/analytics/useAnalytics";

/** Public props for {@link ReferralField}. */
export interface ReferralFieldProps {
  /** Field caption (e.g. "Referral code"). */
  label: string;
  /** The value to display and copy. */
  value: string;
  /** Accessible label for the copy button. */
  copyLabel: string;
  /** Accessible label announced once copied. */
  copiedLabel: string;
  /** Extra classes on the wrapper. */
  className?: string;
}

/** A read-only referral value with a copy button. */
export function ReferralField({
  label,
  value,
  copyLabel,
  copiedLabel,
  className,
}: ReferralFieldProps) {
  const [copied, setCopied] = useState(false);
  const { track } = useAnalytics();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      track("reward_referral_shared");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context / unsupported) — leave state unchanged.
    }
  }

  return (
    <div className={className}>
      <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-foreground text-sm">{value}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? copiedLabel : copyLabel}
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-raised text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copied ? (
            <Check className="size-3.5 text-success" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
