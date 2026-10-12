/**
 * @id PP-MGR-CMP-104
 * @name TokenAccessControl
 * @implements-rules-version v1 (POO-2332)
 * @analytics-events none, the builder shell (PP-MGR-SCR-002) sends
 *   `builder_mandate_token_mode_changed` when the draft mode changes.
 *
 * POO-2332 R1: the "Token access" segmented control at the top of the Tokens step. Two options,
 * "Selected tokens" and "All tokens". The options are native radio inputs in a fieldset, so the
 * arrow keys move between them and a screen reader reads the chosen one. The draft keeps the mode.
 * This component only shows it and reports a change.
 */
"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { cn } from "@/lib/utils/cn";
import type { TokenMode } from "../mandateDraft";

/** The options, in screen order. */
const MODES: readonly TokenMode[] = ["selected", "all"];

/** Public props for {@link TokenAccessControl}. */
export interface TokenAccessControlProps {
  /** The mode the draft holds. */
  mode: TokenMode;
  /** Called with the new mode. Not called when the chosen option is pressed again. */
  onChange: (mode: TokenMode) => void;
  /** R4: the info line shows in Selected mode only. Default true. */
  showInfo?: boolean;
}

/** R1: the Token access control, with the info line in Selected mode (R4). */
export function TokenAccessControl({ mode, onChange, showInfo = true }: TokenAccessControlProps) {
  const t = useTranslations("manager");
  const name = useId();
  const labels: Record<TokenMode, string> = {
    selected: t("fundBuilder.tokens.accessSelected"),
    all: t("fundBuilder.tokens.accessAll"),
  };

  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-3 border-0 p-0">
      <legend className="sr-only">{t("fundBuilder.tokens.access")}</legend>
      <span aria-hidden="true" className="font-medium text-foreground text-sm">
        {t("fundBuilder.tokens.access")}
      </span>
      <div className="inline-flex items-center gap-1 rounded-full bg-surface p-1">
        {MODES.map((option) => {
          const checked = option === mode;
          return (
            <label
              key={option}
              data-token-mode={option}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 font-medium text-xs transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                checked
                  ? "bg-surface-raised text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {/* A native radio: the arrow keys move between the options for free. */}
              <input
                type="radio"
                name={name}
                value={option}
                checked={checked}
                onChange={() => {
                  if (!checked) onChange(option);
                }}
                className="sr-only"
              />
              {labels[option]}
            </label>
          );
        })}
      </div>
      {showInfo && mode === "selected" ? (
        <p className="min-w-0 flex-1 text-muted-foreground text-xs">
          {t("fundBuilder.tokens.accessInfo")}
        </p>
      ) : null}
    </fieldset>
  );
}
