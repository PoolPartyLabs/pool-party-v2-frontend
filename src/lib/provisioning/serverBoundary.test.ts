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
 *   [R2] secret/network work sits behind a `"use server"` module, which is a boundary and therefore
 *        allowed to be server-only (the guard must not report the boundary itself)
 *   [R3] the client barrel re-exports nothing that transitively imports `server-only`
 *
 * The walk's own correctness is under test too: it must follow every import form that puts a module
 * in a bundle (side-effect, dynamic, require), or a leak reaches the browser with this guard green.
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

/**
 * Every import specifier in a source file, in all four forms that can pull a module into a bundle:
 * static `from "..."` (type-only included), bare side-effect `import "..."`, dynamic `import("...")`
 * and CommonJS `require("...")`.
 *
 * All four matter. A `server-only` module reached through a side-effect or dynamic import is exactly
 * as leaked as one reached through a named import, and a walker that only understood `from "..."`
 * would silently leave the graph incomplete: this guard would stay green while the leak shipped.
 */
function importsOf(source: string): string[] {
  const patterns = [
    /from\s+["']([^"']+)["']/g, // import x from "y" / export … from "y"
    /import\s+["']([^"']+)["']/g, // import "y"  (side effect, e.g. `import "server-only"`)
    /import\(\s*["']([^"']+)["']/g, // await import("y")
    /require\(\s*["']([^"']+)["']/g, // require("y")
  ];
  return patterns.flatMap((pattern) => [...source.matchAll(pattern)].map((m) => m[1] as string));
}

/**
 * Does this module carry a `"use server"` directive?
 *
 * PP-NOTE (known limitation): the `/m` anchor accepts the directive at the start of ANY line, so an
 * inline function-level `"use server"` reads as a file-level one, and such a module would be treated
 * as a boundary here. Left as-is deliberately: the file-level directive in this repo follows the
 * file's doc header (see `planActions.ts`), so it cannot be anchored to line 1, and no module in the
 * graph uses the function-level form today. Swap this for a real parser if that ever changes.
 */
function isServerBoundary(source: string): boolean {
  return /^\s*(["'])use server\1/m.test(source);
}

/**
 * Walk the import graph from `entry`, returning every file reachable from it.
 * `"use server"` modules are boundaries, not edges: Next compiles them to an RPC stub on the client,
 * so their implementation (and any secret it reads) never reaches the browser bundle. The walk
 * records a boundary module (it WAS visited: the client graph really does reference it) but does not
 * follow through it, which would report a false leak.
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
    if (isServerBoundary(source)) continue;

    for (const specifier of importsOf(source)) {
      const resolved = resolveImport(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

/**
 * The client-reachable modules in `graph` that import `server-only`.
 *
 * A `"use server"` module is excluded even when it imports `server-only`: that is the intended
 * design, not a leak. `planActions.ts` is empty today, but the real planner (POO-1034) imports the
 * server-only Uniswap client precisely because it sits behind the boundary. Reporting it would fail
 * this guard the moment the boundary starts doing its job.
 */
function serverOnlyOffenders(graph: Map<string, string>): string[] {
  return [...graph.entries()]
    .filter(([, source]) => !isServerBoundary(source))
    .filter(([, source]) => /^\s*import\s+"server-only"/m.test(source))
    .map(([file]) => file.replace(`${ROOT}/`, ""));
}

describe("provisioning server boundary (POO-1024)", () => {
  // [R3] The load-bearing assertion: nothing the client barrel pulls in may be server-only.
  it("the client barrel reaches no server-only module", () => {
    expect(serverOnlyOffenders(reachableFrom(join(PROVISIONING, "index.ts")))).toEqual([]);
  });

  // [R2] The guard must not fire on the boundary itself. POO-1034 puts the server-only Uniswap
  // client inside planActions.ts, which is the design working, not a leak.
  it("does not report a 'use server' module that imports server-only", () => {
    const graph = new Map([
      [join(PROVISIONING, "planActions.ts"), '"use server";\nimport "server-only";\n'],
    ]);

    expect(serverOnlyOffenders(graph)).toEqual([]);
  });

  // [R3] …and still fires on a module that is genuinely in the client graph, so the exclusion above
  // cannot quietly turn the whole guard into a no-op.
  it("reports a client-reachable module that imports server-only", () => {
    const graph = new Map([[join(PROVISIONING, "planner.ts"), 'import "server-only";\n']]);

    expect(serverOnlyOffenders(graph)).toEqual(["src/lib/provisioning/planner.ts"]);
  });

  // [R3] The walker must see every form that pulls a module into a bundle, not just `from "..."`.
  // A side-effect or dynamic import of a server-only module leaks exactly the same credential.
  it("importsOf sees side-effect, dynamic and require specifiers, not just `from`", () => {
    const source = [
      'import { a } from "./named";',
      'export type { B } from "./reexported";',
      'import "./side-effect";',
      'const c = await import("./dynamic");',
      'const d = require("./required");',
    ].join("\n");

    expect(importsOf(source).sort()).toEqual([
      "./dynamic",
      "./named",
      "./reexported",
      "./required",
      "./side-effect",
    ]);
  });

  // [R3] The same against a real file: `server-only` is *only ever* imported for its side effect,
  // so a walker blind to that form is blind to the exact edge this guard exists to catch.
  it("sees the side-effect import in a real server-only module", () => {
    const apiClient = readFileSync(join(ROOT, "src", "lib", "api", "client.ts"), "utf8");

    expect(apiClient).toMatch(/^\s*import\s+"server-only"/m);
    expect(importsOf(apiClient)).toContain("server-only");
  });

  // [R1] The pure layer must stay pure: no viem, no React, no fetch.
  it.each([
    "types.ts",
    "computeNeed.ts",
    "gasFeasibility.ts",
  ])("%s is pure (no viem, React or I/O)", (name) => {
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

  // [R1]/[R3] Guard against the barrel quietly growing a client-hostile export in future.
  //
  // The rule is NOT "only planActions.ts may be server-only" — POO-1034 added `buildPlan.ts`, the
  // real planner, which is server-only precisely because it prices legs through the key-bearing
  // Uniswap layer ([R9]). The rule that actually protects the bundle is: a server-only module must
  // not be REACHABLE from the client barrel. So every server-only module in the folder is checked
  // against the client graph rather than against a name allowlist, which cannot rot.
  it("no server-only module in the provisioning folder is client-reachable", () => {
    const clientGraph = reachableFrom(join(PROVISIONING, "index.ts"));
    const files = readdirSync(PROVISIONING).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    // planActions is the deliberate `"use server"` boundary and must keep existing.
    expect(files).toContain("planActions.ts");

    const serverOnly = files.filter((file) =>
      /^\s*import\s+"server-only"/m.test(readFileSync(join(PROVISIONING, file), "utf8")),
    );
    // The real planner is server-only by design; asserting it is present keeps this test honest if
    // the file is ever renamed away rather than silently losing its guard.
    expect(serverOnly).toContain("buildPlan.ts");

    for (const file of serverOnly) {
      expect(
        clientGraph.has(join(PROVISIONING, file)),
        `${file} must not ship to the browser`,
      ).toBe(false);
    }
  });
});
