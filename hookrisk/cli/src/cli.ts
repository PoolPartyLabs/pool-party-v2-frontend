#!/usr/bin/env node
/**
 * hookrisk command line.
 *
 * `hookrisk scan <file>:<Contract>` runs every enabled engine over a hook,
 * reconciles their findings, scores the result against the Uniswap Foundation's
 * framework, and writes a manifest, a human report and a SARIF file.
 *
 * Exit codes are meaningful and documented in `errors/catalog.json`:
 *   0   scan completed, gate passed
 *   2   scan completed, gate failed — a result, not an error
 *   10+ hookrisk could not run; the code identifies why
 *   64  usage: the command line itself was wrong, so no scan was attempted
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertDeclarationsComplete,
  configTemplate,
  loadConfig,
  type HookriskConfig,
} from './config.js';
import { EXIT_GATE_FAILED, HookriskError, errorCodeFor, supportsColour } from './errors.js';
import { BlockSecEngine } from './engines/blocksec.js';
import { mergeEngineResults } from './engines/dedupe.js';
import { SlitherEngine } from './engines/slither.js';
import { resolveHome } from './home.js';
import { createLogger } from './log.js';
import {
  buildManifest,
  renderMarkdown,
  validateManifest,
  type HarnessSummary,
  type InvariantResult,
} from './manifest.js';
import {
  FLAG_BITS,
  permissionsFrom,
  resolveProject,
  runHarness,
  type HarnessOutcome,
} from './harness.js';
import { reconcileLayers } from './reconcile.js';
import { toSarif } from './sarif.js';
import { deriveScoringInput } from './scoring/derive.js';
import { loadRubric } from './scoring/rubric.js';
import { score } from './scoring/score.js';
import type { Engine, EngineResult } from './types.js';

const VERSION = '0.1.0';

/** Wrong command line. sysexits.h EX_USAGE; see `reserved` in errors/catalog.json. */
const EXIT_USAGE = 64;

interface ScanArgs {
  target?: string;
  projectRoot: string;
  configPath: string;
  outDir: string;
  timeoutMs: number;
  skipStatic: boolean;
  skipDynamic: boolean;
  noGate: boolean;
  noValidate: boolean;
  verbose: boolean;
  json: boolean;
  logJson: boolean;
}

function usage(): string {
  return `hookrisk ${VERSION} — executable risk assessment for Uniswap v4 hooks

USAGE
  hookrisk scan <file.sol:Contract> [options]
  hookrisk init [--config <path>]
  hookrisk engines
  hookrisk --version

SCAN OPTIONS
  --root <dir>        Foundry project root (default: cwd)
  --config <path>     hookrisk.toml (default: <root>/hookrisk.toml)
  --out <dir>         Where to write artifacts (default: <root>)
  --timeout <sec>     Per-engine budget (default: 600)
  --skip-static       Do not run static analysis; affected dimensions are
                      reported unmeasured, never as zero
  --skip-dynamic      Do not run the differential harness
  --no-gate           Report without failing on the configured thresholds
  --no-validate       Emit the manifest even if it fails schema validation
  --verbose           Print engine invocations and progress to stderr
  --log-json          Emit the progress log to stderr as one JSON object per
                      line, every line carrying the run id. Implies verbosity.
  --json              Print the manifest to stdout instead of the summary

OUTPUT
  hook-risk.json      Machine-readable manifest, validated against
                      schema/hook-risk.schema.json
  HOOK_RISK.md        Human report
  hookrisk.sarif      For GitHub code scanning

  The summary goes to stdout; progress and errors go to stderr. With --json,
  stdout carries the manifest and nothing else.

EXIT CODES
  0                   Scan completed, gate passed
  2                   Scan completed, gate failed — a result, not an error
  10-70               hookrisk could not run; the code identifies why, see
                      docs/TROUBLESHOOTING.md
  64                  Usage: unknown or missing command; nothing was scanned
  1                   Never emitted deliberately — an uncaught crash

ENVIRONMENT
  HOOKRISK_HOME       hookrisk checkout holding harness/ and schema/. Defaults
                      to the repository this CLI was built in.

Full documentation: https://github.com/0xmvercosa/hookrisk
`;
}

