/**
 * @id PP-CORE-SEC-001 (POO-1050)
 * @name build-output secret scan, spec
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1050 rules v1):
 *   [R1] `UNISWAP_API_KEY` is server-only, and a BUILD-OUTPUT GREP proves it never reaches a client
 *        bundle. The highest-severity check in the epic, committed as a script so it cannot regress.
 *
 * Two halves, deliberately. The scanner is unit-tested here against a synthetic `.next/` tree, so the
 * suite stays offline and fast; the real grep runs from `pnpm secrets:check` after `pnpm build`,
 * where an actual bundle exists. A test that silently skipped when `.next/` was absent would be worse
 * than no test, because it would report green on every machine that had not built.
 *
 * The static invariants below need no build at all and are the ones that catch the failure mode ADR
 * 0003 calls invisible: a `NEXT_PUBLIC_` prefix ships the key to every browser and works perfectly in
 * every test.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clientReachableFiles,
  findLeakedSecrets,
  findPublicPrefixedSecrets,
  MIN_SCANNABLE_SECRET_LENGTH,
} from "../scripts/bundle-secrets-check";

const ROOT = join(__dirname, "..");
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A synthetic `.next/` tree: `{ "static/chunks/a.js": "…" }` relative to the build dir. */
function buildDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "pp-bundle-scan-"));
  created.push(root);
  const next = join(root, ".next");
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(next, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
  }
  return next;
}

describe("clientReachableFiles", () => {
  it("includes everything under static/, which is served verbatim to the browser", () => {
    const next = buildDir({ "static/chunks/app/page-1.js": "x", "static/css/a.css": "y" });
    expect(
      clientReachableFiles(next)
        .map((f) => f.path.replace(`${next}/`, ""))
        .sort(),
    ).toEqual(["static/chunks/app/page-1.js", "static/css/a.css"]);
  });

  it("includes prerendered HTML and RSC payloads, which also travel to the browser", () => {
    const next = buildDir({ "server/app/en/page.html": "x", "server/app/en/page.rsc": "y" });
    expect(clientReachableFiles(next)).toHaveLength(2);
  });

  it("excludes server JavaScript, where a secret legitimately lives", () => {
    const next = buildDir({ "server/chunks/123.js": "process.env.UNISWAP_API_KEY" });
    expect(clientReachableFiles(next)).toEqual([]);
  });

  it("excludes the build cache, which is not shipped", () => {
    const next = buildDir({ "cache/webpack/a.pack": "x" });
    expect(clientReachableFiles(next)).toEqual([]);
  });
});

describe("findLeakedSecrets", () => {
  const files = [
    { path: "/build/.next/static/chunks/a.js", contents: 'const k="sk-live-abc123def";' },
  ];

  it("reports a secret value found in a client-reachable file", () => {
    const problems = findLeakedSecrets(files, { UNISWAP_API_KEY: "sk-live-abc123def" });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe("leaked-secret");
    expect(problems[0]?.message).toContain("UNISWAP_API_KEY");
  });

  it("never puts the secret VALUE in its own report, which would leak it into CI logs", () => {
    const [problem] = findLeakedSecrets(files, { UNISWAP_API_KEY: "sk-live-abc123def" });
    expect(problem?.message).not.toContain("sk-live-abc123def");
  });

  it("passes when the value is absent", () => {
    expect(findLeakedSecrets(files, { UNISWAP_API_KEY: "a-different-key-entirely" })).toEqual([]);
  });

  it("skips a value too short to grep for, rather than matching every file by accident", () => {
    const short = "a".repeat(MIN_SCANNABLE_SECRET_LENGTH - 1);
    const problems = findLeakedSecrets([{ path: "/a.js", contents: short }], {
      UNISWAP_API_KEY: short,
    });
    expect(problems.map((p) => p.kind)).toEqual(["unscannable-secret"]);
  });

  it("ignores an unset variable entirely", () => {
    expect(findLeakedSecrets(files, { UNISWAP_API_KEY: undefined })).toEqual([]);
  });
});

describe("findPublicPrefixedSecrets — the invisible failure ADR 0003 exists for", () => {
  it("flags a server-only secret that has been given a NEXT_PUBLIC_ twin", () => {
    const problems = findPublicPrefixedSecrets({ NEXT_PUBLIC_UNISWAP_API_KEY: "x" });
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe("public-prefixed-secret");
  });

  it("leaves unrelated public variables alone", () => {
    expect(findPublicPrefixedSecrets({ NEXT_PUBLIC_MOCK_MODE: "true" })).toEqual([]);
  });
});

describe("the repository's own static invariants (no build required)", () => {
  it("[R1] no NEXT_PUBLIC_ Uniswap key exists anywhere in the tracked tree", () => {
    // A grep over source rather than over `process.env`: the leak we are guarding against is a line
    // of code someone writes, and it would ship long before it appeared in anyone's environment.
    const tracked = ["src", "scripts", ".env.example", "next.config.ts"];
    for (const entry of tracked) {
      const hits = grep(join(ROOT, entry), /NEXT_PUBLIC_UNISWAP/);
      expect(hits, `NEXT_PUBLIC_UNISWAP found in ${entry}`).toEqual([]);
    }
  });

  it("[R1] UNISWAP_API_KEY is read in exactly one module, and that module is server-only", () => {
    const readers = grep(join(ROOT, "src"), /process\.env\.UNISWAP_API_KEY/).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    expect(readers).toEqual([join(ROOT, "src/lib/uniswap/client.ts")]);
    expect(readFileSync(readers[0] as string, "utf8")).toMatch(/^\s*import\s+"server-only"/m);
  });
});

/** Every file under `path` whose contents match `pattern`. */
function grep(path: string, pattern: RegExp): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(path);
  } catch {
    return [];
  }
  if (!stats.isDirectory()) {
    return pattern.test(readFileSync(path, "utf8")) ? [path] : [];
  }
  return readdirSync(path).flatMap((entry) => grep(join(path, entry), pattern));
}
