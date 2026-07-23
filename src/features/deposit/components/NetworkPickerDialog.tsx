/**
 * @id PP-DEP-MOD-002 (POO-479, POO-728)
 * @name NetworkPickerDialog
 * @implements-rules-version v2
 *
 * Crypto-deposit network picker: the receive step shows the USDC address on the chosen network, and
 * the loss-of-funds warning names that chain. POO-728: the dialog opens with a default network
 * (Arbitrum) pre-selected so Continue is enabled on open; the user can still switch. The disabled
 * guard on Continue is a defensive no-op for the (now unreachable) no-selection state. Bottom sheet
 * on mobile, centered dialog on desktop (mirrors {@link PaymentMethodDialog}).
 */
"use client";

import { useTranslations } from "next-intl";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils/cn";
import { DEPOSIT_NETWORKS, type DepositNetwork } from "../lib/depositNetworks";

/** A selectable network row (radio). */
function NetworkRow({
  selected,
  network,
  onSelect,
}: {
  selected: boolean;
  network: DepositNetwork;
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
        name="deposit-network"
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <NetworkLogo network={network.slug} name={network.name} size={36} className="size-9" />
      <span className="min-w-0 flex-1 font-medium text-foreground text-sm">{network.name}</span>
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

/** Public props for {@link NetworkPickerDialog}. */
export interface NetworkPickerDialogProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The currently selected network, or `null` when none has been chosen yet. */
  value: DepositNetwork | null;
  /** Called when a network is chosen. */
  onSelect: (network: DepositNetwork) => void;
  /** Called when Continue is pressed (advance to the receive step). Enabled on open — a default
   * network is pre-selected (POO-728); the guard only disables if the selection is ever null. */
  onContinue: () => void;
}

/** Crypto-deposit network picker dialog. */
export function NetworkPickerDialog({
  open,
  onOpenChange,
  value,
  onSelect,
  onContinue,
}: NetworkPickerDialogProps) {
  const t = useTranslations("deposit");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("crypto.networkTitle")}</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">{t("crypto.networkSubtitle")}</p>

        <div className="flex flex-col gap-2">
          {DEPOSIT_NETWORKS.map((network) => (
            <NetworkRow
              key={network.slug}
              selected={value?.slug === network.slug}
              network={network}
              onSelect={() => onSelect(network)}
            />
          ))}
        </div>

        <Button className="w-full" size="lg" disabled={value === null} onClick={onContinue}>
          {t("crypto.networkContinue")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