// --------------------------------------------------------------------------- //
// Argument parsing
// --------------------------------------------------------------------------- //

function parseScanArgs(argv: string[]): ScanArgs {
  const args: ScanArgs = {
    projectRoot: process.cwd(),
    configPath: '',
    outDir: '',
    timeoutMs: 600_000,
    skipStatic: false,
    skipDynamic: false,
    noGate: false,
    noValidate: false,
    verbose: false,
    json: false,
    logJson: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new HookriskError('HR-E102', { detail: `${arg} requires a value.` });
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case '--root':
        args.projectRoot = resolve(next());
        break;
      case '--config':
        args.configPath = resolve(next());
        break;
      case '--out':
        args.outDir = resolve(next());
        break;
      case '--timeout':
        args.timeoutMs = Number.parseInt(next(), 10) * 1000;
        break;
      case '--skip-static':
        args.skipStatic = true;
        break;
      case '--skip-dynamic':
        args.skipDynamic = true;
        break;
      case '--no-gate':
        args.noGate = true;
        break;
      case '--no-validate':
        args.noValidate = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--log-json':
        args.logJson = true;
        break;
      case '--json':
        args.json = true;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new HookriskError('HR-E102', { detail: `Unknown option ${arg}.` });
        }
        if (args.target) {
          throw new HookriskError('HR-E102', {
            detail: `Multiple targets given: ${args.target} and ${arg}.`,
          });
        }
        args.target = arg;
    }
  }

  args.configPath ||= join(args.projectRoot, 'hookrisk.toml');
  args.outDir ||= args.projectRoot;
  return args;
}

/** Split `path/to/File.sol:Contract` into its parts. */
function resolveTarget(target: string | undefined, projectRoot: string): {
  sourceFile: string;
  contractName: string;
} {
  if (!target) {
    throw new HookriskError('HR-E102', {
      detail: 'No target given. Pass `path/to/Hook.sol:ContractName`.',
    });
  }

  const colon = target.lastIndexOf(':');
  if (colon <= 0) {
    throw new HookriskError('HR-E102', {
      detail: `\`${target}\` is not of the form path/to/Hook.sol:ContractName.`,
    });
  }

  const sourceFile = target.slice(0, colon);
  const contractName = target.slice(colon + 1);

  if (!existsSync(resolve(projectRoot, sourceFile))) {
    throw new HookriskError('HR-E102', {
      detail: `Source file not found: ${sourceFile}`,
      context: { root: projectRoot },
    });
  }

  return { sourceFile, contractName };
}

// --------------------------------------------------------------------------- //
// Commands
// --------------------------------------------------------------------------- //

