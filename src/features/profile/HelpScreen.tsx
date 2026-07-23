/**
 * @id PP-PROF-SCR-007
 * @name Help center
 * @implements-rules-version v1
 *
 * Search + featured Discord (primary support) + Documentation / Contact support + a "Popular
 * questions" FAQ accordion (first item expanded). Wrapped in the shared SettingsLayout.
 */
"use client";

import { BookOpen, MessageCircle, Search, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DISCORD_INVITE_URL } from "@/lib/constants/links";
import { FaqItem } from "./components/FaqItem";
import { SettingsLayout } from "./components/SettingsLayout";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

/** Help center. */
export function HelpScreen() {
  const t = useTranslations("profile");
  const [query, setQuery] = useState("");
  const faqs = [
    { q: t("help.faq.q1"), a: t("help.faq.a1") },
    { q: t("help.faq.q2"), a: t("help.faq.a2") },
    { q: t("help.faq.q3"), a: t("help.faq.a3") },
  ];
  // Single-open accordion: only one question stays expanded — opening another collapses it. Tracked
  // by question text (survives filtering) and defaults to the first; the user can collapse it.
  const [openQ, setOpenQ] = useState<string | null>(faqs[0]?.q ?? null);
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? faqs.filter((f) => f.q.toLowerCase().includes(needle) || f.a.toLowerCase().includes(needle))
    : faqs;

  return (
    <SettingsLayout title={t("help.title")}>
      <div className="relative">
        <Search
          className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("help.searchPlaceholder")}
          aria-label={t("help.searchPlaceholder")}
          className="w-full rounded-lg border border-border bg-surface py-2.5 pr-3 pl-9 text-foreground text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* Featured: Discord (primary support) */}
      <div className="rounded-xl border border-info/30 bg-info/5 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info/15 text-info">
            <MessageCircle className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-foreground">{t("help.discord.title")}</p>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary text-xs">
                <Zap className="size-3" aria-hidden="true" />
                {t("help.discord.fastest")}
              </span>
            </div>
            <p className="mt-1 text-muted-foreground text-sm">{t("help.discord.body")}</p>
          </div>
        </div>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground text-sm transition-colors hover:bg-primary/90"
        >
          {t("help.discord.open")}
        </a>
      </div>

      <SettingsSection>
        <SettingsRow
          title={t("help.docs.title")}
          sub={t("help.docs.body")}
          onClick={() => {}}
          icon={<BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />}
          chevron
        />
        <SettingsRow
          title={t("help.contact.title")}
          value={t("help.contact.body")}
          onClick={() => {}}
        />
      </SettingsSection>

      <SettingsSection label={t("help.faqTitle")}>
        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground text-sm">{t("help.noResults")}</p>
        ) : (
          filtered.map((faq) => (
            <FaqItem
              key={faq.q}
              question={faq.q}
              answer={faq.a}
              open={openQ === faq.q}
              onToggle={() => setOpenQ((current) => (current === faq.q ? null : faq.q))}
            />
          ))
        )}
      </SettingsSection>
    </SettingsLayout>
  );
}
