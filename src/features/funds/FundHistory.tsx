/**
 * @id PP-STR-CMP-036 (POO-2182)
 * @name FundHistory
 * @implements-rules-version v1
 * @i18n-namespace strategies.funds
 */
"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { FundHistory as HistoryPage } from "@/lib/api/v2/fundSchemas";
import { ExplorerFields } from "./ExplorerFields";
import { loadFundHistoryAction } from "./fundActions";
import { fundErrorKey } from "./fundModel";

export function FundHistory({ core }: { core: string }) {
  const t = useTranslations("strategies.funds");
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const identity = useRef(core);
  useEffect(() => {
    identity.current = core;
    request.current += 1;
    inFlight.current = false;
    setHistory(null);
    setBusy(false);
    setError(null);
    return () => {
      request.current += 1;
    };
  }, [core]);
  const load = async (cursor?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const run = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const result = await loadFundHistoryAction(core, cursor);
      if (request.current !== run || identity.current !== core) return;
      if (!result.ok) {
        setError(fundErrorKey(result.error.code));
        return;
      }
      setHistory((previous) => {
        const events = cursor
          ? [...(previous?.events ?? []), ...result.data.events]
          : result.data.events;
        const unique = new Map(
          events.map((event) => [
            `${event.chainId}:${event.transactionHash.toLowerCase()}:${event.logIndex}`,
            event,
          ]),
        );
        return { ...result.data, events: [...unique.values()] };
      });
    } catch {
      if (request.current === run) setError("unavailable");
    } finally {
      if (request.current === run) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <section aria-label={t("fundHistory")} className="space-y-3">
      <h2>{t("fundHistory")}</h2>
      <p>{t("historyNewestFirst")}</p>
      <button type="button" disabled={busy} onClick={() => void load()}>
        {t("historyRefresh")}
      </button>
      {busy ? <p role="status">{t("loading")}</p> : null}
      {error ? <p role="alert">{t(error)}</p> : null}
      {history ? (
        <>
          <p>{t("historyIndexedOnly")}</p>
          {history.events.length === 0 ? (
            <p>{t("historyEmpty")}</p>
          ) : (
            <ol>
              {history.events.map((event) => (
                <li key={`${event.chainId}:${event.transactionHash}:${event.logIndex}`}>
                  <p>
                    {event.type} · <time dateTime={event.timestamp}>{event.timestamp}</time>
                  </p>
                  <ExplorerFields value={event} chainId={Number(event.chainId)} />
                </li>
              ))}
            </ol>
          )}
          {history.nextCursor ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void load(history.nextCursor ?? undefined)}
            >
              {t("historyMore")}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