async function commandScan(argv: string[]): Promise<number> {
  const startedAt = Date.now();
  const args = parseScanArgs(argv);
  const { sourceFile, contractName } = resolveTarget(args.target, args.projectRoot);

  const log = createLogger({ json: args.logJson, verbose: args.verbose });

  // Before anything else: the CLI needs a harness project and a schema
  // directory, and neither is inside the package. Resolving them up front turns
  // "installed wrong" from a scan that quietly skips its dynamic half into one
  // loud HR-E005 — see cli/src/home.ts.
  const home = resolveHome();
  log.event('info', 'scan', `scan: ${sourceFile}:${contractName} run=${log.runId}`, {
    target: `${sourceFile}:${contractName}`,
    projectRoot: args.projectRoot,
    home: home.root,
    homeSource: home.source,
    toolVersion: VERSION,
  });

  let config: HookriskConfig;
  if (existsSync(args.configPath)) {
    config = loadConfig(args.configPath);
  } else {
    throw new HookriskError('HR-E101', {
      detail: `No config at ${args.configPath}.`,
      context: { fix: 'run `hookrisk init` to generate one' },
    });
  }
  assertDeclarationsComplete(config);

  // --- engines ---
  const engines: Engine[] = [];
  if (!args.skipStatic && config.engines.hookrisk !== false) {
    engines.push(new SlitherEngine());
  }
  if (!args.skipStatic && config.engines.blocksec === true) {
    engines.push(new BlockSecEngine());
  }

  // Where the artifacts are and which solc built them, from forge itself. Both
  // the static engines (solc version) and the harness (artifact path) depend
  // on it, and guessing either is how a built project gets told to build.
  const project = await resolveProject(args.projectRoot, sourceFile, contractName);
  const projectLog = log.stage('project');
  for (const note of project.notes) projectLog(`project: ${note}`);
  projectLog(
    `project: out=${project.artifactDir} solc=${project.solcVersion} (${project.solcSource})` +
      (project.artifactPath ? ` artifact=${project.artifactPath}` : ` artifact: ${project.artifactReason}`),
  );

  // The dynamic layer executes the hook rather than reading it, so it needs the
  // permission set to place the hook at a flag-bearing address. It derives that
  // set itself, from the compiled runtime code: the static engine also resolves
  // getHookPermissions(), but it runs concurrently with the harness, and a
  // source-level reading is the weaker claim anyway — the runtime derivation is
  // what the PoolManager would actually obey. Both are recorded in the manifest
  // and a disagreement between them is reported below.
  const permissions: Record<string, boolean> | null = null;

  // --- run the engines and the harness together ---
  //
  // They are independent subprocesses over the same already-compiled sources:
  // Slither parses the AST, the harness drives forge. Sequentially a scan cost
  // the sum; concurrently it costs the longer of the two, which on a real hook
  // is the harness by an order of magnitude. `--timeout` is a *per-engine*
  // budget and stays one — each gets the full value, because a shared budget
  // would make one engine's slowness look like another's timeout.
  //
  // Ordering is not left to the scheduler: results are unpacked back into the
  // declared engine order below, then the harness, so two runs over the same
  // target produce byte-identical artifacts.
  const engineMeta = new Map<string, { displayName: string; upstream?: { url: string; license: string } }>();
  for (const engine of engines) {
    engineMeta.set(engine.id, {
      displayName: engine.displayName,
      ...(engine.upstream ? { upstream: engine.upstream } : {}),
    });
  }

  const enginePromises = engines.map((engine) =>
    engine.run({
      projectRoot: args.projectRoot,
      sourceFile,
      contractName,
      solcVersion: project.solcVersion,
      timeoutMs: args.timeoutMs,
      // Per engine, so an interleaved JSON log says which subprocess spoke.
      log: log.stage(`engine:${engine.id}`),
    }),
  );

  const harnessPromise: Promise<HarnessOutcome | null> = args.skipDynamic
    ? Promise.resolve(null)
    : runHarness({
        project,
        sourceFile,
        contractName,
        permissions,
        ...(config.harness.constructorArgs ? { constructorArgs: config.harness.constructorArgs } : {}),
        maxFeeBips: config.declared.maxFeeBips ?? 0,
        timeoutMs: args.timeoutMs,
        harnessRoot: home.harnessRoot,
        log: log.stage('harness'),
      });

  // allSettled, not Promise.all: `all` hands back control on the first
  // rejection, and returning from the scan while forge is still fuzzing leaves
  // an orphaned subprocess writing run records into harness/out that a later
  // scan could read. Everything settles, then the first failure is rethrown —
  // so a broken engine still fails the whole scan, just not early.
  const settled = await Promise.allSettled([...enginePromises, harnessPromise]);
  const rejection = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (rejection) throw rejection.reason;

  const engineResults: EngineResult[] = [];
  let uncoveredFunctions: Array<{ contract: string; function: string; reason: string }> = [];
  engines.forEach((engine, index) => {
    const result = (settled[index] as PromiseFulfilledResult<EngineResult>).value;
    engineResults.push(result);
    // Read off the instance rather than the result: `uncoveredFunctions` is the
    // HR-E205 list, and it has to reach the manifest or a partial scan reads as
    // a complete one.
    if (engine instanceof SlitherEngine) uncoveredFunctions = engine.uncoveredFunctions;
    const errorCode = errorCodeFor(result.reason);
    log.event(result.status === 'failed' ? 'error' : 'info', `engine:${engine.id}`,
      `${engine.id}: ${result.status}${result.reason ? ` — ${result.reason}` : ''}`,
      {
        status: result.status,
        durationMs: result.durationMs,
        findings: result.findings.length,
        ...(errorCode ? { errorCode } : {}),
      });
  });

  if (engines.length === 0) {
    engineResults.push({
      engine: 'hookrisk',
      version: 'n/a',
      status: 'skipped',
      reason: args.skipStatic ? '--skip-static' : 'disabled in configuration',
      findings: [],
      durationMs: 0,
    });
    engineMeta.set('hookrisk', { displayName: 'hookrisk Slither detectors' });
  }

  const { findings, stats } = mergeEngineResults(engineResults, log.stage('reconcile'));

  // --- invariants ---
  const outcome = (settled[engines.length] as PromiseFulfilledResult<HarnessOutcome | null>).value;
  let invariants: InvariantResult[] = [];
  let harness: HarnessSummary = { version: 'n/a', status: 'skipped', reason: '--skip-dynamic', durationMs: 0 };
  const permissionsSection: Record<string, unknown> = {};
  if (permissions) permissionsSection.fromSource = permissions;
  // The static engine's resolved getHookPermissions(), inheritance followed,
  // from its hook-profile for the target.
  const staticResult = engineResults.find((r) => r.engine === 'hookrisk' && r.status === 'ok');
  if (staticResult?.permissions) permissionsSection.fromEngine = staticResult.permissions;

  if (outcome) {
    invariants = outcome.invariants;
    // "Run forge build first" is wrong advice when the build is what failed.
    // The static engine already knows the project does not compile; say that.
    const staticFailure = engineResults.find((r) => r.engine === 'hookrisk' && r.status === 'failed');
    const reason =
      outcome.status === 'skipped' && staticFailure && /no compiled artifact/.test(outcome.reason ?? '')
        ? `the project does not compile (static engine: ${staticFailure.reason?.split('\n')[0] ?? 'failed'}), so there is no artifact to run`
        : outcome.reason;
    if (reason !== outcome.reason) {
      for (const inv of invariants) if (inv.status === 'skipped') inv.detail = reason;
    }
    harness = {
      version: outcome.version,
      status: outcome.status,
      ...(reason ? { reason } : {}),
      durationMs: outcome.durationMs,
    };
    const harnessErrorCode = errorCodeFor(outcome.reason);
    log.event(outcome.status === 'failed' ? 'error' : 'info', 'harness',
      `harness: ${outcome.status}${outcome.reason ? ` — ${outcome.reason}` : ''}`,
      {
        status: outcome.status,
        durationMs: outcome.durationMs,
        invariants: Object.fromEntries(outcome.invariants.map((i) => [i.id, i.status])),
        ...(harnessErrorCode ? { errorCode: harnessErrorCode } : {}),
      });
    if (outcome.run) {
      // What the harness actually deployed under. Recorded even when it agrees
      // with the source declaration: this is the set the PoolManager obeyed.
      permissionsSection.fromRuntime = permissionsFrom(outcome.run.flags);
      // Static and runtime are two independent readings of the same function.
      // They should agree; when they do not, one of the two analyses is looking
      // at the wrong contract, and a reader must be told rather than left to
      // pick the row they prefer.
      if (staticResult?.permissions) {
        const runtime = permissionsSection.fromRuntime as Record<string, boolean>;
        const differing = Object.keys(FLAG_BITS).filter(
          (field) => Boolean(staticResult.permissions![field]) !== Boolean(runtime[field]),
        );
        permissionsSection.disagreement = differing;
        if (differing.length > 0) {
          log.event('warn', 'reconcile',
            `permissions: static analysis and the deployed runtime disagree on ${differing.join(', ')}`,
            { differing });
        }
      }
      permissionsSection.harnessRun = {
        flags: outcome.run.flags,
        permissionsDerived: outcome.run.permissionsDerived,
        customCurve: outcome.run.customCurve,
        dynamicFee: outcome.run.dynamicFee,
        seeded: outcome.run.seeded,
        ...(outcome.run.hookedSeedRevert ? { hookedSeedRevert: outcome.run.hookedSeedRevert } : {}),
        ...(outcome.run.probes ? { probes: outcome.run.probes } : {}),
      };
    }
  }

  // --- reconcile the two layers ---
  // A static "disabled by design" classification and a harness seed that
  // reverted are the same fact observed twice; merged, they become one finding
  // confirmed across layers, and an exit-liveness invariant that could never
  // have been exercised is reported not-applicable instead of vacuously passed.
  const reconciled = reconcileLayers({
    findings,
    invariants,
    sourceFile,
    ...(outcome?.run ? { runRecord: outcome.run } : {}),
    ...(outcome?.observations ? { observations: outcome.observations } : {}),
  });
  for (const note of reconciled.notes) log.event('info', 'reconcile', note);

  // --- score ---
  // After reconciliation on purpose: the harness's probes add findings
  // (an unguarded callback seen by execution, a selector mismatch) that the
  // rubric must see, and the harness summary tells the scorer whether the
  // dynamic layer looked at all.
  const rubric = loadRubric(home.rubric);
  const scoringInput = deriveScoringInput({
    findings: reconciled.findings,
    engineResults,
    declared: config.declared,
    dimensionIds: rubric.dimensions.map((d) => d.id),
    contractName,
    harness: { status: harness.status, ...(harness.reason ? { reason: harness.reason } : {}) },
  });
  const scored = score(scoringInput, rubric);

  // --- manifest ---
  const manifest = buildManifest({
    toolVersion: VERSION,
    commandLine: `hookrisk scan ${args.target}`,
    target: {
      mode: 'source',
      contractName,
      sourceFile,
      solcVersion: project.solcVersion,
      artifactDir: relative(args.projectRoot, project.artifactDir) || '.',
      projectConfigSource: project.configSource,
    },
    ...(Object.keys(permissionsSection).length > 0 ? { permissions: permissionsSection } : {}),
    findings: reconciled.findings,
    invariants: reconciled.invariants,
    score: scored,
    engineResults,
    engineMeta,
    harness,
    ...(outcome?.observations
      ? { observations: { ...outcome.observations, ...(outcome.observedSequences !== undefined ? { sequences: outcome.observedSequences } : {}) } }
      : {}),
    corroboratedFindings: stats.corroborated,
    uncoveredFunctions,
    staticAnalysisSkipped: args.skipStatic,
    ...(args.noGate ? {} : { gate: config.gate }),
  });

  if (!args.noValidate) {
    try {
      validateManifest(manifest, home.manifestSchema);
    } catch (err) {
      // Write the rejected manifest so it can be attached to a bug report.
      mkdirSync(args.outDir, { recursive: true });
      writeFileSync(join(args.outDir, 'hook-risk.invalid.json'), JSON.stringify(manifest, null, 2));
      throw err;
    }
  }

  // --- write ---
  mkdirSync(args.outDir, { recursive: true });
  const manifestPath = join(args.outDir, 'hook-risk.json');
  const reportPath = join(args.outDir, 'HOOK_RISK.md');
  const sarifPath = join(args.outDir, 'hookrisk.sarif');

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(reportPath, `${renderMarkdown(manifest)}\n`);
  writeFileSync(sarifPath, `${JSON.stringify(toSarif(reconciled.findings, VERSION), null, 2)}\n`);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    printSummary(manifest, { manifestPath, reportPath, sarifPath });
  }

  const gate = manifest.gate as { passed?: boolean } | undefined;
  const exitCode = gate && gate.passed === false ? EXIT_GATE_FAILED : 0;
  log.event('info', 'scan', `scan: finished in ${Date.now() - startedAt}ms, exit ${exitCode}`, {
    durationMs: Date.now() - startedAt,
    exitCode,
    tier: scored.tier.id,
    total: scored.total,
    inconclusive: scored.inconclusive,
    findings: findings.length,
    ...(gate ? { gatePassed: gate.passed === true } : {}),
  });
  return exitCode;
}

