import { AQUA_REGISTRY, AQUA_SWAP_VM_ROUTER } from "@/lib/aqua/config/addresses";
import { COPY } from "../copy";
import { arbiscanAddress, shortHash } from "../format";

/**
 * FE-R2's on-chain verification block.
 *
 * The official 1inch contracts are listed alongside ours on purpose: the claim being made is
 * that this runs on the real Aqua registry and the real AquaSwapVMRouter, unmodified, and the
 * cheapest way to support that claim is to let anyone click through and check.
 */
export function VerifyBlock({
  vault,
  adapter,
}: {
  vault: `0x${string}`;
  adapter: `0x${string}` | null;
}) {
  const rows: Array<{ label: string; address: string }> = [
    { label: COPY.verify.vault, address: vault },
  ];
  if (adapter && adapter !== "0x0000000000000000000000000000000000000000") {
    rows.push({ label: COPY.verify.adapter, address: adapter });
  }
  rows.push(
    { label: "1inch Aqua registry", address: AQUA_REGISTRY },
    { label: "1inch AquaSwapVMRouter", address: AQUA_SWAP_VM_ROUTER },
  );

  return (
    <section
      aria-labelledby="verify-title"
      className="rounded-lg border border-border bg-surface p-6"
    >
      <h2 id="verify-title" className="text-lg font-semibold">
        {COPY.verify.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{COPY.verify.help}</p>

      <dl className="mt-4 flex flex-col gap-2 text-sm">
        {rows.map((row) => (
          <div key={row.address} className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd>
              <a
                className="tabular-nums underline"
                href={arbiscanAddress(row.address)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {shortHash(row.address)}
              </a>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
