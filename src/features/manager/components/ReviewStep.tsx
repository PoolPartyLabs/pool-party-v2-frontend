/**
 * @id PP-MGR-SCR-002 (POO-453, POO-701)
 * @name ReviewStep
 * @implements-rules-version v6
 *
 * POO-701 (rules v1, Option (b)): the cropped logo is no longer left as a raw `data:` URL that the
 * https-only guard silently drops — it is uploaded on crop-apply. `handleCropApply` shows the crop as
 * a local preview, then (real mode only, via the injected `onUploadLogo` = `useUploadMedia("logo")`
 * with NO strategyId — a manager-scoped PRE-ID mint) mints (SIWE session-authorized, NO wallet
 * signature since POO-707 [R2]) + uploads to S3 and swaps in the
 * trusted https CDN URL so it rides into the SINGLE create POST ([R1]); on failure it keeps the local
 * preview and surfaces an inline error, never silently dropping the logo. Launch is BLOCKED while the
 * logo is uploading ([R2], mirrors the manager Profile-tab mediaUploading gate) so the https URL is
 * staged first. The upload fn is injected only by the real-mode `StrategyBuilderDataLoader` ([R3]);
 * mock mode has no upload fn and the crop stays a session-local preview (unchanged). The
 * `buildStrategyMetadata` https guard is untouched ([R4]) — correct once a real https URL is staged.
 *
 * POO-308 (rules v1, ADR POO-585): real-mode Launch now persists the strategy METADATA the on-chain
 * build drops. Before the tx it signs + POSTs the metadata (name/description/logo/category/riskLevel/
 * fees/access) via `useCreateStrategyMetadata.create` -> a pending strategyId ([R1]/[R7]); the build-tx
 * flow runs UNCHANGED ([R2]); on the send's success it confirms with the mined txHash ([R3]) and renders
 * the strategy immediately with a PENDING badge that POO-638 convergence (fed the send's receipt block)
 * clears to live ([R6]). A pre-tx write failure aborts with a non-blocking inline retry (nothing is
 * on-chain yet); a post-mine confirm failure keeps the live view + a non-blocking re-confirm retry (the
 * on-chain pool is never lost) ([R5]). Mock mode is unchanged (persists via managerService).
 *
 * POO-599 (rules v1): the POO-574 build→review→sign handshake reaches the manager Launch flow. The
 * wallet-sign flow now PAUSES after its `build` step (`pauseAfterKey: "build"`), and a post-build
 * `review` phase renders the built figures (real network gas via `flow.context.built.estimatedGasInUsd`,
 * else the honest pending placeholder — never a fabricated number in real mode) with the shared
 * `useReviewCountdown` 10s re-quote timer (`flow.rebuild()` re-runs ONLY the build, reusing the signed
 * approve/permit — no re-prompt). The Review approve does `flow.resume()` into the send. Because
 * create-pool's build is step 3 (approve×2 → permit → build → send), the pause sits AFTER the Permit2
 * batch signature (same as Invest, POO-598): the review guards the final broadcast, not the permit. The
 * slippage/deadline gear STAYS on the pre-build Launch confirm (POO-550, R4) — the review is gearless.
 * `strategy_launch_submitted` fires ONCE from the Launch-confirm approve (the flow start, R3). Mock mode
 * runs a synthetic 5-step flow (mockCreatePoolSteps) so the build re-runs on the timer too (R5); its
 * live launch persists via managerService on the send's success (never on cancel).
 *
 * POO-510 (POO-467 rules v3, [R10]): the manager Launch strategy flow (technical name create-pool),
 * whose real-mode wallet-sign flow runs here, joins the SAME slippage auto-retry orchestration as the
 * six transactional modals (POO-499) via the shared `useSlippageAutoRetry` hook wired to `flow`:
 *   - R2: the first slippage-classified failure auto-retries ONCE from the build step — the pending
 *     WalletSignModal shows the retry notice instead of the failed view, and the completed
 *     approve/permit steps are never re-run (retryFrom("build"));
 *   - R3: the second slippage failure swaps the generic failed view for the slippage-specific copy
 *     (shared strategies.flow.slippage.* keys) and auto-opens the settings dialog exactly once; "Back
 *     to review" then re-runs from the build step with the new gear slippage;
 *   - R4: a non-slippage failure is unchanged (generic failed view, plain resume-from-failed retry);
 *   - R8: `tx_slippage_retry` fires once per automatic retry with the `createPool` flow tag.
 * The mock launch path (which bypasses the wallet-sign flow) is out of scope. Copy reuses the existing
 * `strategies.flow.slippage.*` keys — no new locale keys.
 *
 * POO-524 (rules v1): the launch confirm (PP-MGR-MOD-002) gains the per-token seed amounts
 * (TokenAmountRow + resolveTokenLogo, POO-482) and ONE consolidated Fee row via buildFeeRow (R1):
 * mock mode uses the PP-MOCK gas constant; real mode has no figure before the flow's build step
 * returns `estimatedGasInUsd`, so the row shows a pending placeholder, never a fabricated number.
 * The "Your strategy is live" success view gains a receipt (R2): the seeded per-token amounts + USD
 * snapshotted at tx time (transaction display rule) and the Transaction row with the mined
 * flow.txHash + the shared ExplorerTxLink (PP-CORE-CMP-050, POO-514).
 *
 * POO-478 rules v1 [R3]: the Review step gains the standard tx settings gear + TransactionSettingsDialog
 * (Max slippage; Transaction deadline 30, display-only) so every on-chain tx exposes both controls (R1).
 * The chosen slippage flows into buildCreatePoolTxAction (via createPoolInput.slippageTolerance).
 * POO-525 rules v1 [R1]: the gear seeds CREATE_POOL_DEFAULT_SLIPPAGE_PCT = 2 (was the manager 5),
 * aligned with useCreatePool's client default and createPoolAction's server fallback.
 * POO-547: the custom slippage input is now uniform (0.1-100%) — the old 5% cap is dropped (2% stays
 * the seed); createPoolAction now clamps server-side to 100 (pending POO-551's backend confirmation).
 * POO-496 rules v1: handleSeedChange also compares decimals0/decimals1, so a decimals-only seed
 * report is accepted and a non-full range's ticks resolve before any amount is typed.
 * POO-497 rules v1: Launch is gated on the pool having a defined market price (defensive backstop to
 * the picker filter) — the create flow never builds a position on a no-price pool.
 * POO-878/882 rules v1: the seed card reports the wrapped-native funding source (native vs WETH/WPOL)
 * on SeedState.wrappedNativeFunding; handleSeedChange compares it (a source-only switch propagates)
 * and createPoolInput forwards it so the API-built tx.value matches the FE-validated source, per chain.
 * POO-893 rules v1: the post-build Review DialogContent prevents Radix's open-autofocus (the app's
 * only fresh-mount <Dialog open>) so initial focus goes to the dialog container, not the fee (i)
 * trigger: the fee breakdown tooltip no longer auto-opens at mount (hover/keyboard/tap unchanged).
 *
 * POO-453 R8: on a mock create (draft or live), the success path also calls `usePostWriteRefresh`
 * so the new strategy appears on the Manage-strategies list + Explore at once (the real path already
 * refreshes via its outcome effect + the console's ?created=1 re-poll).
 *
 * POO-495 (rules v1): the on-page Summary card gains a Fee tier row and an Access row, and the launch
 * confirm modal (PP-MGR-MOD-002) gains an Access row after Risk and before Performance fee. The fee
 * tier string is hoisted to one `feeTierLabel` const reused by card + modal so they cannot diverge,
 * and the access value is hoisted to the module-level `STRATEGY_ACCESS` const (single source of truth)
 * feeding both the createStrategy payload and the two read-back Access rows.
 *
 * Step 3 of the V1 strategy builder (PP-MGR-SCR-002 Review & launch). The strategy identity
 * (name + optional logo / description) is set HERE — the Mandate step only picks the pool — so
 * launching is gated on a name. Shows the derived mandate summary, lets the manager set the four
 * fees (entry / exit / management uncapped; performance 10–90% of generated LP fees — so NO
 * high-water mark), displays Pool Party's AUM-tiered cut (read-only, from the backend), fixes
 * access to Public (private models are behind a flag), and previews the investor card. "Launch"
 * confirms first (PP-MGR-MOD-002: summary + gas note), then runs automatic verification (pool
 * exists + params valid) and lists the strategy immediately; "Save as draft" stores it as a draft
 * without confirming. Identity edits are handed back up through onBack so stepping away and
 * returning keeps them. The verification's internal risk flags are never shown to investors —
 * only a general disclaimer is.
 */
"use client";

