/**
 * @id PP-MGR-CMP-026
 * @name MandateSummaryCard
 * @implements-rules-version v2 (POO-2127 rules v1, POO-2143 rules v2)
 * @analytics-events none, a read-only card. It shows what was already decided and offers no
 *   control, so there is no intent here to record; the landing that renders it owns the view event
 *   (PP-MGR-SCR-002)
 *
 * POO-2127 [B1], epic POO-2119. The mandate, read back. Rendered on the Build landing today and
 * reusable by Review later, which is why it takes a draft and a catalog and nothing else: no
 * callbacks, no store access, no router. Everything on it is derived, so the card cannot disagree
 * with the five steps that produced it.
 *
 * ## Why the card derives rather than stores
 *
 * Every row here is computed from `draft` at render time through the same domain functions the steps
 * use: {@link capRows} for the Limits rows, {@link hasDexProtocol} for whether Pools exists at all.
 * A summary that kept its own copy of "which caps matter" would be a second rule about the hub's
 * implicit cap (R40) and the locked deposit row (R43), and the two would eventually disagree, with
 * the summary being the one the manager believes.
 *
 * ## The one claim on this card
 *
 * Four of the five rows describe the mandate. The Broad mandate notice (R13) is different in kind:
 * it is a promise about what investors will be told before they deposit, and it is the only thing
 * here that could be wrong in a way that matters. So it is NOT derived here. {@link isBroadMandate}
 * needs the size of the pool universe the Pools step searched, which only that step knows, and a
 * universe it has not resolved is 0 rather than "all of them". Deriving it from a count this card
 * does not have would print the flag on a mandate that does not carry it, or hide one that does;
 * the caller passes the answer or the card stays silent.
 *
 * ## Ordering
 *
 * Protocols list the two required ones first, with a Lock, because "Uniswap v3, Across, Aave v3"
 * reads as three choices when two of them were never choices (R20). Pools show four and count the
 * rest: a broad mandate can hold a dozen, and a summary that scrolls is not a summary.
 */
"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { TokenLogo } from "@/components/data-display/TokenLogo";
import { Card } from "@/components/ui/Card";
import { formatCount } from "@/lib/utils/format";
import type { MandateCatalog } from "../mandateCatalog";
import {
  capRows,
  hasDexProtocol,
  type MandateCap,
  type MandateDraft,
  type NetworkId,
  PROTOCOL_ORDER,
  type ProtocolId,
  REQUIRED_PROTOCOLS,
  tokenKey,
} from "../mandateDraft";
import { NetworkDots, NetworkLogoWithName, useNetworkNames } from "./NetworkDots";

/** How many pools are listed before the rest become a count. */
const POOLS_SHOWN = 4;

/** Public props for {@link MandateSummaryCard}. */
export interface MandateSummaryCardProps {
  /** The mandate to read back. Need not be complete; every row renders from what is there. */
  draft: MandateDraft;
  /** The catalog the draft was built against: brand colours and protocol availability. */
  catalog: MandateCatalog;
  /**
   * Whether this mandate carries the Broad flag (R13).
   *
   * Passed in rather than derived: see the file header. Absent or false means the card says
   * nothing about the flag, which is the right answer whenever the pool universe is unknown.
   */
  broad?: boolean;
}

/** The fee tier as the pools step writes it: basis points as a percentage, two decimals. */
function feeLabel(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** One labelled row of the summary. */
function SummaryRow({
  label,
  count,
  testId,
  children,
}: {
  label: string;
  count?: number;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-28 shrink-0 pt-0.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      <dd data-testid={testId} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
        {count === undefined ? null : (
          <span className="text-muted-foreground text-xs">{formatCount(count)}</span>
        )}
      </dd>
    </div>
  );
}

/** A summary chip: a mark and a label, in the row style the mandate uses everywhere else. */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2 py-1 text-foreground text-xs">
      {children}
    </span>
  );
}

/**
 * Group the draft's token entries by symbol, keeping which networks each one runs on.
 *
 * A token takes one SLOT per network (R27), so the same symbol is several entries in the draft.
 * Listing them separately would print "USDC, USDC, USDC" for a three-network mandate; one chip
 * carrying three network dots says the same thing and says it once.
 */
