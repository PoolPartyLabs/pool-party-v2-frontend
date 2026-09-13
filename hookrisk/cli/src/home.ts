/**
 * Where hookrisk lives.
 *
 * The CLI is not self-contained and is not meant to be. It shells out to a
 * Foundry project (`harness/`) and reads two JSON files it does not carry
 * (`schema/hook-risk.schema.json`, `schema/framework-rubric.json`). Until today
 * each consumer found those on its own by walking up from its compiled
 * location, which works from a checkout and fails silently everywhere else: the
 * harness reported `skipped — harness project not found`, buried in an engine
 * row, and the scan carried on and produced a manifest.
 *
 * That is the wrong failure. A hookrisk that cannot find its harness is not
 * degraded, it is misinstalled, and it should say so once, loudly, before it
 * runs anything. So the location is resolved exactly once per scan, up front:
 *
 *   1. `HOOKRISK_HOME`, when set. The escape hatch for anyone who moves the CLI
 *      away from the repository — a container image, a shared tool directory.
 *   2. Two levels up from this module, i.e. `cli/dist/..` -> `cli/..` -> the
 *      repository root. The monorepo layout, which is the supported one.
 *
 * A candidate counts only if it holds both `harness/foundry.toml` and
 * `schema/`; a directory with one and not the other is a partial checkout and
 * pretending otherwise defers the failure to the middle of a scan.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HookriskError } from './errors.js';

/** What a usable hookrisk installation must contain, relative to its root. */
const REQUIRED = ['harness/foundry.toml', 'schema'] as const;

export interface HookriskHome {
  /** Absolute path to the installation root. */
  root: string;
  /** `harness/`, the Foundry project the differential layer runs in. */
  harnessRoot: string;
  /** `schema/hook-risk.schema.json`, the manifest contract. */
  manifestSchema: string;
  /** `schema/framework-rubric.json`, the framework as data. */
  rubric: string;
  /** Which candidate won, for the verbose log. */
  source: 'HOOKRISK_HOME' | 'relative-to-dist';
}

/** Candidate roots, most explicit first. Exported for the tests. */
export function homeCandidates(
  env: NodeJS.ProcessEnv = process.env,
  moduleDir: string = dirname(fileURLToPath(import.meta.url)),
): Array<{ root: string; source: HookriskHome['source'] }> {
  const candidates: Array<{ root: string; source: HookriskHome['source'] }> = [];
  if (env.HOOKRISK_HOME) {
    candidates.push({ root: resolve(env.HOOKRISK_HOME), source: 'HOOKRISK_HOME' });
  }
  // dist/ -> cli/ -> repository root.
  candidates.push({ root: resolve(join(moduleDir, '..', '..')), source: 'relative-to-dist' });
  return candidates;
}

/** The parts of {@link REQUIRED} a candidate is missing. Empty means usable. */
function missingFrom(root: string): string[] {
  return REQUIRED.filter((part) => !existsSync(join(root, part)));
}

/**
 * Resolve the installation, or fail with HR-E005.
 *
 * @throws HookriskError HR-E005, naming every candidate and what each lacked.
 */
export function resolveHome(
  env: NodeJS.ProcessEnv = process.env,
  moduleDir?: string,
): HookriskHome {
  const candidates = homeCandidates(env, moduleDir);
  const context: Record<string, string> = {};

  for (const { root, source } of candidates) {
    const missing = missingFrom(root);
    if (missing.length === 0) {
      return {
        root,
        harnessRoot: join(root, 'harness'),
        manifestSchema: join(root, 'schema', 'hook-risk.schema.json'),
        rubric: join(root, 'schema', 'framework-rubric.json'),
        source,
      };
    }
    context[source] = `${root} (missing ${missing.join(', ')})`;
  }

  throw new HookriskError('HR-E005', {
    detail:
      'hookrisk cannot find its own installation: no candidate directory holds both ' +
      `${REQUIRED.join(' and ')}. Run \`make setup\` from a hookrisk checkout, or set ` +
      'HOOKRISK_HOME to one.',
    context,
  });
}
