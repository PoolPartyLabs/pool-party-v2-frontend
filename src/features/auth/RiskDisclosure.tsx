/**
 * @id PP-AUTH-SCR-006
 * @name RiskDisclosure
 * @implements-rules-version v2
 * The Risk disclosure legal page: an intro plus 14 numbered risk sections and a closing note, wrapped
 * in the pre-auth AuthShell. English-only, hardcoded (no i18n per product decision, matching the
 * Privacy Policy and Terms of Service). Because the copy is hardcoded English, the AuthShell locale
 * switcher is hidden here (POO-663 / POO-664). The content is non-copyable (NoCopy) and the route is
 * served noindex (page-level robots metadata + an X-Robots-Tag header in next.config.ts). The copy is
 * informational only and is not financial, legal, or tax advice.
 */
"use client";

import { NoCopy } from "@/components/ui/NoCopy";
import { AuthShell } from "./components/AuthShell";

// The 14 risk sections, in display order.
const SECTIONS: { title: string; body: string }[] = [
  {
    title: "You can lose money",
    body: "Every strategy can lose part or all of your funds. There is no guaranteed return and no protection of your capital. Only commit funds you can afford to lose entirely.",
  },
  {
    title: "Crypto assets are volatile",
    body: "The value of crypto assets can move sharply and without warning, and can fall to zero. Past performance never predicts future results.",
  },
  {
    title: "Returns are estimates, not promises",
    body: "Any yield, APR, APY, or performance figure shown is an estimate or a record of past activity. It is not a promise of future returns and can change at any moment.",
  },
  {
    title: "Smart contract risk",
    body: "Strategies run on smart contracts. Code can contain bugs or be exploited, and audits reduce but never remove this risk. On-chain transactions are final and cannot be reversed.",
  },
  {
    title: "Liquidity and impermanent loss",
    body: "Strategies provide liquidity to decentralized exchanges. When asset prices move apart, your position can be worth less than simply holding the assets. This is impermanent loss and it can be significant.",
  },
  {
    title: "Manager risk",
    body: "Strategies are created and run by independent third parties, which may include automated agents. A manager can make losing decisions, stop managing a strategy, or act against your interests. Pool Party does not control managers or guarantee their results.",
  },
  {
    title: "You control your own wallet",
    body: "Pool Party is non-custodial. You alone hold your keys and are responsible for your wallet. If you lose access or approve a malicious transaction, your funds may be lost permanently and no one can recover them.",
  },
  {
    title: "Fees reduce your returns",
    body: "Network gas, swap costs, protocol fees, and manager performance fees all reduce your net result and can exceed the yield a strategy generates.",
  },
  {
    title: "No insurance",
    body: "Your funds are not covered by any deposit insurance or investor compensation scheme. There is no government or third-party guarantee.",
  },
  {
    title: "Infrastructure and third-party risk",
    body: "Pool Party depends on blockchains, node providers, price oracles, bridges, and fiat on-ramps run by third parties. Congestion, downtime, or failure of any of these can delay or block transactions and affect your funds.",
  },
  {
    title: "Withdrawal and slippage risk",
    body: "You may not be able to exit a position immediately or at the price you expect. Low liquidity and price movement can cause slippage and reduce the amount you receive.",
  },
  {
    title: "Regulatory and tax risk",
    body: "The rules that apply to crypto assets are uncertain and change often. Pool Party may not be available in your location. You are solely responsible for using it lawfully and for meeting your own tax obligations.",
  },
  {
    title: "Technology and security risk",
    body: "Software can fail, and attackers target crypto users through phishing, fake sites, address poisoning, and malicious approvals. Always verify what you are signing.",
  },
  {
    title: "Your responsibility",
    body: "You are responsible for evaluating each strategy and deciding whether it fits your circumstances. Do your own research. If you are unsure, seek independent professional advice before investing.",
  },
];

/** Full Risk disclosure page (replaces the reserved placeholder at /risk). */
export function RiskDisclosure() {
  return (
    <AuthShell showLocaleSwitcher={false}>
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <h1 className="font-bold text-2xl text-foreground">Risk disclosure</h1>
        <p className="mt-1 text-muted-foreground text-sm">Last updated: July 7, 2026</p>

        <NoCopy className="mt-6 text-left">
          <p className="text-muted-foreground leading-relaxed">
            Read this carefully before using Pool Party. Connecting a wallet or investing in any
            strategy means you understand and accept the risks below. If a risk is unclear to you,
            do not proceed. Pool Party is a technology platform that gives you access to on-chain
            strategies run by independent managers. It is not a bank, broker, custodian, or
            financial advisor, and nothing here is financial, legal, or tax advice or a
            recommendation to buy, sell, or hold any asset.
          </p>

          <ol className="mt-6 space-y-5">
            {SECTIONS.map((section, index) => (
              <li key={section.title} className="flex gap-3">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary text-xs"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div>
                  <h2 className="font-semibold text-base text-foreground">{section.title}</h2>
                  <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                    {section.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-6 border-border border-t pt-5 text-muted-foreground text-sm leading-relaxed">
            This disclosure does not describe every risk. It is provided for information only and
            should be read together with the Terms of Service and Privacy Policy.
          </p>
        </NoCopy>
      </div>
    </AuthShell>
  );
}
