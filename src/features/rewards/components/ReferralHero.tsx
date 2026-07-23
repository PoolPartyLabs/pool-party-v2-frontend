/**
 * @id PP-REW-CMP-017 (POO-290, POO-853)
 * @name ReferralHero
 * @implements-rules-version v1
 *
 * The dynamic half of the Referral screen's give-get hero. Before the user creates their code it
 * renders the one-time creation form (custom code + immutability warning — POO-290 R1/R2); after,
 * the code + invite-link fields and the share action. Client component (form + shared referral
 * state via {@link useReferral}).
 */
"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import type { ReferralProgram } from "@/lib/schemas";
import { appHost, referralUrl } from "@/lib/urls";
import { useReferral } from "../useReferral";
import { ReferralField } from "./ReferralField";
import { ShareInviteButton } from "./ShareInviteButton";

/**
 * Accepted CREATION code shape: 6 to 10 alphanumerics — min-6 product floor (murilo 2026-06-11), max-10
 * backend hard limit (POO-853 [R2]). Capture accepts a wider 3-10 (see `pendingReferralCode`).
 */
const CODE_PATTERN = /^[a-zA-Z0-9]{6,10}$/;

/** Public props for {@link ReferralHero}. */
export interface ReferralHeroProps {
  /** Server-fetched program snapshot (seeds the shared client state). */
  initial: ReferralProgram;
}

/** Creation form ↔ code/link/share, inside the hero card. */
export function ReferralHero({ initial }: ReferralHeroProps) {
  const t = useTranslations("rewards");
  const { program, createCode } = useReferral(initial);
  const data = program ?? initial;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // `invalid` = the typed code fails the 6-10 shape; `unavailable` = the backend rejected it (taken).
  const [error, setError] = useState<null | "invalid" | "unavailable">(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    // Stored and displayed AS TYPED; the canonical `?ref=` link keeps the casing too (POO-853 [R3]).
    const candidate = draft.trim();
    if (!CODE_PATTERN.test(candidate)) {
      setError("invalid");
      return;
    }
    setError(null);
    setBusy(true);
    // POO-853 [R1]: createCode never throws — it resolves false on a taken/rejected code.
    const created = await createCode(candidate);
    setBusy(false);
    if (!created) setError("unavailable");
  }

  if (data.code == null) {
    return (
      <form onSubmit={handleCreate} className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t("referral.create.label")}
          </span>
          <span className="flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2.5">
            {/* POO-853 [R3]: the canonical `?ref=` link shape (matches the copied invite), not `/r/`. */}
            <span className="shrink-0 text-muted-foreground text-sm">{appHost()}?ref=</span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("referral.create.placeholder")}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              className="w-full min-w-0 bg-transparent font-medium text-foreground text-sm outline-none placeholder:text-muted-foreground/60"
            />
          </span>
        </label>
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {t(error === "invalid" ? "referral.create.invalid" : "referral.create.unavailable")}
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">{t("referral.create.warning")}</p>
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground text-sm transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("referral.create.cta")}
        </button>
      </form>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      <ReferralField
        label={t("referral.code")}
        value={data.code}
        copyLabel={t("referral.copyCode")}
        copiedLabel={t("referral.copied")}
      />
      <ReferralField
        label={t("referral.link")}
        value={data.inviteLink ?? ""}
        copyLabel={t("referral.copyLink")}
        copiedLabel={t("referral.copied")}
      />
      {/* POO-717 R7: share the canonical `?ref=` URL (code as typed) so a code has one identity
          everywhere (POO-172), not the legacy `/r/` link. */}
      <ShareInviteButton
        url={referralUrl(data.code)}
        label={t("referral.share")}
        copiedLabel={t("referral.shared")}
      />
    </div>
  );
}
