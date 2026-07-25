/**
 * @id PP-CORE-SCR-010 (POO-1046)
 * @name SwapScreen
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The standalone swap and bridge surface: the first place in the product where a user can move
 * their own money between networks on purpose, rather than as a side effect of investing.
 *
 * ## What it actually is
 *
 * A destination, an amount, and then the shipped {@link ProvisioningPanel}. That is the whole
 * component, and it is the point: the wallet modal has shown USDC split across three chains, with a
 * disabled "coming soon" Swap button, since POO-240 (`WalletModal.tsx`), while the entire rail that
 * could move it landed over this epic behind an operation modal where no one could reach it
 * directly. This screen is the missing entry point, not a new capability.
 *
 * [R3] is therefore structural rather than aspirational: everything after "Continue" is the panel,
 * which owns the funding-source picker, the cost breakdown, the plan card and
 * `buildPlanSteps` / `useProvisioningRail`. There is no second planner call, no second rail and no
 * second execution path here. Anything that lands in the panel later (POO-1047's price-impact gate
 * is the immediate one) reaches this screen with no work, precisely because there is nothing here
 * to also change.
 *
 * [R2] is the same idea from the user's side: they say WHERE and HOW MUCH, and nothing on screen
 * asks them to classify their own transfer. Same-chain swap, cross-chain bridge and
 * swap-then-bridge are all the planner's answer to one question (`buildPlan`, POO-1034), so this
 * component contains no branch on route shape at all.
 *
 * ## Two honest limits, stated where they are visible
 *
 * The destination asset is USDC, and the amount is a TARGET BALANCE on the destination rather than
 * a transfer size. Both fall out of the question the shipped planner answers; the reasoning, and
 * why bending either would have cost more than it bought, is in `../lib/swapRequest.ts`.
 *
 * ## Design
 *
 * There is no Figma for this screen. It is composed from primitives already in the tree (the
 * segmented-control pattern of `GasAmountSelector`, the amount field of the invest flow, the
 * `TransactionStatus` success body) rather than inventing a visual language that design would then
 * have to un-invent. It needs a design pass before launch, which is one of the things the flag is
 * holding.
 *
 * PP-INTEGRATION-POINT: `getProvisioningContextAction` (PP-CORE-LIB-057) is the live, server-side
 * wallet read, reached through the `"use server"` boundary so the Uniswap key stays server-side
 * (ADR 0003). It derives the wallet from the SIWE session; this screen never sends an address.
 */
"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { Button } from "@/components/ui/Button";
import { ProvisioningPanel } from "@/features/strategies/components/ProvisioningPanel";
import { supportedChainMetas } from "@/lib/chains/config";
// Type-only, therefore erased: `gateContext.ts` is `server-only` and this is a client component.
// The value crosses the boundary as data through the action below (ADR 0003).
import type { ProvisioningGateContext } from "@/lib/provisioning/gateContext";
import { getProvisioningContextAction } from "@/lib/provisioning/planActions";
import { isMockMode } from "@/lib/services";
import { cn } from "@/lib/utils/cn";
import { formatUsd } from "@/lib/utils/format";
import { sanitizeNumericInput } from "@/lib/utils/numericInput";
import {
  buildSwapInput,
  parseSwapAmountUsd,
  swapFundingSources,
  usdcAtDestinationUsd,
} from "../lib/swapRequest";

/** Where the user is: choosing, reviewing/executing the plan, or done. */
type Phase = "form" | "plan" | "done";

/** The destination options. From the chain config, never a local literal list (POO-1041 [R3]). */
const DESTINATIONS = supportedChainMetas.map((meta) => ({
  chainId: meta.chain.id,
  name: meta.displayName,
  slug: meta.apiNetworkId,
}));

/** Option pill styling, matching the segmented control in `GasAmountSelector`. */
function pillClass(active: boolean): string {
  return cn(
    "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 font-semibold text-sm transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
  );
}

