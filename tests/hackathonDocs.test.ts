/**
 * @id PP-CORE-DOC-001 (POO-1051)
 * @name hackathon submission documentation, spec
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The submission's narrative is its documentation, and an evaluator cannot see our tracker. So the
 * claims in `docs/_hackathon/` are the claims we are judged on, and a confidently wrong one is worse
 * than a thin one. This file turns the checkable half of those claims into assertions.
 *
 * Rules under test (POO-1051 rules v1):
 *   [R1] the continuity table's `Status` column is true: a `landed` row's path is in the tree, a
 *        `planned` row's is not, and the table agrees with the document's own `@hackathon` recipe
 *   [R2] the plan of record lists the epic as it actually ran, including the issues added mid-flight
 *   [R3] the bridge document carries the verified flagship evidence, with its real figures
 *   [R4] `INTEGRATION_POINTS.md` and `ARCHITECTURE_STATE.md` know the funding rail exists
 *   [R5] every artifact the epic added has a registry row, and the Totals header is a real count
 *   [R6] ADR 0003 still describes reality, and names the committed check that now enforces it
 *
 * Source-text guards rather than runtime assertions, the same choice `fundingRailBoundary.test.ts`
 * makes and for the same reason: the failure is a line someone writes (or fails to write), and it has
 * to fail in review rather than in front of a judge.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

const CONTINUITY = "docs/_hackathon/03_PRE_EXISTING_VS_NEW.md";
const PLAN = "docs/_hackathon/00_IMPLEMENTATION_PLAN.md";
const BRIDGE = "docs/_hackathon/02_BRIDGE_ARCHITECTURE.md";
const REGISTRY = "docs/IDS_REGISTRY.md";
const SEAMS = "docs/INTEGRATION_POINTS.md";
const STATE = "docs/ARCHITECTURE_STATE.md";
const ADR_KEY_BOUNDARY = "docs/adr/0003-server-only-uniswap-key-boundary.md";

/** Directories the repo's own scans walk. `.next`, `node_modules` and friends are never in them. */
const SCANNED_ROOTS = ["src", "scripts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) walk(relative, out);
    else out.push(relative);
  }
  return out;
}

const ALL_FILES = SCANNED_ROOTS.flatMap((dir) => walk(dir));

const isTestOrStory = (path: string): boolean =>
  /\.(test|spec)\.(ts|tsx)$/.test(path) || /\.stories\.tsx$/.test(path);

/** Every module the epic header-tagged, excluding the tests and stories that sit beside them. */
const TAGGED_MODULES = ALL_FILES.filter(
  (path) => !isTestOrStory(path) && /\.(ts|tsx)$/.test(path) && read(path).includes("@hackathon"),
);

/** Every `@hackathon` file, tests included: the document's own `git grep -l` recipe. */
const TAGGED_FILES = ALL_FILES.filter(
  (path) => /\.(ts|tsx)$/.test(path) && read(path).includes("@hackathon"),
);

interface Row {
  section: string;
  paths: string[];
  status: string;
  line: string;
}

/**
 * Every `| … | Status |` row of the continuity document's Part 2, tagged with the sub-table it sits
 * in, with the repo paths in its first cell. A path is any backticked token containing a `/`, which
 * is why the tables spell every cell as a repo-relative path rather than a bare component name: a
 * citation nobody can resolve is not a citation.
 *
 * The sub-table matters because `landed` means the opposite thing under `### Deleted`: there, the
 * work having landed is precisely why the path is gone.
 */
