import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone/server.js) so the Docker runner stage ships
  // only the server + static assets, not the full node_modules (dev deploy, INT-DEPLOY).
  output: "standalone",
  experimental: {
    // Behind CloudFront the forwarded Host differs from the request Origin, which trips Next's
    // Server Action CSRF/origin check (the browser sees "An unexpected response was received from
    // the server" and SIWE fails). Allow the public origins so Server Actions work through the CDN.
    // PP-INTEGRATION-POINT (INT-DEPLOY): keep in sync with the deployed domain(s).
    serverActions: {
      allowedOrigins: [
        "v2.dev.pool-party.xyz",
        "www.v2.dev.pool-party.xyz",
        "v2.app.pool-party.xyz",
        "www.v2.app.pool-party.xyz",
      ],
    },
  },
  // PP-SECURITY: do not advertise the framework via the X-Powered-By response header.
  poweredByHeader: false,
  // PP-SECURITY (POO-81): static security headers on every route. CSP is per-request in middleware.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // PP-SECURITY (POO-663/POO-664): keep the legal pages (Risk disclosure, Privacy Policy, Terms
      // of Service) out of every search index. Paired with each page's `robots: { index: false }`
      // metadata; do NOT disallow these paths in robots.txt, or crawlers cannot read the noindex.
      // localePrefix is "always", so real paths are /{locale}/{risk|privacy|terms}.
      {
        source: "/:locale/:page(risk|privacy|terms)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  // PP-INTEGRATION-POINT: when remote images are introduced, add their exact hosts to
  // images.remotePatterns and tighten CSP img-src (currently `https:`) to the same allowlist.

  // Wagmi connectors dynamically import optional packages (e.g. 'accounts' from the Tempo
  // connector). Webpack resolves these at build time and fails. Mark them as external so the
  // dynamic import('accounts').catch() fallback works at runtime as intended.
  serverExternalPackages: ["accounts"],
  webpack(config) {
    // Also ignore on the client bundle: treat the missing optional import as an empty module
    // so the .catch() handler in wagmi fires cleanly instead of a build error.
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      accounts: false,
    };
    return config;
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
