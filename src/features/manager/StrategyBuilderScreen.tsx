/**
 * @id PP-MGR-SCR-002
 * @name StrategyBuilderScreen
 *
 * V1 strategy builder wizard: Mandate → Build (n8n canvas, POO-278 [R4]) → Review, on a single
 * Uniswap v3 pool ([R3]). Reached from the "Create your first strategy" CTA on the onboarding and
 * the console. The Mandate selection is held here (lifted from the step) so it persists across
 * steps; the Mandate only picks the pool — the range is set on the Build step's pool node
 * (risk/category re-derive there); the Review step then sets the strategy identity (name / logo /
 * description) + fees + access and launches (auto-verification → listed) or saves a draft.
 * Review's onBack hands the selection back with its identity edits merged so they persist.
 * Mandate/Review read as a centered form (max-w-3xl); Build widens to the AppShell content cap so
 * the canvas is a real workspace.
 *
 * POO-861 (rules v1): the selected pool's price is kept fresh on Build / Review via useLivePoolPrice
 * (real mode only) and folded back into the mandate's pool, so the display, range status and the
 * Review seed-side track the live on-chain price instead of the frozen selection price; the price is
 * also revalidated on the Build->Review transition (refresh()).
 */
"use client";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import type { MediaUploadFn } from "@/lib/media/useUploadMedia";
import type { FeePolicy, UniswapPool } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";
import { type BuilderStep, BuilderStepper } from "./components/BuilderStepper";
import { BuildStep } from "./components/BuildStep";
import { type MandateResult, type MandateSelection, MandateStep } from "./components/MandateStep";
import { ReviewStep } from "./components/ReviewStep";
import { useLivePoolPrice } from "./hooks/useLivePoolPrice";
import { deriveMandate } from "./lib/deriveMandate";

/**
 * Re-resolves a {@link MandateResult} after the Build step edits the range: recomputes the range
 * half-width and re-derives risk/category (the pool itself is fixed after Mandate).
 */
function reresolveMandate(prev: MandateResult, selection: MandateSelection): MandateResult {
  const { pool } = prev;
  let widthPct: number | null = null;
  if (!selection.full) {
    const lo = Number.parseFloat(selection.minPrice);
    const hi = Number.parseFloat(selection.maxPrice);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      widthPct = ((hi - lo) / 2 / pool.currentPrice) * 100;
    }
  }
  return {
    selection,
    pool,
    derived: deriveMandate(pool, selection.full ? null : widthPct),
    rangeWidthPct: selection.full ? null : widthPct,
  };
}

/** Public props for {@link StrategyBuilderScreen}. */
export interface StrategyBuilderScreenProps {
  /** The Uniswap v3 pool catalog for the Mandate step's pool picker. */
  pools: UniswapPool[];
  /** Pool Party's AUM-tiered cut, shown read-only on the Review step. */
  feePolicy: FeePolicy;
  /**
   * Real-mode only (POO-701 [R3]): uploads the cropped strategy logo (a manager-scoped PRE-ID mint)
   * and resolves its trusted https URL, threaded to the Review step's crop-apply. Omitted in mock mode,
   * where the crop stays a session-local preview (injected by {@link StrategyBuilderDataLoader}).
   */
  onUploadLogo?: MediaUploadFn;
}

/** Wizard step order, for back-only stepper navigation. */
const STEP_ORDER: BuilderStep[] = ["mandate", "build", "review"];

