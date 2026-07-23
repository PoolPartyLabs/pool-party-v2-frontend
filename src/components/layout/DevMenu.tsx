/**
 * @id PP-CORE-CMP-024
 * @name DevMenu
 * @implements-rules-version v1
 *
 * TEMPORARY developer tool in the header (removed before launch — signalled by its dashed-gold
 * border). A "Dev mode" button opens a popover with:
 *  - a Manager-mode switch that reveals the Manager section in the sidebar (controlled by the shell);
 *  - a "Test modal states" grid that opens the shared {@link StatusModal} in each state, on any page.
 *
 * PP-INTEGRATION-POINT: delete this component, its header mount, and the Manager-mode state in
 * {@link AppShell} before launch.
 */
"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { FEATURE_KEYS, FEATURES } from "@/lib/features";
import { clearOverrides, getOverrides, setOverride } from "@/lib/features/devOverrides";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { cn } from "@/lib/utils/cn";
import { MODAL_STATUSES, type ModalStatus, STATUS_STYLE, StatusModal } from "./StatusModal";

/** Public props for {@link DevMenu}. */
export interface DevMenuProps {
  /** Whether Manager mode is on (the shell shows the Manager sidebar section when true). */
  managerMode: boolean;
  /** Called with the next Manager-mode state when the switch is toggled. */
  onManagerModeChange: (next: boolean) => void;
}

/** Temporary in-app developer menu (Manager-mode toggle + modal-state QA testers). */
export function DevMenu({ managerMode, onManagerModeChange }: DevMenuProps) {
  const t = useTranslations("shell");
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [modalStatus, setModalStatus] = useState<ModalStatus | null>(null);
  // Feature-flag dev panel: the live (override-aware) flag map + which keys are currently forced.
  const { flags } = useFeatureFlags();
  const overrides = getOverrides();
  const hasOverrides = Object.keys(overrides).length > 0;

  // Close the popover on outside pointer-down or Escape while it is open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Literal keys so the static i18n scan counts each state label as used.
  const stateLabel: Record<ModalStatus, string> = {
    confirm: t("dev.states.confirm"),
    loading: t("dev.states.loading"),
    pending: t("dev.states.pending"),
    success: t("dev.states.success"),
    warning: t("dev.states.warning"),
    error: t("dev.states.error"),
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-full border border-primary/70 border-dashed px-3.5",
          "font-medium text-foreground text-sm transition-colors hover:bg-primary/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <SlidersHorizontal className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="hidden sm:inline">{t("dev.button")}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          id={panelId}
          className={cn(
            "absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-4",
            "text-left shadow-lg",
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-base text-foreground">{t("dev.title")}</h2>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 font-semibold text-[10px] text-primary uppercase tracking-wider">
              {t("dev.temp")}
            </span>
          </div>
          <p className="mt-1 text-muted-foreground text-xs">{t("dev.subtitle")}</p>

          {/* Manager mode */}
          <div className="mt-4 flex items-center justify-between gap-4 border-border border-t pt-4">
            <div className="min-w-0">
              <p className="font-medium text-foreground text-sm">{t("dev.managerMode")}</p>
              <p className="text-muted-foreground text-xs">{t("dev.managerModeSub")}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={managerMode}
              aria-label={t("dev.managerMode")}
              onClick={() => onManagerModeChange(!managerMode)}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                managerMode ? "bg-success" : "bg-input",
              )}
            >
              <span
                className={cn(
                  "inline-block size-5 transform rounded-full bg-white transition-transform",
                  managerMode ? "translate-x-5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>

          {/* Modal-state testers */}
          <div className="mt-4 border-border border-t pt-4">
            <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
              {t("dev.testModalStates")}
            </p>
            <p className="mt-1 text-muted-foreground text-xs">{t("dev.testModalStatesSub")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {MODAL_STATUSES.map((state) => {
                const { icon: Icon, fg, spin } = STATUS_STYLE[state];
                return (
                  <button
                    key={state}
                    type="button"
                    onClick={() => {
                      setModalStatus(state);
                      setOpen(false);
                    }}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2.5",
                      "font-medium text-foreground text-sm transition-colors hover:border-input",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <Icon
                      className={cn("size-4 shrink-0", fg, spin && "animate-spin")}
                      aria-hidden="true"
                    />
                    <span>{stateLabel[state]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Feature flags — dev-only QA panel (POO-129 / closes the POO-132 epic). Flip any area on
              or off live; the change is reactive through useFeatureFlags so the nav + entry links
              update immediately. Strings are intentionally NOT i18n'd: this whole component is
              deleted before launch (see file header), so dev-tool copy stays inline. */}
          <div className="mt-4 border-border border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                Feature flags
              </p>
              {hasOverrides ? (
                <button
                  type="button"
                  onClick={clearOverrides}
                  className="rounded-md px-2 py-0.5 font-medium text-[11px] text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Reset
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              Toggle areas live (nav + entry links). Route 404 guards follow the env var.
            </p>
            <ul className="mt-3 flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
              {FEATURE_KEYS.map((key) => {
                const on = flags[key];
                const overridden = overrides[key] !== undefined;
                const { area, stage } = FEATURES[key];
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-lg px-1.5 py-1.5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-foreground text-sm">{area}</span>
                      <span className="shrink-0 rounded-full bg-surface-raised px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                        {stage}
                      </span>
                      {overridden ? (
                        <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-semibold text-[10px] text-primary uppercase tracking-wide">
                          override
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${area} feature flag`}
                      onClick={() => setOverride(key, !on)}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "bg-success" : "bg-input",
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block size-4 transform rounded-full bg-white transition-transform",
                          on ? "translate-x-4" : "translate-x-0.5",
                        )}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      <StatusModal status={modalStatus} onClose={() => setModalStatus(null)} />
    </div>
  );
}
