/**
 * Tests for the parts of the error catalogue reader that other layers branch on.
 *
 * `describeFailure` is prose and its exact wording is not a contract.
 * `errorCodeFor` is: it feeds `engines[].errorCode` in the manifest and the
 * `errorCode` field of a `--log-json` line, so a CI job can assert which
 * failure it got. A code that drifts between the reason string and the field is
 * worse than no field at all.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { classify, errorCodeFor, supportsColour } from './errors.js';

describe('errorCodeFor', () => {
  test('reads the code out of a reason describeFailure already rendered', () => {
    const reason =
      'HR-E203 Target compiles under forge but not under Slither: ' +
      'Error (7920): Identifier not found or not unique. --> src/RefHook.sol:144:59';

    assert.equal(errorCodeFor(reason), 'HR-E203');
  });

  test('falls back to matching raw tool output', () => {
    // Nothing rendered this; it is what Slither printed. The catalogue's own
    // regexes are the only way to name it.
    assert.equal(errorCodeFor('slither: Impossible to generate IR for X.f()'), 'HR-E205');
  });

  test('agrees with classify on raw output', () => {
    const raw = 'forge: command not found';
    assert.equal(errorCodeFor(raw), classify(raw)?.code);
  });

  test('is undefined for a reason that is not a failure', () => {
    // `skipped` reasons are ordinary sentences. Inventing HR-E901 for them
    // would put an error code on every engine that was simply switched off.
    assert.equal(errorCodeFor('--skip-static'), undefined);
    assert.equal(errorCodeFor('disabled in configuration'), undefined);
    assert.equal(errorCodeFor(undefined), undefined);
    assert.equal(errorCodeFor(''), undefined);
  });

  test('does not match a code embedded in a longer token', () => {
    assert.equal(errorCodeFor('see XHR-E2033 for details'), undefined);
  });
});

describe('supportsColour', () => {
  const withEnv = <T>(env: Record<string, string | undefined>, fn: () => T): T => {
    const saved = { NO_COLOR: process.env.NO_COLOR, FORCE_COLOR: process.env.FORCE_COLOR };
    Object.assign(process.env, env);
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  test('follows the stream it is asked about', () => {
    // The summary goes to stdout and errors to stderr, so one global answer
    // would put escape codes into a redirected file whenever the other stream
    // happened to be a terminal.
    withEnv({ NO_COLOR: undefined, FORCE_COLOR: undefined }, () => {
      assert.equal(supportsColour({ isTTY: true }), true);
      assert.equal(supportsColour({ isTTY: false }), false);
      assert.equal(supportsColour({}), false);
    });
  });

  test('NO_COLOR wins over an interactive stream', () => {
    withEnv({ NO_COLOR: '1', FORCE_COLOR: undefined }, () => {
      assert.equal(supportsColour({ isTTY: true }), false);
    });
  });

  test('FORCE_COLOR wins over a redirected stream', () => {
    withEnv({ NO_COLOR: undefined, FORCE_COLOR: '1' }, () => {
      assert.equal(supportsColour({ isTTY: false }), true);
    });
  });
});
