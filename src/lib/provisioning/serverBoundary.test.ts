/**
 * @id PP-CORE-LIB-016 (POO-1024)
 * @name provisioning server-boundary guard
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * An import-graph drift guard.
 *
 * `src/lib/provisioning/index.ts` is imported by `"use client"` components, so everything it
 * re-exports ships to the browser. The real planner (POO-1034) reads `UNISWAP_API_KEY`, which must
 * never leave the server. If the planner were added to the barrel's graph, two things happen and
 * neither is caught by `typecheck`, `lint`, `test` or `i18n:check`: the Next build fails on the
 * `server-only` import, or (worse, if the key were ever given a `NEXT_PUBLIC_` prefix) it succeeds
 * and silently ships a credential to every browser.
 *
 * `pnpm build` catches the first case. This test catches both, in seconds rather than minutes, and
 * names the offending edge so the fix is obvious.
 *
 * Rules under test (POO-1024 rules v1):
 *   [R1] types + pure math stay client-importable and free of viem / React / I/O
 *   [R3] the client barrel re-exports nothing that transitively imports `server-only`
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..", "..", "..");
const PROVISIONING = join(ROOT, "src", "lib", "provisioning");

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

/** Every `from "..."` specifier in a source file, type-only imports included. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);
}

/**
 * Walk the import graph from `entry`, returning every file reachable from it.
 * `"use server"` modules are boundaries, not edges: Next compiles them to an RPC stub on the client,
 * so their implementation (and any secret it reads) never reaches the browser bundle. Following
 * through one would report a false leak.
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

    // A "use server" module is where the client graph stops.
    if (/^\s*(["'])use server\1/m.test(source)) continue;

    for (const specifier of importsOf(source)) {
      const resolved = resolveImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

describe("provisioning server boundary (POO-1024)", () => {
  // [R3] The load-bearing assertion: nothing the client barrel pulls in may be server-only.
  it("the client barrel reaches no server-only module", () => {
    const graph = reachableFrom(join(PROVISIONING, "index.ts"));
    const offenders = [...graph.entries()]
      .filter(([, source]) => /^\s*import\s+"server-only"/m.test(source))
      .map(([file]) => file.replace(`${ROOT}/`, ""));

    expect(offenders).toEqual([]);
  });

  // [R1] The pure layer must stay pure: no viem, no React, no fetch.
  it.each(["types.ts", "computeNeed.ts"])("%s is pure (no viem, React or I/O)", (name) => {
    const source = readFileSync(join(PROVISIONING, name), "utf8");
    expect(source).not.toMatch(/from\s+"viem/);
    expect(source).not.toMatch(/from\s+"react"/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/^\s*import\s+"server-only"/m);
  });

  // [R2] Network/secret work belongs behind a "use server" module, and there must be one.
  it("planActions.ts is a server action module", () => {
    const source = readFileSync(join(PROVISIONING, "planActions.ts"), "utf8");
    expect(source).toMatch(/^\s*(["'])use server\1/m);
  });

  // [R1] Guard against the barrel quietly growing a client-hostile export in future.
  it("every module in the provisioning folder is accounted for", () => {
    const files = readdirSync(PROVISIONING).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    // planActions is the deliberate server side; everything else must be client-safe.
    expect(files).toContain("planActions.ts");
    for (const file of files) {
      if (file === "planActions.ts") continue;
      const source = readFileSync(join(PROVISIONING, file), "utf8");
      expect(source, `${file} must not be server-only`).not.toMatch(/^\s*import\s+"server-only"/m);
    }
  });
});
