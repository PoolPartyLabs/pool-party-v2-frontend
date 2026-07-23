/**
 * @id PP-DASH-CMP-007 (POO-579)
 * @name ReferralWelcomeBanner
 * @implements-rules-version v1
 *
 * Feature B (POO-579): a one-time welcome banner shown on Home right after a new user joined through a
 * friend's referral link (the apply succeeded). It reads the `pp-referral-welcome` flag that
 * `ReferralTracker` set before its `router.refresh()`, and CONSUMES it on mount (read-and-clear) so the
 * banner shows exactly once — a later navigation or remount finds nothing pending and renders nothing.
 * Dismissible (the flag is already cleared; dismiss just hides the current instance).
 *
 * The flag is consumed inside a mount effect (not during render) so SSR and the first client render both
 * produce empty markup (no hydration mismatch); the banner then appears client-side when the flag was set.
 */
"use client";

import { PartyPopper, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { consumeReferralWelcomePending } from "@/features/rewards/referralWelcome";

/** One-time "welcome, you joined via a referral" banner for Home. Renders nothing when not pending. */
export function ReferralWelcomeBanner() {
  const t = useTranslations("home");
  const [show, setShow] = useState(false);

  // Consume the one-time flag on mount (read-and-clear). Runs client-side only, so the flag is
  // cleared the first time the banner mounts and never re-shows on a later render.
  useEffect(() => {
    if (consumeReferralWelcomePending()) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <section
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <PartyPopper className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{t("referralWelcome.title")}</p>
        <p className="mt-0.5 text-muted-foreground text-sm">{t("referralWelcome.body")}</p>
      </div>
      <button
        type="button"
        onClick={() => setShow(false)}
        aria-label={t("referralWelcome.dismiss")}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </section>
  );
}