/**
 * The end-of-scan summary.
 *
 * On **stdout**, deliberately. It used to go to stderr along with the progress
 * log, which left `hookrisk scan … > report.txt` producing an empty file and
 * made the tool look broken in every pipeline that redirects the two streams
 * separately. The split is now the conventional one: stdout is the result,
 * stderr is the commentary. Under `--json` the manifest takes stdout instead
 * and this is not called at all, so stdout is never two things at once.
 */
function printSummary(
  manifest: Record<string, unknown>,
  paths: { manifestPath: string; reportPath: string; sarifPath: string },
): void {
  const colour = supportsColour(process.stdout);
  const bold = colour ? '[1m' : '';
  const dim = colour ? '[2m' : '';
  const reset = colour ? '[0m' : '';

  const scored = manifest.score as Record<string, unknown>;
  const findings = (manifest.findings ?? []) as Array<Record<string, unknown>>;
  const coverage = (manifest.coverage ?? {}) as Record<string, unknown>;
  const engines = (manifest.engines ?? []) as Array<Record<string, unknown>>;
  const gate = manifest.gate as { passed?: boolean; failures?: string[] } | undefined;

  const out = process.stdout;
  out.write('\n');
  out.write(
    `${bold}${String(scored.tier).toUpperCase()} risk${reset}  ${scored.total}/33` +
      (scored.inconclusive ? `  ${dim}(undetermined: up to ${scored.totalUpperBound}/33)${reset}` : '') +
      '\n\n',
  );

  const bySeverity = new Map<string, number>();
  let profiles = 0;
  for (const f of findings) {
    if (f.ruleClass === 'hook-profile') { profiles += 1; continue; }
    const key = String(f.severity);
    bySeverity.set(key, (bySeverity.get(key) ?? 0) + 1);
  }
  if (bySeverity.size > 0) {
    const parts = [...bySeverity.entries()].map(([sev, n]) => `${n} ${sev}`);
    out.write(`  findings    ${parts.join(', ')}${profiles ? ` (+ hook profile)` : ''}\n`);
  } else {
    out.write(`  findings    none${profiles ? ' (hook profile only)' : ''}\n`);
  }

  const corroborated = Number(coverage.corroboratedFindings ?? 0);
  if (corroborated > 0) {
    out.write(`  ${dim}          ${corroborated} corroborated across engines${reset}\n`);
  }

  for (const engine of engines) {
    const mark = engine.status === 'ok' ? '✓' : engine.status === 'skipped' ? '-' : '✗';
    out.write(
      `  ${mark} ${String(engine.engine).padEnd(10)} ${engine.status}` +
        (engine.reason ? `  ${dim}${engine.reason}${reset}` : '') +
        '\n',
    );
  }

  // The invariants are the harness's output; one line so a reader sees
  // "I1 passed, I2 not-applicable" rather than inferring it from the engine row.
  const invariants = (manifest.invariants ?? []) as Array<{ id: string; status: string }>;
  if (invariants.length > 0) {
    out.write(`  invariants  ${invariants.map((i) => `${i.id} ${i.status}`).join(', ')}\n`);
  }

  const uncovered = (coverage.uncoveredFunctions ?? []) as unknown[];
  if (uncovered.length > 0) {
    out.write(
      `\n  ${bold}⚠ ${uncovered.length} function(s) were not analysed${reset} ` +
        `${dim}(HR-E205) — a clean result does not cover them${reset}\n`,
    );
  }

  const warnings = (scored.warnings ?? []) as string[];
  for (const warning of warnings) {
    out.write(`  ${dim}! ${warning}${reset}\n`);
  }

  out.write('\n');
  out.write(`  ${dim}${paths.reportPath}${reset}\n`);
  out.write(`  ${dim}${paths.manifestPath}${reset}\n`);
  out.write(`  ${dim}${paths.sarifPath}${reset}\n`);

  if (gate) {
    out.write('\n');
    if (gate.passed) {
      out.write(`  ${bold}gate passed${reset}\n`);
    } else {
      out.write(`  ${bold}gate failed${reset}\n`);
      for (const failure of gate.failures ?? []) out.write(`    - ${failure}\n`);
    }
  }
  out.write('\n');
}

