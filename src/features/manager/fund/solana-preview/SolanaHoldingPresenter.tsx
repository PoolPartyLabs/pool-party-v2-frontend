/**
 * @id PP-MGR-CMP-096
 * @name SolanaHoldingPresenter
 * @implements-rules-version v1 (POO-2291)
 * @i18n-namespace manager.solanaPreview.holding
 * @analytics-events none, controlled presentation; host owns view/mode/blocked/error intents
 *
 * PP-INTEGRATION-POINT: POO-2239/2240/2261/2262 inject custody reads, exact intentions and quotes.
 * Holding and Jupiter are separate inspections. No wallet, RPC, quote or execution API is called.
 */
"use client";
import { useLocale, useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";
import {
  classifyHoldingConversion,
  type HoldingClock,
  type HoldingIntent,
  type HoldingOrigin,
  type HoldingRead,
  holdingOriginSchema,
  inspectHoldingRead,
  inspectJupiterQuote,
  type JupiterQuote,
  validateHoldingIntent,
} from "./solanaHoldingModel";
import { type SolanaAmount, type SolanaSource, solanaAmountToDecimal } from "./solanaSchemas";
export type HoldingMode = "choice" | "buy" | "sell" | "review-buy" | "review-sell";
export interface HoldingPresenterProps {
  origin: HoldingOrigin | null;
  read: HoldingRead | null;
  intent: HoldingIntent | null;
  quote: JupiterQuote | null;
  clock: HoldingClock;
  mode: HoldingMode;
  onMode(mode: HoldingMode): void;
  className?: string;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-1">
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className="min-w-0 break-all text-right tabular-nums">{children}</dd>
    </div>
  );
}
/** Exact decimal text with a locale separator; no Number conversion or display value enters payloads. */
function ExactDecimal({ value }: { value: string }) {
  const locale = useLocale();
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === "decimal")?.value ??
    ".";
  return <>{value.replace(".", separator)}</>;
}
function Amount({ amount }: { amount: SolanaAmount }) {
  const locale = useLocale();
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === "decimal")?.value ??
    ".";
  return (
    <>
      {solanaAmountToDecimal(amount).replace(".", separator)} {amount.token.symbol}
    </>
  );
}
function Provenance({ source }: { source: SolanaSource | null }) {
  const t = useTranslations("manager.solanaPreview.holding");
  if (!source) return null;
  return (
    <dl className="grid min-w-0 gap-2 text-xs">
      <Row label={t("source")}>
        {source.kind === "fixture" ? (
          <>
            <span>{t("fixture")}</span>: <span>{source.fixtureId}</span>
          </>
        ) : (
          source.source
        )}
      </Row>
      <Row label={t("asOf")}>{source.sourceAsOf}</Row>
      {source.kind === "observed" ? (
        <>
          <Row label={t("slot")}>{source.slot}</Row>
          <Row label={t("commitment")}>{source.commitment}</Row>
        </>
      ) : null}
    </dl>
  );
}
export function SolanaHoldingPresenter({
  origin: input,
  read,
  intent: rawIntent,
  quote,
  clock,
  mode,
  onMode,
  className,
}: HoldingPresenterProps) {
  const t = useTranslations("manager.solanaPreview.holding");
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const previousMode = useRef(mode);
  useEffect(() => {
    if (previousMode.current !== mode) {
      previousMode.current = mode;
      heading.current?.focus();
    }
  }, [mode]);
  const parsed = holdingOriginSchema.safeParse(input);
  const origin = parsed.success ? parsed.data : null;
  const view = inspectHoldingRead(origin, read);
  const side = mode === "sell" || mode === "review-sell" ? "sell" : "buy";
  const review = mode === "review-buy" || mode === "review-sell";
  const validated = validateHoldingIntent(origin, rawIntent);
  const intent = validated?.side === side ? validated : null;
  const conversion = classifyHoldingConversion(intent);
  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-4",
        className,
      )}
      data-holding-mode={mode}
    >
      <header className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 ref={heading} id={id} tabIndex={-1} className="font-semibold text-[15px]">
            {t("title")}
          </h2>
          <p className="break-words text-muted-foreground text-xs">
            {origin?.asset.symbol ?? t("notAvailable")}
          </p>
        </div>
        {origin ? (
          <span className="flex min-h-7 max-w-full items-center rounded-full bg-surface-raised px-2 text-[11px]">
            {t("solana")} · {origin.cluster}
          </span>
        ) : null}
      </header>
      <p className="text-muted-foreground text-xs">{t("tokenRisk")}</p>
      {origin ? (
        <dl className="grid min-w-0 gap-2 text-xs">
          <Row label={t("token")}>
            {origin.asset.symbol}
            {origin.asset.kind === "spl" ? ` · ${origin.asset.mint}` : ""}
          </Row>
          <Row label={t("network")}>{origin.cluster}</Row>
          <Row label={t("custody")}>{origin.custody.account}</Row>
          <Row label={t("program")}>{origin.custody.program}</Row>
          <Row label={t("authority")}>{origin.custody.authority}</Row>
          <Row label={t("position")}>{origin.custody.positionId ?? t("notAvailable")}</Row>
        </dl>
      ) : (
        <p role="status">{t("notAvailable")}</p>
      )}
      <dl className="grid min-w-0 gap-2 text-xs">
        <Row label={t("quantity")}>
          {view.quantity ? <Amount amount={view.quantity} /> : t("notAvailable")}
        </Row>
        <Row label={t("valueUsd")}>
          {view.valueUsd === null ? t("notAvailable") : <ExactDecimal value={view.valueUsd} />}
        </Row>
        <Row label={t("allocation")}>
          {view.allocationBps === null ? (
            t("notAvailable")
          ) : (
            <>
              <ExactDecimal
                value={`${Math.floor(view.allocationBps / 100)}${
                  view.allocationBps % 100
                    ? `.` +
                      String(view.allocationBps % 100)
                        .padStart(2, "0")
                        .replace(/0+$/, "")
                    : ""
                }`}
              />
              %
            </>
          )}
        </Row>
      </dl>
      {view.quantityStatus === "stale" ? (
        <p role="status" className="text-warning text-xs">
          {t("stale")}
        </p>
      ) : view.quantityStatus === "confirmed-zero" ? (
        <p role="status" className="text-muted-foreground text-xs">
          {t("zero")}
        </p>
      ) : null}
      <Provenance source={view.source} />
      {mode === "choice" ? (
        <>
          <p className="text-muted-foreground text-xs">{t("choose")}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              disabled={!origin}
              className="min-h-11"
              onClick={() => onMode("buy")}
            >
              {t("buy")}
            </Button>
            <Button
              variant="secondary"
              disabled={!origin}
              className="min-h-11"
              onClick={() => onMode("sell")}
            >
              {t("sell")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3 className="font-semibold text-sm">{t(side)}</h3>
          {intent ? (
            <>
              <dl className="grid min-w-0 gap-2 text-xs">
                <Row label={t("input")}>
                  <Amount amount={intent.input} />
                </Row>
                <Row label={t("destination")}>
                  <div data-holding-principal="" data-tone="principal">
                    <span>
                      {intent.destination.kind === "holding" ? t("title") : t("idleOutput")}
                    </span>{" "}
                    · {intent.destination.account}
                    {intent.destination.kind === "idle-output" &&
                    intent.destination.principalBridgeId ? (
                      <div>
                        {t("principalBridge")} · {intent.destination.principalBridgeId}
                      </div>
                    ) : null}
                  </div>
                </Row>
              </dl>
              <p role="status" className="text-muted-foreground text-xs">
                {conversion === "unavailable" ? t("notAvailable") : t(conversion)}
              </p>
              {conversion === "swap" ? (
                <SolanaJupiterInspector intent={intent} quote={quote} clock={clock} />
              ) : null}
            </>
          ) : (
            <p role="status">{t("notAvailable")}</p>
          )}
          {review ? (
            <>
              <p role="status" className="text-muted-foreground text-xs">
                {t("transactionUnavailable")}
              </p>
              <Button disabled className="min-h-11 w-full">
                {t(side === "buy" ? "confirmBuy" : "confirmSell")}
              </Button>
              <Button variant="secondary" className="min-h-11 w-full" onClick={() => onMode(side)}>
                {t(side === "buy" ? "backBuy" : "backSell")}
              </Button>
            </>
          ) : (
            <>
              <Button
                disabled={!intent}
                className="min-h-11 w-full"
                onClick={() => onMode(side === "buy" ? "review-buy" : "review-sell")}
              >
                {t(side === "buy" ? "reviewBuy" : "reviewSell")}
              </Button>
              <Button
                variant="secondary"
                className="min-h-11 w-full"
                onClick={() => onMode("choice")}
              >
                {t("backActions")}
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
export function SolanaJupiterInspector({
  intent,
  quote,
  clock,
  className,
}: Pick<HoldingPresenterProps, "intent" | "quote" | "clock" | "className">) {
  const t = useTranslations("manager.solanaPreview.holding");
  const id = useId();
  const view = inspectJupiterQuote(intent, quote, clock);
  const q = view.quote;
  return (
    <section
      aria-labelledby={id}
      className={cn("flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3", className)}
      data-jupiter-inspector=""
    >
      <h3 id={id} tabIndex={-1} className="font-semibold text-sm">
        {t("jupiter")}
      </h3>
      {q ? (
        <>
          <p className="text-muted-foreground text-xs">
            {t(q.inspection.mode === "managed-order-execute" ? "managed" : "composable")}
          </p>
          <dl className="grid min-w-0 gap-2 text-xs">
            <Row label={t("input")}>
              <Amount amount={q.input} />
            </Row>
            <Row label={t("output")}>
              <Amount amount={q.output} />
            </Row>
            <Row label={t("minimum")}>
              <Amount amount={q.minimumReceived} />
            </Row>
            <Row label={t("route")}>{q.route.join(" · ")}</Row>
            <Row label={t("quote")}>{t(view.quoteValidity)}</Row>
            <Row label={t("blockhash")}>{t(view.transactionValidity)}</Row>
            {"value" in q.inspection.quoteValidity ? (
              <Row label={t("quoteExpires")}>{q.inspection.quoteValidity.value.expiresAt}</Row>
            ) : null}
            {"value" in q.inspection.transactionValidity ? (
              <>
                <Row label={t("lastValidHeight")}>
                  {q.inspection.transactionValidity.value.lastValidBlockHeight}
                </Row>
                <Row label={t("blockhashValue")}>
                  {q.inspection.transactionValidity.value.blockhash}
                </Row>
              </>
            ) : null}
            {q.inspection.mode === "managed-order-execute" ? (
              <Row label={t("requestId")}>{q.inspection.requestId}</Row>
            ) : (
              <Row label={t("instructionPrograms")}>
                {q.inspection.instructionPrograms.join(" · ")}
              </Row>
            )}
          </dl>
          {q.status === "stale" ? (
            <p role="status" className="text-warning text-xs">
              {t("stale")}
            </p>
          ) : null}
          <Provenance source={q.source} />
          <h4 className="font-medium text-xs">{t("costs")}</h4>
          <dl className="grid min-w-0 gap-2 text-xs">
            {q.costs.length ? (
              q.costs.map((cost) => (
                <Row
                  key={cost.id}
                  label={t(cost.category === "network" ? "networkCost" : cost.category)}
                >
                  <Amount amount={cost.amount} /> ·{" "}
                  {t(
                    cost.inclusion === "included-in-input"
                      ? "includedInput"
                      : cost.inclusion === "included-in-output"
                        ? "includedOutput"
                        : cost.inclusion === "additional"
                          ? "additional"
                          : "costUnknown",
                  )}
                </Row>
              ))
            ) : (
              <dd>{t("notAvailable")}</dd>
            )}
          </dl>
        </>
      ) : (
        <p role="status" className="text-muted-foreground text-xs">
          {t("noQuote")}
        </p>
      )}
    </section>
  );
}