import {
  ArrowLeft,
  BadgeCheck,
  CheckCircle2,
  FileText,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { NetworkLogo } from "@/components/data-display/NetworkLogo";
import { ProtocolBadge } from "@/components/data-display/ProtocolBadge";
import { StrategyLogo } from "@/components/data-display/StrategyLogo";
import { TokenAmountRow } from "@/components/data-display/TokenAmountRow";
import { AprTooltip } from "@/components/ui/AprTooltip";
import { Button } from "@/components/ui/Button";
import { CtaWithMissing } from "@/components/ui/CtaWithMissing";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { ExplorerTxLink } from "@/components/ui/ExplorerTxLink";
import { ImageCropModal } from "@/components/ui/ImageCropModal";
import { Input } from "@/components/ui/Input";
import { type ReceiptRowItem, ReceiptRows } from "@/components/ui/ReceiptRows";
import { InfoTip } from "@/features/rewards/components/InfoTip";
import { buildFeeRow } from "@/features/strategies/components/FeeBreakdown";
import { TransactionSettingsDialog } from "@/features/strategies/components/TransactionSettingsDialog";
import { WalletSignModal } from "@/features/strategies/components/WalletSignModal";
import { useReviewCountdown } from "@/features/strategies/hooks/useReviewCountdown";
import { useSlippageAutoRetry } from "@/features/strategies/hooks/useSlippageAutoRetry";
import { type FlowStep, useWalletSignFlow } from "@/features/strategies/hooks/useWalletSignFlow";
import { CREATE_POOL_DEFAULT_SLIPPAGE_PCT } from "@/features/strategies/lib/slippage";
import { useRouter } from "@/i18n/navigation";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { MIN_AMOUNT_FOR_CREATE_POOL } from "@/lib/config/operationMinimums";
import { createPoolTicks } from "@/lib/manager/createPoolTicks";
import { seedUsdValue } from "@/lib/manager/seedUsdValue";
import type { MediaUploadFn } from "@/lib/media/useUploadMedia";
import type { FeePolicy, StrategyAccess } from "@/lib/schemas";
import { type CreateStrategyResult, isMockMode, managerService } from "@/lib/services";
import { getRiskProfile } from "@/lib/strategies/riskProfile";
import { resolveTokenLogo } from "@/lib/tokens/tokenLogo";
import { usePostWriteRefresh } from "@/lib/tx/usePostWriteRefresh";
import { cn } from "@/lib/utils/cn";
import { formatPercent, formatTxHash, formatUsd } from "@/lib/utils/format";
import { IMAGE_ACCEPT_ATTR, validateImageFile } from "@/lib/utils/imageUpload";
import { sanitizeNumericInput } from "@/lib/utils/numericInput";
import { type CreatePoolCtx, type CreatePoolRunInput, useCreatePool } from "../hooks/useCreatePool";
import { useCreateStrategyMetadata } from "../hooks/useCreateStrategyMetadata";
import { buildStrategyMetadata } from "../lib/buildStrategyMetadata";
import { deriveBuilderStrategyTagsForPool } from "../lib/deriveBuilderStrategyTags";
import type { DerivedMandate } from "../lib/deriveMandate";
import { invert, toDisplayBounds } from "../lib/invertPrice";
import { roundPrice } from "../lib/priceFormat";
import { ManagerActionModal } from "./ManagerActionModal";
import type { MandateResult, MandateSelection } from "./MandateStep";
import { SeedLiquidityCard, type SeedState } from "./SeedLiquidityCard";

/** Performance fee bounds (V1 rule): 10–90% of generated LP fees. */
const PERF_MIN = 10;
const PERF_MAX = 90;

/**
 * V1 access model: public only. Allowlist / NFT / password access are flag-gated (POO-177). This is
 * the single source of truth (POO-495 [R4]): it feeds both the createStrategy payload and the two
 * read-back Access rows, so the summary can never display something different from what is sent on
 * create. PP-NOTE: when a non-public model launches, extend accessLabel's exhaustive switch with the
 * matching literal t() key; POO-308 also sends this value to the backend on create-pool.
 */
const STRATEGY_ACCESS: StrategyAccess = "public";

/** Max length of the optional strategy description (POO-278 [R5] / POO-235). */
const DESCRIPTION_MAX = 280;

/**
 * POO-478 R3: create-pool is a manager-only flow whose settings gear exposes Max slippage + a
 * transaction deadline defaulting to 30 minutes. The deadline is display-only for now (the create-pool
 * build does not consume it yet, mirroring MoveRange/Close); it MUST still render (R1). The chosen
 * slippage flows into the build. POO-525 R1: the gear SEEDS the create-pool default 2%
 * (CREATE_POOL_DEFAULT_SLIPPAGE_PCT). POO-547: the custom slippage input is now uniform (0.1-100%) —
 * the old 5% cap is dropped (2% stays the seed); createPoolAction clamps server-side to 100 now
 * (pending POO-551's backend confirmation).
 */
const DEFAULT_DEADLINE_MINS = 30;

/**
 * PP-MOCK (POO-524 R1): mocked network gas for the mock-mode launch confirm's Fee row, mirroring
 * the transactional modals' NETWORK_FEE_USD (CollectModal / InvestModal / CompoundModal). Real mode
 * never uses it — the confirm shows the pending placeholder until a pre-build estimate exists.
 */
const NETWORK_FEE_USD = 0.3;

/** POO-599 R1: the Review re-quotes (flow.rebuild) this many seconds after each build settles. */
const REVIEW_REFRESH_SECS = 10;

/** Per-step mock duration so the wallet-sign stepper visibly walks in mock mode. */
const MOCK_STEP_MS = 350;

/**
 * POO-599 R5: mock create-pool steps mirroring the real 5-step sequence (approve×2 → permit → build →
 * confirm), each with a visible beat, so mock mode runs the SAME build→review→sign handshake as real
 * (pauseAfterKey "build" pauses here; flow.rebuild re-runs the build on the 10s timer). Keys match the
 * real useCreatePool steps so pauseAfterKey/retryFrom align. The build yields a mock `estimatedGasInUsd`
 * so the mock Review shows the honest PP-MOCK $0.30 estimate (never leaked into real mode). The confirm
 * returns no txHash — the mock live view keeps its plain success (no fabricated receipt, POO-524 R2).
 */
function mockCreatePoolSteps(): FlowStep<CreatePoolCtx>[] {
  const beat = () => new Promise((resolve) => setTimeout(resolve, MOCK_STEP_MS));
  return [
    { key: "approve:token0", run: async () => (await beat(), {}) },
    { key: "approve:token1", run: async () => (await beat(), {}) },
    { key: "permit", run: async () => (await beat(), {}) },
    {
      key: "build",
      run: async () => {
        await beat();
        return {
          built: {
            tx: { to: "0x0000000000000000000000000000000000000000", data: "0x" },
            estimatedGasInUsd: NETWORK_FEE_USD,
          } as CreatePoolCtx["built"],
        };
      },
    },
    { key: "confirm:addLiquidity", run: async () => (await beat(), {}) },
  ];
}

/** Public props for {@link ReviewStep}. */
export interface ReviewStepProps {
  /** The resolved mandate from step 1. */
  mandate: MandateResult;
  /** Pool Party's AUM-tiered cut (read-only, from the backend). */
  feePolicy: FeePolicy;
  /**
   * Step back to the Build step. Receives the selection with this step's identity edits merged in
   * so the wizard shell can persist them (returning to Review restores name/logo/description).
   */
  onBack: (selection: MandateSelection) => void;
  /**
   * Mirrors identity edits (name / logo / description) up to the wizard shell on every change, so
   * stepping back via the stepper — not just this step's Back button — keeps them. Must be a stable
   * reference (the sync effect depends on it) to avoid a render loop.
   */
  onIdentityChange?: (identity: Pick<MandateSelection, "name" | "description" | "logoUrl">) => void;
  /**
   * Real-mode only (POO-701 [R1]/[R3]): uploads the cropped logo Blob (a manager-scoped PRE-ID mint —
   * `useUploadMedia("logo")` with NO strategyId, since the strategy does not exist yet) and resolves
   * its trusted https CDN URL, which is staged into `logoUrl` so it rides into the create POST. Omitted
   * in mock mode / Storybook, where the crop stays a session-local preview (the real-mode
   * `StrategyBuilderDataLoader` injects this — mirrors `PersonalInfoDataLoader` / `ManagerConsoleDataLoader`).
   */
  onUploadLogo?: MediaUploadFn;
}

/** Builder lifecycle: editing the form, the wallet-signing modal, the POO-599 post-build review, the
 *  brief auto-verification (draft), then the outcome. */
// POO-599: `review` is the post-build handshake pause — the flow holds in `awaiting` after the build
// step (approve×2 → permit → build already ran) while the manager reviews the built figures before the
// final send. `signing` runs BOTH the pre-build steps and (after resume) the send.
type Phase = "form" | "signing" | "review" | "verifying" | "live" | "draft" | "failed";

/** Per-token seed display data for the launch confirm rows + the success receipt (POO-524). */
interface SeedTokenDisplay {
  /** Token symbol, e.g. "ETH". */
  symbol: string;
  /** Human token amount (converted from wei with the reported decimals). */
  amount: number;
  /** Pre-formatted USD value; omitted when the pool carries no price for the token (no fake data). */
  usd?: string;
  /** Resolved logo URL (POO-482); the TokenAmountRow initial chip renders when unresolved. */
  iconUrl?: string;
}

/** The success receipt, snapshotted when the on-chain launch settles (POO-524 R2). */
interface LaunchReceipt {
  /** Seeded per-token amounts + USD as valued at tx time; null when the seed never reported. */
  tokens: SeedTokenDisplay[] | null;
  /** The mined create-pool hash (the flow's terminal txHash); null when none was recorded. */
  txHash: string | null;
}

/** Stacked per-token seed list (POO-524 R1/R2), mirroring CollectModal's pair payout list. */
function SeedTokenList({ tokens }: { tokens: SeedTokenDisplay[] }) {
  return (
    <span data-testid="launch-seed-tokens" className="flex flex-col items-end gap-1">
      {tokens.map((token) => (
        // The two pool tokens are distinct, so the symbol is a stable key.
        <TokenAmountRow
          key={token.symbol}
          symbol={token.symbol}
          amount={token.amount}
          iconUrl={token.iconUrl}
          usd={token.usd}
        />
      ))}
    </span>
  );
}

/** Five-segment risk meter (mirrors the Mandate step's derived display). */
function RiskBars({ level }: { level: DerivedMandate["riskLevel"] }) {
  return (
    <span className="flex gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((seg) => (
        <span
          key={seg}
          className={cn(
            "h-1.5 w-4 rounded-full",
            seg <= level ? "bg-primary" : "bg-surface-raised",
          )}
        />
      ))}
    </span>
  );
}