/** The standalone swap + bridge screen. See the module header. */
export function SwapScreen() {
  const t = useTranslations("swap");
  const amountId = useId();
  const [phase, setPhase] = useState<Phase>("form");
  const [destinationChainId, setDestinationChainId] = useState<number>(
    DESTINATIONS[0]?.chainId ?? 42161,
  );
  const [amountText, setAmountText] = useState("");
  const [context, setContext] = useState<ProvisioningGateContext | null>(null);
  const [contextFailed, setContextFailed] = useState(false);

  const destination = DESTINATIONS.find((entry) => entry.chainId === destinationChainId);
  const destinationName = destination?.name ?? "";
  const amountUsd = parseSwapAmountUsd(amountText);

  // PP-INTEGRATION-POINT: the live wallet read, per destination. Mock mode never reaches it (no
  // session, no key), exactly as `useProvisioningGate` does not; its plan comes from the fixture.
  useEffect(() => {
    if (isMockMode) return;
    let live = true;
    setContext(null);
    setContextFailed(false);
    getProvisioningContextAction(destinationChainId)
      .then((result) => {
        if (!live) return;
        // A typed failure is "we could not read the wallet". Said out loud rather than rendered as
        // an empty wallet: this screen exists to spend money the user has, so claiming they have
        // none because a balance read blipped is the one wrong answer.
        if (result.ok) setContext(result.context);
        else setContextFailed(true);
      })
      .catch(() => {
        if (live) setContextFailed(true);
      });
    return () => {
      live = false;
    };
  }, [destinationChainId]);

  const alreadyThereUsd = usdcAtDestinationUsd(context);
  // The context is re-read per destination, so a response in flight when the choice changes belongs
  // to the old chain. `context.targetChainId` is the read's own subject, and only a match may be
  // spent from; the input's destination is the user's pick either way (`buildSwapInput`).
  const contextForDestination = context?.targetChainId === destinationChainId ? context : null;
  const ready = isMockMode || contextForDestination !== null;

  if (phase === "plan" && amountUsd !== null) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="font-bold text-2xl text-foreground">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">
            {t("plan.subtitle", { amount: formatUsd(amountUsd), network: destinationName })}
          </p>
        </header>
        <ProvisioningPanel
          input={buildSwapInput({
            context: contextForDestination,
            destinationChainId,
            amountUsd,
          })}
          // [R2] The destination's own USDC is not something to move to the destination.
          context={
            contextForDestination
              ? { ...contextForDestination, sources: swapFundingSources(contextForDestination) }
              : null
          }
          opLabel={t("opLabel", { amount: formatUsd(amountUsd), network: destinationName })}
          onDone={() => setPhase("done")}
          onCancel={() => setPhase("form")}
        />
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 py-10 text-center">
        <h1 className="font-bold text-2xl text-foreground">
          {t("done.title", { network: destinationName })}
        </h1>
        <p className="text-muted-foreground text-sm">{t("done.body")}</p>
        <Button
          className="w-full"
          size="lg"
          onClick={() => {
            setAmountText("");
            setPhase("form");
          }}
        >
          {t("done.cta")}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-bold text-2xl text-foreground">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-muted-foreground text-xs tracking-wide">
          {t("destination.label")}
        </h2>
        {/* biome-ignore lint/a11y/useSemanticElements: a labelled group of related toggle buttons (a segmented control) is the correct ARIA pattern here, and it matches the shipped GasAmountSelector; no native element fits. */}
        <div role="group" aria-label={t("destination.label")} className="grid grid-cols-3 gap-2">
          {DESTINATIONS.map((entry) => (
            <button
              key={entry.chainId}
              type="button"
              aria-pressed={entry.chainId === destinationChainId}
              onClick={() => setDestinationChainId(entry.chainId)}
              className={pillClass(entry.chainId === destinationChainId)}
            >
              <NetworkLogo network={entry.slug} name={entry.name} size={18} />
              {entry.name}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <label htmlFor={amountId} className="font-medium text-foreground text-sm">
          {t("amount.label", { network: destinationName })}
        </label>
        <div className="flex items-center gap-1 rounded-xl border border-border bg-surface-raised px-3 py-3 focus-within:border-primary">
          <span className="font-semibold text-muted-foreground">$</span>
          <input
            id={amountId}
            type="text"
            inputMode="decimal"
            value={amountText}
            // The app's single numeric-input helper, not a local regex: cents-bounded, one
            // separator, everything else stripped (number-formatting skill §5). `maxDecimals: 2`
            // matches what `parseSwapAmountUsd` rounds to, so the field cannot hold precision the
            // approved figure will not carry. The placeholder is a bare "0" for the same reason
            // AmountField and DepositScreen use one: the field is canonically dot-separated, and a
            // localized "0,00" would invite a comma the sanitizer reads as grouping, turning
            // "12,34" into 1234.
            onChange={(event) =>
              setAmountText(sanitizeNumericInput(event.target.value, { maxDecimals: 2 }))
            }
            placeholder="0"
            className="w-full bg-transparent font-semibold text-foreground text-lg outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        {/* Why a target balance moves less than it says: what is already there is not moved twice. */}
        {contextForDestination ? (
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {t("amount.available", {
              amount: formatUsd(alreadyThereUsd),
              network: destinationName,
            })}
          </p>
        ) : null}
        {contextFailed ? (
          <p role="alert" className="text-destructive text-xs">
            {t("walletUnavailable")}
          </p>
        ) : null}
      </section>

      <Button
        className="w-full"
        size="lg"
        disabled={amountUsd === null || !ready}
        onClick={() => setPhase("plan")}
      >
        {t("continue")}
        <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
      </Button>

      {/* The route is Uniswap's answer, not a choice the user has to make. Saying so beats leaving
          them to wonder which of "swap" and "bridge" they were supposed to have picked. */}
      <p className="text-center text-muted-foreground text-xs">
        {t("routingNote", { network: destinationName })}
      </p>
    </div>
  );
}