function continuityRows(markdown: string): Row[] {
  const part2 = markdown.slice(markdown.indexOf("## Part 2"), markdown.indexOf("## Part 3"));
  const rows: Row[] = [];
  let section = "";
  for (const line of part2.split("\n")) {
    if (line.startsWith("### ")) section = line.slice(4).trim();
    if (!line.startsWith("| `")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const status = cells.at(-2) ?? "";
    const paths = [...(cells[1] ?? "").matchAll(/`([^`]+)`/g)]
      .map((match) => match[1] ?? "")
      .filter((token) => token.includes("/"));
    rows.push({ section, paths, status, line });
  }
  return rows;
}

const exists = (relative: string): boolean => {
  try {
    statSync(join(ROOT, relative));
    return true;
  } catch {
    return false;
  }
};

describe("[R1] the continuity table is true against the tree", () => {
  const rows = continuityRows(read(CONTINUITY));

  it("parses a Part 2 row for every listed path", () => {
    expect(rows.length).toBeGreaterThan(20);
    for (const row of rows) expect(row.paths.length, row.line).toBeGreaterThan(0);
  });

  it("uses only the two statuses its own legend defines", () => {
    for (const row of rows) expect(["landed", "planned"], row.line).toContain(row.status);
  });

  it("has every `landed` path in the tree", () => {
    const missing = rows
      .filter((row) => row.status === "landed" && row.section !== "Deleted")
      .flatMap((row) => row.paths)
      .filter((path) => !exists(path));
    expect(missing).toEqual([]);
  });

  it("has no `planned` module already in the tree", () => {
    const stale = rows
      .filter((row) => row.status === "planned" && row.section === "New modules")
      .flatMap((row) => row.paths)
      .filter((path) => exists(path));
    expect(stale).toEqual([]);
  });

  it("has actually deleted what it says it deleted", () => {
    const deleted = rows.filter((row) => row.section === "Deleted");
    expect(deleted.length).toBeGreaterThan(0);
    for (const row of deleted) {
      expect(row.status, row.line).toBe("landed");
      for (const path of row.paths) expect(exists(path), path).toBe(false);
    }
  });

  it("agrees with its own `git grep -l @hackathon` recipe", () => {
    const listed = new Set(rows.flatMap((row) => row.paths));
    const unlisted = TAGGED_MODULES.filter(
      (path) => !listed.has(path) && ![...listed].some((entry) => path.startsWith(entry)),
    );
    expect(unlisted).toEqual([]);
  });

  it("states how many files the recipe returns, and is right", () => {
    expect(read(CONTINUITY)).toContain(`${TAGGED_FILES.length} files`);
  });
});

describe("[R2] the plan of record matches the epic that actually ran", () => {
  const plan = read(PLAN);

  it("counts the 33 issues the epic finished with, not the 29 it opened with", () => {
    expect(plan).toContain("33 issues");
  });

  it("lists every issue added mid-flight", () => {
    for (const issue of ["POO-1052", "POO-1054", "POO-1055", "POO-1056"]) {
      expect(plan, issue).toContain(issue);
    }
  });

  it("tells the story of the plan changing under contact with the live API", () => {
    expect(plan).toContain("How the plan changed under contact with the live API");
  });

  it("does not claim an issue number the epic never had", () => {
    expect(plan).not.toContain("POO-1053");
  });
});

describe("[R3] the bridge document carries the verified flagship evidence", () => {
  const bridge = read(BRIDGE);

  it("records the probe that produced it, under the anchor the plan links to", () => {
    expect(bridge).toContain("### 1.6 The verified flagship route, live (2026-07-25)");
    expect(read(PLAN)).toContain("#16-the-verified-flagship-route-live-2026-07-25");
  });

  it("keeps the real figures, which are the whole point of the section", () => {
    for (const figure of ["18552590", "18542977", "404", "estimatedFillTimeMs"]) {
      expect(bridge, figure).toContain(figure);
    }
  });
});

describe("[R4] the integration docs know the funding rail exists", () => {
  const seams = read(SEAMS);

  it("gives the rail its own section in INTEGRATION_POINTS", () => {
    expect(seams).toContain("Universal Funding");
  });

  it("names the modules that own the rail's seams", () => {
    for (const path of [
      "src/lib/uniswap/client.ts",
      "src/lib/uniswap/actions.ts",
      "src/lib/provisioning/planner.ts",
      "src/features/strategies/lib/buildPlanSteps.ts",
    ]) {
      expect(seams, path).toContain(path);
    }
  });

  it("states a marker census that matches the tree", () => {
    const files = ALL_FILES.filter((path) => path.startsWith("src/"));
    let markers = 0;
    let marked = 0;
    for (const path of files) {
      const hits = read(path).match(/PP-INTEGRATION-POINT/g)?.length ?? 0;
      markers += hits;
      if (hits > 0) marked += 1;
    }
    expect(seams).toContain(`${markers} markers across ${marked} files`);
  });

  it("records provisioning as real in ARCHITECTURE_STATE", () => {
    const state = read(STATE);
    expect(state).toContain("Universal Funding");
    expect(state).toContain("UNISWAP_API_KEY");
  });
});

describe("[R5] the registry covers what the epic added", () => {
  const registry = read(REGISTRY);
  const rowIds = [...registry.matchAll(/^\| `(PP-[A-Z0-9-]+)`/gm)].map((match) => match[1] ?? "");

  it("has a row for every @id the epic's modules declare", () => {
    const declared = new Set<string>();
    for (const path of TAGGED_MODULES) {
      const id = read(path).match(/@id\s+(PP-[A-Z0-9-]+)/)?.[1];
      if (id) declared.add(id);
    }
    const missing = [...declared].filter((id) => !rowIds.includes(id));
    expect(missing).toEqual([]);
  });

  it("states a Totals header that counts the rows it actually has", () => {
    expect(registry).toContain(`Totals: ${rowIds.length} artifacts`);
  });

  it("adds no NEW duplicate id, and names the pre-existing ones instead of hiding them", () => {
    const seen = new Set<string>();
    const duplicated = new Set<string>();
    for (const id of rowIds) {
      if (seen.has(id)) duplicated.add(id);
      seen.add(id);
    }
    // Pre-existing collisions, from before this epic. Renumbering another team's shipped artifacts
    // is a change to their code, not a documentation fix, so they are disclosed rather than moved.
    expect([...duplicated].sort()).toEqual([
      "PP-PORT-SCR-001",
      "PP-PROF-HOOK-002",
      "PP-STR-LIB-005",
      "PP-STR-LIB-006",
      "PP-STR-LIB-007",
    ]);
    for (const id of duplicated) expect(registry, id).toContain(`\`${id}\` is duplicated`);
  });
});

describe("[R6] ADR 0003 still describes reality", () => {
  const adr = read(ADR_KEY_BOUNDARY);

  it("names the committed build-output grep that now enforces the boundary", () => {
    expect(adr).toContain("scripts/bundle-secrets-check.ts");
    expect(adr).toContain("pnpm secrets:check");
  });

  it("still asserts the CSP absence that the boundary rests on", () => {
    expect(adr).toContain("trade-api.gateway.uniswap.org");
    expect(read("src/lib/security/csp.ts")).not.toContain("trade-api.gateway.uniswap.org");
  });
});
