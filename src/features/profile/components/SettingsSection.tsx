/**
 * @id PP-PROF-CMP-006
 * @name SettingsSection
 * @implements-rules-version v1
 * A titled settings card: a small-caps label + a bordered surface that hosts inset-divided rows.
 */
import type { ReactNode } from "react";

/** Public props for {@link SettingsSection}. */
export interface SettingsSectionProps {
  /** Optional small-caps section label. */
  label?: string;
  /** Rows (typically {@link SettingsRow}). */
  children: ReactNode;
  /** Extra classes on the wrapper. */
  className?: string;
}

/** A grouped settings card. */
export function SettingsSection({ label, children, className }: SettingsSectionProps) {
  return (
    <section className={className}>
      {label ? (
        <h2 className="mb-2 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {label}
        </h2>
      ) : null}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}
