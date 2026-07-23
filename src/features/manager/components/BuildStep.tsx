/**
 * @id PP-MGR-CMP-019
 * @name BuildStep
 * @implements-rules-version v5 (POO-900 rules v1)
 *
 * POO-877 (rules v1, R1-R3): the ± range steppers move the underlying TICK, not the display string.
 * A nudge resolves the bound's nearest usable tick, steps it by exactly one spacing and re-derives the
 * price (stepPriceForPool → POO-877 fix), so on tickSpacing-1 pools (USDC/USDT 0.01%) `+` always yields
 * a strictly higher price and `-` a strictly lower one — the old display-string round-trip locked (a
 * fixed point) or skipped ticks. Typed prices keep the POO-319 floor snap on blur (R2).
 *
 * POO-881 (rules v1, R5/R6): input-level max>min enforcement on top of the POO-860 CTA gate (R7). On
 * blur (snapBound) and on every ± step (nudge) the edited bound is clamped (clampRangeBound) so it can
 * never invert or over-narrow the range — it pins the bound at least the 2-tick minimum off the
 * opposite one. The CTA gate + inline error stay as the backstop for the transient (typed, un-blurred)
 * state.
 *
 * POO-900 (rules v1, R1/R2/R5-R7): at exactly 2 tick-spacings the NARROWING steppers (displayed-min
 * "+", displayed-max "−") are disabled (`atMinWidth`, plain disabled buttons - the inline rangeError
 * copy already explains the 2-tick minimum, R10); widening is never disabled (R5) and orientation
 * needs no special-casing (R6). A typed violating value snaps on blur to the exactly-2-spacings
 * boundary (R2, via the POO-900 clampRangeBound pin). The clamp inside `nudge` stays as an idempotent
 * safety net; narrowing is monotonic - no 3-tick sawtooth at the boundary (R7).
 *
 * POO-860 R1/R2: the range editor validates the chosen band up front. A non-full range must have
 * max > min AND span at least MIN_RANGE_SPACINGS usable ticks (isRangeWideEnough); otherwise an
 * inline error shows and both "Apply changes" and "Next" are disabled, so an inverted / equal /
 * too-tight range never reaches Review (where it was only silently gated before).
 *
 * POO-861 R4: a non-blocking warning (real mode) when the draft range is single-sided and sits within
 * a few usable ticks of the LIVE current price (pool.currentPrice is kept fresh by useLivePoolPrice in
 * the wizard shell), since a small move would then require both seed tokens. Warn-only, never blocks.
 *
 * Step 2 of the V1 strategy builder (POO-278 [R4]): the n8n-style assembly canvas. Three panels —
 * a palette (from the mandate: Uniswap v3, plus the fixed building blocks), the canvas (the V1
 * flow Deposit → Swap → Provide LP → Collect fees as connected, click-to-select nodes) and the
 * selected node's config. The wizard widens to the full content width here so the canvas is a real
 * workspace. Only the pool node is configurable, and its panel is THE place the range is set (the
 * Mandate step only picks the pool): presets / manual min-max nudged by tick steppers, the LIVE
 * in/out-of-range status ([R6]) and the live-rederived risk + category card, plus fee tier (fixed
 * by the chosen pool), allocation (locked at 100% — one pool per strategy in V1, [R3]) and auto-move
 * range (post-V1, locked). "Apply changes" commits the edited range to the canvas; "Next" hands the
 * updated selection back to the wizard, which re-derives risk/category before Review. POO-525 R3:
 * the locked max-slippage input was removed — the Review gear is the single slippage control.
 *
 * PP-NOTE: V1 is click-to-select with a fixed flow — real drag-and-drop assembly is post-V1.
 *
 * POO-501 R8: the composition TokenSplitBar resolves token logos by SYMBOL (resolveTokenLogo), so
 * majors render in mock mode (the mock pool's synthetic addresses don't resolve via findToken).
 */
"use client";

import {
  ArrowLeft,
  ArrowLeftRight,
  Coins,
  Download,
  GripVertical,
  Layers,
  Lock,
  Minus,
  Plus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ProtocolBadge } from "@/components/data-display/ProtocolBadge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useFeatureFlags } from "@/lib/features/useFeatureFlags";
