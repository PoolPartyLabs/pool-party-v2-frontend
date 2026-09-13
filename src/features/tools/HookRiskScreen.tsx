/**
 * @id PP-TOOLS-CMP-001
 * @name HookRiskScreen
 * @implements-rules-version v1
 * @analytics-events tools_hookrisk_viewed, tools_hookrisk_started, tools_hookrisk_completed,
 *                   tools_hookrisk_failed, tools_hookrisk_blocked
 *
 * The Tools screen: a chain, a hook address, and the hookrisk report for it.
 *
 * One column. The form sits at the top and the status and the report run full width beneath it,
 * because the report is a long document with wide score tables and putting it in a half-width
 * right-hand panel would make every table scroll horizontally on a laptop.
 *
 * Three states, and the third one is the reason this screen is careful. A scan takes minutes, so
 * "running" has to show progress specific enough to distinguish a compile from a harness run; and
 * when it cannot run at all, the screen says exactly what is missing and prints no report. hookrisk
 * exists because a tool that reports nothing looks identical to a clean bill of health, and a UI
 * that renders an empty report on failure would reintroduce precisely that.
 *
 * A FAILED GATE IS NOT A FAILURE. hookrisk exits 2 when the hook does not pass, and that comes back
 * with a full report, which is the output the user came for. Only `status: "failed"` is an error
 * here; `gatePassed: false` is a result and renders the report.
 */
"use client";

import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { isAddress } from "viem";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/Input";
import { useAnalytics } from "@/lib/analytics/useAnalytics";
import { useTrackView } from "@/lib/analytics/useTrackView";
import { type JobSnapshot, type JobStatus, SUPPORTED_CHAINS } from "@/lib/tools/hookrisk/contract";
import { cn } from "@/lib/utils/cn";
import { MarkdownReport } from "./components/MarkdownReport";

/** Shape of both the POST and the GET response from PP-TOOLS-API-001. */
type JobResponse = JobSnapshot;

/** What the screen is showing right now. */
type ScreenState =
  | { kind: "idle" }
  | { kind: "running"; jobId: string; status: JobStatus }
  | { kind: "report"; markdown: string; cached: boolean; gatePassed?: boolean }
  | { kind: "error"; code: string; message: string };

const POLL_INTERVAL_MS = 3_000;
const ENDPOINT = "/api/tools/hookrisk";