function commandInit(argv: string[]): number {
  let path = join(process.cwd(), 'hookrisk.toml');
  const flag = argv.indexOf('--config');
  if (flag >= 0 && argv[flag + 1]) path = resolve(argv[flag + 1]!);

  if (existsSync(path)) {
    process.stderr.write(`${path} already exists; leaving it alone.\n`);
    return 0;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, configTemplate());
  process.stderr.write(
    `Wrote ${path}.\n\n` +
      'It declares the most conservative values for everything hookrisk cannot\n' +
      'measure — unproven team, no fee. Edit them to match reality before relying\n' +
      'on the score.\n',
  );
  return 0;
}

async function commandEngines(): Promise<number> {
  const engines: Engine[] = [new SlitherEngine(), new BlockSecEngine()];
  process.stderr.write('\n');
  for (const engine of engines) {
    const probe = await engine.probe();
    const mark = probe.available ? '✓' : '-';
    process.stderr.write(`  ${mark} ${engine.id.padEnd(10)} ${engine.displayName}\n`);
    process.stderr.write(`      ${probe.available ? probe.version : probe.reason}\n`);
    if (engine.upstream) {
      process.stderr.write(`      ${engine.upstream.url} (${engine.upstream.license})\n`);
    }
    process.stderr.write('\n');
  }
  return 0;
}