import { MIN_RANGE_SPACINGS } from "@/lib/manager/tickPrice";
import { isMockMode } from "@/lib/services";
import { resolveTokenLogo } from "@/lib/tokens/tokenLogo";
import { cn } from "@/lib/utils/cn";
import { sanitizeNumericInput } from "@/lib/utils/numericInput";
import { getRangeStatus } from "@/lib/utils/rangeStatus";
import { deriveBuilderStrategyTagsForPool } from "../lib/deriveBuilderStrategyTags";
import { deriveMandate } from "../lib/deriveMandate";
import { invert, toCanonicalBounds, toDisplayBounds } from "../lib/invertPrice";
import {
  clampRangeBound,
  isRangeWideEnough,
  isSingleSidedNearPrice,
  type PoolTickGrid,
  rangeSpacingsForPool,
  snapPriceForPool,
  stepPriceForPool,
} from "../lib/poolTickSnap";
import { RANGE_PRESETS } from "../lib/presets";
import { fmtPrice, roundPrice } from "../lib/priceFormat";
import { tokenSplit } from "../lib/rangeMath";
import { DerivedMandateCard } from "./DerivedMandateCard";
import type { MandateResult, MandateSelection } from "./MandateStep";
import { RangeBar } from "./RangeBar";
import { RangeStatusLine } from "./RangeStatusLine";
import { TokenSplitBar } from "./TokenSplitBar";

/** The canvas nodes of the fixed V1 flow. */
type NodeKey = "deposit" | "swap" | "pool" | "collect";

/** The editable slice of the range held by this step. */
interface RangeDraft {
  full: boolean;
  activePreset: number | "full" | null;
  minPrice: string;
  maxPrice: string;
}

