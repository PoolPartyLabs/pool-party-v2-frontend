/**
 * @id PP-CORE-LIB-063 (POO-1132, POO-1805)
 * @name on-ramp server-boundary guard
 * @implements-rules-version v2 (POO-1132 rules v2; the POO-1805 entry follows POO-1805 rules v2)
 *
 * An import-graph drift guard for `src/lib/onramp/`, the on-ramp twin of the provisioning guard
 * (`src/lib/provisioning/serverBoundary.test.ts`).
 *
 * `onRampActions.ts` reads `PP_API_KEY` through `apiFetch` and the session cookie through
 * `getSessionWallet`, both of which `import "server-only"`. That is correct BECAUSE it is a
 * `"use server"` boundary Next compiles to an RPC stub. The danger is the PURE half of this folder,
 * `schemas.ts` and `signatureMessage.ts`, which the sign-and-continue client imports directly: if
 * either ever grew an edge to a `server-only` module (a careless `import` from the actions file, a
 * shared helper that pulled in the client), the Next build would break on the `server-only` import, or
 * (worse, were the key ever `NEXT_PUBLIC_`-prefixed) it would ship a credential to every browser.
 * `typecheck`, `lint`, `test` and `i18n:check` catch none of that; `pnpm build` catches the first case,
 * and this guard catches both in milliseconds, naming the offending edge.
 *
 * Rules under test (POO-1132 rules v2):
 *   the pure modules (`schemas.ts`, `signatureMessage.ts`) stay client-importable — no `server-only`,
 *         no viem, no React, no I/O — so they reach NO server-only module transitively.
 *   secret/network work sits behind a `"use server"` module (`onRampActions.ts`), which is a boundary
 *         and therefore allowed to be server-only; the guard must not report the boundary itself.
 *   no server-only module in the folder is reachable from the pure client-importable modules.
 *
 * PP-NOTE: the walk mirrors `provisioning/serverBoundary.test.ts` verbatim. Copied rather than shared
 * to keep this guard self-contained and avoid coupling two independent drift guards; if a third folder
 * ever needs the same walk, lift these four helpers into a test util then.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..", "..");
const ONRAMP = join(ROOT, "src", "lib", "onramp");

/**
 * The client-importable pure modules: everything reachable from these ships to the browser.
 *
 * POO-1643 adds `methodIconProxy.ts`, and it belongs here for a reason beyond bundle hygiene: it is
 * the ONE allow-list, applied on both sides of the boundary (the picker builds a `src` with it, the
 * route re-validates with it). If it ever reached a server-only module it would stop being
 * importable by the client, and the pressure would be to copy the host list rather than to fix the
 * import. Two copies of a security allow-list is exactly the failure this guard should prevent.
 *
 * POO-1800 adds `onRampProvider.ts`: both halves of the app resolve the rail from it, so it must stay
 * loadable by the client one, and only the graph walk can prove that as its imports grow.
 * POO-1801 adds the three vendor-vocabulary modules, each for the same reason in its own shape:
 * - `destinations.ts`: it reads `chains/config.ts`, the widest import in this folder, so it is the
 *   most likely route by which a server-only edge reaches the browser bundle.
 * - `limits.ts`: it re-exports out of `provisioning/computeNeed.ts`, and that module is separately
 *   pinned pure; this entry is what keeps the re-export from being the hole in that pin.
 * - `fiatCurrencies.ts`: pure data today, and this entry is what makes an `import` added to it
 *   later a red test rather than a silent server-only edge on the checkout path.
 */
const PURE_ENTRIES = [
  "schemas.ts",
  "signatureMessage.ts",
  "methodIconProxy.ts",
  // POO-1800: both halves of the app resolve the rail from it, so it must stay client-loadable.
  "onRampProvider.ts",
  // POO-1801: the three vendor-vocabulary modules, client-imported by the hosts.
  "destinations.ts",
  "limits.ts",
  "fiatCurrencies.ts",
] as const;

/**
 * Every client-importable entry, which is what the server-only walk must start from.
 *
 * POO-1805 adds `coverageProbe.ts`: it runs in the browser (its `fetch` and access token are the
 * BUYER's), so the same "reaches no server-only module" guarantee applies to it, and this list is
 * where a future session would otherwise fail to notice. It is deliberately NOT in
 * {@link PURE_ENTRIES}: the purity assertion below forbids `fetch(` outright, and calling an
 * INJECTED `fetch` is the entire point of that module ([R1] - the probe must see the status code the
 * SDK's own client swallows). Splitting the lists keeps that regex exactly as strict as it was for
 * the modules it was written for, instead of loosening it for all four.
 */
const CLIENT_ENTRIES = [...PURE_ENTRIES, "coverageProbe.ts"] as const;