// --------------------------------------------------------------------------- //
// Entry point
// --------------------------------------------------------------------------- //

async function main(): Promise<number> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case 'scan':
      return commandScan(rest);
    case 'init':
      return commandInit(rest);
    case 'engines':
      return commandEngines();
    case '--version':
    case '-v':
      process.stdout.write(`${VERSION}\n`);
      return 0;
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      // Asking for help succeeds; being given nothing to do does not. 64 is
      // sysexits.h EX_USAGE — see `reserved` in errors/catalog.json and the
      // exit code table in docs/ARCHITECTURE.md.
      process.stderr.write(usage());
      return command === undefined ? EXIT_USAGE : 0;
    default:
      process.stderr.write(`Unknown command \`${command}\`.\n\n${usage()}`);
      return EXIT_USAGE;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof HookriskError) {
      process.stderr.write(`\n${err.render()}\n\n`);
      process.exit(err.exitCode);
    }
    // Anything unmapped is a gap in the catalogue, which we treat as a bug.
    const wrapped = new HookriskError('HR-E901', {
      detail: err instanceof Error ? err.message : String(err),
      rawOutput: err instanceof Error ? err.stack : undefined,
    });
    process.stderr.write(`\n${wrapped.render()}\n\n`);
    process.exit(wrapped.exitCode);
  });

export { fileURLToPath, basename };