/**
 * A labelled fee input flanked by − / + steppers (mirrors the Mandate step's nudge controls), numbers
 * only. When `locked` it renders disabled with a muted "Coming soon" badge — entry / exit / management
 * fees aren't configurable in V1.
 */
function FeeField({
  label,
  value,
  onChange,
  onStep,
  locked = false,
  comingSoonLabel,
  description,
  error,
  tooltip,
  showUnitToggle = false,
}: {
  label: string;
  value: string;
  onChange?: (next: string) => void;
  onStep?: (direction: -1 | 1) => void;
  locked?: boolean;
  comingSoonLabel?: string;
  description?: string;
  error?: string;
  /** Short explanation shown via an info tooltip next to the label. */
  tooltip?: string;
  /** Show a disabled % | $ unit toggle (coming soon — entry/exit fees only). */
  showUnitToggle?: boolean;
}) {
  const stepper = cn(
    "inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border text-foreground transition-colors",
    locked ? "cursor-not-allowed opacity-50" : "hover:bg-surface-raised",
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "font-medium text-sm",
            locked ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {label}
        </span>
        {tooltip ? <InfoTip text={tooltip} /> : null}
        {locked && comingSoonLabel ? (
          <span className="rounded-full bg-surface-raised px-2 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
            {comingSoonLabel}
          </span>
        ) : null}
        {showUnitToggle ? (
          // Coming-soon %/$ unit toggle (disabled, display-only): same muted treatment as the badge.
          <span
            aria-hidden="true"
            data-testid="fee-unit-toggle"
            className="ml-auto inline-flex shrink-0 overflow-hidden rounded-md border border-border opacity-50"
          >
            <span className="bg-surface-raised px-2 py-0.5 font-medium text-foreground text-xs">
              %
            </span>
            <span className="border-border border-l px-2 py-0.5 font-medium text-muted-foreground text-xs">
              $
            </span>
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`${label} −`}
          disabled={locked}
          onClick={() => onStep?.(-1)}
          className={stepper}
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <Input
          value={value}
          inputMode="decimal"
          aria-label={label}
          disabled={locked}
          className="flex-1 text-center"
          onChange={(event) => onChange?.(sanitizeNumericInput(event.target.value))}
        />
        <button
          type="button"
          aria-label={`${label} +`}
          disabled={locked}
          onClick={() => onStep?.(1)}
          className={stepper}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : description ? (
        <p className="text-muted-foreground text-xs">{description}</p>
      ) : null}
    </div>
  );
}

