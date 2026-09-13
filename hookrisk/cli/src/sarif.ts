/**
 * SARIF 2.1.0 output, for GitHub code scanning.
 *
 * Uploading this with `github/codeql-action/upload-sarif` makes findings appear
 * inline on the changed lines of a pull request and in the repository's Security
 * tab. That placement matters more than it sounds: a finding in a CI log is read
 * once by whoever opened the log, while a finding on the diff is read by the
 * reviewer at the moment they are deciding whether to approve.
 */

import type { Finding, Severity } from './types.js';

/** SARIF has three levels; our five severities collapse onto them. */
const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'warning',
  info: 'note',
};

/**
 * `security-severity` drives GitHub's own High/Medium/Low badge and its
 * default alert filters. Without it every finding shows up unranked, which is
 * how a critical access-control bug ends up visually equal to a style note.
 */
const SECURITY_SEVERITY: Record<Severity, string> = {
  critical: '9.5',
  high: '8.0',
  medium: '5.0',
  low: '3.0',
  info: '1.0',
};

const RULE_HELP: Record<string, { name: string; description: string }> = {
  'hook-profile': {
    name: 'Hook profile',
    description: 'Per-contract profile: resolved permissions, implemented callbacks, complexity metrics. Informational.',
  },
  'unprotected-hook-callback': {
    name: 'Unprotected hook callback',
    description:
      'An IHooks callback that does not restrict its caller to the PoolManager can be invoked directly with an arbitrary PoolKey and arbitrary hookData.',
  },
  'unprotected-unlock-callback': {
    name: 'Unprotected unlock callback',
    description: 'unlockCallback does not restrict its caller to the contract itself.',
  },
  'flag-implementation-divergence': {
    name: 'Permission and implementation divergence',
    description:
      'Declared permissions disagree with the callbacks implemented. A declared-but-missing callback reverts every matching pool operation; an implemented-but-undeclared callback is never invoked.',
  },
  'admin-surface': {
    name: 'Privileged administrative surface',
    description:
      'A state-changing external function on the hook: unguarded, so anyone can move the hook’s parameters, or owner-only, so one key can. Fees, pauses, withdrawal restrictions and pool registrations all live here.',
  },
  'upgradeable-hook': {
    name: 'Upgradeable hook',
    description:
      'A proxy, DELEGATECALL to a mutable target, or an EIP-1967 slot. Triggers the framework’s Upgradeable requirements.',
  },
  selfdestruct: {
    name: 'Self-destructible hook',
    description: 'The contract can be destroyed, permanently bricking every pool that uses it.',
  },
  'external-call-in-swap-path': {
    name: 'External call in the swap path',
    description:
      'A call inside before/afterSwap to something other than the PoolManager or the pair’s tokens reopens the execution environment mid-swap: the callee decides whether the swap completes, and an unhandled revert there bricks the pool.',
  },
  'unbounded-dynamic-fee': {
    name: 'Unbounded dynamic fee',
    description:
      'The hook sets the pool’s LP fee dynamically and no ceiling on the value could be found, so the fee a swapper pays is bounded only by v4’s own maximum.',
  },
  'custom-accounting': {
    name: 'Custom accounting in use',
    description:
      'A returns-delta permission lets the hook alter settled amounts. A classification, not a defect: it raises the risk tier and changes which invariants apply.',
  },
  'rounding-direction': {
    name: 'Rounding favours the caller',
    description: 'Rounding on an exit path resolves in the caller’s favour rather than the pool’s.',
  },
  'callback-intentionally-disabled': {
    name: 'Callback intentionally disabled',
    description:
      'A hook callback is overridden with a deliberate revert, so the matching PoolManager operation is disabled by design. A classification, not a defect: it explains why the pool cannot, for example, accept liquidity through the PoolManager.',
  },
  'unvalidated-pool-key': {
    name: 'Hook accepts a foreign pool key',
    description:
      'Called by the PoolManager with the key of a second pool the hook is not attached to, the hook accepted it. Observed by the differential harness, not inferred from source. A classification, not a defect: multi-pool hooks are legitimate — but a hook that keys state per pool and accepts any key can be driven through a pool its author never registered.',
  },
  'callback-selector-mismatch': {
    name: 'Callback returns the wrong selector',
    description:
      'Called exactly as the PoolManager would call it, the callback returned a selector the PoolManager does not accept, or reverted. Either way the pool operation it guards cannot complete. Observed by the differential harness against the deployed hook.',
  },
  'unsupported-hook-abi': {
    name: 'Unsupported hook ABI',
    description:
      'The contract looks like a v4 hook but uses an ABI hookrisk cannot analyse, such as the 2023 getHooksCalls()/Hooks.Calls shape. A classification, not a defect — and a coverage statement: no hookrisk detector examined this contract, so its silence is not a clean result.',
  },
};

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: unknown[];
}

export function toSarif(findings: Finding[], toolVersion: string): SarifLog {
  // Only rules that actually fired: an empty rule catalogue keeps the Security
  // tab from filling with rules that never produce anything.
  const ruleIds = [...new Set(findings.map((f) => f.ruleClass))];

  const rules = ruleIds.map((id) => {
    const help = RULE_HELP[id];
    return {
      id,
      name: help?.name ?? id,
      shortDescription: { text: help?.name ?? id },
      fullDescription: { text: help?.description ?? id },
      helpUri: `https://github.com/0xmvercosa/hookrisk/blob/main/docs/DETECTORS.md#${id}`,
      properties: {
        tags: ['security', 'uniswap-v4', 'hooks'],
        'security-severity': SECURITY_SEVERITY[worstFor(findings, id)],
      },
    };
  });

  const results = findings.map((finding) => ({
    ruleId: finding.ruleClass,
    level: LEVEL[finding.severity],
    message: {
      text:
        finding.description ||
        finding.title ||
        `${finding.ruleClass} reported by ${finding.engines.map((e) => e.engine).join(', ')}`,
    },
    locations: finding.location
      ? [
          {
            physicalLocation: {
              artifactLocation: { uri: finding.location.file },
              region: {
                startLine: finding.location.line,
                ...(finding.location.endLine ? { endLine: finding.location.endLine } : {}),
              },
            },
          },
        ]
      : [],
    // A stable fingerprint keeps GitHub from re-raising an alert every time an
    // unrelated edit shifts the line number.
    partialFingerprints: { hookriskFindingId: finding.id },
    properties: {
      confidence: finding.confidence,
      engines: finding.engines.map((e) => `${e.engine}/${e.nativeRule}`),
      corroborated: finding.engines.length > 1,
      ...(finding.informsDimensions?.length
        ? { informsDimensions: finding.informsDimensions }
        : {}),
      ...(finding.informsTriggers?.length ? { informsTriggers: finding.informsTriggers } : {}),
    },
  }));

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'hookrisk',
            version: toolVersion,
            informationUri: 'https://github.com/0xmvercosa/hookrisk',
            rules,
          },
        },
        results,
      },
    ],
  };
}

function worstFor(findings: Finding[], ruleClass: string): Severity {
  const order: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
  let worst: Severity = 'info';
  for (const finding of findings) {
    if (finding.ruleClass !== ruleClass) continue;
    if (order.indexOf(finding.severity) > order.indexOf(worst)) worst = finding.severity;
  }
  return worst;
}
