"use client";

import { useEffect, useMemo, useState } from "react";
import { createPublicClient, erc20Abi, http } from "viem";
import { arbitrum } from "viem/chains";
import { TOKENS } from "@/lib/aqua/config/public";
import { useAuth } from "@/lib/auth/useAuth";
import { cn } from "@/lib/utils/cn";
import { COPY } from "../copy";
import { formatUnits, formatUsdc } from "../format";
import { useAquaLiquidity } from "../hooks/useAquaLiquidity";

type Mode = "add" | "remove";

type Phase = "input" | "running" | "success" | "error";

/**
 * Add / remove liquidity against the vault.
 *
 * Deliberately a single component for both directions: they share the amount field, the
 * validation and the step runner, and the only real difference is which executor steps run and
 * what "max" means. Splitting them would duplicate the parts most likely to drift.
 *
 * Nothing here is mocked. The steps sign real transactions through the wallet, and the success
 * state links the real hash.
 */
export function AquaLiquidityModal({
  mode,
  open,
  onClose,
  onDone,
  positionShares,
  positionValueUsdc,
  liquidUsdc,
  seeded,
  roomUsdc,
}: {
  mode: Mode;
  open: boolean;
  onClose: () => void;
  /** Fired after a confirmed transaction so the page can re-read chain state. */
  onDone: () => void;
  positionShares: string | null;
  positionValueUsdc: string | null;
  liquidUsdc: string;
  seeded: boolean;
  /** Remaining headroom under maxTvl, raw USDC. */
  roomUsdc: string;
}) {
  const { address } = useAuth();
  const executor = useAquaLiquidity();

  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [stepLabel, setStepLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [walletUsdc, setWalletUsdc] = useState<bigint | null>(null);

  // Wallet balance drives "Max" on a deposit. Read on open so it is never stale by a session.
  useEffect(() => {
    if (!open || mode !== "add" || !address) return;
    let cancelled = false;
    createPublicClient({ chain: arbitrum, transport: http() })
      .readContract({
        address: TOKENS.USDC,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      })
      .then((balance) => {
        if (!cancelled) setWalletUsdc(balance);
      })
      .catch(() => {
        if (!cancelled) setWalletUsdc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, mode, address]);

  useEffect(() => {
    if (open) {
      setAmount("");
      setPhase("input");
      setError(null);
      setHash(null);
    }
  }, [open]);

  /** Deposits are entered in USDC; withdrawals in USDC too, converted to shares on submit. */
  const amountRaw = useMemo(() => toRawUsdc(amount), [amount]);

  const maxRaw = useMemo(() => {
    if (mode === "add") {
      const room = BigInt(roomUsdc);
      if (walletUsdc === null) return room;
      return walletUsdc < room ? walletUsdc : room;
    }
    // Remove: bounded by both the position's value and what the vault can actually pay today.
    const value = BigInt(positionValueUsdc ?? "0");
    const liquid = BigInt(liquidUsdc);
    return value < liquid ? value : liquid;
  }, [mode, roomUsdc, walletUsdc, positionValueUsdc, liquidUsdc]);

  const overMax = amountRaw !== null && amountRaw > maxRaw;
  const canSubmit =
    Boolean(address) &&
    amountRaw !== null &&
    amountRaw > BigInt(0) &&
    !overMax &&
    (mode === "add" ? seeded && maxRaw > BigInt(0) : BigInt(positionShares ?? "0") > BigInt(0));

  async function submit() {
    if (amountRaw === null || !address) return;
    setPhase("running");
    setError(null);

    try {
      const steps =
        mode === "add"
          ? executor.depositSteps(amountRaw)
          : // Convert the USDC the investor typed into shares, proportionally to their position.
            // Full exit uses the exact share balance so no dust is left behind by rounding.
            executor.redeemSteps(sharesFor(amountRaw, positionShares, positionValueUsdc));

      let last: string | null = null;
      for (const step of steps) {
        setStepLabel(labelForStep(step.key));
        const result = await step.run({});
        if (result && "txHash" in result && result.txHash) last = result.txHash;
      }
      setHash(last);
      setPhase("success");
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setPhase("error");
    }
  }

  if (!open) return null;

  const title = mode === "add" ? COPY.actions.addTitle : COPY.actions.removeTitle;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-t-2xl border border-border bg-surface p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-semibold text-foreground text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground text-sm hover:text-foreground"
          >
            Close
          </button>
        </div>

        {phase === "success" ? (
          <div className="flex flex-col gap-3">
            <p className="text-foreground text-sm">
              {mode === "add" ? "Deposit confirmed." : "Withdrawal confirmed."}
            </p>
            {hash ? (
              <a
                className="text-muted-foreground text-sm underline"
                href={`https://arbiscan.io/tx/${hash}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                View on Arbiscan
              </a>
            ) : null}
            <button type="button" className={primaryBtn} onClick={onClose}>
              {COPY.actions.done}
            </button>
          </div>
        ) : (
          <>
            <label className="block" htmlFor="aqua-amount">
              <span className="text-muted-foreground text-xs">{COPY.actions.amount}</span>
              <div className="mt-1 flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                <input
                  id="aqua-amount"
                  inputMode="decimal"
                  value={amount}
                  disabled={phase === "running"}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                  className="min-w-0 flex-1 bg-transparent text-foreground text-lg outline-none"
                />
                <span className="text-muted-foreground text-sm">USDC</span>
                <button
                  type="button"
                  disabled={phase === "running"}
                  onClick={() => setAmount(fromRawUsdc(maxRaw))}
                  className="rounded-md border border-border px-2 py-0.5 text-xs"
                >
                  {COPY.actions.max}
                </button>
              </div>
            </label>

            <p className="mt-2 text-muted-foreground text-xs">
              {mode === "add"
                ? `${COPY.actions.walletBalance}: ${walletUsdc === null ? "-" : formatUsdc(walletUsdc)}`
                : `Available now: ${formatUsdc(maxRaw)}`}
            </p>

            {overMax ? (
              <p className="mt-2 text-destructive text-xs">
                {mode === "add"
                  ? `The most you can add right now is ${formatUsdc(maxRaw)}.`
                  : COPY.actions.removeHelp}
              </p>
            ) : null}

            {mode === "add" && !seeded ? (
              <p className="mt-2 text-destructive text-xs">{COPY.actions.notSeeded}</p>
            ) : null}

            {error ? <p className="mt-3 text-destructive text-sm">{error}</p> : null}

            {phase === "running" ? (
              <p className="mt-3 text-muted-foreground text-sm" role="status">
                {stepLabel}
              </p>
            ) : null}

            <button
              type="button"
              className={cn(primaryBtn, "mt-4 w-full")}
              disabled={!canSubmit || phase === "running"}
              onClick={submit}
            >
              {address
                ? mode === "add"
                  ? COPY.actions.confirmAdd
                  : COPY.actions.confirmRemove
                : COPY.actions.connect}
            </button>

            <p className="mt-3 text-muted-foreground text-xs">
              {mode === "add" ? COPY.actions.addHelp : COPY.actions.removeHelp}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground text-sm disabled:cursor-not-allowed disabled:opacity-50";

function labelForStep(key: string): string {
  if (key === "approve") return COPY.actions.approving;
  if (key === "deposit") return COPY.actions.depositing;
  return COPY.actions.withdrawing;
}

/** "12.5" -> 12500000. Returns null on anything that is not a clean non-negative decimal. */
export function toRawUsdc(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  // More than 6 decimals is sub-cent dust USDC cannot represent; truncate rather than reject,
  // so pasting a long number does the obvious thing.
  const micros = `${frac}000000`.slice(0, 6);
  return BigInt(whole || "0") * BigInt(1_000_000) + BigInt(micros || "0");
}

function fromRawUsdc(raw: bigint): string {
  return formatUnits(raw, 6, 6).replace(/,/g, "");
}

/**
 * Shares to burn for a requested USDC amount.
 *
 * A full exit passes the EXACT share balance rather than a computed figure: the vault's share
 * price moves every block as Aave accrues, so a proportional calculation would leave dust
 * behind and the investor would never quite reach zero.
 */
export function sharesFor(
  amountRaw: bigint,
  positionShares: string | null,
  positionValueUsdc: string | null,
): bigint {
  const shares = BigInt(positionShares ?? "0");
  const value = BigInt(positionValueUsdc ?? "0");
  if (shares === BigInt(0) || value === BigInt(0)) return BigInt(0);
  if (amountRaw >= value) return shares;
  return (shares * amountRaw) / value;
}
