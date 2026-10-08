/**
 * @id PP-MGR-CMP-097 (POO-2291)
 * @name SolanaManagePresenter
 * @implements-rules-version v1
 * @i18n-namespace manager.solanaPreview.localManage
 * @analytics-events none, controlled presentation; host owns view/edit/mode/blocked intents
 * Independent Current, local draft, injected After and read-only operation journal.
 * PP-INTEGRATION-POINT: POO-2239/2240/2261/2262 inject verified canonical reads, protocol context,
 * preview and operation journal. This presenter exposes local intents only, with no signing API.
 */
"use client";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import { sanitizeNumericInput } from "@/lib/utils/numericInput";
import { parseAllocation } from "./previewModel";
import { SolanaKaminoReadSection } from "./SolanaKaminoReadSection";
import { SolanaRangePresenter } from "./SolanaRangePresenter";
import type {
  SolanaManageAction,
  SolanaManageCurrent,
  SolanaManageIdentity,
  SolanaManageProtocol,
  SolanaManageState,
} from "./solanaManageModel";
import { selectSolanaManageView } from "./solanaManageModel";
import { inspectSolanaRangeContext, type SolanaRangeContext } from "./solanaRangeModel";
import {
  type SolanaAmount,
  type SolanaSource,
  type SolanaToken,
  solanaAmountToDecimal,
} from "./solanaSchemas";

