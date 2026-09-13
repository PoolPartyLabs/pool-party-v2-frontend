/** @id PP-CP-CMP-005 @name Cash+ interactive demo controls @implements-rules-version v1 */
"use client";
import { ChevronDown, Play, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatUnits } from "viem";
import { Button } from "@/components/ui/Button";
import type { CashPlusController } from "@/lib/cash-plus/types";

export function CashPlusDemoControls({ controller }: { controller: CashPlusController }) {
  const t = useTranslations("cashPlus");
  const { demo, transaction } = controller;
  if (!demo || controller.snapshot?.mode !== "preview") return null;
  const busy =
    demo.advancing ||
    ["preflight", "review", "approval", "signature", "pending"].includes(transaction.phase);
  return (
    <section
      aria-label={t("demoUI.title")}
      className="rounded-xl border border-primary/20 bg-primary/[0.03] px-4 py-3.5 sm:px-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-muted-foreground text-xs leading-relaxed">
          {t("previewNotice")}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            loading={demo.advancing}
            onClick={() => void demo.advanceDay()}
          >
            <Play className="size-3.5" aria-hidden="true" />
            {t(demo.advancing ? "demoUI.advancing" : "demoUI.advance")}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={demo.reset}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t("demoUI.reset")}
          </Button>
        </div>
      </div>
      <details className="group mt-2.5 text-muted-foreground text-[10px] leading-relaxed">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          {t("demoUI.body")}
          <ChevronDown
            className="size-3 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <p className="mt-2 max-w-3xl">{t("demoUI.assumptions")}</p>
      </details>
      {demo.walletTokens?.some((token) => token.symbol !== "USDC" && token.amount > BigInt(0)) ? (
        <div className="mt-3 border-primary/10 border-t pt-3 text-xs">
          <p className="font-medium">{t("demoUI.walletTokens")}</p>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">
            {demo.walletTokens
              .filter((token) => token.symbol !== "USDC" && token.amount > BigInt(0))
              .map((token) => (
                <li key={token.address}>
                  {formatUnits(token.amount, token.decimals)} {token.symbol}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
