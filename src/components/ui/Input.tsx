"use client";

/**
 * @id PP-CORE-CMP-011
 * @name Input
 * @implements-rules-version v2 (POO-848 rules v1)
 * Text input primitive with default/error variants and sm/md/lg sizes; supports controlled and
 * uncontrolled usage and forwards native input props. Optional `label`, `description`, and `error`
 * props wire an accessible label/id/aria-describedby contract.
 * POO-848 R2: sm/md render 16px below the `sm` breakpoint (iOS Safari zooms on focused inputs with
 * a computed font-size under 16px); the original density returns from `sm:` up.
 */
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils/cn";

const inputVariants = cva(
  cn(
    "flex w-full rounded-md border border-border bg-surface text-foreground",
    "placeholder:text-muted-foreground transition-colors outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ),
  {
    variants: {
      variant: {
        default: "",
        error: "border-destructive",
      },
      size: {
        // POO-848 R2: 16px below the sm breakpoint (iOS zooms on focused inputs under 16px);
        // the original density returns on desktop.
        sm: "h-8 px-2.5 text-base sm:text-xs",
        md: "h-10 px-3 text-base sm:text-sm",
        lg: "h-12 px-4 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  /** Visual variant; `error` (or a non-empty `error` message) adds a destructive border and `aria-invalid`. */
  variant?: "default" | "error";
  /** Control height and typography. */
  size?: "sm" | "md" | "lg";
  /** Optional visible label, associated with the input via `htmlFor`/`id`. */
  label?: string;
  /** Optional hint shown below the input and linked via `aria-describedby`. */
  description?: string;
  /** Optional error message; forces the error variant, sets `aria-invalid`, and is linked via `aria-describedby`. */
  error?: string;
  /** Extra classes merged after the variant defaults so consumers can override. */
  className?: string;
}

/**
 * Input
 *
 * @param variant - `default` or `error` (error => destructive border + `aria-invalid="true"`).
 * @param size - `sm` | `md` | `lg`, controls height and font size (defaults to `md`).
 * @param label - optional visible label tied to the input for assistive tech.
 * @param description - optional hint text announced via `aria-describedby`.
 * @param error - optional error text; announced via `aria-describedby` and forces the error state.
 * @param className - Additional classes merged via `cn`.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      variant,
      size = "md",
      type = "text",
      id,
      label,
      description,
      error,
      "aria-invalid": ariaInvalid,
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const isError = error != null || variant === "error";
    const resolvedVariant = isError ? "error" : (variant ?? "default");

    const descriptionId = description ? `${inputId}-description` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy =
      [ariaDescribedBy, descriptionId, errorId].filter(Boolean).join(" ") || undefined;

    const inputEl = (
      <input
        ref={ref}
        id={inputId}
        type={type}
        aria-invalid={ariaInvalid ?? (isError ? true : undefined)}
        aria-describedby={describedBy}
        className={cn(inputVariants({ variant: resolvedVariant, size }), className)}
        {...props}
      />
    );

    // Keep the bare input when there is nothing to label or describe, so existing usage and DOM
    // shape are unchanged.
    if (!label && !description && !error) {
      return inputEl;
    }

    return (
      <div className="flex flex-col gap-1.5">
        {label ? (
          <label htmlFor={inputId} className="font-medium text-foreground text-sm">
            {label}
          </label>
        ) : null}
        {inputEl}
        {description ? (
          <p id={descriptionId} className="text-muted-foreground text-xs">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="text-destructive text-xs">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);

Input.displayName = "Input";