function feeLabel(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
/**
 * The displayed ±`pct` band around `dispCurrent`, converted to canonical, snapped onto the pool's
 * usable-tick grid and shown back in display space. Shared by the preset chips and the
 * degenerate-seed recompute so both round the bounds through the same magnitude-aware path
 * (POO-278; POO-770 hardening).
 */
function presetBounds(
  pct: number,
  dispCurrent: number,
  inverted: boolean,
  grid: PoolTickGrid,
): { minPrice: string; maxPrice: string } {
  const canon = toCanonicalBounds(
    dispCurrent * (1 - pct / 100),
    dispCurrent * (1 + pct / 100),
    inverted,
  );
  const lo = snapPriceForPool(canon.min, grid);
  const hi = snapPriceForPool(canon.max, grid);
  const disp = toDisplayBounds(lo, hi, inverted);
  return {
    minPrice: roundPrice(disp.min, dispCurrent),
    maxPrice: roundPrice(disp.max, dispCurrent),
  };
}
function toRange(draft: RangeDraft, inverted: boolean) {
  const dispMin = Number.parseFloat(draft.minPrice) || null;
  const dispMax = Number.parseFloat(draft.maxPrice) || null;
  if (!inverted) return { full: draft.full, minPrice: dispMin, maxPrice: dispMax };
  // Inverted view: the displayed bounds are reciprocated AND swapped to get the canonical pair that
  // the status / split / DTO consume (a null bound stays null on the opposite side).
  return {
    full: draft.full,
    minPrice: dispMax === null ? null : invert(dispMax),
    maxPrice: dispMin === null ? null : invert(dispMin),
  };
}

/** Public props for {@link BuildStep}. */
export interface BuildStepProps {
  /** The resolved mandate from step 1 (pool + selection). */
  mandate: MandateResult;
  /** Step back to the Mandate step. */
  onBack: () => void;
  /** Advance to Review with the (possibly re-ranged) selection. */
  onNext: (selection: MandateSelection) => void;
}

/** Strategy builder — Build (n8n canvas): palette, flow canvas, node config. */
export function BuildStep({ mandate, onBack, onNext }: BuildStepProps) {
  const t = useTranslations("manager");
  // The shared "Coming soon" label lives under profile.security (same reuse as ReviewStep).
  const tProfile = useTranslations("profile");
  // POO-830 R5/R8: the derived asset + objective preview is dark-launched behind the same
  // strategyCategoryFilter flag as the investor filter — off = the card renders as before.
  const { isEnabled } = useFeatureFlags();
  const categoryTagsEnabled = isEnabled("strategyCategoryFilter");
  const { pool, selection } = mandate;
  // Pool grid for the usable-tick snap: exact (on-chain tick) when token decimals are known, the
  // current-price-anchored grid otherwise (POO-408).
  const grid = {
    currentPrice: pool.currentPrice,
    feeBps: pool.feeBps,
    decimals0: pool.decimals0,
    decimals1: pool.decimals1,
  };

  const [selected, setSelected] = useState<NodeKey>("pool");
  // Reopen in the orientation the manager last used (e.g. after Back from Review): the selection
  // carries CANONICAL bounds plus a display-only `displayInverted` flag (set on Next), so when it's
  // set we re-express the canonical bounds back into the inverted display orientation for the draft.
  const startInverted = selection.displayInverted === true && !selection.full;
  // The pre-set bounds arrive already snapped (MandateStep.selectPool seeds the default on the grid;
  // Back-from-Review carries the snapped canonical bounds) — POO-408 R3. The inverted branch only
  // re-expresses them into the display orientation.
  const initialRange: RangeDraft = startInverted
    ? (() => {
        const canonMin = Number.parseFloat(selection.minPrice);
        const canonMax = Number.parseFloat(selection.maxPrice);
        const disp = toDisplayBounds(
          Number.isFinite(canonMin) ? canonMin : Number.NaN,
          Number.isFinite(canonMax) ? canonMax : Number.NaN,
          true,
        );
        const refDisp = invert(pool.currentPrice);
        return {
          full: false,
          activePreset: selection.activePreset,
          minPrice: Number.isFinite(disp.min) ? roundPrice(disp.min, refDisp) : selection.minPrice,
          maxPrice: Number.isFinite(disp.max) ? roundPrice(disp.max, refDisp) : selection.maxPrice,
        };
      })()
    : (() => {
        // Trust the seeded canonical bounds, EXCEPT when they arrive degenerate — a low-price pool
        // whose ±% seed rounded down to 0 or collapsed to a single point (POO-770). Then recompute
        // from the active preset so Build never opens on an invalid range (which would flow straight
        // to Review). Only a numeric preset can be recomputed; a manual/full seed passes through.
        const seeded: RangeDraft = {
          full: selection.full,
          activePreset: selection.activePreset,
          minPrice: selection.minPrice,
          maxPrice: selection.maxPrice,
        };
        if (seeded.full || typeof selection.activePreset !== "number") return seeded;
        const lo = Number.parseFloat(seeded.minPrice);
        const hi = Number.parseFloat(seeded.maxPrice);
        if (lo > 0 && hi > lo) return seeded;
        return {
          full: false,
          activePreset: selection.activePreset,
          ...presetBounds(selection.activePreset, pool.currentPrice, false, grid),
        };
      })();
  // `applied` is what the canvas (and Next) use; `draft` is what the config panel edits. Both hold the
  // range as DISPLAYED text (so decimal entry is lossless); canonical is derived at the edges below.
  const [applied, setApplied] = useState<RangeDraft>(initialRange);
  const [draft, setDraft] = useState<RangeDraft>(initialRange);
  // Price-orientation toggle: the on-chain pool is canonical token1/token0, but the manager can flip
  // the editor to read/set the range the other way (e.g. USDC-per-ETH). View-only — applied/Next stay
  // canonical (see committedRange) and carry `displayInverted` so Review echoes the same orientation.
  const [inverted, setInverted] = useState(startInverted);
  const dispCurrent = inverted ? invert(pool.currentPrice) : pool.currentPrice;

  const appliedStatus = getRangeStatus(pool.currentPrice, toRange(applied, inverted));
  const draftStatus = getRangeStatus(pool.currentPrice, toRange(draft, inverted));
  const dirty =
    draft.full !== applied.full ||
    draft.minPrice !== applied.minPrice ||
    draft.maxPrice !== applied.maxPrice;
  const comingSoon = tProfile("security.comingSoon");

  function applyPreset(pct: number) {
    // ±pct is taken around the DISPLAYED price (what the manager reads), converted to canonical and
    // snapped onto the pool's usable-tick grid (POO-278), then shown back in display space.
    setDraft({ full: false, activePreset: pct, ...presetBounds(pct, dispCurrent, inverted, grid) });
  }
  /**
   * Nudge a manual draft bound by exactly one usable tick (switches off presets/full). The tick grid
   * lives in canonical space, so we step the canonical bound the displayed one maps to — and when
   * inverted, raising the displayed value LOWERS the canonical one (the reciprocal is decreasing), so
   * the canonical bound and the step direction both flip.
   */
  function nudge(which: "min" | "max", dir: 1 | -1) {
    setDraft((prev) => {
      const dispMin = Number.parseFloat(prev.minPrice);
      const dispMax = Number.parseFloat(prev.maxPrice);
      const canon = toCanonicalBounds(
        Number.isFinite(dispMin) ? dispMin : Number.NaN,
        Number.isFinite(dispMax) ? dispMax : Number.NaN,
        inverted,
      );
      const canonWhich: "min" | "max" = inverted ? (which === "min" ? "max" : "min") : which;
      const canonDir = (inverted ? -dir : dir) as 1 | -1;
      const base = canonWhich === "min" ? canon.min : canon.max;
      const from = Number.isFinite(base) && base > 0 ? base : pool.currentPrice;
      const stepped = stepPriceForPool(from, grid, canonDir);
      // POO-881 R6: hard-stop — a step can never invert or over-narrow the range. Clamp the stepped
      // bound to stay at least the 2-tick minimum off the (unchanged) opposite bound.
      const opposite = canonWhich === "min" ? canon.max : canon.min;
      const nextCanon = { min: canon.min, max: canon.max };
      nextCanon[canonWhich] =
        Number.isFinite(opposite) && opposite > 0
          ? clampRangeBound(stepped, opposite, canonWhich, grid)
          : stepped;
      const disp = toDisplayBounds(nextCanon.min, nextCanon.max, inverted);
      return {
        ...prev,
        full: false,
        activePreset: null,
        [which === "min" ? "minPrice" : "maxPrice"]: roundPrice(
          which === "min" ? disp.min : disp.max,
          dispCurrent,
        ),
      };
    });
  }
  /** Snap a manually-typed bound onto the pool's usable-tick grid (called on blur — only exact ticks).
   *  Snapping is in canonical space (the displayed bound re-derives), so behavior is unchanged when
   *  not inverted. */
  function snapBound(which: "min" | "max") {
    setDraft((prev) => {
      const dispMin = Number.parseFloat(prev.minPrice);
      const dispMax = Number.parseFloat(prev.maxPrice);
      const rawDisp = which === "min" ? dispMin : dispMax;
      if (!Number.isFinite(rawDisp) || rawDisp <= 0) return prev;
      const canon = toCanonicalBounds(
        Number.isFinite(dispMin) ? dispMin : Number.NaN,
        Number.isFinite(dispMax) ? dispMax : Number.NaN,
        inverted,
      );
      const canonWhich: "min" | "max" = inverted ? (which === "min" ? "max" : "min") : which;
      const target = canonWhich === "min" ? canon.min : canon.max;
      if (!Number.isFinite(target) || target <= 0) return prev;
      const snapped = snapPriceForPool(target, grid);
      // POO-881 R5: snap the blurred field back to the nearest VALID bound — clamp so min can't exceed
      // max (and max can't fall below min), keeping the 2-tick minimum against the opposite bound.
      const opposite = canonWhich === "min" ? canon.max : canon.min;
      const nextCanon = { min: canon.min, max: canon.max };
      nextCanon[canonWhich] =
        Number.isFinite(opposite) && opposite > 0
          ? clampRangeBound(snapped, opposite, canonWhich, grid)
          : snapped;
      const disp = toDisplayBounds(nextCanon.min, nextCanon.max, inverted);
      return {
        ...prev,
        [which === "min" ? "minPrice" : "maxPrice"]: roundPrice(
          which === "min" ? disp.min : disp.max,
          dispCurrent,
        ),
      };
    });
  }
  /**
   * Flip the displayed price orientation (canonical ⇄ reciprocal), re-expressing BOTH the draft and
   * the applied bands in the new orientation so they keep representing the same canonical range (which
   * keeps the dirty check, the canvas and Next consistent).
   */
  function toggleInverted() {
    const next = !inverted;
    const refDisp = next ? invert(pool.currentPrice) : pool.currentPrice;
    const reExpress = (d: RangeDraft): RangeDraft => {
      if (d.full) return d;
      const dispMin = Number.parseFloat(d.minPrice);
      const dispMax = Number.parseFloat(d.maxPrice);
      const canon = toCanonicalBounds(
        Number.isFinite(dispMin) ? dispMin : Number.NaN,
        Number.isFinite(dispMax) ? dispMax : Number.NaN,
        inverted,
      );
      const disp = toDisplayBounds(canon.min, canon.max, next);
      return {
        full: false,
        activePreset: null,
        minPrice: Number.isFinite(disp.min) ? roundPrice(disp.min, refDisp) : d.minPrice,
        maxPrice: Number.isFinite(disp.max) ? roundPrice(disp.max, refDisp) : d.maxPrice,
      };
    };
    setDraft(reExpress);
    setApplied(reExpress);
    setInverted(next);
  }
  /** The applied range in CANONICAL space for Next / the create-pool DTO — converts back from the
   *  displayed orientation when inverted; otherwise the applied strings pass through untouched.
   *  PP-NOTE: the inverted path hands up `invert(rounded-display-bound)`, i.e. one extra rounding on
   *  top of the displayed string. That sub-tick drift is harmless: `createPoolTicks` floor-snaps both
   *  bounds onto the fee tier's usable-tick grid downstream, so the resolved ticks are identical to
   *  the canonical-entry path (the round-trip test asserts 2745/3355 recover to integer precision). */
  function committedRange(): { minPrice: string; maxPrice: string } {
    if (applied.full || !inverted) {
      return { minPrice: applied.minPrice, maxPrice: applied.maxPrice };
    }
    const dispMin = Number.parseFloat(applied.minPrice);
    const dispMax = Number.parseFloat(applied.maxPrice);
    const canon = toCanonicalBounds(
      Number.isFinite(dispMin) ? dispMin : Number.NaN,
      Number.isFinite(dispMax) ? dispMax : Number.NaN,
      true,
    );
    return {
      minPrice: Number.isFinite(canon.min) ? roundPrice(canon.min, canon.min) : applied.minPrice,
      maxPrice: Number.isFinite(canon.max) ? roundPrice(canon.max, canon.max) : applied.maxPrice,
    };
  }

  // Live re-derivation: risk + category respond to the range draft as the manager edits it (the
  // derived card moved here from the Mandate step — it belongs where the range is set). canonDraft
  // converts the displayed bounds back to canonical (identity when not inverted).
  const canonDraft = toRange(draft, inverted);
  // POO-860 R1/R2: the draft range is valid when full, or when both bounds resolve and span at least
  // MIN_RANGE_SPACINGS usable ticks on the pool's grid (rejects max<=min and too-tight ranges). This
  // gates Apply/Next and drives the inline error, matching the create-pool tick backstop downstream.
  const draftRangeValid =
    draft.full ||
    (canonDraft.minPrice !== null &&
      canonDraft.maxPrice !== null &&
      isRangeWideEnough(canonDraft.minPrice, canonDraft.maxPrice, grid));
  // POO-900 R1: once the draft band sits at (or, mid-edit, below) the 2-spacing minimum, the steppers
  // that would narrow it further - displayed-min "+" and displayed-max "−" - are disabled. Measured on
  // the canonical draft bounds, so it is orientation-independent (R6: inversion flips the mapped side
  // AND the step direction, so the displayed narrowing pair is the same). The clamp inside `nudge`
  // stays as an idempotent safety net; widening is never disabled (R5).
  const draftWidthSpacings =
    !draft.full && canonDraft.minPrice !== null && canonDraft.maxPrice !== null
      ? rangeSpacingsForPool(canonDraft.minPrice, canonDraft.maxPrice, grid)
      : null;
  const atMinWidth = draftWidthSpacings !== null && draftWidthSpacings <= MIN_RANGE_SPACINGS;
  // The committed (applied) range Next hands to Review must also be valid — guards the rare degenerate
  // seed (POO-770) so an invalid band can never advance even if the draft is momentarily valid.
  const canonApplied = toRange(applied, inverted);
  const appliedRangeValid =
    applied.full ||
    (canonApplied.minPrice !== null &&
      canonApplied.maxPrice !== null &&
      isRangeWideEnough(canonApplied.minPrice, canonApplied.maxPrice, grid));
  // POO-861 R4: non-blocking heads-up when the draft range is single-sided AND sits within a few usable
  // ticks of the LIVE current price (pool.currentPrice is refreshed by useLivePoolPrice) — a small move
  // would pull the price into the range and require BOTH seed tokens. Real mode only (mock never mints,
  // and has no seed step). Warn-only: it never blocks Apply/Next (R5).
  const monoAssetWarning =
    !isMockMode &&
    !draft.full &&
    isSingleSidedNearPrice(
      pool.currentPrice,
      canonDraft.minPrice,
      canonDraft.maxPrice,
      draft.full,
      grid,
    );
  let draftWidthPct: number | null = null;
  if (!draft.full && canonDraft.minPrice !== null && canonDraft.maxPrice !== null) {
    const lo = canonDraft.minPrice;
    const hi = canonDraft.maxPrice;
    if (hi > lo) {
      draftWidthPct = ((hi - lo) / 2 / pool.currentPrice) * 100;
    }
  }
  const draftDerived =
    draft.full || draftWidthPct !== null
      ? deriveMandate(pool, draft.full ? null : draftWidthPct)
      : null;
  // POO-830 R3/R4/R5: the live asset + objective preview, re-derived from the SAME canonical range
  // draft that feeds the split/status. Computed only when the flag is on and a mandate is shown, so
  // flag-off keeps the card byte-for-byte as before. Uses canonDraft (canonical, orientation-safe).
  const draftTags =
    categoryTagsEnabled && draftDerived
      ? deriveBuilderStrategyTagsForPool(pool, {
          full: draft.full,
          minPrice: canonDraft.minPrice,
          maxPrice: canonDraft.maxPrice,
        })
      : null;

  // Estimated token value split for the chosen range (computed canonical), and whether to show the
  // price/proportion viz (a concrete min<max range — full-range has no band to draw). The displayed
  // bounds drive the viz domain so the bar reads in the chosen orientation.
  const split = tokenSplit(pool.currentPrice, canonDraft.minPrice, canonDraft.maxPrice, draft.full);
  const draftMin = Number.parseFloat(draft.minPrice);
  const draftMax = Number.parseFloat(draft.maxPrice);
  const showRangeViz =
    !draft.full && Number.isFinite(draftMin) && Number.isFinite(draftMax) && draftMax > draftMin;
  // POO-501 R8 / decision Q6: resolve by SYMBOL (resolveTokenLogo), so majors resolve consistently in
  // mock mode (the mock pool's synthetic token addresses don't resolve via the address-keyed lookup);
  // non-majors fall back to the network token-list icon. Follows the same path as the Move Range modal.
  const icon0 = resolveTokenLogo(pool.token0, pool.network);
  const icon1 = resolveTokenLogo(pool.token1, pool.network);

  const pairLabel = inverted ? `${pool.token1}/${pool.token0}` : `${pool.token0}/${pool.token1}`;
  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-medium text-sm transition-colors",
      active
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border text-muted-foreground hover:text-foreground",
    );
  const stepper =
    "inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  const BLOCKS: { key: NodeKey; label: string; icon: typeof Download }[] = [
    { key: "deposit", label: t("build.blocks.deposit"), icon: Download },
    { key: "swap", label: t("build.blocks.swap"), icon: ArrowLeftRight },
    { key: "pool", label: t("build.blocks.pool"), icon: Layers },
    { key: "collect", label: t("build.blocks.collect"), icon: Coins },
  ];

  /** One canvas node (click-to-select). */
  function CanvasNode({
    nodeKey,
    title,
    subtitle,
    children,
  }: {
    nodeKey: NodeKey;
    title: string;
    subtitle: string;
    children?: React.ReactNode;
  }) {
    const isSelected = selected === nodeKey;
    const Icon = BLOCKS.find((block) => block.key === nodeKey)?.icon ?? Layers;
    return (
      <button
        type="button"
        onClick={() => setSelected(nodeKey)}
        aria-pressed={isSelected}
        className={cn(
          "flex w-full max-w-sm flex-col gap-2 rounded-xl border bg-surface p-3 text-left transition-colors",
          isSelected
            ? "border-primary ring-1 ring-primary"
            : "border-border hover:border-muted-foreground/40",
        )}
      >
        <span className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-surface-raised">
            <Icon className="size-4 text-primary" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-foreground text-sm">{title}</span>
            <span className="truncate text-muted-foreground text-xs">{subtitle}</span>
          </span>
        </span>
        {children}
      </button>
    );
  }

  /** Vertical connector between canvas nodes. */
  const Edge = () => <span aria-hidden="true" className="mx-auto block h-6 w-px bg-border" />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-foreground text-lg">{t("build.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("build.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
        {/* Palette */}
        <aside className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-col gap-2">
            <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
              {t("build.paletteMandate")}
            </p>
            <span className="inline-flex items-center rounded-lg border border-border bg-surface-raised px-3 py-2 font-medium text-foreground text-sm">
              <ProtocolBadge />
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
              {t("build.paletteBlocks")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {BLOCKS.map((block) => (
                <li
                  key={block.key}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground text-sm"
                >
                  <block.icon className="size-4" aria-hidden="true" />
                  <span className="flex-1">{block.label}</span>
                  <GripVertical className="size-4 opacity-40" aria-hidden="true" />
                </li>
              ))}
            </ul>
          </div>
          <p className="text-muted-foreground text-xs">{t("build.paletteNote")}</p>
        </aside>

        {/* Canvas: the fixed V1 flow ([R3]: exactly one pool node). min-h keeps it a real
            workspace even while the flow is short — the canvas is where managers work. */}
        <div className="flex min-h-[560px] flex-col items-center rounded-xl border border-border bg-background p-8">
          <CanvasNode
            nodeKey="deposit"
            title={t("build.blocks.deposit")}
            subtitle={t("build.nodes.depositSub")}
          />
          <Edge />
          <CanvasNode
            nodeKey="swap"
            title={t("build.blocks.swap")}
            subtitle={t("build.nodes.swapSub", { tokens: `${pool.token0} + ${pool.token1}` })}
          />
          <Edge />
          <CanvasNode
            nodeKey="pool"
            title={pairLabel}
            subtitle={`Uniswap v3 · ${feeLabel(pool.feeBps)} · ${t("build.nodes.poolSub")}`}
          >
            <span className="flex items-center justify-between gap-2">
              <RangeStatusLine status={appliedStatus} />
              <span className="text-muted-foreground text-xs">
                {applied.full
                  ? t("mandate.rangeFull")
                  : `${applied.minPrice} – ${applied.maxPrice}`}
              </span>
            </span>
          </CanvasNode>
          <Edge />
          <CanvasNode
            nodeKey="collect"
            title={t("build.blocks.collect")}
            subtitle={t("build.nodes.collectSub")}
          />
        </div>

        {/* Config for the selected node */}
        <aside className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
            {t("build.config.title")}
          </p>

          {selected === "pool" ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <p className="font-medium text-foreground text-sm">{t("build.config.pool")}</p>
                <div className="flex items-center justify-between rounded-md border border-border bg-surface-raised px-3 py-2">
                  <span className="font-medium text-foreground text-sm">{pairLabel}</span>
                  <span className="text-muted-foreground text-xs">{pool.networkName}</span>
                </div>
              </div>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="float-left mb-1.5 w-full font-medium text-foreground text-sm">
                  {t("build.config.feeTier")}
                </legend>
                <div className="flex gap-1.5">
                  {[5, 30, 100].map((bps) => (
                    <span
                      key={bps}
                      className={cn(
                        "flex-1 rounded-md border px-2 py-1.5 text-center font-medium text-xs",
                        bps === pool.feeBps
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground opacity-60",
                      )}
                    >
                      {feeLabel(bps)}
                    </span>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">{t("build.config.feeTierNote")}</p>
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-foreground text-sm">
                    {t("build.config.allocation")}
                  </p>
                  <span className="font-medium text-foreground text-sm">100%</span>
                </div>
                <p className="text-muted-foreground text-xs">{t("build.config.allocationNote")}</p>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-foreground text-sm">{t("build.config.range")}</p>
                  <button
                    type="button"
                    onClick={toggleInverted}
                    aria-pressed={inverted}
                    aria-label={t("build.config.invert")}
                    title={t("build.config.invert")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
                  >
                    <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                    {pairLabel}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {RANGE_PRESETS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => applyPreset(pct)}
                      aria-pressed={!draft.full && draft.activePreset === pct}
                      className={chip(!draft.full && draft.activePreset === pct)}
                    >
                      ±{pct}%
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, full: true, activePreset: "full" })}
                    aria-pressed={draft.full}
                    className={chip(draft.full)}
                  >
                    {t("mandate.rangeFull")}
                  </button>
                </div>
                {draft.full ? (
                  <p className="text-muted-foreground text-xs">{t("mandate.rangeFullNote")}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1.5">
                      <span className="font-medium text-foreground text-sm">
                        {t("mandate.rangeMin")}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={t("mandate.rangeMinDecrease")}
                          onClick={() => nudge("min", -1)}
                          className={stepper}
                        >
                          <Minus className="size-4" aria-hidden="true" />
                        </button>
                        <Input
                          value={draft.minPrice}
                          inputMode="decimal"
                          size="sm"
                          aria-label={t("mandate.rangeMin")}
                          className="flex-1 text-center"
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              full: false,
                              activePreset: null,
                              minPrice: sanitizeNumericInput(event.target.value),
                            })
                          }
                          onBlur={() => snapBound("min")}
                        />
                        <button
                          type="button"
                          aria-label={t("mandate.rangeMinIncrease")}
                          onClick={() => nudge("min", 1)}
                          disabled={atMinWidth}
                          className={stepper}
                        >
                          <Plus className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="font-medium text-foreground text-sm">
                        {t("mandate.rangeMax")}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={t("mandate.rangeMaxDecrease")}
                          onClick={() => nudge("max", -1)}
                          disabled={atMinWidth}
                          className={stepper}
                        >
                          <Minus className="size-4" aria-hidden="true" />
                        </button>
                        <Input
                          value={draft.maxPrice}
                          inputMode="decimal"
                          size="sm"
                          aria-label={t("mandate.rangeMax")}
                          className="flex-1 text-center"
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              full: false,
                              activePreset: null,
                              maxPrice: sanitizeNumericInput(event.target.value),
                            })
                          }
                          onBlur={() => snapBound("max")}
                        />
                        <button
                          type="button"
                          aria-label={t("mandate.rangeMaxIncrease")}
                          onClick={() => nudge("max", 1)}
                          className={stepper}
                        >
                          <Plus className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-muted-foreground text-xs">
                    {t("mandate.rangeCurrent", { price: fmtPrice(dispCurrent) })}
                    {inverted ? ` ${pairLabel}` : ""}
                  </p>
                  <RangeStatusLine status={draftStatus} />
                </div>
                {/* POO-860 R1/R2: inline error when the (non-full) draft range is inverted, equal, or
                    narrower than the 2-tick minimum. Blocks Apply/Next below. */}
                {!draft.full && !draftRangeValid ? (
                  <p className="text-destructive text-xs">{t("build.config.rangeError")}</p>
                ) : null}
                {/* POO-861 R4: non-blocking mono-asset proximity warning (real mode). */}
                {monoAssetWarning ? (
                  <p className="text-warning text-xs">{t("build.config.monoAssetWarning")}</p>
                ) : null}
                {showRangeViz ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised/40 p-3">
                    <RangeBar
                      min={draftMin}
                      max={draftMax}
                      current={dispCurrent}
                      inRange={dispCurrent >= draftMin && dispCurrent <= draftMax}
                    />
                    <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                      {t("build.config.composition")}
                    </p>
                    <TokenSplitBar
                      pct0={inverted ? split.pct1 : split.pct0}
                      pct1={inverted ? split.pct0 : split.pct1}
                      token0={inverted ? pool.token1 : pool.token0}
                      token1={inverted ? pool.token0 : pool.token1}
                      icon0={inverted ? icon1 : icon0}
                      icon1={inverted ? icon0 : icon1}
                    />
                  </div>
                ) : null}
                {draft.full ? null : (
                  <p className="text-muted-foreground text-xs">{t("build.config.tickNote")}</p>
                )}
              </div>

              {draftDerived ? (
                <DerivedMandateCard derived={draftDerived} tags={draftTags ?? undefined} />
              ) : null}

              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col">
                  <span className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
                    {t("build.config.autoMove")}
                    <span className="rounded-full bg-surface-raised px-2 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                      {comingSoon}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("build.config.autoMoveNote")}
                  </span>
                </div>
                <Lock className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </div>

              {/* POO-525 R3: the locked "Coming soon" 0.5% slippage input is gone — the Review
                  step's settings gear (POO-478 R3) is the single slippage control for create-pool. */}
              <Button disabled={!dirty || !draftRangeValid} onClick={() => setApplied(draft)}>
                {t("build.config.apply")}
              </Button>
              <div className="flex flex-col gap-1">
                <Button variant="secondary" size="sm" disabled title={t("build.config.removeNote")}>
                  {t("build.config.removeNode")}
                </Button>
                <p className="text-muted-foreground text-xs">{t("build.config.removeNote")}</p>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {selected === "deposit"
                ? t("build.config.depositBody")
                : selected === "swap"
                  ? t("build.config.swapBody", { tokens: `${pool.token0} + ${pool.token1}` })
                  : t("build.config.collectBody")}
            </p>
          )}
        </aside>
      </div>

      {/* Actions — wizard convention: "Next" on the right, back on the left (row-reverse keeps
          the primary action first on mobile). */}
      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center">
        <Button
          size="lg"
          // POO-860 R1/R2: block advancing to Review while the shown draft or the committed range is
          // invalid (inverted, equal, or narrower than the 2-tick minimum).
          disabled={!draftRangeValid || !appliedRangeValid}
          onClick={() =>
            onNext({
              ...selection,
              full: applied.full,
              activePreset: applied.activePreset,
              ...committedRange(),
              // Display-only: Review echoes the range in this orientation; committedRange() above
              // already converted the bounds to canonical for the DTO/tick math. Full-range has no
              // orientation to echo.
              displayInverted: !applied.full && inverted,
            })
          }
        >
          {t("builder.nextReview")}
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 self-start text-muted-foreground text-sm hover:text-foreground sm:mr-auto"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("builder.steps.mandate")}
        </button>
      </div>
    </div>
  );
}
