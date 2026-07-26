import type { FillView } from "@/lib/aqua/api/vaultState";
import { COPY } from "../copy";
import { arbiscanTx, formatUsdc, formatWeth, shortHash } from "../format";

/**
 * Every purchase, with a link to the transaction.
 *
 * Two things this component refuses to soften. The JIT badge is shown because the
 * Aave-withdrawal-inside-settlement is the mechanism worth seeing, not a footnote. And the
 * self-directed disclosure sits at the top of the list rather than buried at the bottom,
 * because during the demo window these fills come from our own wallet (BOT-R2 v2) and a
 * reader should learn that before reading the numbers, not after.
 */
export function FillsFeed({ fills }: { fills: FillView[] }) {
  return (
    <section
      aria-labelledby="fills-title"
      className="rounded-lg border border-border bg-surface p-6"
    >
      <h2 id="fills-title" className="text-lg font-semibold">
        {COPY.fills.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{COPY.fills.selfDirected}</p>

      {fills.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{COPY.fills.empty}</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {fills.map((fill) => {
            const price = impliedPrice(fill);
            return (
              <li key={fill.txHash} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium tabular-nums">
                    Bought {formatWeth(fill.amountIn)}
                    {price ? <span className="text-muted-foreground"> at {price}</span> : null}
                  </span>
                  <span className="tabular-nums text-sm text-muted-foreground">
                    {formatUsdc(fill.amountOut)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <time dateTime={fill.when}>{fill.when.replace("T", " ").slice(0, 16)} UTC</time>
                  <span className="capitalize">{fill.mandate} band</span>
                  <a
                    className="underline"
                    href={arbiscanTx(fill.txHash)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {shortHash(fill.txHash)}
                  </a>
                </div>

                {fill.jitUnparked ? (
                  <p className="text-xs">
                    <span className="bg-primary/10 rounded px-1.5 py-0.5 font-medium">
                      {COPY.fills.jitBadge}
                    </span>{" "}
                    <span className="text-muted-foreground">{COPY.fills.jitHelp}</span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Price actually paid per ETH. Computed from the two raw amounts with a scaled bigint divide
 * so a large fill cannot lose precision, then rendered as USDC.
 */
function impliedPrice(fill: FillView): string | null {
  const weth = BigInt(fill.amountIn || "0");
  const usdc = BigInt(fill.amountOut || "0");
  if (weth <= BigInt(0)) return null;
  // usdc(6dp) per whole ETH = usdc * 1e18 / weth, still in 6dp.
  return formatUsdc((usdc * BigInt(10) ** BigInt(18)) / weth);
}
