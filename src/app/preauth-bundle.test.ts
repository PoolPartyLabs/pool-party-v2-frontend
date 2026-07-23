/**
 * @id PP-CORE-LAY-003 (POO-491)
 * @name Auth-scoped layout bundle fitness test
 * @implements-rules-version v1
 *
 * Fitness function for POO-491 [R1]: the wallet provider stack (Privy / wagmi) is mounted in the
 * `(auth)` route group, so the pure-public routes (privacy / terms / risk / learn) must NOT ship it.
 * This holds identically in mock and real mode — the client bundle is built once; `NEXT_PUBLIC_MOCK_MODE`
 * only flips runtime behaviour, not which routes import the provider.
 *
 * Reads the Next build manifest and asserts the public routes' client chunks contain NO wallet
 * markers, while an `(auth)` route (sign-in) DOES — a positive control so a future minification change
 * can't silently make the assertion vacuous. `@privy-io` is stripped by minification; the markers
 * below survive (verified against the built output).
 *
 * Requires a prior `pnpm build` (.next/app-build-manifest.json). Skips with a note when absent, so the
 * unit suite stays runnable without a build.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MANIFEST = join(process.cwd(), ".next", "app-build-manifest.json");
const hasBuild = existsSync(MANIFEST);

// Markers that survive minification in the built wallet chunk (NOT "@privy-io", which is stripped).
const WALLET_MARKERS = ["PrivyProvider", "WagmiProvider", "privy.io"];

// Pure-public routes that must stay wallet-free (outside the `(auth)` group).
const PUBLIC_ROUTES = ["privacy", "terms", "risk", "learn/wallets"];
// An `(auth)` route that MUST carry the wallet stack (detection positive control).
const CONTROL_ROUTE = "sign-in";

type Pages = Record<string, string[]>;

function loadPages(): Pages {
  return (JSON.parse(readFileSync(MANIFEST, "utf8")) as { pages: Pages }).pages;
}

function keyFor(pages: Pages, segment: string): string | undefined {
  return Object.keys(pages).find((k) => k.includes(`/${segment}/page`));
}

function chunkText(pages: Pages, key: string): string {
  return (pages[key] ?? [])
    .filter((f) => f.endsWith(".js"))
    .map((f) => {
      const p = join(process.cwd(), ".next", f);
      return existsSync(p) ? readFileSync(p, "utf8") : "";
    })
    .join("\n");
}

function markersIn(text: string): string[] {
  return WALLET_MARKERS.filter((m) => text.includes(m));
}

describe.skipIf(!hasBuild)("POO-491 pre-auth bundle boundary [R1]", () => {
  const pages = hasBuild ? loadPages() : {};

  // Positive control: the markers are actually detectable against minified output.
  it("detects the wallet stack on the sign-in (auth) route", () => {
    const key = keyFor(pages, CONTROL_ROUTE);
    expect(key, "sign-in route missing from the build manifest").toBeDefined();
    expect(markersIn(chunkText(pages, key as string)).length).toBeGreaterThan(0);
  });

  it.each(PUBLIC_ROUTES)("ships no wallet stack on the public route: %s", (segment) => {
    const key = keyFor(pages, segment);
    expect(key, `public route "${segment}" missing from the build manifest`).toBeDefined();
    expect(markersIn(chunkText(pages, key as string))).toEqual([]);
  });
});
