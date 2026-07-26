/**
 * @id PP-AQUA-CMP-010 (POO-1067)
 * @name Active Reserve entry card
 * @implements-rules-version v1
 *
 * The promoted card at the top of the strategies list, and the ONLY way into `/active-reserve`.
 *
 * Active Reserve is not in the pool-party-api catalog: it is read straight off Arbitrum, so it can
 * never arrive through `listStrategies` alongside the managed strategies. Rather than teach the
 * catalog about a second source (a change that would reach into paging, sorting, filtering and the
 * detail route, and would have to be unpicked afterwards), the entry is one card rendered above the
 * list. FE-R12.
 *
 * That choice is about removal as much as about scope. This entry ships to dev for judging and does
 * not go to production, so the whole surface has to come out cleanly: turning `activeReserve` off
 * hides this card and 404s both routes, and deleting the feature is this file plus one import in
 * `strategies/page.tsx`. Nothing in the strategies list knows Aqua exists.
 *
 * Renders NOTHING when the flag is off, when no vault is configured, or when the configured vault
 * has no contract at it. A dead link into a 404 would be worse than no entry point at all.
 */
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
// PP-INTEGRATION-POINT: reads Arbitrum directly (no pool-party-api), see src/lib/aqua/README.md.
import { readActiveReserveState } from "@/lib/aqua/api/vaultState";
import { isFeatureEnabled } from "@/lib/features";
import { COPY, PRODUCT_DESCRIPTION, PRODUCT_NAME } from "./copy";
import { formatUsdc } from "./format";

export async function ActiveReserveEntryCard() {
  if (!isFeatureEnabled("activeReserve")) return null;

  const state = await readActiveReserveState();
  if (state.status !== "live") return null;

  // The headline number is the same NAV the detail page shows, read in the same call. Two surfaces
  // disagreeing about how much money is in a vault is the one thing this card must not do.
  const tvl = formatUsdc(state.nav.totalAssetsUsdc);
  const cap = formatUsdc(state.maxTvlUsdc);
  const earning = formatUsdc(state.sleeves.parkedUsdc);

  return (
    <Link
      href="/active-reserve"
      className="group block rounded-2xl border border-white/10 bg-gradient-to-br from-sky-500/10 via-transparent to-transparent p-5 transition-colors hover:border-white/20"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-white">{PRODUCT_NAME}</h2>
            <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[11px] font-medium text-sky-300">
              {COPY.tagline}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-white/60">{PRODUCT_DESCRIPTION}</p>
        </div>
        <ArrowRight
          aria-hidden
          className="mt-1 size-5 shrink-0 text-white/40 transition-transform group-hover:translate-x-0.5 group-hover:text-white/70"
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-white/50">{COPY.nav.title}</dt>
          <dd className="mt-0.5 text-sm font-medium text-white tabular-nums">${tvl}</dd>
        </div>
        <div>
          <dt className="text-xs text-white/50">{COPY.metrics.carry}</dt>
          <dd className="mt-0.5 text-sm font-medium text-white tabular-nums">${earning}</dd>
        </div>
        <div>
          <dt className="text-xs text-white/50">{COPY.metrics.cap}</dt>
          <dd className="mt-0.5 text-sm font-medium text-white tabular-nums">${cap}</dd>
        </div>
      </dl>
    </Link>
  );
}
