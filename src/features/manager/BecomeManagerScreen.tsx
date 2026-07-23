/**
 * @id PP-MGR-SCR-000
 * @name BecomeManagerScreen
 *
 * Onboarding for non-managers (permissionless): a hero, a "how it works" 3-step explainer, and a CTA
 * to create the first strategy. Reached from the sidebar "Become a manager" entry. The CTA routes to
 * the strategy builder (a placeholder until the wizard lands in a later slice).
 */
"use client";

import { Briefcase, Coins, Users, Workflow } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { useRouter } from "@/i18n/navigation";

/** Become-a-manager onboarding screen. */
export function BecomeManagerScreen() {
  const t = useTranslations("manager");
  const router = useRouter();
  // Literal t() calls (the i18n usage scan is static — no dynamic keys).
  const steps = [
    { Icon: Workflow, title: t("become.how.step1.title"), body: t("become.how.step1.body") },
    { Icon: Users, title: t("become.how.step2.title"), body: t("become.how.step2.body") },
    { Icon: Coins, title: t("become.how.step3.title"), body: t("become.how.step3.body") },
  ];
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10">
          <Briefcase className="size-6 text-primary" aria-hidden="true" />
        </div>
        <h1 className="font-semibold text-3xl text-foreground">{t("become.title")}</h1>
        <p className="max-w-2xl text-muted-foreground">{t("become.subtitle")}</p>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="font-semibold text-foreground text-lg">{t("become.how.title")}</h2>
        <ol className="grid gap-4 sm:grid-cols-3">
          {steps.map(({ Icon, title, body }) => (
            <li key={title} className="flex flex-col gap-3 rounded-xl bg-surface p-5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="size-5 text-primary" aria-hidden="true" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-medium text-foreground text-sm">{title}</span>
                <span className="text-muted-foreground text-xs">{body}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3">
        {/* PP-INTEGRATION-POINT: routes to the strategy builder (placeholder until the wizard lands). */}
        <Button size="lg" className="self-start" onClick={() => router.push("/manager/new")}>
          {t("cta.createFirst")}
        </Button>
        <p className="text-muted-foreground text-xs">{t("become.note")}</p>
      </div>
    </section>
  );
}
