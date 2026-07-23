/**
 * @id PP-PROF-CMP-005
 * @name FaqItem
 * @implements-rules-version v1
 * A single expand/collapse FAQ row (accessible disclosure).
 */
"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils/cn";

/** Public props for {@link FaqItem}. */
export interface FaqItemProps {
  /** The question. */
  question: string;
  /** The answer (shown when expanded). */
  answer: string;
  /**
   * Controlled open state. When provided, the parent owns expansion — this is how {@link HelpScreen}
   * runs a single-open accordion (opening one row collapses the others).
   */
  open?: boolean;
  /** Toggle handler for controlled mode. */
  onToggle?: () => void;
  /** Initial open state in uncontrolled mode (ignored when `open` is provided). */
  defaultOpen?: boolean;
}

/** An expandable FAQ row. Controlled when `open`/`onToggle` are passed; otherwise self-managed. */
export function FaqItem({ question, answer, open, onToggle, defaultOpen = false }: FaqItemProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const expanded = isControlled ? open : internalOpen;
  const toggle = () => {
    if (isControlled) onToggle?.();
    else setInternalOpen((value) => !value);
  };
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="font-medium text-foreground text-sm">{question}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180 text-primary",
          )}
          aria-hidden="true"
        />
      </button>
      {expanded ? <p className="px-4 pb-4 text-muted-foreground text-sm">{answer}</p> : null}
    </div>
  );
}
