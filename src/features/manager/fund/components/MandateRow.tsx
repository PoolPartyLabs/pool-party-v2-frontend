/**
 * @id PP-MGR-CMP-041
 * @name MandateRow
 * @implements-rules-version v1
 * @analytics-events none, the shell emits
 *
 * POO-2123 [R12] / [R15] / [R17] / [R19] / [R21], epic POO-2119. One row of a Mandate list: a
 * network, a protocol, later a cap. Three shapes, one component, because the five Mandate steps
 * otherwise each grow their own row and the selected-state rule (R12) drifts between them.
 *
 * - **Selectable**: the whole row is the click target, a `checkbox` carrying `aria-checked`. R12:
 *   selected means the raised surface and a softened border, and the primary colour lives on the
 *   20 px box, never as a fill on the row.
 * - **Locked**: a row the manate always contains (the hub network, the two required protocols). It
 *   renders as plain content with a Lock and "Always included", and no control at all, because an
 *   `aria-disabled` checkbox would invite a click that can never do anything.
 * - **Disabled**: listed but not operable yet ("Coming soon"). It keeps `role="checkbox"` and takes
 *   `aria-disabled` rather than the native `disabled` attribute, which is the whole point: a native
 *   disabled button swallows the click, and the click is the only evidence that someone wanted this
 *   network. The caller routes that click to `onBlocked` (CLAUDE.md premise 11, blocked intent).
 *
 * `id` lands on `data-mandate-row` so a `StepBlock.rowId` from `validateStep` can scroll the first
 * offending row into view. The ids are the domain's own (`NetworkId`, `ProtocolId`, `tokenKey`), set
 * by `PP-MGR-LIB-019`; this component never invents a prefixed format.
 */
"use client";

import { Check, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link MandateRow}. */
export interface MandateRowProps {
  /** Stable row id; becomes `data-mandate-row` and must match what a `StepBlock` reports. */
  id: string;
  /** Accessible name of the control. A locked row has no control and carries its title instead. */
  ariaLabel: string;
  /** Already-built leading visual (a network logo, a protocol mark). */
  logo: ReactNode;
  /** Already-translated row title. */
  title: string;
  /** Already-translated supporting line under the title. */
  caption?: string;
  /** Already-built trailing content (the Protocols step's "On" dots, a cap slider). */
  trailing?: ReactNode;
  /** Whether the row is in the mandate. Ignored on a locked row, which always is. */
  selected?: boolean;
  /** Always in the mandate and not removable: Lock + "Always included", no control. */
  locked?: boolean;
  /** Listed but not operable. Stays clickable so the refusal can be reported. */
  disabled?: boolean;
  /** Already-translated status pill text, e.g. "Coming soon". */
  statusLabel?: string;
  /** Called on every click, disabled included. The caller decides whether that is a toggle or a refusal. */
  onToggle?: () => void;
}

/**
 * The 20 px box. Unselected is an outline; selected is the primary fill with its own foreground.
 *
 * Exported because a step's "Select all" is the same box at the head of its group (R16/R20), and a
 * second hand-rolled copy there is how a 20 px box quietly becomes an 18 px one.
 */
export function MandateCheckbox({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors",
        selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
      )}
    >
      {selected ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

/** Title + caption, the one block that is identical in all three shapes. */
function RowText({ title, caption }: { title: string; caption?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col text-left">
      <span className="truncate font-medium text-foreground text-sm">{title}</span>
      {caption ? <span className="truncate text-muted-foreground text-xs">{caption}</span> : null}
    </span>
  );
}

/** One row of a Mandate list: selectable, locked, or listed-but-not-yet-operable. */
export function MandateRow({
  id,
  ariaLabel,
  logo,
  title,
  caption,
  trailing,
  selected = false,
  locked = false,
  disabled = false,
  statusLabel,
  onToggle,
}: MandateRowProps) {
  const t = useTranslations("manager");

  const shell = cn(
    "flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
    // R12: the raised surface with a softened border is the whole selected signal on a row.
    selected || locked ? "border-border/60 bg-surface-raised" : "border-border bg-surface",
  );

  const status = statusLabel ? (
    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
      {statusLabel}
    </span>
  ) : null;

  if (locked) {
    // No control: nothing here can be toggled, so nothing here is focusable.
    return (
      <div data-mandate-row={id} className={shell}>
        {logo}
        <RowText title={title} caption={caption} />
        {trailing}
        {status}
        <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
          <Lock className="size-3.5" aria-hidden="true" />
          {t("fundBuilder.common.alwaysIncluded")}
        </span>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <input type="checkbox"> cannot wrap the row, and the whole row is the click target (R12). A button with role="checkbox" keeps one focus stop, one hit area and a real aria-checked, which is the pattern the repo's other segmented controls already use.
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      data-mandate-row={id}
      onClick={onToggle}
      className={cn(
        shell,
        "text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:border-muted-foreground/40 cursor-pointer",
      )}
    >
      <MandateCheckbox selected={selected} />
      {logo}
      <RowText title={title} caption={caption} />
      {trailing}
      {status}
    </button>
  );
}
