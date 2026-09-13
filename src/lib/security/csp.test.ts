import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSENT_DEFAULT_SNIPPET } from "@/lib/analytics/consentSnippet";
import { rpcOrigins } from "@/lib/chains/config";
import { buildContentSecurityPolicy } from "./csp";

function directive(csp: string, name: string): string {
  return (
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ""
  );
}

describe("buildContentSecurityPolicy", () => {
  const csp = buildContentSecurityPolicy();

  // R4: clickjacking.
  it("blocks framing with frame-ancestors none", () => {
    expect(csp).toContain("frame-ancestors 'none'");
  });

  // R3: explicit allowlists, no wildcard, no unsafe-eval.
  it("has no unsafe-eval and no bare wildcard in script/connect/frame-src", () => {
    expect(csp).not.toContain("'unsafe-eval'");
    for (const name of ["script-src", "connect-src", "frame-src"]) {
      const segment = directive(csp, name);
      expect(segment).not.toContain(" *");
      // any wildcard must be a subdomain wildcard (e.g. https://*.privy.io), never a bare *
      if (segment.includes("*")) {
        expect(segment.includes("*.")).toBe(true);
      }
    }
  });

  it("default-denies and disables plugins", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("allowlists the known Pool Party origins", () => {
    expect(csp).toContain("https://*.privy.io");
    expect(csp).toContain("https://mainnet.base.org");
    expect(csp).toContain("https://www.googletagmanager.com");
  });

  it("points report-uri at the collector", () => {
    expect(csp).toContain("report-uri /api/csp-report");
  });

  it("also declares report-to for modern reporting", () => {
    expect(csp).toContain("report-to csp-endpoint");
  });

  // Drift guard: the inline Consent Mode snippet is allowlisted by hash. If the snippet changes,
  // this fails until the hash in csp.ts is recomputed.
  it("allowlists the inline consent snippet by its current SHA-256 hash", () => {
    const hash = `sha256-${createHash("sha256").update(CONSENT_DEFAULT_SNIPPET).digest("base64")}`;
    expect(directive(csp, "script-src")).toContain(`'${hash}'`);
  });

  it("keeps script-src free of unsafe-inline (hash + nonce, never inline)", () => {
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
  });

  // POO-1189 drift guard: the `_next-gtm-init` inline script is allowlisted by hash, recomputed
  // here from the INSTALLED @next/third-parties dist template, evaluated exactly as the layout's
  // call site does (no dataLayer, default dataLayerName). GoogleTagManager writes that script via
  // dangerouslySetInnerHTML, so Next.js never nonces it; without the hash, enforcing the CSP kills
  // GTM boot on every route. A dependency bump that changes the template fails HERE, in
  // `pnpm test`, instead of surfacing in prod as a silent measurement outage the day the header
  // is promoted from Report-Only. On failure: recompute the hash in csp.ts from the new template.
  it("allowlists the @next/third-parties GTM init by its current SHA-256 hash (POO-1189)", () => {
    const dist = readFileSync(
      join(__dirname, "../../../node_modules/@next/third-parties/dist/google/gtm.js"),
      "utf8",
    );
    const template = dist.match(/__html: `([\s\S]*?)`,\n/)?.[1];
    expect(template, "gtm.js dist lost the __html template; re-derive the hash").toBeTruthy();
    const body = new Function("dataLayer", "dataLayerName", `return \`${template}\`;`)(
      undefined,
      "dataLayer",
    );
    const hash = `sha256-${createHash("sha256").update(body, "utf8").digest("base64")}`;
    expect(directive(csp, "script-src")).toContain(`'${hash}'`);
  });

  // [R5] / POO-1138: the Paybis on-ramp widget loads its script from *.paybis.com. script-src is an
  // explicit host allowlist (no 'strict-dynamic'), so the host must be present or the widget loader
  // (POO-1134) is blocked even when it carries the per-request nonce. Mirrors the connect-src/frame-src
  // wildcard already allowlisting the same origin.
  it("allows the Paybis widget script host in script-src (POO-1138)", () => {
    expect(directive(csp, "script-src")).toContain("https://*.paybis.com");
  });

  // [R4] / POO-1211: INVERTED from POO-1156, which briefly allowed this origin in frame-src for a
  // GTM <noscript> fallback. That fallback is gone (a no-JS session cannot reach Consent Mode, and
  // GA4 has no non-JS variant, so it measured nothing while disclosing IP + UA to Google). The app
  // now frames no Google origin, so keeping the entry would widen the CSP for an unused capability.
  // Re-adding it means the noscript came back; fix the layout, not this test.
  it("does NOT allow any googletagmanager origin in frame-src (POO-1211)", () => {
    expect(directive(csp, "frame-src")).not.toContain("https://www.googletagmanager.com");
    expect(directive(csp, "frame-src")).not.toMatch(/googletagmanager/);
  });

  // [R4] / POO-1211: script-src KEEPS the origin. The JS loader (@next/third-parties
  // GoogleTagManager) still fetches gtm.js from it, and script-src is an explicit host allowlist
  // with no 'strict-dynamic', so dropping it here would kill analytics for every JS session.
  it("still allows the GTM loader host in script-src (POO-1211)", () => {
    expect(directive(csp, "script-src")).toContain("https://www.googletagmanager.com");
  });

  // POO-1451 (found in POO-1189): INVERTED, same shape as the POO-1211 guard above.
  // `https://*.tradingview.com` sat in script-src AND frame-src as a dead allowlist entry: nothing
  // in `src/`, `public/` or `package.json` ever loaded TradingView, and grep found it only in this
  // file and `csp.ts`. `csp.ts` opens by stating that every entry is a reviewed decision, so a stale
  // one quietly weakens that claim for every other entry beside it. Re-adding it means a TradingView
  // widget actually shipped; add the loader AND this entry back together, deliberately, rather than
  // restoring the allowlist on its own.
  it("does NOT allow any tradingview origin in script-src or frame-src (POO-1451)", () => {
    expect(directive(csp, "script-src")).not.toMatch(/tradingview/);
    expect(directive(csp, "frame-src")).not.toMatch(/tradingview/);
  });

  /**
   * POO-1643: `img-src` names NO Paybis host, and it must stay that way.
   *
   * Payment-method logos are served through our own origin (`/api/onramp/method-icon`,
   * `PP-CORE-SEC-003`) precisely so the buyer's browser never fetches from a KYC'd payment venue on
   * a screen they are only looking at. Naming `cdn.paybis.com` here is what a future session would
   * do to "fix" a logo that stopped rendering, and it would silently restore the exact disclosure
   * `CR-TOK-011` exists about, in a diff that reads as a one-line CSP tweak.
   *
   * Inverted deliberately, the POO-1451 / POO-1211 pattern: assert the ABSENCE, so a re-add fails a
   * test rather than passing review. `script-src`, `connect-src` and `frame-src` keep their Paybis
   * entries (the widget genuinely runs in the browser); this is about IMAGES only.
   */
  it("does NOT allow any paybis origin in img-src (POO-1643)", () => {
    // Anchored FIRST, because `directive()` returns "" when nothing matches: without this the
    // negative assertion below passes trivially the day `img-src` is renamed or dropped, which is
    // precisely when the guard is most needed. A guard that cannot fail is not a guard.
    expect(directive(csp, "img-src")).toMatch(/^img-src /);
    expect(directive(csp, "img-src")).not.toMatch(/paybis/);
    // The widget's own three directives are untouched, so this guard cannot be read as a rollback.
    expect(directive(csp, "script-src")).toMatch(/paybis/);
    expect(directive(csp, "frame-src")).toMatch(/paybis/);
  });

  // R6: per-request nonce for App Router inline scripts.
  describe("nonce (R6)", () => {
    it("adds 'nonce-<value>' to script-src when a nonce is provided", () => {
      const withNonce = buildContentSecurityPolicy("abc123");
      expect(directive(withNonce, "script-src")).toContain("'nonce-abc123'");
    });

    it("omits any nonce when none is provided", () => {
      expect(directive(csp, "script-src")).not.toContain("nonce-");
    });

    it("keeps the consent hash AND host allowlists alongside the nonce", () => {
      const scriptSrc = directive(buildContentSecurityPolicy("abc123"), "script-src");
      expect(scriptSrc).toContain("'nonce-abc123'");
      expect(scriptSrc).toContain("'sha256-jVw1eGdHL8e1Srej/DxWoUXoh/E2Or7t5QPTxhUdseE='");
      expect(scriptSrc).toContain("https://www.googletagmanager.com");
      // POO-1138: the nonce is inserted after 'self', so the Paybis widget host must survive too.
      expect(scriptSrc).toContain("https://*.paybis.com");
    });

    it("does not use 'strict-dynamic' (host allowlists must keep working)", () => {
      expect(buildContentSecurityPolicy("abc123")).not.toContain("strict-dynamic");
    });
  });

  // POO-193 / INT-W1: Privy + WalletConnect + multi-chain RPC drift guards.
  describe("wallet integration origins (POO-193)", () => {
    // [R1] WalletConnect relay WebSocket on .com
    it("allows WalletConnect relay WebSocket on .com in connect-src", () => {
      expect(directive(csp, "connect-src")).toContain("wss://*.walletconnect.com");
    });

    // [R2] WalletConnect relay HTTPS on .org
    it("allows WalletConnect relay HTTPS on .org in connect-src", () => {
      expect(directive(csp, "connect-src")).toContain("https://*.walletconnect.org");
    });

    // [R3] WalletConnect Verify iframe on .com
    it("allows WalletConnect Verify iframe on .com in frame-src", () => {
      expect(directive(csp, "frame-src")).toContain("https://verify.walletconnect.com");
    });

    // [R4] WalletConnect Verify iframe on .org
    it("allows WalletConnect Verify iframe on .org in frame-src", () => {
      expect(directive(csp, "frame-src")).toContain("https://verify.walletconnect.org");
    });

    // [R5] Public RPC endpoints for all 3 supported chains.
    it("allows Arbitrum public RPC in connect-src", () => {
      expect(directive(csp, "connect-src")).toContain("https://arb1.arbitrum.io");
    });

    it("allows Base public RPC in connect-src (pre-existing)", () => {
      expect(directive(csp, "connect-src")).toContain("https://mainnet.base.org");
    });

    it("allows Polygon public RPC in connect-src", () => {
      expect(directive(csp, "connect-src")).toContain("https://polygon-bor-rpc.publicnode.com");
    });

    // POO-1776 [R3]: Robinhood Chain (Arbitrum Orbit, 4663). ONE origin, the RPC that wagmi/viem and
    // every server read talk to. A literal because csp.ts cannot import the chain config (it runs in
    // the edge middleware); the drift guard below ties it back to `rpcOrigins`.
    it("allows the Robinhood Chain public RPC in connect-src", () => {
      expect(directive(csp, "connect-src")).toContain("https://rpc.mainnet.chain.robinhood.com");
    });

    /**
     * POO-1776 [R3]: `connect-src` names NO explorer origin, Robinhood's Blockscout included, and it
     * must stay that way (the POO-1451 / POO-1643 inverted-guard pattern).
     *
     * The explorer is reached only through `<a href>` (`ExplorerTxLink`, `FundingRecoveryBanner`),
     * and link NAVIGATION is not governed by connect-src at all — which is why Arbiscan, Basescan
     * and Polygonscan are absent despite the same links existing for those chains. An entry added
     * "for" an explorer is therefore a grant nothing uses, and this file's header says every entry
     * is a reviewed decision, so a dead one weakens that claim for every entry beside it. The day
     * something actually FETCHES an explorer API, that read is the reviewed edit, not this test.
     */
    it("does NOT allow any explorer origin in connect-src (POO-1776)", () => {
      const connectSrc = directive(csp, "connect-src");
      expect(connectSrc).not.toMatch(/blockscout/);
      expect(connectSrc).not.toMatch(/arbiscan|basescan|polygonscan|etherscan/);
      // The RPC half is what the chain actually needs, and it stays.
      expect(connectSrc).toContain("https://rpc.mainnet.chain.robinhood.com");
    });

    // [R6] Privy origins still present (regression guard).
    it("keeps Privy HTTPS and WSS origins in connect-src", () => {
      const connectSrc = directive(csp, "connect-src");
      expect(connectSrc).toContain("https://*.privy.io");
      expect(connectSrc).toContain("wss://*.privy.io");
    });

    /**
     * POO-1799: the hosts the PRIVY on-ramp rail actually loads, each proven by a file that was
     * opened rather than by a vendor guide. The policy is Report-Only (`csp.ts:6`), so an addition
     * is harmless and a GUESS is a landmine that only bites at enforcement, which is why the
     * "not added" cases below are asserted as loudly as the added ones.
     */
    describe("Privy on-ramp rail hosts (POO-1799 [R1])", () => {
      // @rule R1
      it("[R1] allows the Stripe crypto-onramp loader host in script-src", () => {
        // PROVEN: `@privy-io/react-auth@3.40.0` declares `@stripe/crypto@>=1.1.1` in `dependencies`
        // (not a peer, not optional), and that package's `src/shared.ts:11` holds
        // `https://crypto-js.stripe.com/crypto-onramp-outer.js`, which `injectScript()` loads by
        // `document.createElement('script')` + `headOrBody.appendChild(script)`. A `<script src>`
        // injection is script-src, and we deliberately do not use 'strict-dynamic', so the host must
        // be listed by name or the loader is blocked at enforcement.
        expect(directive(csp, "script-src")).toContain("https://crypto-js.stripe.com");
      });

      // @rule R1
      it("[R1] allows js.stripe.com in script-src: the SAME loader, not Privy Cards", () => {
        // The first read of this file refused this host as "Privy Cards, a product this app does
        // not use" and asserted it ABSENT. That was wrong, and the on-ramp path proves it without
        // any Cards surface being involved:
        //   * `@privy-io/react-auth@3.40.0`'s `dist/esm/FiatOnrampScreen-CdmfW60V.mjs` does
        //     `await import("@stripe/crypto")` and destructures `loadCryptoOnrampAndInitialize`;
        //   * `@stripe/crypto@1.1.3/src/embedded_components.ts:12-13` defines that function against
        //     `https://js.stripe.com/crypto-onramp/v1/crypto-onramp.js`, injected by
        //     `document.createElement('script')` (:34) + `appendChild` (:47);
        //   * that import also loads `@stripe/stripe-js@1.54.2` (via `@stripe/crypto/src/index.ts:1`),
        //     whose `src/index.ts:5` calls `loadScript(null)` at MODULE SCOPE for
        //     `https://js.stripe.com/v3` (`src/shared.ts:15`).
        // `https://crypto-js.stripe.com` does not cover it: they are different hosts.
        expect(directive(csp, "script-src")).toContain("https://js.stripe.com");
      });

      // @rule R1
      it("[R1] keeps Stripe out of frame-src and connect-src, which the harvest owns", () => {
        // script-src is what the opened files prove: a `<script src>` injection. What the loaded
        // script then FRAMES or CALLS is not readable from them, so those directives stay unwritten
        // until a violation report names the origin (POO-1809 harvest). Guessing them is the
        // dead-entry class POO-1451 removed.
        expect(directive(csp, "frame-src")).not.toContain("https://js.stripe.com");
        expect(directive(csp, "frame-src")).not.toContain("https://crypto-js.stripe.com");
        expect(directive(csp, "connect-src")).not.toContain("https://js.stripe.com");
        expect(directive(csp, "connect-src")).not.toContain("https://api.stripe.com");
      });

      // @rule R1
      it("[R1] allows the Privy embedded-wallet RPC host over https", () => {
        // PROVEN for the three chains this app actually ships: `@privy-io/chains@0.3.0` (a direct
        // dependency of the INSTALLED `@privy-io/react-auth@3.29.2`) declares
        // `rpcUrls:{privy:{http:["https://base-mainnet.rpc.privy.systems"]}}` at
        // `dist/esm/ethereum/definitions/base.mjs:1`, with `arbitrum.mjs:1` and `polygon.mjs:1` the
        // same. `src/lib/tx/sendTransaction.ts:501` records a live send to
        // `polygon-mainnet.rpc.privy.systems`, so this is a request the app has demonstrably made.
        expect(directive(csp, "connect-src")).toContain("https://*.rpc.privy.systems");
      });

      // @rule R1
      it("[R1] does NOT allow the wss twin: EVM definitions are http-only", () => {
        // The split is the evidence, not a preference: the EVM chain definitions carry `http:` and
        // no `webSocket:`, and the only `wss://...rpc.privy.systems` in the SDK is
        // `dist/esm/solana.mjs`'s `rpcSubscriptions:`, for a chain family this app does not
        // configure. Add it the day a Solana chain or a violation report calls for it.
        expect(directive(csp, "connect-src")).not.toContain("wss://*.rpc.privy.systems");
      });

      // @rule R1
      it("[R1] adds no duplicate for api.privy.io, already covered by the wildcard", () => {
        // `https://*.privy.io` (csp.ts) already matches `api.privy.io` and `auth.privy.io`. A second
        // literal entry would read as new coverage while adding none.
        const connectSrc = directive(csp, "connect-src");
        expect(connectSrc).toContain("https://*.privy.io");
        expect(connectSrc).not.toContain("https://api.privy.io");
      });

      /**
       * The inverted half, in the POO-1451 / POO-1211 pattern this file already uses: a host that
       * was CONSIDERED and refused has to say WHY, or the next session adds it from the same vendor
       * guide that suggested it the first time.
       *
       * Two hosts that stood here as inverted assertions have been REMOVED rather than kept, because
       * their stated reason was wrong and an assertion pinned on a wrong reason is worse than none.
       * Both are genuinely reachable and both stay OUT of the policy on a different ground, that the
       * policy is Report-Only and the harvest decides:
       *
       *   * `https://challenges.cloudflare.com` (Turnstile). It IS in the bundle:
       *     `dist/esm/TurnstileWrapper-CGrQ-0hi.mjs` imports `@marsidev/react-turnstile`, whose
       *     `dist/index.js:2` holds `SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js"`
       *     and appends it as a `<script>`. Whether it ever fires is a PRIVY DASHBOARD setting
       *     (captcha on/off) that this repo cannot read, so the harvest decides.
       *   * `wss://www.walletlink.org`. The react-auth bundle holds only the localStorage key, but
       *     `@coinbase/wallet-sdk@4.3.2` (a pinned dependency of react-auth) declares
       *     `WALLETLINK_URL = 'https://www.walletlink.org'` at `dist/core/constants.js:3`, dialled as
       *     `${linkAPIUrl}/rpc` (`WalletLinkConnection.js:89`) through `WalletLinkWebSocket.js:23`,
       *     which rewrites `^http` to `ws`. `src/app/providers.tsx:129,142` enables the coinbase
       *     connector, so the socket is reachable for a buyer who picks Coinbase Wallet on mobile.
       *     It stays out until a report proves this app opens it.
       */
      // @rule R1
      it("[R1] declares no child-src or worker-src: no worker and no blob: in either bundle", () => {
        // `new Worker(` and `blob:` are both absent from 3.29.2 and 3.40.0, so there is nothing for
        // either directive to permit. Adding them empty would be worse than omitting them: an empty
        // worker-src FORBIDS workers rather than describing them.
        expect(csp).not.toContain("child-src");
        expect(csp).not.toContain("worker-src");
      });

      it("keeps every Paybis origin, because the removal is POO-1809's (decision D13)", () => {
        // The Paybis rail stays LIVE until Privy is ready, so this PR adds beside it and removes
        // nothing. Asserted in all three directives so POO-1809 flips them consciously, as one
        // reviewed edit, rather than discovering them one failing test at a time.
        expect(directive(csp, "script-src")).toContain("https://*.paybis.com");
        expect(directive(csp, "connect-src")).toContain("https://*.paybis.com");
        expect(directive(csp, "frame-src")).toContain("https://*.paybis.com");
      });
    });

    // POO-352 drift guard: connect-src must cover EVERY RPC origin derived from the single chain
    // source (src/lib/chains/config.ts `rpcOrigins`). csp.ts can't import that module (it runs in the
    // edge middleware and chains/config pulls viem), so this test ties the hand-maintained literals to
    // the chain config: adding/removing a chain fails here until connect-src is updated to match.
    it("covers every RPC origin from the chain config single source", () => {
      const connectSrc = directive(csp, "connect-src");
      expect(rpcOrigins.length).toBeGreaterThan(0);
      for (const origin of rpcOrigins) {
        expect(connectSrc).toContain(origin);
      }
    });
  });
});
