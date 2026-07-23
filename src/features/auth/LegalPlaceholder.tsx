/**
 * @id PP-AUTH-SCR-005
 * @name Legal / info placeholder
 * @implements-rules-version v1
 *
 * Reserved "new to wallets?" educational placeholder, reachable pre- and post-auth: a short blurb
 * plus a Back action, wrapped in the pre-auth AuthShell chrome. Real educational content lands before
 * launch (PP-INTEGRATION-POINT). Risk disclosure (PP-AUTH-SCR-006), Privacy Policy (PP-AUTH-SCR-007),
 * and Terms of Service (PP-AUTH-SCR-008) now have their own real pages and no longer use this.
 */
"use client";

import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AuthShell } from "./components/AuthShell";

/** Public props for {@link LegalPlaceholder}. */
export interface LegalPlaceholderProps {
  /** Which reserved page to render. */
  kind: "learnWallets";
}

/** A reserved Terms / Privacy / wallets-guide placeholder page. */
export function LegalPlaceholder({ kind }: LegalPlaceholderProps) {
  const t = useTranslations("auth");
  const router = useRouter();
  // Literal t() calls per branch so the i18n used-key scan resolves every key.
  const content = {
    learnWallets: { title: t("legal.learnWallets.title"), body: t("legal.learnWallets.body") },
  }[kind];

  return (
    <AuthShell>
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="w-full max-w-md">
          <h1 className="font-bold text-2xl text-foreground">{content.title}</h1>
          <p className="mt-3 text-muted-foreground leading-relaxed">{content.body}</p>
          <button
            type="button"
            onClick={() => router.back()}
            className="mt-6 inline-flex items-center gap-1 font-medium text-primary text-sm hover:underline"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            {t("legal.back")}
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
