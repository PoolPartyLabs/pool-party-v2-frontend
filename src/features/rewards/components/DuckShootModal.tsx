/**
 * @id PP-REW-MOD-001
 * @name DuckShootModal
 * @implements-rules-version v1
 *
 * The Duck Shoot mini-game (POO-187/POO-210): a carnival shooting game launched
 * from Rubber Rush that grants a boost on today's Quacks. Tries are earned by
 * protocol transactions. This is a thin Dialog shell around {@link DuckGame}
 * (ported from the reference); the play itself goes through usePlayDuckShoot
 * (mock or real). The entry button lives in RubberRushActions.
 */
"use client";

import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import type { RubberRush } from "@/lib/schemas";
import { DuckGame } from "./DuckGame";

/** Public props for {@link DuckShootModal}. */
export interface DuckShootModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Open-state change handler. */
  onOpenChange: (open: boolean) => void;
  /** The Rubber Rush dashboard data (Duck Shoot state). */
  data: RubberRush;
  /** POO-764 R4: refetch the dashboard after a successful play so balance + tries update. */
  onPlayed?: () => void;
}

/** The Duck Shoot mini-game modal. */
export function DuckShootModal({ open, onOpenChange, data, onPlayed }: DuckShootModalProps) {
  const t = useTranslations("rewards");
  const { duckShoot } = data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden border-0 p-0" aria-describedby={undefined}>
        <DialogHeader className="sr-only">
          <DialogTitle>{t("rubberRush.duckShoot.title")}</DialogTitle>
        </DialogHeader>
        {/* POO-764 R5: the no-tries copy uses the REAL weekly-tries-left, not the constant cap. */}
        <DuckGame
          triesRemaining={duckShoot.triesLeft}
          weeklyTriesLeft={duckShoot.weeklyTriesLeft}
          onPlayed={onPlayed}
        />
      </DialogContent>
    </Dialog>
  );
}
