/**
 * @id PP-MGR-SCR-002
 * @name mandateStepTitles
 * @implements-rules-version v1 (POO-2122 rules v1)
 * @analytics-events none, a copy lookup
 *
 * The five Mandate step titles and subtitles, as literal records.
 *
 * It is a module rather than two inline objects because the sub-step header (PP-MGR-CMP-028) and the
 * action bar (PP-MGR-CMP-040) both name a step the user is not on, so the alternative was the same
 * ten `t()` calls written twice, drifting the first time a title changes.
 *
 * The lookup is a RECORD built from literal keys, never `t(step.titleKey)`. `scripts/i18n-check.ts`
 * binds keys syntactically, by matching a quoted literal inside a translator call in a file with one
 * namespace, so a dynamic key is invisible to it: the parity check would pass while the screen
 * rendered a missing-message error at runtime.
 */
"use client";

import { useTranslations } from "next-intl";
import type { MandateStepKey } from "../mandateDraft";

/** The step titles, in the current locale. */
export function useMandateStepTitles(): Record<MandateStepKey, string> {
  const t = useTranslations("manager");
  return {
    networks: t("fundBuilder.steps.networks.title"),
    protocols: t("fundBuilder.steps.protocols.title"),
    tokens: t("fundBuilder.steps.tokens.title"),
    pools: t("fundBuilder.steps.pools.title"),
    limits: t("fundBuilder.steps.limits.title"),
  };
}

/** The one-line subtitles the expanded sub-step header runs under the row (R3). */
export function useMandateStepSubtitles(): Record<MandateStepKey, string> {
  const t = useTranslations("manager");
  return {
    networks: t("fundBuilder.steps.networks.subtitle"),
    protocols: t("fundBuilder.steps.protocols.subtitle"),
    tokens: t("fundBuilder.steps.tokens.subtitle"),
    pools: t("fundBuilder.steps.pools.subtitle"),
    limits: t("fundBuilder.steps.limits.subtitle"),
  };
}