export function HookRiskScreen() {
  const t = useTranslations("tools");
  const { track } = useAnalytics();
  useTrackView("tools_hookrisk_viewed");

  const [chainId, setChainId] = useState<number>(SUPPORTED_CHAINS[0]?.id ?? 1);
  const [address, setAddress] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [state, setState] = useState<ScreenState>({ kind: "idle" });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Guards the poll loop against a screen that unmounted mid-scan.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const running = state.kind === "running";

  // Elapsed time, so a five-minute scan does not look like a hung page.
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    setElapsedSeconds(0);
    const timer = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - started) / 1000));
    }, 1_000);
    return () => clearInterval(timer);
  }, [running]);

  /** Apply one job snapshot, emitting the terminal event exactly once. */
  const applySnapshot = useCallback(
    (job: JobResponse) => {
      if (job.status === "done" && typeof job.report === "string") {
        // [Premise 11] The completion fires on the REPORT, never on the click that asked for it.
        track("tools_hookrisk_completed", { chain_id: chainId });
        setState({
          kind: "report",
          markdown: job.report,
          cached: job.cached === true,
          gatePassed: job.gatePassed,
        });
        return;
      }
      if (job.status === "failed") {
        const code = job.error?.code ?? "UNKNOWN";
        track("tools_hookrisk_failed", { chain_id: chainId, error_code: code });
        setState({
          kind: "error",
          code,
          message: job.error?.message ?? t("hookRisk.errors.NETWORK"),
        });
        return;
      }
      setState({ kind: "running", jobId: job.jobId, status: job.status });
    },
    [chainId, t, track],
  );

  /** Poll until the job reaches a terminal state. */
  const poll = useCallback(
    async (jobId: string) => {
      while (mounted.current) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (!mounted.current) return;
        let job: JobResponse;
        try {
          const response = await fetch(`${ENDPOINT}?jobId=${jobId}`);
          if (response.status === 404) {
            track("tools_hookrisk_failed", { chain_id: chainId, error_code: "JOB_UNKNOWN" });
            setState({
              kind: "error",
              code: "JOB_UNKNOWN",
              message: t("hookRisk.errors.JOB_UNKNOWN"),
            });
            return;
          }
          job = (await response.json()) as JobResponse;
        } catch {
          track("tools_hookrisk_failed", { chain_id: chainId, error_code: "NETWORK" });
          setState({ kind: "error", code: "NETWORK", message: t("hookRisk.errors.NETWORK") });
          return;
        }
        if (!mounted.current) return;
        applySnapshot(job);
        if (job.status === "done" || job.status === "failed") return;
      }
    },
    [applySnapshot, chainId, t, track],
  );

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running) return;

    const trimmed = address.trim();
    if (!isAddress(trimmed, { strict: false })) {
      // Blocked intent: the user asked for a scan and the product said no, before any work started.
      track("tools_hookrisk_blocked", { chain_id: chainId, error_code: "INVALID_ADDRESS" });
      setFieldError(t("hookRisk.errors.INVALID_ADDRESS"));
      return;
    }
    setFieldError(null);
    track("tools_hookrisk_started", { chain_id: chainId });
    setState({ kind: "running", jobId: "", status: "queued" });

    let job: JobResponse;
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId, address: trimmed }),
      });
      const body = (await response.json()) as JobResponse & { code?: string; message?: string };
      if (response.status === 400) {
        const code = body.code ?? "INVALID_ADDRESS";
        track("tools_hookrisk_blocked", { chain_id: chainId, error_code: code });
        setFieldError(
          code === "UNSUPPORTED_CHAIN"
            ? t("hookRisk.errors.UNSUPPORTED_CHAIN")
            : t("hookRisk.errors.INVALID_ADDRESS"),
        );
        setState({ kind: "idle" });
        return;
      }
      job = body;
    } catch {
      track("tools_hookrisk_failed", { chain_id: chainId, error_code: "NETWORK" });
      setState({ kind: "error", code: "NETWORK", message: t("hookRisk.errors.NETWORK") });
      return;
    }

    applySnapshot(job);
    if (job.status !== "done" && job.status !== "failed") void poll(job.jobId);
  }

  // Literal t() calls per status (the i18n usage scan is static, so no dynamic keys).
  const statusLabel: Record<JobStatus, string> = {
    queued: t("hookRisk.status.queued"),
    "fetching-source": t("hookRisk.status.fetchingSource"),
    building: t("hookRisk.status.building"),
    scanning: t("hookRisk.status.scanning"),
    done: t("hookRisk.status.done"),
    failed: t("hookRisk.status.failed"),
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-2xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </header>

      {/* The form. Full width at the top of the single column, its controls laid out in a row on
          desktop and stacked below `sm`. */}
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5"
      >
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 font-semibold text-base">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            {t("hookRisk.heading")}
          </h2>
          <p className="text-muted-foreground text-sm">{t("hookRisk.intro")}</p>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5 sm:w-48">
            <label className="font-medium text-sm" htmlFor="hookrisk-chain">
              {t("hookRisk.chainLabel")}
            </label>
            <select
              id="hookrisk-chain"
              value={chainId}
              onChange={(event) => setChainId(Number(event.target.value))}
              disabled={running}
              className={cn(
                "h-10 w-full rounded-md border border-border bg-surface px-3 text-base text-foreground sm:text-sm",
                "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {SUPPORTED_CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <Input
              label={t("hookRisk.addressLabel")}
              placeholder={t("hookRisk.addressPlaceholder")}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              error={fieldError ?? undefined}
              disabled={running}
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
            />
          </div>

          <Button type="submit" loading={running} className="sm:w-32">
            {running ? t("hookRisk.submitRunning") : t("hookRisk.submit")}
          </Button>
        </div>

        <p className="text-muted-foreground text-xs">{t("hookRisk.notice")}</p>
      </form>

      {/* Status and report, full width beneath the form. */}
      {state.kind === "idle" ? (
        <div className="rounded-xl border border-border border-dashed px-6 py-12 text-center">
          <p className="font-medium text-foreground text-sm">{t("hookRisk.idleTitle")}</p>
          <p className="mt-1 text-muted-foreground text-sm">{t("hookRisk.idleBody")}</p>
        </div>
      ) : null}

      {state.kind === "running" ? (
        <div
          className="flex items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4"
          aria-live="polite"
        >
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
          <div className="flex flex-col">
            <span className="font-medium text-sm">{statusLabel[state.status]}</span>
            <span className="text-muted-foreground text-xs">
              {t("hookRisk.elapsed", { seconds: elapsedSeconds })}
            </span>
          </div>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div className="rounded-xl border border-error-border bg-error-surface">
          <ErrorState
            title={t("hookRisk.errorTitle")}
            description={state.message}
            onRetry={() => setState({ kind: "idle" })}
            retryLabel={t("hookRisk.retry")}
          />
        </div>
      ) : null}

      {state.kind === "report" ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {state.gatePassed === true ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 font-medium text-success text-xs">
                <CheckCircle2 className="size-3.5" aria-hidden="true" />
                {t("hookRisk.gatePassed")}
              </span>
            ) : null}
            {state.gatePassed === false ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1 font-medium text-warning text-xs">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {t("hookRisk.gateFailed")}
              </span>
            ) : null}
            {state.cached ? (
              <span className="text-muted-foreground text-xs">{t("hookRisk.cached")}</span>
            ) : null}
          </div>
          <div className="rounded-xl border border-border bg-surface p-5 sm:p-6">
            <MarkdownReport markdown={state.markdown} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
