import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      // server-only is a Next.js build-time guard that throws on client import.
      // In Vitest there is no client/server boundary, so we alias it to a noop.
      "server-only": new URL("./tests/__mocks__/server-only.ts", import.meta.url).pathname,
      // The ported on-ramp and observability modules reach the Sentry SDK for `trace_id` and
      // breadcrumbs. The SDK is a plain dependency here (never initialised in this public build),
      // and the test graph aliases it to a recording stub so component tests need no real SDK.
      "@sentry/nextjs": new URL("./tests/__mocks__/sentry-nextjs.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // The ported suites (265 files) were written against a 30s budget; the 5s default measures
    // machine load, not hangs.
    hookTimeout: 30_000,
    testTimeout: 30_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    server: {
      deps: {
        // The 1inch SDKs ship an ESM bundle with extensionless internal imports
        // ("@1inch/byte-utils/dist/constants"), which Node's ESM resolver rejects. Inlining
        // them routes those imports through Vite's resolver, which handles the omission.
        // Next and tsx already tolerate it, so this is a Vitest-only accommodation.
        inline: [/@1inch\//],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage",
      // Per-layer thresholds (docs/04_CODE_STANDARDS.md). Globs with no files yet are skipped.
      thresholds: {
        // Global floor across every covered file: catches regressions in layers without a
        // stricter per-glob rule below. Set just under the current measured coverage
        // (stmts ~78.9 / branch 75 / funcs ~87.8 / lines ~81.7); ratchet up over time.
        // PP-DEBT(SEV:LOW): enable `all: true` once src/app, src/components and
        // src/design-system have baseline tests, so untested files also count here.
        statements: 75,
        branches: 70,
        functions: 82,
        lines: 78,
        "src/lib/utils/**": { lines: 95, functions: 95, branches: 90 },
        "src/lib/schemas/**": { lines: 100, functions: 100, branches: 100 },
        "src/mocks/services/**": { lines: 90, functions: 90, branches: 85 },
        "src/hooks/**": { lines: 85, functions: 85, branches: 80 },
        "src/features/**/hooks/**": { lines: 85, functions: 85, branches: 80 },
        "src/stores/**": { lines: 90, functions: 90, branches: 85 },
      },
    },
  },
});
