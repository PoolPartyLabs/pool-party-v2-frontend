import { createHash } from "node:crypto";
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
      expect(scriptSrc).toContain("https://*.tradingview.com");
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

    // [R6] Privy origins still present (regression guard).
    it("keeps Privy HTTPS and WSS origins in connect-src", () => {
      const connectSrc = directive(csp, "connect-src");
      expect(connectSrc).toContain("https://*.privy.io");
      expect(connectSrc).toContain("wss://*.privy.io");
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
