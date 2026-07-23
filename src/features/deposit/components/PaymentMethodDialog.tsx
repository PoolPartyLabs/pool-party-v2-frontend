/**
 * @id PP-DEP-MOD-001
 * @name PaymentMethodDialog
 * @implements-rules-version v1
 *
 * Step 2 of the fiat on-ramp: pick a Paybis payment method (bottom sheet on mobile, centered dialog
 * on desktop). Rows show name + speed/descriptor only — NO fees here (fees are revealed at Review).
 * Pix is the default selection. Continue advances to Review with the chosen method.
 */
"use client";

import { CreditCard, Landmark, type LucideIcon, Smartphone, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils/cn";

/** The supported payment methods. */
export type PaymentMethod = "pix" | "card" | "applePay" | "bank";

/** A selectable method row (radio). */
function MethodRow({
  selected,
  icon: Icon,
  name,
  meta,
  onSelect,
}: {
  selected: boolean;
  icon: LucideIcon;
  name: string;
  meta: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-colors",
        "focus-within:ring-2 focus-within:ring-ring",
        selected ? "border-input bg-surface-raised" : "border-border hover:bg-surface-raised",
      )}
    >
      <input
        type="radio"
        name="payment-method"
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-raised text-foreground"
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-foreground text-sm">{name}</span>
        <span className="block text-muted-foreground text-xs">{meta}</span>
      </span>
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-foreground" : "border-border",
        )}
        aria-hidden="true"
      >
        {selected ? <span className="size-2.5 rounded-full bg-foreground" /> : null}
      </span>
    </label>
  );
}

/** Public props for {@link PaymentMethodDialog}. */
export interface PaymentMethodDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The currently selected method. */
  value: PaymentMethod;
  /** Called when a method is chosen. */
  onSelect: (method: PaymentMethod) => void;
  /** Called when Continue is pressed (advance to Review). */
  onContinue: () => void;
}

/** Payment-method picker dialog. */
export function PaymentMethodDialog({
  open,
  onOpenChange,
  value,
  onSelect,
  onContinue,
}: PaymentMethodDialogProps) {
  const t = useTranslations("deposit");
  // Literal t() calls (not dynamic keys) so the i18n used-key scan resolves every label.
  const methods: { id: PaymentMethod; icon: LucideIcon; name: string; meta: string }[] = [
    { id: "pix", icon: Zap, name: t("method.pix.name"), meta: t("method.pix.meta") },
    { id: "card", icon: CreditCard, name: t("method.card.name"), meta: t("method.card.meta") },
    {
      id: "applePay",
      icon: Smartphone,
      name: t("method.applePay.name"),
      meta: t("method.applePay.meta"),
    },
    { id: "bank", icon: Landmark, name: t("method.bank.name"), meta: t("method.bank.meta") },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("method.title")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {methods.map((method) => (
            <MethodRow
              key={method.id}
              selected={value === method.id}
              icon={method.icon}
              name={method.name}
              meta={method.meta}
              onSelect={() => onSelect(method.id)}
            />
          ))}
        </div>

        <Button className="w-full" size="lg" onClick={onContinue}>
          {t("method.continue")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