/** Resolve a relative import specifier to a real file on disk, or null when it is a package. */
function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else if (specifier.startsWith("@/")) base = join(ROOT, "src", specifier.slice(2));
  else return null; // a node_modules package: outside our graph

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    try {
      if (readFileSync(candidate, "utf8")) return candidate;
    } catch {
      // not this candidate
    }
  }
  return null;
}

/**
 * Every import specifier in a source file, in all four forms that can pull a module into a bundle:
 * static `from "..."`, bare side-effect `import "..."`, dynamic `import("...")` and `require("...")`.
 */
function importsOf(source: string): string[] {
  const patterns = [
    /from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']/g,
    /require\(\s*["']([^"']+)["']/g,
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((m) => m[1] as string));
}

/** Does this module carry a `"use server"` directive (a boundary the client walk stops at)? */
function isServerBoundary(source: string): boolean {
  return /^\s*(["'])use server\1/m.test(source);
}

/**
 * Walk the import graph from `entry`, returning every file reachable from it. `"use server"` modules
 * are boundaries, not edges: recorded as visited but not followed through.
 */
function reachableFrom(entry: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;

    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    seen.set(file, source);

    if (isServerBoundary(source)) continue;

    for (const specifier of importsOf(source)) {
      const resolved = resolveImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

/** The client-reachable modules in `graph` that import `server-only` (a boundary is not one). */
function serverOnlyOffenders(graph: Map<string, string>): string[] {
  return [...graph.entries()]
    .filter(([, source]) => !isServerBoundary(source))
    .filter(([, source]) => /^\s*import\s+"server-only"/m.test(source))
    .map(([file]) => file.replace(`${ROOT}/`, ""));
}

describe("on-ramp server boundary (POO-1132)", () => {
  // @rule POO-1132: the load-bearing assertion. Nothing a client-importable pure module pulls in
  // may be server-only, transitively included.
  it.each(CLIENT_ENTRIES)("the pure module %s reaches no server-only module", (name) => {
    expect(serverOnlyOffenders(reachableFrom(join(ONRAMP, name)))).toEqual([]);
  });

  // @rule POO-1132: network/secret work sits behind a "use server" module, and there must be one.
  it("onRampActions.ts is a server action module", () => {
    const source = readFileSync(join(ONRAMP, "onRampActions.ts"), "utf8");
    expect(source).toMatch(/^\s*(["'])use server\1/m);
  });

  // @rule POO-1132: the pure layer stays pure, so it remains client-importable. No viem, no React,
  // no fetch, no server-only.
  it.each(PURE_ENTRIES)("%s is client-safe (no viem, React, I/O or server-only)", (name) => {
    const source = readFileSync(join(ONRAMP, name), "utf8");
    expect(source).not.toMatch(/from\s+"viem/);
    expect(source).not.toMatch(/from\s+"react"/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/^\s*import\s+"server-only"/m);
  });

  // @rule POO-1132 (POO-1805): the one client entry that performs I/O still performs it through an
  // INJECTED `fetch` and never by reaching for the global. That is what keeps it testable without a
  // network and what keeps the module pure enough to sit in CLIENT_ENTRIES at all.
  it("coverageProbe.ts calls only the fetch it was given", () => {
    const source = readFileSync(join(ONRAMP, "coverageProbe.ts"), "utf8");
    expect(source).not.toMatch(/from\s+"viem/);
    expect(source).not.toMatch(/from\s+"react"/);
    expect(source).not.toMatch(/^\s*import\s+"server-only"/m);
    // `deps.fetch(` and `globalThis.fetch(` are the only accepted forms; a bare `fetch(` is not.
    expect(source).not.toMatch(/(?<![.\w$])fetch\(/);
    expect(source).toMatch(/deps\.fetch\(/);
  });

  // @rule POO-1132: every server-only module in the folder is unreachable from the pure entries.
  // Checked against the graph rather than a name allowlist, so it cannot rot as files are added.
  it("no server-only module in the on-ramp folder is client-reachable", () => {
    const clientGraph = new Map<string, string>();
    for (const name of CLIENT_ENTRIES) {
      for (const [file, source] of reachableFrom(join(ONRAMP, name))) clientGraph.set(file, source);
    }

    const files = readdirSync(ONRAMP).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    // onRampActions is the deliberate `"use server"` boundary and must keep existing.
    expect(files).toContain("onRampActions.ts");

    const serverOnly = files.filter((file) =>
      /^\s*import\s+"server-only"/m.test(readFileSync(join(ONRAMP, file), "utf8")),
    );
    for (const file of serverOnly) {
      expect(clientGraph.has(join(ONRAMP, file)), `${file} must not ship to the browser`).toBe(
        false,
      );
    }
  });
});