export interface SolanaManagePresenterProps {
  /** Registered local instance, independent from canonical position identity. */
  localId: string;
  /** Host-selected protocol, checked against the registered instance. */
  protocol: SolanaManageProtocol;
  /** Host-owned state with independently injected reads, previews and journal. */
  state: SolanaManageState;
  /** Host clock; null explicitly prevents a valid After. */
  now: string | null;
  /** Verified protocol context, absent when not integrated. No range is seeded. */
  rangeContext: SolanaRangeContext | null;
  /** Local intent dispatcher; no transaction or capability API is exposed. */
  onAction(action: SolanaManageAction): void;
  /** Host aggregate/capability guard, separate from the model's syntactic validation. */
  actionAllowed?: boolean;
  /** Reports a bounded blocked intent before a mode or Review transition. */
  onBlocked?(): void;
  /** Notifies the host only when a local inline Review is opened. */
  onReviewIntent?(): void;
  /** Optional host presentation override. */
  className?: string;
}
export function SolanaManagePresenter(props: SolanaManagePresenterProps) {
  const t = useTranslations("manager.solanaPreview.localManage");
  const instance = Object.hasOwn(props.state.instances, props.localId)
    ? props.state.instances[props.localId]
    : undefined;
  if (!instance || instance.protocol !== props.protocol)
    return (
      <p role="status" className={props.className}>
        {t("notAvailable")}
      </p>
    );
  // Only the visual Review step resets on selection; all financial/local drafts remain host-owned.
  return <ManageContent key={`${props.localId}:${props.protocol}`} {...props} />;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs">{label}</dt>
      <dd className="min-w-0 break-all text-right text-xs tabular-nums">{children}</dd>
    </div>
  );
}
function ExactAmount({ amount }: { amount: SolanaAmount }) {
  const locale = useLocale();
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")
      ?.value ?? ".";
  return (
    <>
      {solanaAmountToDecimal(amount).replace(".", separator)} {amount.token.symbol}
    </>
  );
}
function tokenKey(token: SolanaToken) {
  return `${token.cluster}:${token.kind}:${token.kind === "spl" ? token.mint : "native-SOL"}:${token.decimals}:${token.unit}`;
}
function sameSource(a: SolanaSource, b: SolanaSource) {
  return (
    a.kind === b.kind &&
    a.sourceAsOf === b.sourceAsOf &&
    (a.kind === "fixture" && b.kind === "fixture"
      ? a.fixtureId === b.fixtureId
      : a.kind === "observed" &&
        b.kind === "observed" &&
        a.source === b.source &&
        a.slot === b.slot &&
        a.commitment === b.commitment)
  );
}
/** A context is never borrowed from another canonical position or snapshot. */
function rangeForCurrent(
  input: SolanaRangeContext | null,
  protocol: SolanaManageProtocol,
  current: SolanaManageCurrent,
) {
  const context = inspectSolanaRangeContext(input).context;
  if (!context || context.protocol !== protocol) return null;
  const snapshot = current.snapshot;
  if (!snapshot) return context;
  const identity = snapshot.identity;
  if (
    context.cluster !== identity.cluster ||
    context.program !== identity.program ||
    context.pool !== identity.venue ||
    context.position?.positionId !== identity.positionId ||
    !snapshot.config.range ||
    context.position?.tickLower !== snapshot.config.range.tickLower ||
    context.position?.tickUpper !== snapshot.config.range.tickUpper ||
    identity.assets.length !== 2 ||
    tokenKey(context.tokenA) !== tokenKey(identity.assets[0] as SolanaToken) ||
    tokenKey(context.tokenB) !== tokenKey(identity.assets[1] as SolanaToken) ||
    !sameSource(context.source, snapshot.source) ||
    (current.status === "stale" && context.status !== "stale")
  )
    return null;
  return context;
}
function Identity({ identity }: { identity: SolanaManageIdentity }) {
  const t = useTranslations("manager.solanaPreview.localManage");
  return (
    <dl className="grid min-w-0 gap-2">
      <Row label={t("network")}>{identity.cluster}</Row>
      <Row label={t("program")}>{identity.program}</Row>
      <Row label={t("venue")}>{identity.venue}</Row>
      <Row label={t("position")}>{identity.positionId}</Row>
    </dl>
  );
}
function Snapshot({ label, read }: { label: "current" | "after"; read: SolanaManageCurrent }) {
  const t = useTranslations("manager.solanaPreview.localManage");
  const id = useId();
  const snapshot = read.snapshot;
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3"
      aria-live="polite"
    >
      <h3 id={id} className="font-semibold text-sm">
        {t(label)}
      </h3>
      {read.status === "stale" ? (
        <p role="status" className="text-warning text-xs">
          {t("stale")}
        </p>
      ) : null}
      {!snapshot ? (
        <p className="text-sm">{t("notAvailable")}</p>
      ) : (
        <>
          <Identity identity={snapshot.identity} />
          <dl className="grid min-w-0 gap-2">
            <Row label={t("snapshot")}>{snapshot.snapshotId}</Row>
            <Row label={t("allocation")}>{snapshot.config.allocation}%</Row>
            <Row label={t("pair")}>{snapshot.config.pair}</Row>
            {snapshot.identity.protocol === "orca" || snapshot.identity.protocol === "raydium" ? (
              <Row label={t("ticks")}>
                {snapshot.config.range
                  ? `${snapshot.config.range.tickLower} / ${snapshot.config.range.tickUpper}`
                  : t("notAvailable")}
              </Row>
            ) : null}
            {(["principal", "interest", "fees", "rewards"] as const).map((kind) => (
              <Row key={kind} label={t(kind)}>
                {snapshot.values[kind]?.length
                  ? snapshot.values[kind]?.map((amount, index) => (
                      // Rows are stateless observations; the DTO has no stream ID and may repeat a mint.
                      // biome-ignore lint/suspicious/noArrayIndexKey: retain every injected quantity without deduplication or invented identity.
                      <div key={`${tokenKey(amount.token)}:${index}`}>
                        <ExactAmount amount={amount} />
                      </div>
                    ))
                  : t("notAvailable")}
              </Row>
            ))}
            <Row label={t("source")}>
              {snapshot.source.kind === "fixture" ? (
                <>
                  <span>{t("fixture")}</span>: {snapshot.source.fixtureId}
                </>
              ) : (
                snapshot.source.source
              )}
            </Row>
            <Row label={t("asOf")}>{snapshot.source.sourceAsOf}</Row>
            {snapshot.source.kind === "observed" ? (
              <>
                <Row label={t("slot")}>{snapshot.source.slot}</Row>
                <Row label={t("commitment")}>{snapshot.source.commitment}</Row>
              </>
            ) : null}
          </dl>
        </>
      )}
    </section>
  );
}
function ManageContent({
  localId,
  protocol,
  state,
  now,
  rangeContext,
  onAction,
  actionAllowed = true,
  onBlocked,
  onReviewIntent,
  className,
}: SolanaManagePresenterProps) {
  const t = useTranslations("manager.solanaPreview.localManage");
  const shared = useTranslations("manager.solanaPreview");
  // An absent clock is explicitly invalid; no current time or expiry fallback is manufactured.
  const view = selectSolanaManageView(state, localId, now ?? "");
  const [reviewOf, setReviewOf] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const binding = JSON.stringify([
    localId,
    view.draft.revision,
    view.draft.mode,
    view.current.snapshot?.snapshotId,
    view.conflict,
  ]);
  const review = reviewOf === binding && view.draft.mode !== null;
  const focusState = `${view.draft.mode}:${review}`;
  const previous = useRef(focusState);
  useEffect(() => {
    if (previous.current !== focusState) {
      previous.current = focusState;
      heading.current?.focus();
    }
  }, [focusState]);
  const lp = protocol === "orca" || protocol === "raydium";
  const protocolLabel =
    protocol === "holding" || protocol === "jupiter"
      ? t(protocol)
      : shared(`protocols.${protocol}`);
  const operation =
    view.draft.mode === "move"
      ? lp
        ? t("move")
        : t("applyNow")
      : lp
        ? t("future")
        : t("newDeposits");
  const reviewLabel =
    view.draft.mode === "move" ? t(lp ? "reviewMove" : "reviewNow") : t("reviewFuture");
  const context = rangeForCurrent(rangeContext, protocol, view.current);
  const entries = Object.values(state.journal);
  const act = (type: "back" | "discard" | "rebase") => {
    setReviewOf(null);
    onAction({ type, localId });
  };
  const choose = (mode: "move" | "future") => {
    if (!actionAllowed) {
      onBlocked?.();
      return;
    }
    onAction({ type: "choose", localId, mode });
  };
  const requestReview = () => {
    if (!actionAllowed) {
      onBlocked?.();
      return;
    }
    setReviewOf(binding);
    onReviewIntent?.();
  };
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-4",
        className,
      )}
      data-solana-manage=""
    >
      <header className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="font-semibold text-[15px]">
            {t("title")}
          </h2>
          <p className="break-words text-xs">{protocolLabel}</p>
        </div>
        {view.current.snapshot ? (
          <span className="max-w-full break-all rounded-full bg-surface-raised px-2 py-1 text-xs">
            {view.current.snapshot.identity.cluster}
          </span>
        ) : null}
      </header>
      <p role="status" className="text-muted-foreground text-xs">
        {t("localOnly")}
      </p>
      <Snapshot label="current" read={view.current} />
      {protocol === "kamino" ? (
        // PP-INTEGRATION-POINT: POO-2240/2261 and POO-2290 supply canonical Kamino reads and full-obligation risk independently; local Manage never manufactures them from a draft.
        <SolanaKaminoReadSection mode="manage" origin={null} read={null} />
      ) : null}
      <section
        aria-labelledby={`${id}-draft`}
        className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3"
      >
        <h3 id={`${id}-draft`} className="font-semibold text-sm">
          {t("draft")}
        </h3>
        <dl>
          <Row label={t("revision")}>{view.draft.revision}</Row>
        </dl>
        <div>
          <label htmlFor={`${id}-allocation`} className="mb-1 block text-xs">
            {t("allocation")}
          </label>
          <input
            id={`${id}-allocation`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            readOnly={review}
            value={view.draft.config.allocation}
            aria-invalid={parseAllocation(view.draft.config.allocation) === null}
            onChange={(event) =>
              onAction({
                type: "edit",
                localId,
                patch: {
                  allocation: sanitizeNumericInput(event.target.value, { maxDecimals: 0 }).slice(
                    0,
                    3,
                  ),
                },
              })
            }
            className="min-h-11 w-full rounded-lg border border-border bg-input px-3 text-right text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          />
        </div>
        {lp ? (
          <dl>
            <Row label={t("pair")}>{view.draft.config.pair}</Row>
          </dl>
        ) : null}
        {lp && (parseAllocation(view.draft.config.allocation) ?? 0) > 0 ? (
          <SolanaRangePresenter
            context={context}
            range={view.draft.config.range}
            readOnly={review}
            onChange={(range) => onAction({ type: "edit", localId, patch: { range } })}
          />
        ) : null}
        {view.conflict ? (
          <>
            <p role="status" className="text-warning text-xs">
              {t(view.conflict === "snapshot-changed" ? "conflict" : "unavailableConflict")}
            </p>
            <Button
              variant="secondary"
              disabled={view.current.status !== "available"}
              onClick={() => act("rebase")}
            >
              {t("rebase")}
            </Button>
          </>
        ) : null}
      </section>
      <Snapshot label="after" read={view.after} />
      {view.dirty ? (
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby={`${id}-operation`}>
          <h3 id={`${id}-operation`} ref={heading} tabIndex={-1} className="font-semibold text-sm">
            {review ? reviewLabel : view.draft.mode ? t("selected") : t("choose")}
          </h3>
          {!view.draft.mode ? (
            <div className="grid grid-cols-1 gap-2">
              <Button
                variant="secondary"
                disabled={!view.localApplyValid}
                className="min-h-11 w-full flex-col items-start py-2 text-left"
                onClick={() => choose("move")}
              >
                <span>{lp ? t("move") : t("applyNow")}</span>
                {lp ? <span className="text-xs">{t("applyNow")}</span> : null}
              </Button>
              <Button
                variant="secondary"
                disabled={!view.localApplyValid}
                className="min-h-11 w-full flex-col items-start py-2 text-left"
                onClick={() => choose("future")}
              >
                <span>{lp ? t("future") : t("newDeposits")}</span>
                {lp ? <span className="text-xs">{t("newDeposits")}</span> : null}
              </Button>
            </div>
          ) : (
            <>
              <p className="font-medium text-sm">{operation}</p>
              <p className="text-xs">
                {t(
                  view.draft.mode === "move"
                    ? lp
                      ? "moveDescription"
                      : "allocationDescription"
                    : "futureDescription",
                )}
              </p>
              {review ? (
                <>
                  <p role="status" className="text-sm">
                    {t("transactionUnavailable")}
                  </p>
                  <Button disabled className="min-h-11 w-full">
                    {t(
                      view.draft.mode === "move"
                        ? lp
                          ? "confirmMove"
                          : "confirmNow"
                        : "confirmFuture",
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-11 w-full"
                    onClick={() => setReviewOf(null)}
                  >
                    {t("backSettings")}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    className="min-h-11 w-full"
                    disabled={!view.localApplyValid}
                    onClick={requestReview}
                  >
                    {reviewLabel}
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-h-11 w-full"
                    onClick={() => act("back")}
                  >
                    {t("backActions")}
                  </Button>
                </>
              )}
            </>
          )}
          <Button variant="secondary" className="min-h-11 w-full" onClick={() => act("discard")}>
            {t("discard")}
          </Button>
        </section>
      ) : null}
      {entries.length ? (
        <section
          aria-labelledby={`${id}-journal`}
          className="flex min-w-0 flex-col gap-3"
          aria-live="polite"
        >
          <h3 id={`${id}-journal`} className="font-semibold text-sm">
            {t("journal")}
          </h3>
          {entries.map((entry) => (
            <div
              key={entry.operationId}
              className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3"
            >
              <p className="break-all text-xs">
                {entry.operationId} · {entry.localId}
              </p>
              <p className="text-xs">{t(entry.status)}</p>
              <dl className="grid min-w-0 gap-2">
                <Row label={t("signature")}>{entry.signature ?? t("notAvailable")}</Row>
                {entry.checkpoints.map((step) => (
                  <Row key={step.id} label={`${t("checkpoint")}: ${step.id}`}>
                    <span>{t(step.status)}</span>
                    <div>{step.signature ?? t("notAvailable")}</div>
                  </Row>
                ))}
              </dl>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}