function tokensBySymbol(draft: MandateDraft): { symbol: string; networks: NetworkId[] }[] {
  const grouped: { symbol: string; networks: NetworkId[] }[] = [];
  for (const token of draft.tokens) {
    const existing = grouped.find((entry) => entry.symbol === token.symbol);
    if (existing) {
      if (!existing.networks.includes(token.network)) existing.networks.push(token.network);
      continue;
    }
    grouped.push({ symbol: token.symbol, networks: [token.network] });
  }
  return grouped;
}

/** The chosen protocols, the required two first: two of them were never a choice (R20). */
function orderedProtocols(draft: MandateDraft): ProtocolId[] {
  const chosen = new Set(draft.protocols);
  const required = REQUIRED_PROTOCOLS.filter((id) => chosen.has(id));
  const rest = PROTOCOL_ORDER.filter((id) => chosen.has(id) && !REQUIRED_PROTOCOLS.includes(id));
  return [...required, ...rest];
}

/** Read-only summary of a mandate: networks, protocols, tokens, pools and caps. */
export function MandateSummaryCard({ draft, catalog, broad }: MandateSummaryCardProps) {
  const t = useTranslations("manager");
  const networkNames = useNetworkNames();

  // Literal keys indexed by id: `MandateProtocol.name` holds a translation KEY, and `t(p.name)`
  // would be a dynamic key the i18n usage scan cannot see (COMMON §6).
  const protocolNames: Record<ProtocolId, string> = {
    "uniswap-v3-swap": t("fundBuilder.protocolNames.uniswapV3Swap"),
    across: t("fundBuilder.protocolNames.across"),
    "aave-v3": t("fundBuilder.protocolNames.aaveV3"),
    "uniswap-v3": t("fundBuilder.protocolNames.uniswapV3"),
    "uniswap-v4": t("fundBuilder.protocolNames.uniswapV4"),
    // PP-NOTE: buildathon scope (2026-10-03, POO-2143): commented out, restore when the fund contracts reach it.
    // gmx: t("fundBuilder.protocolNames.gmx"),
  };

  const noCapLabel = t("fundBuilder.common.noCap");
  const unsetLabel = t("fundBuilder.limits.unset");

  /**
   * One cap, as the row prints it.
   *
   * The middle dot joins two already-translated halves and is the separator this namespace uses
   * inside its own strings (`fundBuilder.drafts.row`, `fundBuilder.limits.hubRow`), not copy.
   * An unanswered cap reads "Not set" and never "0%": zero is a cap that forbids the position.
   */
  function capText(name: string, cap: MandateCap | undefined): string {
    if (!cap) return `${name} · ${unsetLabel}`;
    return `${name} · ${cap.noCap ? noCapLabel : `${cap.pct}%`}`;
  }

  const rows = capRows(draft, catalog);
  const tokens = tokensBySymbol(draft);
  const protocols = orderedProtocols(draft);
  const showPools = hasDexProtocol(draft) && draft.pools.length > 0;
  const hiddenPools = Math.max(0, draft.pools.length - POOLS_SHOWN);
  const hasCapRows =
    rows.networks.length > 0 || rows.protocols.length > 0 || rows.tokens.length > 0;

  /** One sub-group of the Limits row, or nothing when the group has no rows at all (R43). */
  function capGroup(label: string, entries: string[]): ReactNode {
    if (entries.length === 0) return null;
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">{label}</span>
        {entries.map((entry) => (
          <Chip key={entry}>{entry}</Chip>
        ))}
      </span>
    );
  }

  return (
    <Card data-testid="mandate-summary-card" className="flex flex-col gap-4 p-6">
      <h2 className="font-semibold text-foreground text-lg">{t("fundBuilder.build.summary")}</h2>

      <dl className="flex flex-col gap-3 text-sm">
        <SummaryRow
          label={t("fundBuilder.build.summaryNetworks")}
          testId="mandate-summary-networks"
        >
          {draft.networks.map((network) => (
            <Chip key={network}>
              <NetworkLogoWithName network={network} catalog={catalog} size={14} />
              {networkNames[network]}
            </Chip>
          ))}
        </SummaryRow>

        <SummaryRow
          label={t("fundBuilder.build.summaryProtocols")}
          testId="mandate-summary-protocols"
        >
          {protocols.map((protocol) => (
            <Chip key={protocol}>
              {REQUIRED_PROTOCOLS.includes(protocol) ? (
                <span
                  data-testid="mandate-summary-protocol-locked"
                  className="inline-flex text-muted-foreground"
                  title={t("fundBuilder.common.alwaysIncluded")}
                >
                  <Lock className="size-3" aria-hidden="true" />
                  <span className="sr-only">{t("fundBuilder.common.alwaysIncluded")}</span>
                </span>
              ) : null}
              {protocolNames[protocol]}
            </Chip>
          ))}
        </SummaryRow>

        <SummaryRow
          label={t("fundBuilder.build.summaryTokens")}
          count={draft.tokens.length}
          testId="mandate-summary-tokens"
        >
          {tokens.map((token) => (
            <Chip key={token.symbol}>
              <span data-summary-token={token.symbol} className="inline-flex items-center gap-1.5">
                <TokenLogo
                  symbol={token.symbol}
                  network={token.networks[0]}
                  className="size-4 text-[10px]"
                />
                {token.symbol}
              </span>
              <NetworkDots networks={token.networks} catalog={catalog} size={12} />
            </Chip>
          ))}
        </SummaryRow>

        {/* R29: a mandate with no position protocol never had a Pools step, so there is no row. */}
        {showPools ? (
          <SummaryRow
            label={t("fundBuilder.build.summaryPools")}
            count={draft.pools.length}
            testId="mandate-summary-pools"
          >
            {draft.pools.slice(0, POOLS_SHOWN).map((pool) => (
              <Chip key={pool.id}>
                <span className="font-medium">{`${pool.token0.symbol}/${pool.token1.symbol}`}</span>
                <span className="text-muted-foreground">
                  {`${protocolNames[pool.protocol]} · ${t("fundBuilder.pools.feeTier", {
                    fee: feeLabel(pool.feeBps),
                  })}`}
                </span>
              </Chip>
            ))}
            {hiddenPools > 0 ? (
              <span className="text-muted-foreground text-xs">
                {t("fundBuilder.common.andMore", { count: hiddenPools })}
              </span>
            ) : null}
          </SummaryRow>
        ) : null}

        <SummaryRow label={t("fundBuilder.build.summaryLimits")} testId="mandate-summary-limits">
          {hasCapRows ? (
            <span className="flex flex-col gap-2">
              {capGroup(
                t("fundBuilder.limits.perNetwork"),
                rows.networks.map((network) =>
                  capText(networkNames[network], draft.caps.networks[network]),
                ),
              )}
              {capGroup(
                t("fundBuilder.limits.perProtocol"),
                rows.protocols.map((protocol) =>
                  capText(protocolNames[protocol], draft.caps.protocols[protocol]),
                ),
              )}
              {capGroup(
                t("fundBuilder.limits.perToken"),
                rows.tokens.map((token) =>
                  capText(token.symbol, draft.caps.tokens[tokenKey(token)]),
                ),
              )}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">{t("fundBuilder.limits.noRows")}</span>
          )}
        </SummaryRow>
      </dl>

      {/* R13: the one claim on this card, and the only thing an investor will be shown.
          `role="note"` rather than `alert` or a heading: nothing failed and nothing is urgent, but
          a screen reader has to be able to reach this as a unit of advisory content. */}
      {broad ? (
        <div
          role="note"
          className="flex flex-col gap-1 rounded-xl border border-warning/40 bg-warning/10 p-4"
        >
          <p className="font-medium text-foreground text-sm">{t("fundBuilder.pools.broadTitle")}</p>
          <p className="text-muted-foreground text-sm">{t("fundBuilder.pools.broadBody")}</p>
        </div>
      ) : null}
    </Card>
  );
}