/** Strategy builder — Review & launch (fees, access, preview, launch/draft). */
// `feePolicy` is still accepted (the backend may still take a cut) but no longer displayed — the
// "Pool Party cut" card was removed from Review per product (2026-06-24).
export function ReviewStep({ mandate, onBack, onIdentityChange, onUploadLogo }: ReviewStepProps) {
  const t = useTranslations("manager");
  // The shared "Coming soon" label lives under profile.security; reused here to avoid a new i18n key
  // (which would otherwise need backfilling across every locale, including the new ones in PR #70).
  const tProfile = useTranslations("profile");
  // POO-478 R3: the settings gear reuses the shared strategies.invest.settings.* copy (same as every
  // other tx gear) — no new manager-namespace keys.
  const tStrategies = useTranslations("strategies");
  // POO-586 R3: the shared image-limit error copy lives in the `common` namespace.
  const tCommon = useTranslations("common");
  const router = useRouter();
  const { track } = useAnalytics();
  const { pool, derived, selection } = mandate;

  // In real mode, launching creates the pool on-chain (seed deposit + create-pool tx); in mock mode
  // it runs the mock verification. The executor is mock-safe (no-op in mock mode), so it is always
  // called to keep hook order stable.
  const realMode = !isMockMode;
  const createPool = useCreatePool();
  // POO-308: the metadata write lifecycle — the pre-tx create (returns the pending strategyId) + the
  // post-mine confirm + its pending->live convergence badge. Mock-safe no-op in mock mode.
  const metadataWriter = useCreateStrategyMetadata();

  // Range summary, echoed in the orientation the manager chose in Build. `minPrice`/`maxPrice` are
  // always canonical (token1/token0); when the manager flipped the editor we re-express them as the
  // reciprocal pair (and label it) so Build and Review read the same. Display-only — the tick math
  // downstream still consumes the canonical bounds untouched.
  const rangeSummary = (() => {
    if (selection.full) return t("review.summary.rangeFull");
    if (selection.displayInverted !== true) {
      return `${selection.minPrice} – ${selection.maxPrice}`;
    }
    const disp = toDisplayBounds(
      Number.parseFloat(selection.minPrice),
      Number.parseFloat(selection.maxPrice),
      true,
    );
    if (!Number.isFinite(disp.min) || !Number.isFinite(disp.max)) {
      return `${selection.minPrice} – ${selection.maxPrice}`;
    }
    const refDisp = invert(pool.currentPrice);
    return `${roundPrice(disp.min, refDisp)} – ${roundPrice(disp.max, refDisp)} ${pool.token1}/${pool.token0}`;
  })();

  // Entry / exit / management fees aren't configurable in V1 — shown locked ("coming soon") and
  // launched at 0. Only the performance fee is editable.
  const entry = "0";
  const exit = "0";
  const management = "0";
  const [performance, setPerformance] = useState("20");
  // POO-478 R3: create-pool slippage + deadline behind the standard settings gear. POO-525 R1: the
  // slippage seeds the create-pool default (2%, capped 5) and flows into buildCreatePoolTxAction;
  // deadline is display-only (30 min).
  const [slippage, setSlippage] = useState<number>(CREATE_POOL_DEFAULT_SLIPPAGE_PCT);
  const [deadlineMins, setDeadlineMins] = useState(DEFAULT_DEADLINE_MINS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [created, setCreated] = useState<CreateStrategyResult | null>(null);
  const [confirmLaunch, setConfirmLaunch] = useState(false);
  // POO-308: `preparing` guards the pre-tx metadata POST (between the Launch confirm and the on-chain
  // flow); `metadataError` shows a non-blocking inline retry when that pre-tx write fails ([R5] —
  // nothing is on-chain yet, so re-tapping Launch retries).
  const [preparing, setPreparing] = useState(false);
  const [metadataError, setMetadataError] = useState(false);
  // POO-524 R2: the success receipt, snapshotted ONCE when the on-chain launch settles (tx-time
  // values, transaction display rule) so later price/seed changes can never rewrite it.
  const [launchReceipt, setLaunchReceipt] = useState<LaunchReceipt | null>(null);
  // Real-mode seed-liquidity amounts (wei) from the SeedLiquidityCard, gating Launch in real mode.
  const [seed, setSeed] = useState<SeedState>({
    amount0: null,
    amount1: null,
    valid: false,
    decimals0: null,
    decimals1: null,
  });
  // POO-496 R1: the card's FIRST report is decimals-only (amounts null, valid false); the guard must
  // also compare decimals0/decimals1 or that report is dropped, decimalsReady never flips, and a
  // non-full range's ticks stay null — so the zero-balance check (SeedLiquidityCard) would default to
  // both-needed and name a token the range doesn't need. A fully identical report is still dropped.
  // POO-878 [R5]: also compare wrappedNativeFunding so a source-only switch (native <-> WETH/WPOL,
  // amounts unchanged) still propagates into createPoolInput and rides the build.
  const handleSeedChange = useCallback((next: SeedState) => {
    setSeed((prev) =>
      prev.amount0 === next.amount0 &&
      prev.amount1 === next.amount1 &&
      prev.valid === next.valid &&
      prev.decimals0 === next.decimals0 &&
      prev.decimals1 === next.decimals1 &&
      prev.wrappedNativeFunding === next.wrappedNativeFunding
        ? prev
        : next,
    );
  }, []);
  // Strategy identity is set here (the Mandate step only picks the pool); seeded from the lifted
  // selection so stepping back and returning restores any prior edits.
  const [name, setName] = useState(selection.name);
  const [description, setDescription] = useState(selection.description);
  const [logoUrl, setLogoUrl] = useState<string | null>(selection.logoUrl);
  // The picked image awaiting crop (object URL); the crop modal is open while it's set.
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  // POO-586 R3: set when a picked logo is rejected (wrong type or too large); cleared on a valid pick.
  const [logoError, setLogoError] = useState(false);
  // POO-701 [R2]: true while the cropped logo is minting + uploading to S3 (real mode, session-authorized
  // — no wallet signature since POO-707) — blocks Launch so the trusted https URL is staged before the
  // create POST.
  const [logoUploading, setLogoUploading] = useState(false);
  // POO-701 [R1]: set when the logo upload/mint fails (e.g. 503 MEDIA_NOT_CONFIGURED); the local crop
  // preview is kept and the logo is surfaced as failed, never silently dropped.
  const [logoUploadFailed, setLogoUploadFailed] = useState(false);

  // POO-701 [R1]: apply the cropped logo. Show the crop immediately as a local preview, then (real mode
  // only) mint (session-authorized, no wallet signature since POO-707) + upload to S3 and swap in the
  // trusted https CDN URL so it rides into the single
  // create POST. On failure keep the local preview and surface an inline error — never silently drop
  // the logo. Mock mode has no upload fn: the crop stays a session-local preview (mirrors
  // PersonalInfoScreen.handleCropApply / ManagerProfileTabView.handleCropApplied).
  async function handleCropApply(dataUrl: string) {
    setLogoUrl(dataUrl);
    setCropSrc(null);
    setLogoUploadFailed(false);
    if (!onUploadLogo) return; // Mock mode / Storybook: session-local preview only.
    setLogoUploading(true);
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const publicUrl = await onUploadLogo(blob);
      // Swap the local `data:` preview for the trusted https CDN URL so the create POST persists it.
      setLogoUrl(publicUrl);
    } catch {
      // Keep the local crop preview; surface the failure (the upload/mint did not succeed).
      setLogoUploadFailed(true);
    } finally {
      setLogoUploading(false);
    }
  }

  // Literal t() calls (not dynamic keys) so the i18n used-key scan resolves every label.
  const riskLabels: Record<DerivedMandate["riskLevel"], string> = {
    1: t("mandate.risk.veryConservative"),
    2: t("mandate.risk.conservative"),
    3: t("mandate.risk.moderate"),
    4: t("mandate.risk.aggressive"),
    5: t("mandate.risk.veryAggressive"),
  };
  const categoryLabels: Record<DerivedMandate["categoryKey"], string> = {
    stable: t("mandate.categoryStable"),
    blueChip: t("mandate.categoryBlueChip"),
    volatile: t("mandate.categoryVolatile"),
  };
  const categoryLabel = categoryLabels[derived.categoryKey];

  // POO-495 [R1]: one fee-tier string reused by the on-page Summary card and the confirm modal, so
  // the two surfaces can never diverge. Formatted exactly as the modal already did (0.30% etc).
  const feeTierLabel = `${(pool.feeBps / 100).toFixed(2)}%`;
  // POO-495 [R2]/[R4]: the access label resolves off STRATEGY_ACCESS via an exhaustive switch with
  // LITERAL t() keys (i18n:check rejects dynamic template keys — POO-461 trap). V1 is public only;
  // add a branch here when a non-public model launches (the default is unreachable in V1).
  const accessLabel = (() => {
    switch (STRATEGY_ACCESS) {
      case "public":
        return t("review.access.public");
      default:
        return t("review.access.public");
    }
  })();

  const perfNum = Number.parseFloat(performance);
  const perfValid = Number.isFinite(perfNum) && perfNum >= PERF_MIN && perfNum <= PERF_MAX;
  const strategyName = name.trim();
  // Real mode: the create-pool API enforces a 10–50 char name (POO-315) — gate before any on-chain
  // spend so it never 400s after the user has approved tokens + signed the permit batch.
  const nameLengthValid = !realMode || (strategyName.length >= 10 && strategyName.length <= 50);
  const nameError = realMode && strategyName.length > 0 && !nameLengthValid;
  // Spacing-aligned tick bounds from the manager's range: full-range, or the min/max snapped to the
  // fee tier's spacing (POO-306). Needs the on-chain decimals (reported by the seed card); null for a
  // full range is impossible, but a non-full range is null until decimals load or if it's degenerate.
  const decimalsReady = seed.decimals0 != null && seed.decimals1 != null;
  const rangeTicks =
    selection.full || decimalsReady
      ? createPoolTicks(
          {
            full: selection.full,
            minPrice: Number.parseFloat(selection.minPrice) || null,
            maxPrice: Number.parseFloat(selection.maxPrice) || null,
          },
          seed.decimals0 ?? 18,
          seed.decimals1 ?? 18,
          pool.feeBps,
        )
      : null;

  // Seed value in USD (when the pool carries per-token prices) gated against the create-pool floor.
  // Null → prices unavailable → the floor is not enforced (Launch is not blocked on it).
  const seedUsd = seedUsdValue(
    seed.amount0,
    seed.decimals0,
    pool.token0PriceUsd,
    seed.amount1,
    seed.decimals1,
    pool.token1PriceUsd,
  );
  const belowMinUsd = seedUsd != null && seedUsd < MIN_AMOUNT_FOR_CREATE_POOL;

  // POO-524 R1/R2: per-token seed display data (human amount + USD at the pool's per-token prices +
  // resolved logo) for the launch confirm rows and the success receipt. Null until the seed card
  // reports both amounts AND decimals (mock mode never does), so no row can show a fabricated value.
  const seedTokens = useMemo<SeedTokenDisplay[] | null>(() => {
    if (seed.amount0 == null || seed.amount1 == null) return null;
    if (seed.decimals0 == null || seed.decimals1 == null) return null;
    const toDisplay = (
      amountWei: bigint,
      decimals: number,
      symbol: string,
      priceUsd: number | undefined,
    ): SeedTokenDisplay => {
      const amount = Number(formatUnits(amountWei, decimals));
      return {
        symbol,
        amount,
        // USD only when the pool carries the token price (dex-pools payload); never fabricated.
        usd: priceUsd != null ? formatUsd(amount * priceUsd) : undefined,
        iconUrl: resolveTokenLogo(symbol, pool.network),
      };
    };
    return [
      toDisplay(seed.amount0, seed.decimals0, pool.token0, pool.token0PriceUsd),
      toDisplay(seed.amount1, seed.decimals1, pool.token1, pool.token1PriceUsd),
    ];
  }, [seed.amount0, seed.amount1, seed.decimals0, seed.decimals1, pool]);

  // POO-524 R1: ONE consolidated Fee row (network gas) on the launch confirm, via the shared
  // buildFeeRow (POO-445) so fees render neutral + tooltipped everywhere. Mock mode uses the
  // PP-MOCK constant; real mode has NO figure before the flow's build step returns the built tx's
  // estimatedGasInUsd, so the row shows the pending placeholder (no-fake-data rule).
  // PP-INTEGRATION-POINT (POO-524): when a pre-build gas estimate becomes available at confirm time
  // (e.g. a dry-run build exposing estimatedGasInUsd), feed it through buildFeeRow here in place of
  // the placeholder.
  const confirmFeeRow: ReceiptRowItem = realMode
    ? { label: t("operate.fee"), value: t("confirm.feePending") }
    : buildFeeRow({
        label: t("operate.fee"),
        lines: [{ key: "network", label: t("operate.networkFee"), usd: NETWORK_FEE_USD }],
        totalLabel: t("manage.close.feesTooltip.total"),
      });

  // Real-mode create-pool input (wei amounts + resolved ticks), assembled once the seed + range are
  // ready. Null until then (mock mode, or before the seed card reports), which keeps the runner idle.
  const createPoolInput = useMemo<CreatePoolRunInput | null>(() => {
    if (!realMode || seed.amount0 == null || seed.amount1 == null || !rangeTicks) return null;
    return {
      network: pool.network,
      feeBps: pool.feeBps,
      feeTier: pool.feeTier,
      tickLower: rangeTicks.tickLower,
      tickUpper: rangeTicks.tickUpper,
      token0: pool.token0Address as `0x${string}`,
      amount0: seed.amount0,
      token1: pool.token1Address as `0x${string}`,
      amount1: seed.amount1,
      featureSettings: {
        name: strategyName,
        description: description.trim().length > 0 ? description.trim() : null,
        poolManagerFee: perfNum,
      },
      // POO-478 R3: the gear slippage flows into the build (POO-525 R1: default 2% end to end).
      slippageTolerance: slippage,
      // POO-878 [R5]: the wrapped-native funding source picked in the seed card (undefined when the
      // pool has no wrapped-native token) so the API sets tx.value to match the FE-validated source.
      wrappedNativeFunding: seed.wrappedNativeFunding,
    };
  }, [
    realMode,
    pool,
    seed.amount0,
    seed.amount1,
    seed.wrappedNativeFunding,
    rangeTicks,
    strategyName,
    description,
    perfNum,
    slippage,
  ]);

  // The real per-step sequence (approve ×2 → permit batch → build → send) driven by the wallet-sign
  // runner (FU-001); empty in mock mode / before the input is ready (the mock path drives the modal
  // uncontrolled). reset() before run() rebuilds the per-step arrays for the current input.
  // POO-599 R5: real mode uses the on-chain steps (empty until the seed+range are ready); mock mode
  // runs the synthetic 5-step flow so the SAME build→review→sign handshake (pause + 10s re-quote)
  // exercises in the default mock build, instead of the old managerService straight-through settle.
  const createPoolSteps = useMemo<FlowStep<CreatePoolCtx>[]>(
    () =>
      createPoolInput
        ? createPool.buildSteps(createPoolInput)
        : realMode
          ? []
          : mockCreatePoolSteps(),
    [createPoolInput, createPool, realMode],
  );
  // POO-599 R1: the flow PAUSES after the `build` step so the Review renders the built figures before
  // the send. approve×2 + the Permit2 batch necessarily run before the pause (build consumes the
  // permit), during the `signing` phase.
  const flow = useWalletSignFlow(createPoolSteps, {
    fallbackErrorCode: "CREATE_POOL_FAILED",
    pauseAfterKey: "build",
  });
  // POO-599 R2/R3: the real network gas from the built tx once the build has settled — the create-pool
  // build returns `estimatedGasInUsd` via the shared pool-party-api build wrapper (POO-619 verified),
  // and mock mode's synthetic build supplies the PP-MOCK $0.30. A degenerate `0` (the backend computes
  // `nativeUsd * gasInEth`, so a failed CoinGecko price fetch yields exactly 0) falls back to the honest
  // pending placeholder rather than a misleading "$0.00" (a real gas figure is always > 0).
  const reviewGasUsd = flow.context.built?.estimatedGasInUsd;
  const reviewFeeRow: ReceiptRowItem =
    reviewGasUsd != null && reviewGasUsd > 0
      ? buildFeeRow({
          label: t("operate.fee"),
          lines: [{ key: "network", label: t("operate.networkFee"), usd: reviewGasUsd }],
          totalLabel: t("manage.close.feesTooltip.total"),
        })
      : { label: t("operate.fee"), value: t("confirm.feePending") };
  // POO-599 R1/R3: the shared Review re-quote countdown — active on the Review; on each zero-crossing
  // it re-quotes via flow.rebuild() (re-runs ONLY the build, reusing the signed approve/permit) + resets.
  // POO-888 R3: the launch CTA suspends it synchronously (same-tick zero-cross vs send race).
  const { seconds: reviewCountdown, suspend: suspendReviewCountdown } = useReviewCountdown({
    active: phase === "review",
    seconds: REVIEW_REFRESH_SECS,
    onRefresh: flow.rebuild,
  });
  // POO-510 (POO-467 R10): the shared slippage auto-retry orchestration — one automatic retry from the
  // build step on the first slippage failure (the pending WalletSignModal shows the notice, no failed
  // view), then a slippage error view + settings auto-open on the second. Owns the one-shot; this step
  // only contributes its gear slippage + the settings opener. Non-slippage failures pass through
  // untouched (R4). The strategy does not exist yet at launch, so the analytics event carries the pool
  // id. Mock mode never runs `flow` (the mock launch path settles via managerService), so the hook is a
  // no-op there — the flow stays idle.
  const slippageRetry = useSlippageAutoRetry({
    flow,
    flowName: "createPool",
    strategyId: pool.id,
    slippagePct: slippage,
    onOpenSettings: () => setSettingsOpen(true),
  });

  // Post-write freshness: invalidate the catalog + re-render with a bounded poll (POO-364). There is
  // no local loader on /manager/new — the new strategy surfaces on the console via ?created=1 (below).
  const postWriteRefresh = usePostWriteRefresh();

  // POO-599 R5: guards the mock live persistence to fire exactly once (on the send's success), so a
  // rebuild / re-render can't create duplicate strategies, and a cancelled review creates none.
  const createdRef = useRef(false);
  // POO-308: the pending strategyId from the pre-tx metadata POST (threaded into the post-mine confirm),
  // a once-guard so confirm fires exactly once per launch (never a double wallet prompt), and a ref to
  // the writer so the success effect can call confirm without depending on the writer's changing
  // identity (its confirmStatus updates would otherwise re-fire the effect).
  const strategyIdRef = useRef<string | null>(null);
  const confirmedRef = useRef(false);
  const writerRef = useRef(metadataWriter);
  writerRef.current = metadataWriter;
  // POO-599 R5: the mock live launch persists on the send's SUCCESS (not upfront), mirroring the real
  // path — so backing out of the Review before signing never leaves a phantom strategy. Entry / exit /
  // management are locked at 0 in V1 (only performance is set).
  const persistMockLaunch = useCallback(async () => {
    const range = selection.full
      ? { full: true as const, minPrice: null, maxPrice: null }
      : {
          full: false as const,
          minPrice: Number.parseFloat(selection.minPrice) || null,
          maxPrice: Number.parseFloat(selection.maxPrice) || null,
        };
    try {
      const result = await managerService.createStrategy({
        name: strategyName,
        description: description.trim().length > 0 ? description.trim() : null,
        logoUrl,
        poolId: pool.id,
        riskLevel: derived.riskLevel,
        category: categoryLabel,
        estApyPct: pool.aprPct,
        range,
        fees: { entryPct: 0, exitPct: 0, managementPct: 0, performancePct: perfNum },
        access: STRATEGY_ACCESS,
        asDraft: false,
      });
      setCreated(result);
      setPhase(result.verification.status === "verified" ? "live" : "failed");
      postWriteRefresh();
    } catch {
      setPhase("failed");
    }
  }, [
    selection,
    strategyName,
    description,
    logoUrl,
    pool.id,
    pool.aprPct,
    derived.riskLevel,
    categoryLabel,
    perfNum,
    postWriteRefresh,
  ]);

  // POO-599: drive the whole build→review→sign handshake off the runner (both modes now run `flow`).
  // The build settling into `awaiting` advances the signing stepper to the Review; the Review approve
  // resumes into the send; the send's success lists the strategy (real: snapshot the receipt; mock:
  // persist once), and any non-auto-retried failure routes to the failed view. A rebuild from the
  // Review re-pauses (awaiting) and keeps us on the Review.
  useEffect(() => {
    if (phase !== "signing" && phase !== "review") return;
    if (flow.status === "awaiting") {
      if (phase === "signing") setPhase("review");
      return;
    }
    if (flow.status === "success") {
      if (realMode) {
        // POO-524 R2: snapshot the receipt AT TX TIME (transaction display rule) — the seeded per-token
        // amounts + USD + mined hash — captured once so later price/seed changes can't rewrite it.
        setLaunchReceipt({ tokens: seedTokens, txHash: flow.txHash });
        setPhase("live");
        // POO-308 [R3]/[R6]: the strategy renders immediately (pending badge); confirm the on-chain
        // create (pending_onchain -> live) and drive POO-638 convergence on the mined receipt block so
        // the badge clears when the indexer catches up. Guarded to fire ONCE (never a double wallet
        // prompt). The writer is read via a ref so its confirmStatus updates don't re-fire this effect.
        const strategyId = strategyIdRef.current;
        const blockNumber = flow.context.blockNumber ?? undefined;
        if (strategyId && flow.txHash && !confirmedRef.current) {
          confirmedRef.current = true;
          writerRef.current.confirm({
            strategyId,
            txHash: flow.txHash,
            blockNumber,
            network: pool.network,
          });
        }
        // Pass the convergence hint (mined block + strategy id) so the shared post-write refresh polls
        // the v2 onchain block deterministically; without a block it falls back to the blind poll.
        postWriteRefresh(
          strategyId && blockNumber != null
            ? { blockNumber, strategyIds: [strategyId] }
            : undefined,
        );
      } else if (!createdRef.current) {
        createdRef.current = true;
        void persistMockLaunch();
      }
      return;
    }
    if (flow.status === "error") {
      // POO-510 R2: the FIRST slippage failure auto-retries (retryFrom build, running through the
      // pause) — keep the phase (the pending WalletSignModal shows the notice), do not flip to failed.
      if (slippageRetry.autoRetrying) return;
      setPhase("failed");
    }
  }, [
    phase,
    realMode,
    flow.status,
    flow.txHash,
    flow.context.blockNumber,
    pool.network,
    seedTokens,
    slippageRetry.autoRetrying,
    postWriteRefresh,
    persistMockLaunch,
  ]);

  // POO-497 [R3]: the create flow never builds a position on a pool without a defined market price.
  // No-price pools are filtered out of the picker (POO-497 [R1]); this is the defensive backstop — if
  // a no-price pool (the `currentPrice <= Number.MIN_VALUE` sentinel) ever reaches Review, Launch stays
  // blocked so the flow cannot proceed on it.
  const poolPriceKnown = pool.currentPrice > Number.MIN_VALUE;

  // Real mode also requires both seed amounts to be valid (> 0, within balance), a resolvable tick
  // range (a too-tight range that collapses after snapping cannot mint), and the USD minimum.
  const canSubmit =
    perfValid &&
    strategyName.length > 0 &&
    nameLengthValid &&
    poolPriceKnown &&
    phase === "form" &&
    // POO-701 [R2]: never launch while the logo is still uploading — the https URL must be staged first.
    !logoUploading &&
    (!realMode || (seed.valid && rangeTicks !== null && !belowMinUsd));

  // Per-field reasons the Launch CTA is blocked, surfaced on tap/hover (PP-CORE-CMP-022). Mirrors
  // `canSubmit` minus `phase` (always "form" while the form branch renders). Reuses existing labels
  // so no new locale churn beyond the shared "missing.title" heading.
  const missing: string[] = [];
  if (!(strategyName.length > 0 && nameLengthValid)) missing.push(t("mandate.nameLabel"));
  if (!perfValid) missing.push(t("review.fees.performance"));
  // POO-701 [R2]: while the logo is uploading, block Launch and say why (mirrors the manager
  // Profile-tab mediaUploading gate) so the manager waits for the staged https URL.
  if (logoUploading) missing.push(t("mandate.logoUploading"));
  // POO-497 [R3]: surface the price-less pool as a blocker (reuses the existing "Pool" summary label,
  // no new i18n key). Unreachable in normal use — no-price pools never make it past the picker.
  if (!poolPriceKnown) missing.push(t("review.summary.pool"));
  if (realMode) {
    if (!seed.valid) missing.push(t("review.seed.title"));
    if (rangeTicks === null) missing.push(t("review.summary.range"));
    if (belowMinUsd) {
      missing.push(t("review.seed.minUsd", { amount: formatUsd(MIN_AMOUNT_FOR_CREATE_POOL) }));
    }
  }
  /** The lifted selection with this step's identity edits merged in. */
  const withIdentity = (): MandateSelection => ({
    ...selection,
    name: strategyName,
    description: description.trim(),
    logoUrl,
  });
  // Mirror identity edits up to the wizard shell so stepping back via the stepper (not just the
  // Back button) keeps name / logo / description. onIdentityChange is stable, so this fires only
  // when an identity field actually changes — no render loop.
  useEffect(() => {
    onIdentityChange?.({ name: strategyName, description: description.trim(), logoUrl });
  }, [strategyName, description, logoUrl, onIdentityChange]);
  const comingSoonLabel = tProfile("security.comingSoon");
  const stepPerformance = (direction: -1 | 1) => {
    const base = Number.isFinite(perfNum) ? perfNum : PERF_MIN;
    setPerformance(String(Math.min(PERF_MAX, Math.max(PERF_MIN, base + direction))));
  };

  const feeNum = (value: string) => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  async function submit(asDraft: boolean) {
    if (!perfValid) return;
    // POO-701 [R2]: never launch mid-upload — the staged https logo URL must be resolved first (the
    // CtaWithMissing gate already blocks the CTA; this is the belt-and-suspenders guard on submit).
    if (logoUploading) return;

    // Real mode: create the pool on-chain (seed deposit + create-pool tx). No draft path on-chain.
    if (realMode) {
      if (preparing) return; // guard against a double Launch while the pre-tx write is in flight
      if (!seed.valid || seed.amount0 === null || seed.amount1 === null) return;
      // Guarded by canSubmit, but keep TS honest: never mint without a resolved range + input.
      if (!rangeTicks || !createPoolInput) return;

      // POO-308 [R1]/[R7]: persist the strategy metadata (logo + category + fees + access, dropped by
      // the on-chain build today) BEFORE the tx. The signed POST returns the pending strategyId the
      // post-mine confirm ([R3]) flips to live. A failure here is non-fatal (nothing is on-chain yet):
      // surface an inline retry ([R5]) and abort the launch.
      setMetadataError(false);
      setPreparing(true);
      // POO-830 R3/R4/R7: derive the OBJECTIVE at creation from the committed (canonical) range and
      // persist it — the objective is NOT pair-derivable on the investor read, so it must be stored.
      // The backend DTO whitelist strips it until supported (harmless); the seam is in mapStrategyV2.
      const objective = deriveBuilderStrategyTagsForPool(pool, {
        full: selection.full,
        minPrice: selection.full ? null : Number.parseFloat(selection.minPrice) || null,
        maxPrice: selection.full ? null : Number.parseFloat(selection.maxPrice) || null,
      }).objectiveTags;
      const strategyId = await metadataWriter.create(
        buildStrategyMetadata({
          name: strategyName,
          description,
          logoUrl,
          // Persist the STABLE category enum (localized at render), never the localized label — the v2
          // POST is shared backend data, so a locale-variant label would leak one manager's locale to all.
          category: derived.categoryKey,
          // POO-830 R7: the derived objective (canonical keys), persisted alongside category.
          objective,
          // The DTO reuses the pp-api RiskProfile enum; classify the pool's token pair with the canonical
          // FE mirror. The 1-5 band (derived.riskLevel) stays UI-only (RiskBars / riskLabels).
          riskProfile: getRiskProfile(pool.token0, pool.token1),
          performancePct: perfNum,
          access: STRATEGY_ACCESS,
        }),
      );
      setPreparing(false);
      if (!strategyId) {
        setMetadataError(true);
        return;
      }
      strategyIdRef.current = strategyId;

      // POO-599 R3: the launch is "submitted" once here — the flow-start, before the signatures (the
      // Review approve later only resumes the send, so it must NOT re-fire this event).
      track("strategy_launch_submitted", { strategy_id: pool.id });
      // POO-599 R1: run the sequence with the build pause — the runner advances the stepper on each
      // settlement, pauses at build for the Review, then resumes into the send. reset() rebuilds the
      // per-step arrays for the current input before the run starts.
      createdRef.current = false;
      confirmedRef.current = false;
      setPhase("signing");
      flow.reset();
      void flow.run();
      return;
    }

    // Mock draft — no on-chain equivalent: settle via managerService straight to the draft state.
    if (asDraft) {
      setPhase("verifying");
      const range = selection.full
        ? { full: true, minPrice: null, maxPrice: null }
        : {
            full: false,
            minPrice: Number.parseFloat(selection.minPrice) || null,
            maxPrice: Number.parseFloat(selection.maxPrice) || null,
          };
      try {
        const result = await managerService.createStrategy({
          name: strategyName,
          description: description.trim().length > 0 ? description.trim() : null,
          logoUrl,
          poolId: pool.id,
          riskLevel: derived.riskLevel,
          category: categoryLabel,
          estApyPct: pool.aprPct,
          range,
          fees: {
            entryPct: feeNum(entry),
            exitPct: feeNum(exit),
            managementPct: feeNum(management),
            performancePct: perfNum,
          },
          // POO-495 [R4]/[R7]: single source of truth — the same value shown in the Access rows.
          access: STRATEGY_ACCESS,
          asDraft: true,
        });
        setCreated(result);
        // POO-453 R8: bust the catalog so the new draft shows on the Manage-strategies list at once.
        postWriteRefresh();
        setPhase("draft");
      } catch {
        setPhase("failed");
      }
      return;
    }

    // POO-599 R5: mock LIVE launch runs the synthetic build→review→sign handshake (mockCreatePoolSteps)
    // exactly like real mode; the strategy is persisted on the send's success (outcome effect →
    // persistMockLaunch), never upfront, so a cancelled Review leaves no phantom strategy. R3: the
    // submitted event fires once here (the flow-start), not on the Review approve.
    track("strategy_launch_submitted", { strategy_id: pool.id });
    createdRef.current = false;
    setPhase("signing");
    flow.reset();
    void flow.run();
  }

  // Wallet-signing steps shown while the launch tx is in flight (PP-CORE-MOD-009). Real mode: approve
  // each seeded token; mock mode: a representative two-token spec so the steps are visible.
  const signApprovals = realMode
    ? [
        seed.amount0 && seed.amount0 > BigInt(0) ? pool.token0 : null,
        seed.amount1 && seed.amount1 > BigInt(0) ? pool.token1 : null,
      ].filter((token): token is string => token !== null)
    : [pool.token0, pool.token1];

  // --- Outcome states -------------------------------------------------------
  if (phase === "signing") {
    return (
      <WalletSignModal
        open
        onOpenChange={() => {}}
        title={t("review.creating")}
        summary={
          <div className="flex flex-col gap-2">
            {/* POO-510 R2: the auto-retry notice sits in the pending WalletSignModal (the flow re-runs
                from build; the notice makes the possible wallet re-prompt legible). Reuses the shared
                strategies.flow.slippage.retryNotice copy — no new manager-namespace key. */}
            {slippageRetry.autoRetrying ? (
              <p className="rounded-md bg-warning/10 px-3 py-2 text-center text-warning text-sm">
                {tStrategies("flow.slippage.retryNotice", { value: slippageRetry.slippagePct })}
              </p>
            ) : null}
            <p className="text-muted-foreground text-sm">{t("review.creatingNote")}</p>
          </div>
        }
        // POO-599 R5: both modes now run the wallet-sign flow (mock uses mockCreatePoolSteps), so the
        // stepper is controlled by the runner in both — the build step + the build→review pause are the
        // same path in mock and real.
        spec={{ approvals: signApprovals, permit2: true, build: true, confirm: "addLiquidity" }}
        activeStep={flow.activeStep}
        statuses={flow.statuses}
        txHashes={flow.txHashes}
      />
    );
  }
  // POO-599 R1-R4: the post-build Review — renders the built figures (real gas or the honest pending
  // placeholder) with the 10s re-quote countdown, before the final send. Gearless (R4: the gear stays
  // on the pre-build Launch confirm). Approve resumes the paused flow into the send; Back abandons it.
  if (phase === "review") {
    return (
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) {
            flow.reset();
            setPhase("form");
          }
        }}
      >
        <DialogContent
          className="max-w-md"
          aria-describedby={undefined}
          // POO-893 [R1][R2]: this is the app's only fresh-mount <Dialog open> (signing -> review),
          // so Radix's open-autofocus would land on the FIRST tabbable, the fee (i) trigger, and
          // auto-open its tooltip (Radix Tooltip opens on any non-pointer focus). Prevent it and
          // focus the dialog CONTAINER (event target, tabindex="-1") explicitly: a prevented mount
          // autofocus makes FocusScope 1.1.7 skip its container fallback too, stranding focus on
          // body. Container focus keeps the WAI-ARIA dialog contract, opens no tooltip, and avoids
          // the Launch button (Enter-to-confirm in a money flow risks accidental sends). Focus
          // trap, Esc and tab order ((i) -> Launch -> Back -> close X) are unchanged.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("review.title")}</DialogTitle>
          </DialogHeader>
          {/* POO-599 R3: the visible re-quote countdown — the built figures refresh when it hits 0. */}
          <p className="flex items-center justify-center gap-1.5 text-muted-foreground text-xs">
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {tStrategies("flow.review.refreshIn", { seconds: reviewCountdown })}
          </p>
          {/* POO-885 R2/R4: subtle stale-quote hint after 3 consecutive background re-quote
              failures (non-fatal; the countdown keeps retrying with the last good quote). */}
          {flow.quoteStale ? (
            <p className="text-center text-warning text-xs">
              {tStrategies("flow.review.quoteStale")}
            </p>
          ) : null}
          <ReceiptRows
            className="mt-1"
            groups={[
              [
                { label: t("review.nameLabel"), value: strategyName },
                { label: t("confirm.launchPool"), value: `${pool.token0}/${pool.token1}` },
                ...(seedTokens
                  ? [
                      {
                        label: t("review.seed.title"),
                        value: <SeedTokenList tokens={seedTokens} />,
                      } satisfies ReceiptRowItem,
                    ]
                  : []),
                reviewFeeRow,
              ],
            ]}
          />
          <div className="mt-2 flex flex-col gap-2">
            <Button
              size="lg"
              onClick={() => {
                // POO-599 R3: the tx is already built (paused after build); approving resumes into the
                // send. The build is NOT re-run, and the submit event already fired on the flow-start.
                // POO-888 R3: suspend the re-quote countdown SYNCHRONOUSLY first, so a zero-crossing
                // in this same tick cannot race the send.
                suspendReviewCountdown();
                setPhase("signing");
                void flow.resume();
              }}
            >
              {t("review.launch")}
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => {
                flow.reset();
                setPhase("form");
              }}
            >
              {tStrategies("withdraw.review.back")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  if (phase === "verifying") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
        <p className="font-medium text-foreground">
          {realMode ? t("review.creating") : t("review.verifying")}
        </p>
        <p className="max-w-sm text-muted-foreground text-sm">
          {realMode ? t("review.creatingNote") : t("review.verifyingNote")}
        </p>
      </div>
    );
  }
  if (phase === "live" || phase === "draft") {
    const isLive = phase === "live";
    const displayName = created?.strategy.name ?? strategyName;
    // POO-524 R2: the receipt renders only when the on-chain launch recorded something (seed rows
    // and/or a mined hash); the mock create keeps the plain success view (no fabricated receipt).
    const showReceipt =
      isLive &&
      launchReceipt != null &&
      (launchReceipt.tokens != null || launchReceipt.txHash != null);
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        {isLive ? (
          <CheckCircle2 className="size-12 text-success" aria-hidden="true" />
        ) : (
          <FileText className="size-12 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold text-foreground text-xl">
            {isLive ? t("review.live.title") : t("review.draft.title")}
          </h2>
          <p className="max-w-sm text-muted-foreground text-sm">
            {isLive
              ? realMode
                ? t("review.live.bodyChain", { name: displayName })
                : t("review.live.body", { name: displayName })
              : t("review.draft.body", { name: displayName })}
          </p>
        </div>
        {/* POO-308 [R6]: the just-created strategy renders immediately with a PENDING badge that
            deterministic convergence (POO-638) clears to live; a confirm-write failure surfaces a
            NON-BLOCKING retry ([R5]) — the pool is already on-chain, so the launch never rolls back. */}
        {isLive && realMode ? (
          metadataWriter.confirmStatus === "error" ? (
            <div className="flex flex-col items-center gap-2">
              <p className="max-w-sm text-warning text-xs">{t("review.metadata.failed")}</p>
              <Button size="sm" variant="secondary" onClick={() => metadataWriter.retryConfirm()}>
                {t("review.metadata.retry")}
              </Button>
            </div>
          ) : metadataWriter.confirmStatus === "pending" ? (
            <span
              data-testid="launch-pending-badge"
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-raised px-3 py-1 text-muted-foreground text-xs"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              {t("review.pending.badge")}
            </span>
          ) : null
        ) : null}
        {/* POO-524 R2: the launch receipt — seeded per-token amounts + USD captured at tx time and
            the Transaction row with the mined hash + explorer link. */}
        {showReceipt && launchReceipt ? (
          <div className="flex w-full max-w-sm flex-col gap-2 text-left">
            <ReceiptRows
              groups={[
                ...(launchReceipt.tokens
                  ? [
                      [
                        {
                          label: t("review.seed.title"),
                          value: <SeedTokenList tokens={launchReceipt.tokens} />,
                        } satisfies ReceiptRowItem,
                      ],
                    ]
                  : []),
                ...(launchReceipt.txHash
                  ? [
                      [
                        {
                          label: tStrategies("flow.receipt.transaction"),
                          value: formatTxHash(launchReceipt.txHash),
                        } satisfies ReceiptRowItem,
                      ],
                    ]
                  : []),
              ]}
            />
            <ExplorerTxLink network={pool.network} hash={launchReceipt.txHash} />
          </div>
        ) : null}
        <Button size="lg" onClick={() => router.push("/manager?created=1")}>
          {isLive ? t("review.live.cta") : t("review.draft.cta")}
        </Button>
      </div>
    );
  }
  if (phase === "failed") {
    // POO-510 R3: the SECOND slippage failure swaps the generic failed copy for the slippage-specific
    // title/body (shared strategies.flow.slippage.* keys, interpolating the gear value). R4: any other
    // failure keeps the generic manager copy unchanged.
    const failedTitle = slippageRetry.slippageError
      ? tStrategies("flow.slippage.errorTitle")
      : t("review.failed.title");
    const failedBody = slippageRetry.slippageError
      ? tStrategies("flow.slippage.errorBody", { value: slippageRetry.slippagePct })
      : realMode
        ? t("review.failed.bodyChain")
        : t("review.failed.body");
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <h2 className="font-semibold text-foreground text-xl">{failedTitle}</h2>
        <p className="max-w-sm text-muted-foreground text-sm">{failedBody}</p>
        <Button
          size="lg"
          variant="secondary"
          onClick={() => {
            if (realMode) {
              // POO-887 R2/R4: "signing" already re-engages this host's awaiting → review mapping,
              // so a pre-Review retry that re-pauses (flow.retry re-honoring pauseAfterKey) lands
              // back on the Review - no phase fork needed here, unlike the five modal hosts.
              setPhase("signing");
              // POO-510 R3: after a slippage error + raising the gear, Back to review re-runs from the
              // build step so the backend re-quotes at the new slippage (the rebuilt steps carry it).
              // R4: a non-slippage failure keeps today's resume-from-failed-step semantics (the
              // already-approved tokens + the signed permit are reused).
              if (slippageRetry.slippageError) void flow.retryFrom("build");
              else void flow.retry();
            } else {
              setPhase("form");
            }
          }}
        >
          {t("review.failed.cta")}
        </Button>
        {/* POO-510 R3: the settings dialog is mounted here too so the slippage error's auto-open (the
            hook calls onOpenSettings) is visible in the failed phase — the manager can raise the gear
            before Back to review re-runs from the build step. Same props as the form branch. */}
        <TransactionSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          slippage={slippage}
          onSlippageChange={setSlippage}
          deadlineMins={deadlineMins}
          onDeadlineChange={setDeadlineMins}
        />
      </div>
    );
  }

  // --- Form -----------------------------------------------------------------
  const cardClass = "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4";

  return (
    <div className="flex flex-col gap-6">
      {/* POO-550: the tx settings gear (Max slippage + Transaction deadline) moved OFF the Review page
          and INTO the Launch strategy confirm modal (below), so the controls sit at the point of
          signing like the transactional modals — not on the review page (murilo 2026-07-04). */}
      <h2 className="font-semibold text-foreground text-lg">{t("review.title")}</h2>

      {/* Strategy identity (name + optional logo / description) is set HERE — moved out of the
          Mandate step (murilo 2026-06-12). Reuses the mandate.* identity keys so no locale churn. */}
      <div className="flex flex-col gap-2">
        <p className="font-medium text-foreground text-sm">{t("mandate.identityLabel")}</p>
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center gap-1.5">
            {/* The circle itself opens the picker (shares the input below via htmlFor). */}
            <label htmlFor="strategy-logo-input" className="cursor-pointer">
              {logoUrl ? (
                <img src={logoUrl} alt="" className="size-14 rounded-full object-cover" />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-14 items-center justify-center rounded-full bg-surface-raised font-semibold text-lg text-muted-foreground"
                >
                  {(strategyName[0] ?? "?").toUpperCase()}
                </span>
              )}
            </label>
            <label className="cursor-pointer text-primary text-xs hover:underline">
              {logoUrl ? t("mandate.logoChange") : t("mandate.logoAdd")}
              <input
                id="strategy-logo-input"
                type="file"
                accept={IMAGE_ACCEPT_ATTR}
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // POO-586 R1/R2: reject a wrong-type or >10 MB file before the crop opens; surface
                  // the error and never build an object URL for it.
                  if (file && !validateImageFile(file).ok) {
                    setLogoError(true);
                  } else if (
                    file &&
                    typeof URL !== "undefined" &&
                    typeof URL.createObjectURL === "function"
                  ) {
                    setLogoError(false);
                    // Open the crop modal on the picked image; the cropped result becomes the logo.
                    setCropSrc(URL.createObjectURL(file));
                  }
                  // Reset so re-picking the same file fires onChange again.
                  event.target.value = "";
                }}
              />
            </label>
            {logoUrl ? (
              <button
                type="button"
                onClick={() => setLogoUrl(null)}
                className="text-muted-foreground text-xs hover:text-foreground"
              >
                {t("mandate.logoRemove")}
              </button>
            ) : null}
            {/* POO-586 R3: the image-limit error, under the logo controls (cleared on the next valid
                pick). */}
            {logoError ? (
              <p className="text-destructive text-xs">
                {tCommon("validation.imageTooLargeOrType")}
              </p>
            ) : null}
            {/* POO-701 [R1]: the logo upload/mint failed (e.g. media hosting not configured); the local
                crop preview is kept so the edit is not lost. Cleared when a new crop is applied. Reuses
                the manager profile-tab upload-failed copy (no new locale key). */}
            {logoUploadFailed ? (
              <p className="text-destructive text-xs" role="alert">
                {t("profileTab.mediaUploadFailed")}
              </p>
            ) : null}
          </div>
          <div className="flex-1">
            <Input
              label={t("mandate.nameLabel")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("mandate.namePlaceholder")}
            />
            {nameError ? (
              <p className="mt-1.5 text-destructive text-xs">{t("review.nameLengthError")}</p>
            ) : null}
          </div>
        </div>
        {/* Description (optional, POO-278 [R5]): the strategy's thesis, surfaced to investors as
            the prospectus "about". */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="strategy-description" className="font-medium text-foreground text-sm">
            {t("mandate.descriptionLabel")}{" "}
            <span className="font-normal text-muted-foreground text-xs">
              {t("mandate.descriptionOptional")}
            </span>
          </label>
          <textarea
            id="strategy-description"
            value={description}
            maxLength={DESCRIPTION_MAX}
            rows={3}
            placeholder={t("mandate.descriptionPlaceholder")}
            onChange={(event) => setDescription(event.target.value)}
            className={cn(
              "flex w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-foreground text-sm",
              "placeholder:text-muted-foreground outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring",
            )}
          />
          <p className="self-end text-muted-foreground text-xs" aria-hidden="true">
            {description.length} / {DESCRIPTION_MAX}
          </p>
        </div>
      </div>

      {/* Mandate summary (derived, read-only) */}
      <div className={cardClass}>
        <p className="font-medium text-foreground text-sm">{t("review.summary.title")}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{t("review.summary.pool")}</dt>
            <dd className="font-medium text-foreground">
              {pool.token0}/{pool.token1}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{t("review.summary.network")}</dt>
            <dd className="flex items-center gap-1.5 font-medium text-foreground">
              <NetworkLogo network={pool.network} name={pool.networkName} />
              {pool.networkName}
            </dd>
          </div>
          <div className="col-span-2 flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{t("review.summary.protocol")}</dt>
            <dd>
              <ProtocolBadge className="font-medium text-foreground" />
            </dd>
          </div>
          {/* POO-495 [R1]/[R3]: Fee tier, half-width, paired with Range; same feeTierLabel as the modal. */}
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{t("review.summary.feeTier")}</dt>
            <dd className="font-medium text-foreground">{feeTierLabel}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{t("review.summary.range")}</dt>
            <dd className="font-medium text-foreground">{rangeSummary}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{t("review.summary.category")}</dt>
            <dd className="font-medium text-foreground">{categoryLabel}</dd>
          </div>
          {/* POO-495 [R3]: Risk drops from full-width to half-width so it pairs with Category and the
              new Access row (below) sits half-width, never full-width. */}
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-xs">{t("review.summary.risk")}</dt>
            <dd className="flex items-center gap-2">
              <RiskBars level={derived.riskLevel} />
              <span className="font-medium text-foreground">{riskLabels[derived.riskLevel]}</span>
            </dd>
          </div>
          {/* POO-495 [R2]: Access read-back (Public in V1). Value from STRATEGY_ACCESS via accessLabel,
              identical to the confirm modal and to what createStrategy is sent. */}
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{t("review.access.title")}</dt>
            <dd className="font-medium text-foreground">{accessLabel}</dd>
          </div>
        </dl>
      </div>

      {/* Seed liquidity — real mode only (the on-chain create requires depositing both tokens). */}
      {realMode ? (
        <div className="flex flex-col gap-1.5">
          <SeedLiquidityCard
            pool={pool}
            tickLower={rangeTicks?.tickLower ?? null}
            tickUpper={rangeTicks?.tickUpper ?? null}
            onChange={handleSeedChange}
          />
          {belowMinUsd ? (
            <p className="text-destructive text-xs">
              {t("review.seed.minUsd", { amount: formatUsd(MIN_AMOUNT_FOR_CREATE_POOL) })}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Fees */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-medium text-foreground text-sm">{t("review.fees.title")}</p>
          <p className="text-muted-foreground text-xs">{t("review.fees.subtitle")}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FeeField
            label={t("review.fees.entry")}
            value={entry}
            locked
            comingSoonLabel={comingSoonLabel}
            tooltip={t("review.fees.entryInfo")}
            showUnitToggle
          />
          <FeeField
            label={t("review.fees.exit")}
            value={exit}
            locked
            comingSoonLabel={comingSoonLabel}
            tooltip={t("review.fees.exitInfo")}
            showUnitToggle
          />
          <FeeField
            label={t("review.fees.management")}
            value={management}
            locked
            comingSoonLabel={comingSoonLabel}
            tooltip={t("review.fees.managementInfo")}
          />
          <FeeField
            label={t("review.fees.performance")}
            value={performance}
            onChange={setPerformance}
            onStep={stepPerformance}
            tooltip={t("review.fees.performanceInfo")}
            description={
              perfValid
                ? t("review.fees.performanceHint", { min: PERF_MIN, max: PERF_MAX })
                : undefined
            }
            error={
              perfValid
                ? undefined
                : t("review.fees.performanceError", { min: PERF_MIN, max: PERF_MAX })
            }
          />
        </div>
      </div>

      {/* Access — Public only in V1 */}
      <div className={cardClass}>
        <p className="font-medium text-foreground text-sm">{t("review.access.title")}</p>
        <div className="flex items-center gap-2 rounded-lg border border-primary bg-primary/10 p-3">
          <BadgeCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex flex-col">
            <span className="font-medium text-foreground text-sm">{t("review.access.public")}</span>
            <span className="text-muted-foreground text-xs">{t("review.access.publicNote")}</span>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">{t("review.access.privateSoon")}</p>
      </div>

      {/* Investor preview */}
      <div className={cardClass}>
        <p className="font-medium text-foreground text-sm">{t("review.preview.title")}</p>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <StrategyLogo url={logoUrl} name={strategyName} className="size-8 text-sm" />
              <h3 className="truncate font-semibold text-foreground">{strategyName}</h3>
            </div>
            {/* POO-280 R4: no verified badge beside a STRATEGY name (Product Rules 11). */}
          </div>
          <p className="text-muted-foreground text-xs">{categoryLabel}</p>
          <div className="flex items-center justify-between gap-2">
            <RiskBars level={derived.riskLevel} />
            <span className="text-muted-foreground text-xs">{riskLabels[derived.riskLevel]}</span>
          </div>
          <div className="flex items-end justify-between gap-2 pt-1">
            <span className="text-muted-foreground text-xs">
              {pool.token0}/{pool.token1}
            </span>
            <div className="text-right">
              <p className="text-muted-foreground text-xs">{t("review.preview.est")}</p>
              <p className="font-semibold text-success">
                {formatPercent(pool.aprPct)}{" "}
                <AprTooltip className="font-normal text-[10px] text-muted-foreground uppercase">
                  APR
                </AprTooltip>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* POO-308 [R5]: the pre-tx metadata write failed (nothing is on-chain yet) — a non-blocking
          inline error; re-tapping Launch retries. */}
      {metadataError ? (
        <p className="text-destructive text-sm" role="alert">
          {t("review.metadata.createFailed")}
        </p>
      ) : null}

      {/* Actions — Launch confirms first (PP-MGR-MOD-002); Save as draft stores directly.
          Wizard convention: primary actions on the right, back on the left (row-reverse keeps
          Launch first on mobile). */}
      <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-start">
        <CtaWithMissing
          size="lg"
          missing={missing}
          missingTitle={t("missing.title")}
          onClick={() => setConfirmLaunch(true)}
        >
          {t("review.launch")}
        </CtaWithMissing>
        {/* Save as draft has no on-chain equivalent — hidden in real mode (POO-309 [R4]). */}
        {realMode ? null : (
          <Button size="lg" variant="secondary" disabled={!canSubmit} onClick={() => submit(true)}>
            {t("review.saveDraft")}
          </Button>
        )}
        <button
          type="button"
          onClick={() => onBack(withIdentity())}
          className="inline-flex items-center gap-1 self-start text-muted-foreground text-sm hover:text-foreground sm:mr-auto"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("builder.steps.build")}
        </button>
      </div>

      <ManagerActionModal
        open={confirmLaunch}
        onOpenChange={setConfirmLaunch}
        title={t("confirm.launchTitle")}
        description={t("confirm.launchBody")}
        details={[
          { label: t("review.nameLabel"), value: strategyName },
          { label: t("confirm.launchPool"), value: `${pool.token0}/${pool.token1}` },
          {
            label: t("review.summary.network"),
            value: (
              <span className="inline-flex items-center gap-1.5">
                <NetworkLogo network={pool.network} name={pool.networkName} />
                {pool.networkName}
              </span>
            ),
          },
          { label: t("review.summary.protocol"), value: <ProtocolBadge /> },
          // POO-495 [R1]: reuse the shared feeTierLabel so the modal can never diverge from the card.
          { label: t("review.summary.feeTier"), value: feeTierLabel },
          { label: t("review.summary.range"), value: rangeSummary },
          { label: t("review.summary.category"), value: categoryLabel },
          {
            label: t("review.summary.risk"),
            value: (
              <span className="inline-flex items-center gap-2">
                <RiskBars level={derived.riskLevel} />
                {riskLabels[derived.riskLevel]}
              </span>
            ),
          },
          // POO-495 [R2]/[R3]: Access row, after Risk and before Performance fee (extends POO-433's
          // 9-row modal to 10). Same accessLabel as the on-page card and the created payload.
          { label: t("review.access.title"), value: accessLabel },
          { label: t("confirm.launchPerf"), value: formatPercent(perfNum) },
        ]}
        confirmLabel={t("review.launch")}
        // POO-550: the Max slippage / deadline gear now lives on the Launch confirm (point of
        // signing), not the Review page. Opens the same TransactionSettingsDialog (mounted below).
        onOpenSettings={() => setSettingsOpen(true)}
        settingsLabel={tStrategies("invest.settings.title")}
        onConfirm={async () => {
          setConfirmLaunch(false);
          await submit(false);
          return undefined;
        }}
      >
        {/* POO-524 R1: the per-token seed amounts (real mode, once the card reports them) and ONE
            consolidated Fee row (network gas). Mock mode has no seed step, so only the Fee row
            renders there (with the PP-MOCK constant). */}
        <ReceiptRows
          groups={[
            [
              ...(seedTokens
                ? [
                    {
                      label: t("review.seed.title"),
                      value: <SeedTokenList tokens={seedTokens} />,
                    } satisfies ReceiptRowItem,
                  ]
                : []),
              confirmFeeRow,
            ],
          ]}
        />
      </ManagerActionModal>

      {/* Crop the picked strategy logo before it's applied (reuses the profile crop modal). */}
      <ImageCropModal
        open={cropSrc !== null}
        onOpenChange={(open) => {
          if (!open) setCropSrc(null);
        }}
        src={cropSrc ?? ""}
        aspect={1}
        round
        minZoom={0.5}
        title={t("mandate.logoCropTitle")}
        zoomLabel={t("profileTab.crop.zoom")}
        applyLabel={t("profileTab.crop.apply")}
        cancelLabel={t("profileTab.crop.cancel")}
        outputWidth={512}
        onApply={handleCropApply}
      />

      {/* POO-478 R3: Max slippage (POO-525 R1: seeded 2%; POO-547: uniform 0.1-100%, no cap) +
          Transaction deadline (30 min, display-only). No "Receive as" — create-pool has no payout
          choice. PP-INTEGRATION-POINT: the deadline is display-only until the create-pool build/tx
          consumes it (mirrors MoveRange/Close); the chosen slippage already flows into the build. */}
      <TransactionSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        slippage={slippage}
        onSlippageChange={setSlippage}
        deadlineMins={deadlineMins}
        onDeadlineChange={setDeadlineMins}
      />
    </div>
  );
}
