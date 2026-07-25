/**
 * @id PP-CORE-SEC-001 (POO-1050)
 * @name build-output secret scan
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Greps the Next build output for the VALUES of every server-only secret, and fails if one appears in
 * anything a browser can fetch. POO-1050 [R1], the highest-severity check in the Universal Funding
 * epic, and ADR 0003 §8.
 *
 * ## Why a build-output grep, and not a code review
 *
 * ADR 0003 calls the failure mode invisible, and it is. `UNISWAP_API_KEY` is read in exactly one
 * `server-only` module, and that fact is guarded by an import-graph test. But neither guard survives
 * a `NEXT_PUBLIC_` prefix: with one, Next inlines the value into every client chunk, every test still
 * passes, every manual QA still works, and the key ships to every browser. The only artefact that
 * tells the truth is the build output, so that is what this reads.
 *
 * ## What counts as client-reachable
 *
 * Everything under `.next/static/` (served verbatim), plus every prerendered `.html` and `.rsc`
 * payload anywhere under `.next` (an RSC flight payload is streamed to the browser, so a secret
 * interpolated into a Server Component's props leaks through it just as surely as through a chunk).
 * Deliberately NOT `.next/server/**` JavaScript, where a secret legitimately lives, and not
 * `.next/cache`, which is not shipped.
 *
 * ## Usage
 *
 *   pnpm build && pnpm secrets:check
 *
 * It exits non-zero when there is no build to scan. A check that quietly passed on a machine that had
 * not built would report green exactly when it was blind, which is worse than not having it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { argv, cwd, env, exit } from "node:process";

const ROOT = cwd();
const BUILD_DIR = join(ROOT, ".next");

/**
 * The server-only credentials this repository holds, and only those: each one is documented in
 * `.env.example` under a "NEVER prefix with NEXT_PUBLIC" heading and read from server-only code, so
 * none may ever appear in a client bundle.
 *
 * The list is the guard's coverage, so it has to stay exhaustive: a name that is missing here is a
 * secret nobody is scanning for, while a name that is set in no environment simply costs nothing.
 * Add every new server-only credential in the same PR that introduces it. Speculative names are
 * deliberately absent, because a list padded with credentials this repo does not hold reads as
 * exhaustive without being it, which is exactly how a real omission goes unnoticed.
 */
export const SERVER_ONLY_SECRET_NAMES = [
  "UNISWAP_API_KEY",
  "PP_API_KEY",
  "PP_ANALYTICS_USER_ID_SECRET",
] as const;

/**
 * Below this length a value is not greppable: a 4-character secret matches half the minified output
 * by coincidence, and the resulting noise is how a real hit gets ignored. Such a value is reported as
 * `unscannable-secret` rather than silently skipped, because the right fix is a longer secret.
 */
export const MIN_SCANNABLE_SECRET_LENGTH = 12;

export interface BundleSecretProblem {
  kind: "leaked-secret" | "public-prefixed-secret" | "unscannable-secret" | "no-build";
  message: string;
}

export interface ScannedFile {
  path: string;
  contents: string;
}

/** Everything under `dir` (`.next`) that a browser can fetch. See the header for the reasoning. */
export function clientReachableFiles(dir: string): ScannedFile[] {
  return walk(dir)
    .filter((path) => {
      const rel = relative(dir, path);
      if (rel.startsWith("cache/")) return false;
      if (rel.startsWith("static/")) return true;
      return rel.endsWith(".html") || rel.endsWith(".rsc") || rel.endsWith(".body");
    })
    .map((path) => ({ path, contents: readFileSync(path, "utf8") }));
}

/** Every file under `dir`, recursively. A missing directory yields nothing rather than throwing. */
function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * Any secret VALUE that appears in a client-reachable file.
 *
 * The report names the variable and the file, never the value: a CI log is a public artefact, and a
 * check that prints the secret it just found has leaked it a second time.
 */
export function findLeakedSecrets(
  files: readonly ScannedFile[],
  secrets: Record<string, string | undefined>,
): BundleSecretProblem[] {
  const problems: BundleSecretProblem[] = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) continue;
    if (value.length < MIN_SCANNABLE_SECRET_LENGTH) {
      problems.push({
        kind: "unscannable-secret",
        message: `${name} is shorter than ${MIN_SCANNABLE_SECRET_LENGTH} characters, so the bundle cannot be scanned for it. Use a longer secret.`,
      });
      continue;
    }
    for (const file of files) {
      if (file.contents.includes(value)) {
        problems.push({
          kind: "leaked-secret",
          message: `${name} appears in ${file.path}, which is served to the browser.`,
        });
      }
    }
  }
  return problems;
}

/**
 * A server-only secret that has grown a `NEXT_PUBLIC_` twin. This is the failure ADR 0003 exists for,
 * and it is caught here even when the variable is unset in the scanning environment, because the
 * prefix alone is the defect.
 */
export function findPublicPrefixedSecrets(
  environment: Record<string, string | undefined>,
): BundleSecretProblem[] {
  return SERVER_ONLY_SECRET_NAMES.filter((name) => `NEXT_PUBLIC_${name}` in environment).map(
    (name) => ({
      kind: "public-prefixed-secret" as const,
      message: `NEXT_PUBLIC_${name} exists. A NEXT_PUBLIC_ prefix inlines the value into every client bundle (ADR 0003).`,
    }),
  );
}

function main(): number {
  const problems = findPublicPrefixedSecrets(env);
  const files = clientReachableFiles(BUILD_DIR);

  if (files.length === 0) {
    problems.push({
      kind: "no-build",
      message: `No client-reachable files under ${BUILD_DIR}. Run \`pnpm build\` first: this check is only meaningful against a real build.`,
    });
  } else {
    const secrets = Object.fromEntries(SERVER_ONLY_SECRET_NAMES.map((n) => [n, env[n]]));
    problems.push(...findLeakedSecrets(files, secrets));
  }

  if (problems.length > 0) {
    console.error(`secrets:check found ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  [${p.kind}] ${p.message}`);
    return 1;
  }

  const configured = SERVER_ONLY_SECRET_NAMES.filter((name) => env[name]);
  console.log(
    `secrets:check passed. ${files.length} client-reachable files scanned for ${configured.length} configured secret(s): ${configured.join(", ") || "none"}.`,
  );
  if (configured.length === 0) {
    console.log(
      "  Note: no secret was set in this environment, so only the NEXT_PUBLIC_ prefix check ran.",
    );
  }
  return 0;
}

const invoked = argv[1] ?? "";
const isDirectRun =
  invoked.endsWith("bundle-secrets-check.ts") || invoked.endsWith("bundle-secrets-check.js");
if (isDirectRun) exit(main());
