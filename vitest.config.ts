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
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
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
