/**
 * @name WalletStepsSandbox
 * Dev-only harness (not translated, internal tool) for PP-CORE-MOD-006 / 009 (POO-295). Drives the
 * generic {@link WalletSignModal} from a declarative spec and shows the `buildWalletSignSteps` output,
 * so we can verify the variable step count + the controlled/uncontrolled progress driver by hand.
 */
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { WalletSignModal } from "@/features/strategies/components/WalletSignModal";
import {
  buildWalletSignSteps,
  type WalletConfirmKind,
  type WalletSignSpec,
} from "@/features/strategies/components/walletSignSteps";

const CONFIRM_KINDS: WalletConfirmKind[] = [
  "invest",
  "addLiquidity",
  "withdraw",
  "removeLiquidity",
  "collect",
  "compound",
];

interface Preset {
  label: string;
  title: string;
  spec: WalletSignSpec;
}

/** Opens here. The 2-step deposit is the most representative real shape. */
const DEFAULT_PRESET: Preset = {
  label: "Deposit · 2 steps",
  title: "Confirming your deposit",
  spec: { approvals: ["USDC"], confirm: "invest" },
};

/** The real shapes the live flows produce, plus the 4-step add-liquidity for the upper bound. */
const PRESETS: Preset[] = [
  { label: "Collect · 1 step", title: "Collecting fees", spec: { confirm: "collect" } },
  { label: "Compound · 1 step", title: "Compounding", spec: { confirm: "compound" } },
  DEFAULT_PRESET,
  {
    label: "Withdraw · 2 steps",
    title: "Confirming your withdrawal",
    spec: { permit2: true, confirm: "withdraw" },
  },
  {
    label: "Add liquidity · 4 steps",
    title: "Adding liquidity",
    spec: { approvals: ["USDC", "WETH"], permit2: true, confirm: "addLiquidity" },
  },
];

const FIELD = "rounded-md border border-border bg-card px-2 py-1 text-foreground text-sm";

export function WalletStepsSandbox() {
  const [title, setTitle] = useState(DEFAULT_PRESET.title);
  const [spec, setSpec] = useState<WalletSignSpec>(DEFAULT_PRESET.spec);
  const [open, setOpen] = useState(false);
  const [controlled, setControlled] = useState(true);
  const [activeStep, setActiveStep] = useState(0);

  const descriptors = useMemo(() => buildWalletSignSteps(spec), [spec]);
  const total = descriptors.length;
  const clampedActive = Math.min(activeStep, total - 1);
  const approvalsText = (spec.approvals ?? []).join(", ");

  /** Replace the spec and snap progress back to the first step. */
  function applySpec(next: WalletSignSpec, nextTitle?: string) {
    setSpec(next);
    if (nextTitle) setTitle(nextTitle);
    setActiveStep(0);
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 text-foreground">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-xl">Wallet-signing modal · sandbox</h1>
        <p className="text-muted-foreground text-sm">
          PP-CORE-MOD-009 (POO-295). Dev-only. Pick a spec, then drive the steps by hand
          (controlled) or let the mock timer run (uncontrolled). The shape adapts to the spec.
        </p>
      </header>

      {/* Presets */}
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-muted-foreground text-sm">Presets</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="secondary"
              size="sm"
              onClick={() => applySpec(preset.spec, preset.title)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </section>

      {/* Custom spec */}
      <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h2 className="font-medium text-muted-foreground text-sm">Custom spec</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Title</span>
          <input className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Approvals (comma-separated tokens)</span>
          <input
            className={FIELD}
            value={approvalsText}
            placeholder="USDC, WETH"
            onChange={(e) => {
              const approvals = e.target.value
                .split(",")
                .map((token) => token.trim())
                .filter(Boolean);
              applySpec({ ...spec, approvals: approvals.length ? approvals : undefined });
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(spec.permit2)}
            onChange={(e) => applySpec({ ...spec, permit2: e.target.checked || undefined })}
          />
          <span>Require Permit2 / message signature</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Confirm</span>
          <select
            className={FIELD}
            value={spec.confirm}
            onChange={(e) => applySpec({ ...spec, confirm: e.target.value as WalletConfirmKind })}
          >
            {CONFIRM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
      </section>

      {/* Resolved steps (builder output) */}
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-muted-foreground text-sm">
          buildWalletSignSteps(spec) → {total} step{total === 1 ? "" : "s"}
        </h2>
        <ol className="flex flex-col gap-1 rounded-lg border border-border p-3 font-mono text-xs">
          {descriptors.map((descriptor, index) => (
            <li
              key={descriptor.key}
              className={
                index === clampedActive && controlled ? "text-primary" : "text-muted-foreground"
              }
            >
              {index + 1}. {descriptor.kind}
              {descriptor.token ? ` (${descriptor.token})` : ""}
              {descriptor.confirm ? ` (${descriptor.confirm})` : ""}, key: {descriptor.key}
            </li>
          ))}
        </ol>
      </section>

      {/* Driver */}
      <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h2 className="font-medium text-muted-foreground text-sm">Driver</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={controlled}
            onChange={(e) => {
              setControlled(e.target.checked);
              setActiveStep(0);
            }}
          />
          <span>
            Controlled (host drives <code>activeStep</code>). Uncheck to use the mock auto-advance
            timer
          </span>
        </label>
        {controlled ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={clampedActive <= 0}
              onClick={() => setActiveStep((step) => Math.max(0, step - 1))}
            >
              ← Back
            </Button>
            <span className="text-sm tabular-nums">
              Step {clampedActive + 1} of {total}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={clampedActive >= total - 1}
              onClick={() => setActiveStep((step) => Math.min(total - 1, step + 1))}
            >
              Advance →
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setActiveStep(0)}>
              Reset
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            The stepper advances itself ~every 0.9s and rests on the last step.
          </p>
        )}
      </section>

      <Button
        onClick={() => {
          setActiveStep(0);
          setOpen(true);
        }}
      >
        Open modal
      </Button>

      <WalletSignModal
        open={open}
        onOpenChange={setOpen}
        title={title}
        spec={spec}
        activeStep={controlled ? clampedActive : undefined}
        stepMs={900}
      />
    </main>
  );
}
