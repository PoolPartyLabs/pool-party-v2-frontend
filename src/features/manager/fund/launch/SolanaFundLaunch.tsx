/**
 * @id PP-MGR-CMP-108 (POO-2262)
 * @name SolanaFundLaunch
 * @implements-rules-version DEC-188, DEC-190, DEC-191, DEC-204 (founder rulings, unversioned)
 * @analytics-events none here: useSolanaV6Launch emits builder_launch_completed / builder_launch_failed.
 * @i18n-namespace manager
 *
 * The v6 launch page: connect the Manager's Solana wallet, create the Fund on Arbitrum with its
 * Robinhood and Solana spokes, then run the first Solana operations (capital to Solana, Kamino,
 * swap, Raydium). Every row links the transaction or account on its own explorer.
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Link } from "@/i18n/navigation";
import { getSolanaCreationOptionsAction } from "@/lib/api/v2/solanaLaunchActions";
import type { CreationOptions } from "@/lib/api/v2/solanaSchemas";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chain/explorer";
import { isMockMode } from "@/lib/services";
import { solscanAccountUrl, solscanTxUrl } from "@/lib/solana/explorer";
import {
  creationAmountsError,
  defaultCreationAmounts,
  formatRawUnits,
  SOLANA_CREATION_STEPS,
  SOLANA_OPERATION_STEPS,
  type SolanaCreationAmounts,
  type SolanaLaunchState,
  type SolanaLaunchStepId,
  type SolanaLaunchStepRecord,
} from "./solanaV6Launch";
import { type SolanaV6LaunchView, useSolanaV6Launch } from "./useSolanaV6Launch";

const KNOWN_ERRORS = new Set([
  "USER_REJECTED",
  "SOLANA_WALLET_REQUIRED",
  "V2_WALLET_REQUIRED",
  "SOLANA_SEED_BALANCE_LOW",
  "SOLANA_SEED_BELOW_MINIMUM",
  "SOLANA_STOCK_UNAVAILABLE",
  "SOLANA_POOL_NOT_ADMITTED",
  "CREATION_PLAN_STALE",
  "CREATION_BINDING_EXPIRED",
  "SOLANA_PLAN_MISMATCH",
  "UNSAFE_SOLANA_TRANSACTION",
  "SOLANA_BLOCKHASH_EXPIRED",
  "TRANSACTION_REVERTED",
  "SOLANA_TRANSACTION_FAILED",
  "SOLANA_BALANCE_EMPTY",
  "V2_UNAUTHORIZED",
  "SOLANA_DRAFT_UNAVAILABLE",
  "CREATION_AMOUNT_INVALID",
  "CREATION_SEED_BELOW_ONE_SHARE",
  "CREATION_SEED_BELOW_MIN_FIRST_DEPOSIT",
  "CREATION_SPOKE_CAP_ZERO",
  "CREATION_AMOUNT_ABOVE_MAX",
]);

export function SolanaFundLaunch({ draftId }: { draftId: string }) {
  const t = useTranslations("manager");
  if (isMockMode) return <p role="alert">{t("fundLaunch.realOnly")}</p>;
  return <RealSolanaFundLaunch draftId={draftId} />;
}

function RealSolanaFundLaunch({ draftId }: { draftId: string }) {
  const launch = useSolanaV6Launch(draftId);
  const [options, setOptions] = useState<CreationOptions | null>(null);
  useEffect(() => {
    let active = true;
    void getSolanaCreationOptionsAction().then((result) => {
      if (active && result.ok) setOptions(result.data);
    });
    return () => {
      active = false;
    };
  }, []);
  return <SolanaFundLaunchView launch={launch} options={options} />;
}

/** Presentation seam: wallet-free states for tests and stories. */
export function SolanaFundLaunchView({
  launch,
  options,
}: {
  launch: SolanaV6LaunchView;
  options: CreationOptions | null;
}) {
  const t = useTranslations("manager.solanaLaunch");
  const all = useTranslations("manager");
  const state = launch.state;
  const review = launch.draft?.review;
  const created = state?.steps.verify?.status === "done";
  const [amounts, setAmounts] = useState<SolanaCreationAmounts | null>(null);
  useEffect(() => {
    if (review && !amounts) setAmounts(defaultCreationAmounts(review));
  }, [review, amounts]);
  const frozen: SolanaCreationAmounts | null = state
    ? {
        seedAmount: state.request.seedAmount,
        minFirstDeposit: state.request.minFirstDeposit,
        spokeCap: state.request.spokeCap,
      }
    : amounts;
  const amountsError = !state && amounts ? creationAmountsError(amounts) : null;
  const operationsDone = state?.steps["final-report"]?.status === "done";
  const errorText = launch.error
    ? KNOWN_ERRORS.has(launch.error)
      ? t(`errors.${launch.error}`)
      : t("errors.generic", { code: launch.error })
    : null;
  if (!launch.draft)
    return (
      <section className="mx-auto max-w-3xl p-6" role="alert">
        <p>{t("draftMissing")}</p>
      </section>
    );
  if (!launch.supported)
    return (
      <section className="mx-auto max-w-3xl space-y-3 p-6" role="alert">
        <p>{t("notSolanaPlan")}</p>
        <Link className="underline" href="/manager">
          {t("backToManager")}
        </Link>
      </section>
    );
  const sol =
    launch.solanaBalanceLamports === null
      ? null
      : formatRawUnits(launch.solanaBalanceLamports.toString(), 9);
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <header className="space-y-1">
        <h1 className="font-semibold text-2xl">{t("title", { name: review?.name ?? "" })}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      <Card className="space-y-3 rounded-[20px] p-4">
        <h2 className="font-medium">{t("walletsTitle")}</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
          <dt className="text-muted-foreground">{t("evmWallet")}</dt>
          <dd className="break-all font-mono text-xs">{launch.manager ?? t("notSignedIn")}</dd>
          <dt className="text-muted-foreground">{t("solanaWallet")}</dt>
          <dd className="space-y-1">
            {launch.solanaAddress ? (
              <>
                <span className="block break-all font-mono text-xs">{launch.solanaAddress}</span>
                <span className="block text-muted-foreground text-xs">
                  {sol === null ? t("balanceUnknown") : t("solBalance", { sol })}
                </span>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={launch.connectSolana}>
                {t("connectSolana")}
              </Button>
            )}
          </dd>
        </dl>
        <p className="text-muted-foreground text-xs">{t("walletsHint")}</p>
      </Card>

      <Card className="space-y-3 rounded-[20px] p-4">
        <h2 className="font-medium">{t("amountsTitle")}</h2>
        <p className="text-muted-foreground text-xs">{t("amountsHint")}</p>
        {frozen && (
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["seedAmount", "seedLabel", "seedHint"],
                ["minFirstDeposit", "minimumLabel", "minimumHint"],
                ["spokeCap", "spokeCapLabel", "spokeCapHint"],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key} className="space-y-1">
                <AmountField
                  label={t(label)}
                  raw={frozen[key]}
                  disabled={!!state || launch.busy}
                  onChange={(raw) =>
                    setAmounts((current) => (current ? { ...current, [key]: raw } : current))
                  }
                />
                <p className="text-muted-foreground text-xs">
                  {t(hint, {
                    floor: formatRawUnits(
                      options?.amounts?.[key]?.min ??
                        (key === "seedAmount" ? "1002506" : key === "spokeCap" ? "1" : "0"),
                      6,
                    ),
                    fallback: formatRawUnits(options?.amounts?.[key]?.default ?? "50000000", 6),
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
        {amountsError && (
          <p role="alert" className="text-destructive text-xs">
            {t(`errors.${amountsError}`)}
          </p>
        )}
      </Card>

      <Card className="space-y-3 rounded-[20px] p-4">
        <h2 className="font-medium">{t("sealedTitle")}</h2>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          <li>{t("sealedNetworks")}</li>
          <li>{t("sealedSeed", { amount: frozen ? formatRawUnits(frozen.seedAmount, 6) : "" })}</li>
          <li>
            {t("sealedMinimum", {
              amount: frozen ? formatRawUnits(frozen.minFirstDeposit, 6) : "",
            })}
          </li>
          <li>
            {t("sealedSpokeCap", { amount: frozen ? formatRawUnits(frozen.spokeCap, 6) : "" })}
          </li>
          <li>{t("sealedReportAge", { seconds: options?.mandate.maxReportAge ?? 1600 })}</li>
          <li>
            {t("sealedFees", {
              management: (review?.managementFeeBps ?? 0) / 100,
              performance: (review?.performanceFeeBps ?? 0) / 100,
              payout: (review?.payoutFeeBps ?? 0) / 100,
            })}
          </li>
          <li>
            {t("sealedVenues", {
              venues: (state?.request.venues ?? [])
                .map((venue) => (venue.kind === "kamino" ? "Kamino USDC" : "Raydium SOL/USDC"))
                .join(", "),
            })}
          </li>
        </ul>
        {options && (
          <div className="space-y-1">
            <h3 className="font-medium text-sm">{t("assetsTitle")}</h3>
            <ul className="flex flex-wrap gap-2 text-xs">
              {options.assets.map((asset) => (
                <li
                  key={asset.id}
                  className={
                    asset.stock
                      ? "rounded-full border border-border px-2 py-0.5 text-muted-foreground opacity-70"
                      : "rounded-full border border-border px-2 py-0.5"
                  }
                  aria-disabled={asset.stock ? "true" : undefined}
                  title={asset.stock ? t("stockUnavailable") : undefined}
                >
                  {asset.symbol}
                  {asset.stock ? ` · ${t("unavailable")}` : ""}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">{t("stockUnavailable")}</p>
          </div>
        )}
      </Card>

      <StepList
        title={t("creationTitle")}
        steps={SOLANA_CREATION_STEPS}
        state={state}
        activeStep={launch.activeStep}
      />

      {state?.plan && <FundAccounts state={state} created={created} />}

      <Card className="space-y-3 rounded-[20px] p-4">
        <h2 className="font-medium">{t("operationsTitle")}</h2>
        <p className="text-muted-foreground text-xs">{t("operationsHint")}</p>
        {state && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["send", "amountSend"],
                ["kamino", "amountKamino"],
                ["swap", "amountSwap"],
                ["raydiumUsdc", "amountRaydium"],
              ] as const
            ).map(([key, label]) => (
              <AmountField
                key={key}
                label={t(label)}
                raw={state.amounts[key]}
                disabled={launch.busy || state.steps[stepOfAmount(key)]?.status === "done"}
                onChange={(raw) => launch.setAmount(key, raw)}
              />
            ))}
          </div>
        )}
      </Card>
      <StepList
        title={t("operationsStepsTitle")}
        steps={SOLANA_OPERATION_STEPS}
        state={state}
        activeStep={launch.activeStep}
      />

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4">
        <div className="min-h-5 text-xs">
          {errorText && (
            <p role="alert" className="text-destructive">
              {errorText}
            </p>
          )}
          {!errorText && launch.busy && <p role="status">{t("working")}</p>}
          {!errorText && operationsDone && <p role="status">{t("allDone")}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {launch.busy ? (
            <Button variant="secondary" onClick={launch.stop}>
              {t("pause")}
            </Button>
          ) : !created ? (
            <>
              {state?.plan && state.steps["create-fund"]?.status !== "done" && (
                <Button variant="ghost" onClick={launch.restartCreation}>
                  {t("restart")}
                </Button>
              )}
              <Button
                disabled={
                  !launch.solanaAddress ||
                  !launch.manager ||
                  (!state && (!amounts || !!amountsError))
                }
                onClick={() => {
                  if (state) launch.runCreation();
                  else if (amounts) launch.start(amounts);
                }}
              >
                {state ? t("resumeCreation") : t("start")}
              </Button>
            </>
          ) : (
            <>
              <Link
                className="inline-flex items-center rounded-md px-3 text-sm underline"
                href={`/strategies/${state?.plan?.core ?? ""}`}
              >
                {t("openFund")}
              </Link>
              {!operationsDone && (
                <Button disabled={!launch.solanaAddress} onClick={launch.runOperations}>
                  {t("runOperations")}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">{all("fundLaunch.realOnly")}</p>
    </section>
  );
}

function stepOfAmount(key: keyof SolanaLaunchState["amounts"]): SolanaLaunchStepId {
  return key === "send"
    ? "send-to-solana"
    : key === "kamino"
      ? "kamino-supply"
      : key === "swap"
        ? "swap"
        : "raydium-open";
}

function AmountField({
  label,
  raw,
  disabled,
  onChange,
}: {
  label: string;
  raw: string;
  disabled: boolean;
  onChange: (raw: string) => void;
}) {
  const [text, setText] = useState(formatRawUnits(raw, 6));
  useEffect(() => setText(formatRawUnits(raw, 6)), [raw]);
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <input
        className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-sm"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value.replace(/[^0-9.]/g, ""))}
        onBlur={() => {
          const [whole = "0", fraction = ""] = text.split(".");
          const next = `${whole || "0"}${fraction.slice(0, 6).padEnd(6, "0")}`.replace(
            /^0+(?=\d)/,
            "",
          );
          if (/^\d{1,30}$/.test(next)) onChange(next);
          else setText(formatRawUnits(raw, 6));
        }}
      />
    </label>
  );
}

function StepList({
  title,
  steps,
  state,
  activeStep,
}: {
  title: string;
  steps: readonly SolanaLaunchStepId[];
  state: SolanaLaunchState | null;
  activeStep: SolanaLaunchStepId | null;
}) {
  const t = useTranslations("manager.solanaLaunch");
  return (
    <Card className="space-y-2 rounded-[20px] p-4">
      <h2 className="font-medium">{title}</h2>
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const record = state?.steps[step] ?? { status: "idle" as const };
          return (
            <li
              key={step}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3"
              aria-current={activeStep === step ? "step" : undefined}
            >
              <div className="space-y-0.5">
                <p className="font-medium text-sm">
                  {index + 1}. {t(`steps.${step}.label`)}
                </p>
                <p className="text-muted-foreground text-xs">{t(`steps.${step}.hint`)}</p>
                <StepLinks record={record} />
              </div>
              <span
                className={
                  record.status === "done"
                    ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-500 text-xs"
                    : record.status === "failed"
                      ? "rounded-full bg-red-500/15 px-2 py-0.5 text-red-500 text-xs"
                      : "rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs"
                }
                role="status"
              >
                {t(`status.${record.status}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function StepLinks({ record }: { record: SolanaLaunchStepRecord }) {
  const t = useTranslations("manager.solanaLaunch");
  const links: Array<{ href: string; label: string }> = [];
  if (record.chain === "solana")
    for (const [index, signature] of (record.signatures ?? []).entries()) {
      const href = solscanTxUrl(signature);
      if (href) links.push({ href, label: t("solanaTx", { index: index + 1 }) });
    }
  else if (record.txHash && record.chain) {
    const href = explorerTxUrl(record.chain, record.txHash);
    if (href)
      links.push({ href, label: record.chain === 42161 ? t("arbiscanTx") : t("blockscoutTx") });
  }
  if (!links.length) return null;
  return (
    <p className="flex flex-wrap gap-2 text-xs">
      {links.map((link) => (
        <a
          key={link.href}
          className="underline"
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.label}
        </a>
      ))}
    </p>
  );
}

function FundAccounts({ state, created }: { state: SolanaLaunchState; created: boolean }) {
  const t = useTranslations("manager.solanaLaunch");
  const plan = state.plan;
  if (!plan) return null;
  const rows: Array<{ label: string; value: string; href: string | null }> = [
    { label: t("accountCore"), value: plan.core, href: explorerAddressUrl(42161, plan.core) },
    {
      label: t("accountRobinhood"),
      value: plan.robinhoodSpokeVault,
      href: explorerAddressUrl(4663, plan.robinhoodSpokeVault),
    },
    { label: t("accountFundPda"), value: plan.fundPda, href: solscanAccountUrl(plan.fundPda) },
    { label: t("accountVault"), value: plan.vault, href: solscanAccountUrl(plan.vault) },
    { label: t("accountUsdcAta"), value: plan.usdcAta, href: solscanAccountUrl(plan.usdcAta) },
  ];
  return (
    <Card className="space-y-2 rounded-[20px] p-4">
      <h2 className="font-medium">{created ? t("accountsCreated") : t("accountsPredicted")}</h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="break-all font-mono text-xs">
              {row.href ? (
                <a className="underline" href={row.href} target="_blank" rel="noopener noreferrer">
                  {row.value}
                </a>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-xs">
        {t("bindingExpiry", { at: new Date(plan.expiresAt).toLocaleString() })}
      </p>
    </Card>
  );
}
