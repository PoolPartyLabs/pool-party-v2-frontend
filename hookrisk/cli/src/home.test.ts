/**
 * Tests for installation discovery.
 *
 * The interesting cases are all failures. A hookrisk that resolves the wrong
 * root does not crash — it runs a scan with no harness and a manifest it cannot
 * validate, and reports that as a result. So the tests pin the precedence, and
 * pin that a partial directory is refused rather than accepted.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { HookriskError } from './errors.js';
import { homeCandidates, resolveHome } from './home.js';

/** A directory shaped like a hookrisk checkout, or a chosen subset of one. */
function fakeHome(parts: { harness?: boolean; schema?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'hookrisk-home-'));
  if (parts.harness !== false) {
    mkdirSync(join(root, 'harness'), { recursive: true });
    writeFileSync(join(root, 'harness', 'foundry.toml'), '[profile.default]\n');
  }
  if (parts.schema !== false) mkdirSync(join(root, 'schema'), { recursive: true });
  return root;
}

describe('resolveHome', () => {
  test('prefers HOOKRISK_HOME over the location of dist/', () => {
    const explicit = fakeHome();
    const relative = fakeHome();

    const home = resolveHome({ HOOKRISK_HOME: explicit }, join(relative, 'cli', 'dist'));

    assert.equal(home.root, explicit);
    assert.equal(home.source, 'HOOKRISK_HOME');
  });

  test('falls back to two levels above dist/', () => {
    const root = fakeHome();

    const home = resolveHome({}, join(root, 'cli', 'dist'));

    assert.equal(home.root, root);
    assert.equal(home.source, 'relative-to-dist');
  });

  test('derives the three paths the rest of the scan needs', () => {
    const root = fakeHome();

    const home = resolveHome({ HOOKRISK_HOME: root });

    assert.equal(home.harnessRoot, join(root, 'harness'));
    assert.equal(home.manifestSchema, join(root, 'schema', 'hook-risk.schema.json'));
    assert.equal(home.rubric, join(root, 'schema', 'framework-rubric.json'));
  });

  test('skips a HOOKRISK_HOME that is not a hookrisk checkout', () => {
    // Pointing the variable at the wrong directory is a typo, not a decision to
    // run without a harness, so the relative path still gets its turn.
    const wrong = fakeHome({ harness: false, schema: false });
    const right = fakeHome();

    const home = resolveHome({ HOOKRISK_HOME: wrong }, join(right, 'cli', 'dist'));

    assert.equal(home.root, right);
  });

  test('refuses a directory with schema/ but no harness', () => {
    // Half an installation is the failure this exists to catch: the scan would
    // otherwise validate its manifest happily and report the dynamic layer as
    // `skipped`, which reads like a choice rather than a broken install.
    const partial = fakeHome({ harness: false });

    assert.throws(
      () => resolveHome({ HOOKRISK_HOME: partial }, join(partial, 'cli', 'dist')),
      (err: unknown) => err instanceof HookriskError && err.code === 'HR-E005',
    );
  });

  test('refuses a directory with harness/ but no schema/', () => {
    const partial = fakeHome({ schema: false });

    assert.throws(
      () => resolveHome({ HOOKRISK_HOME: partial }, join(partial, 'cli', 'dist')),
      (err: unknown) => err instanceof HookriskError && err.code === 'HR-E005',
    );
  });

  test('the failure names every candidate, what it lacked, and make setup', () => {
    const nothing = fakeHome({ harness: false, schema: false });

    try {
      resolveHome({ HOOKRISK_HOME: nothing }, join(nothing, 'cli', 'dist'));
      assert.fail('expected HR-E005');
    } catch (err) {
      assert.ok(err instanceof HookriskError);
      assert.match(err.detail ?? '', /harness\/foundry\.toml and schema/);
      assert.match(err.detail ?? '', /make setup/);
      assert.match(err.context['HOOKRISK_HOME'] ?? '', /missing harness\/foundry\.toml, schema/);
      assert.ok(err.context['relative-to-dist']);
      // Environment problems are the 10s. CI branches on the range.
      assert.equal(err.exitCode, 10);
    }
  });

  test('exit code 10 puts it in the environment range', () => {
    const nothing = fakeHome({ harness: false, schema: false });
    try {
      resolveHome({ HOOKRISK_HOME: nothing }, join(nothing, 'cli', 'dist'));
      assert.fail('expected HR-E005');
    } catch (err) {
      assert.equal((err as HookriskError).exitCode, 10);
    }
  });
});

describe('homeCandidates', () => {
  test('omits HOOKRISK_HOME when it is unset', () => {
    const candidates = homeCandidates({}, '/somewhere/cli/dist');
    assert.deepEqual(candidates, [{ root: '/somewhere', source: 'relative-to-dist' }]);
  });

  test('resolves a relative HOOKRISK_HOME against the working directory', () => {
    const candidates = homeCandidates({ HOOKRISK_HOME: '.' }, '/somewhere/cli/dist');
    assert.equal(candidates[0]!.root, process.cwd());
    assert.equal(candidates[0]!.source, 'HOOKRISK_HOME');
  });
});