/** Strategy builder wizard shell. */
export function StrategyBuilderScreen({
  pools,
  feePolicy,
  onUploadLogo,
}: StrategyBuilderScreenProps) {
  const t = useTranslations("manager");
  const [step, setStep] = useState<BuilderStep>("mandate");
  const [mandate, setMandate] = useState<MandateResult | null>(null);

  // POO-861 R1/R2/R3: keep the selected pool's price fresh while the manager is on Build / Review.
  // The frozen selection price would otherwise decide the seed-side (which token(s) to deposit) against
  // a stale value while the on-chain mint reads a fresh one, so a single-sided create could revert when
  // the price crossed into the range. Polling the SAME on-chain source the mint uses (getPoolCurrentPrice
  // → fetchDexPoolState) and folding it back into the pool keeps the display, range status, token split
  // and seed-side honest. Mock-safe: the hook no-ops in mock mode (echoes the seed), so this is inert there.
  const livePool = useLivePoolPrice({
    network: mandate?.pool.network,
    currency0: mandate?.pool.token0Address,
    currency1: mandate?.pool.token1Address,
    feeTier: mandate?.pool.feeTier ?? (mandate ? mandate.pool.feeBps * 100 : undefined),
    initialPrice: mandate?.pool.currentPrice,
    active: step === "build" || step === "review",
  });
  // Fold the live price back into the mandate's pool so every downstream consumer (BuildStep display +
  // status, ReviewStep's SeedLiquidityCard seed-side) reads the fresh value. Guarded to a real change so
  // it can't loop; identity edits and the seeded price are untouched otherwise.
  const livePrice = livePool.price;
  useEffect(() => {
    if (livePrice == null) return;
    setMandate((prev) =>
      prev && prev.pool.currentPrice !== livePrice
        ? { ...prev, pool: { ...prev.pool, currentPrice: livePrice } }
        : prev,
    );
  }, [livePrice]);

  // Every step transition starts at the top of the page — the steps are tall, so advancing
  // otherwise dropped the user mid-scroll. Instant (no smooth animation), per the 2026-06-26 rule.
  // biome-ignore lint/correctness/useExhaustiveDependencies: step is an intentional trigger — the effect re-runs on each step change though the body doesn't read it.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  // The stepper navigates BACK only — to an already-completed step. Forward jumps stay gated
  // behind each step's own Next so its validation/derivation runs.
  const goToStep = useCallback((target: BuilderStep) => {
    setStep((current) =>
      STEP_ORDER.indexOf(target) < STEP_ORDER.indexOf(current) ? target : current,
    );
  }, []);

  // Mirror Review's identity edits (name / logo / description) up to the shell so stepping back
  // via the stepper — not just Review's own Back button — keeps them. Stable so Review's sync
  // effect only fires on actual identity changes (no render loop).
  const handleIdentityChange = useCallback(
    (identity: Pick<MandateSelection, "name" | "description" | "logoUrl">) => {
      setMandate((prev) =>
        prev ? { ...prev, selection: { ...prev.selection, ...identity } } : prev,
      );
    },
    [],
  );

  return (
    <section className={cn("mx-auto flex w-full flex-col gap-6", step !== "build" && "max-w-3xl")}>
      <div className="flex flex-col gap-2">
        <Link
          href="/manager"
          className="inline-flex items-center gap-1 self-start text-muted-foreground text-sm hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("builder.back")}
        </Link>
        <h1 className="font-semibold text-2xl text-foreground">{t("builder.title")}</h1>
      </div>

      <BuilderStepper active={step} onStepClick={goToStep} />

      {step === "mandate" ? (
        <MandateStep
          pools={pools}
          initial={mandate?.selection}
          onNext={(result) => {
            setMandate(result);
            setStep("build");
          }}
        />
      ) : step === "build" && mandate ? (
        <BuildStep
          mandate={mandate}
          onBack={() => setStep("mandate")}
          onNext={(selection) => {
            // POO-861 R1: revalidate the pool price on the Build->Review transition, so the seed-side
            // the Review commits to is decided against the freshest on-chain price (the fold-back effect
            // applies the result when it lands).
            livePool.refresh();
            setMandate((prev) => (prev ? reresolveMandate(prev, selection) : prev));
            setStep("review");
          }}
        />
      ) : mandate ? (
        <ReviewStep
          mandate={mandate}
          feePolicy={feePolicy}
          onIdentityChange={handleIdentityChange}
          onUploadLogo={onUploadLogo}
          onBack={(selection) => {
            setMandate((prev) => (prev ? { ...prev, selection } : prev));
            setStep("build");
          }}
        />
      ) : null}
    </section>
  );
}
