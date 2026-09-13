/**
 * Tests for the config parser.
 *
 * The parser handles user-supplied input in a security tool, so the cases that
 * matter most are the ones where it must *refuse* rather than guess. A config
 * silently mis-parsed into a lower declared TVL produces a lower tier and a
 * thinner set of requirements, which is the exact failure the whole design is
 * built to avoid.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HookriskError } from './errors.js';
import {
  assertDeclarationsComplete,
  configTemplate,
  fromDocument,
  parseToml,
} from './config.js';

describe('parseToml', () => {
  test('parses tables, scalars and arrays', () => {
    const doc = parseToml(`
      target = "src/MyHook.sol:MyHook"

      [declared]
      teamMaturity = 2
      tvlPotential = 5
      maxFeeBips = 1_000

      [gate]
      maxTier = "medium"
      failOnPartialCoverage = true

      [engines]
      blocksec = false
    `);

    assert.equal(doc.target, 'src/MyHook.sol:MyHook');
    assert.deepEqual(doc.declared, { teamMaturity: 2, tvlPotential: 5, maxFeeBips: 1000 });
    assert.deepEqual(doc.gate, { maxTier: 'medium', failOnPartialCoverage: true });
    assert.deepEqual(doc.engines, { blocksec: false });
  });

  test('ignores comments, including after values', () => {
    const doc = parseToml(`
      # leading comment
      [declared]
      teamMaturity = 1  # trailing comment
    `);
    assert.deepEqual(doc.declared, { teamMaturity: 1 });
  });

  test('does not treat a # inside a string as a comment', () => {
    const doc = parseToml(`target = "src/My#Hook.sol:MyHook"`);
    assert.equal(doc.target, 'src/My#Hook.sol:MyHook');
  });

  test('parses arrays of scalars', () => {
    const doc = parseToml(`skip = ["a", "b", "c"]`);
    assert.deepEqual(doc.skip, ['a', 'b', 'c']);
  });

  test('rejects nested tables rather than misreading them', () => {
    assert.throws(() => parseToml('[a.b]\nx = 1'), HookriskError);
  });

  test('rejects arrays of tables', () => {
    assert.throws(() => parseToml('[[hooks]]\nname = "x"'), HookriskError);
  });

  test('rejects a line that is not a key/value pair', () => {
    assert.throws(() => parseToml('this is not toml'), HookriskError);
  });

  test('rejects an unquoted bare word, which TOML would too', () => {
    assert.throws(() => parseToml('key = bareword'), HookriskError);
  });

  test('reports the offending line number', () => {
    try {
      parseToml('[declared]\nok = 1\nbroken\n', 'hookrisk.toml');
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof HookriskError);
      assert.match(err.detail ?? '', /hookrisk\.toml:3/);
    }
  });
});

describe('fromDocument', () => {
  test('accepts declared dimensions inside their published ranges', () => {
    const config = fromDocument({ declared: { teamMaturity: 3, tvlPotential: 5 } });
    assert.equal(config.declared.teamMaturity, 3);
    assert.equal(config.declared.tvlPotential, 5);
  });

  test('rejects a dimension outside its range', () => {
    // teamMaturity is 0-3. A 4 here would sail through into the total and
    // produce a tier nobody could reproduce from the framework.
    assert.throws(() => fromDocument({ declared: { teamMaturity: 4 } }), HookriskError);
    assert.throws(() => fromDocument({ declared: { tvlPotential: -1 } }), HookriskError);
  });

  test('rejects a non-integer dimension', () => {
    assert.throws(() => fromDocument({ declared: { teamMaturity: 1.5 } }), HookriskError);
  });

  test('rejects an unknown key instead of ignoring it', () => {
    // A typo like `tvlPotencial` would otherwise leave TVL undeclared while the
    // author believes they declared it.
    assert.throws(() => fromDocument({ declared: { tvlPotencial: 5 } }), HookriskError);
  });

  test('rejects an out-of-range fee bound', () => {
    assert.throws(() => fromDocument({ declared: { maxFeeBips: 10_001 } }), HookriskError);
  });

  test('accepts a zero fee bound as the strong claim it is', () => {
    const config = fromDocument({ declared: { maxFeeBips: 0 } });
    assert.equal(config.declared.maxFeeBips, 0);
  });

  test('rejects an invalid gate tier', () => {
    assert.throws(() => fromDocument({ gate: { maxTier: 'extreme' } }), HookriskError);
  });

  test('parses failOnInconclusive and leaves it undefined when absent', () => {
    // Undefined rather than false: the manifest echoes what the policy said,
    // and "not stated" is not the same statement as "false".
    assert.equal(fromDocument({ gate: { maxTier: 'medium' } }).gate.failOnInconclusive, undefined);
    assert.equal(fromDocument({ gate: { failOnInconclusive: true } }).gate.failOnInconclusive, true);
    assert.equal(fromDocument({ gate: { failOnInconclusive: false } }).gate.failOnInconclusive, false);
  });

  test('rejects a non-boolean failOnInconclusive rather than coercing it', () => {
    // Boolean("false") is true; a policy read as its opposite must not load.
    assert.throws(() => fromDocument({ gate: { failOnInconclusive: 'false' } }), HookriskError);
    assert.throws(() => fromDocument({ gate: { failOnInconclusive: 1 } }), HookriskError);
  });
});

describe('[harness]', () => {
  test('parses constructorArgs as an ordered list of strings', () => {
    const config = fromDocument(parseToml(`
      [harness]
      constructorArgs = ["$poolManager", "3000", "$owner"]
    `));
    assert.deepEqual(config.harness.constructorArgs, ['$poolManager', '3000', '$owner']);
  });

  test('leaves constructorArgs undefined when the table is absent', () => {
    // Undefined, not empty: the harness distinguishes "not configured" (derive
    // what it can) from "configured as no arguments".
    const config = fromDocument({ declared: { teamMaturity: 1, tvlPotential: 1 } });
    assert.deepEqual(config.harness, {});
    assert.equal(config.harness.constructorArgs, undefined);
  });

  test('accepts an explicitly empty list', () => {
    const config = fromDocument(parseToml('[harness]\nconstructorArgs = []'));
    assert.deepEqual(config.harness.constructorArgs, []);
  });

  test('rejects a scalar or a list with non-string entries', () => {
    // A bare 3000 would reach cast as the number 3000 today and as something
    // else the day the parser learns floats; strings keep the contract exact.
    assert.throws(() => fromDocument({ harness: { constructorArgs: '$poolManager' } }), HookriskError);
    assert.throws(() => fromDocument({ harness: { constructorArgs: ['$poolManager', 3000] } }), HookriskError);
  });

  test('rejects an unknown key instead of silently skipping the harness', () => {
    try {
      fromDocument({ harness: { constructorArg: ['$poolManager'] } });
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof HookriskError);
      assert.match(err.detail ?? '', /\[harness\] has unknown key "constructorArg"/);
    }
  });

  test('does not disturb [declared], [gate] or [engines]', () => {
    const config = fromDocument(parseToml(`
      [declared]
      teamMaturity = 1
      tvlPotential = 2
      [gate]
      maxTier = "low"
      [engines]
      blocksec = true
      [harness]
      constructorArgs = ["$poolManager"]
    `));
    assert.deepEqual(config.declared, { teamMaturity: 1, tvlPotential: 2 });
    assert.deepEqual(config.gate, { maxTier: 'low' });
    assert.deepEqual(config.engines, { blocksec: true });
  });
});

describe('assertDeclarationsComplete', () => {
  test('passes when the unobservable dimensions are declared', () => {
    const config = fromDocument({ declared: { teamMaturity: 1, tvlPotential: 2 } });
    assert.doesNotThrow(() => assertDeclarationsComplete(config));
  });

  test('fails, with HR-E101, when they are not', () => {
    const config = fromDocument({ declared: { teamMaturity: 1 } });
    try {
      assertDeclarationsComplete(config);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof HookriskError);
      assert.equal(err.code, 'HR-E101');
      assert.match(err.detail ?? '', /tvlPotential/);
    }
  });

  test('never substitutes a default', () => {
    const config = fromDocument({});
    assert.equal(config.declared.teamMaturity, undefined);
    assert.equal(config.declared.tvlPotential, undefined);
    assert.throws(() => assertDeclarationsComplete(config), HookriskError);
  });
});

describe('configTemplate', () => {
  test('is itself valid and complete', () => {
    // The template is what `hookrisk init` writes, so a user who fills in
    // nothing should still get a config that parses and satisfies the
    // declaration requirement.
    const config = fromDocument(parseToml(configTemplate(), 'template'));
    assert.doesNotThrow(() => assertDeclarationsComplete(config));
  });

  test('defaults to the most conservative declarations', () => {
    const config = fromDocument(parseToml(configTemplate(), 'template'));
    assert.equal(config.declared.teamMaturity, 3, 'unproven until stated otherwise');
    assert.equal(config.declared.tvlPotential, 0);
    assert.equal(config.declared.maxFeeBips, 0, 'claims no fee until stated otherwise');
  });

  test('leaves the third-party engine opt-in', () => {
    const config = fromDocument(parseToml(configTemplate(), 'template'));
    assert.equal(config.engines.blocksec, false, 'pulling a third-party image is the user’s call');
    assert.equal(config.engines.hookrisk, true);
  });

  test('gates on severity, not on a tier the tool cannot yet determine', () => {
    // The default template must pass the official v4 template hook. With six
    // dimensions unmeasured every hook's tier is a range up to High, so a
    // default maxTier would fail every scan on hookrisk's coverage rather than
    // on the hook; the tier gate is opt-in and documented in the template.
    const config = fromDocument(parseToml(configTemplate(), 'template'));
    assert.equal(config.gate.maxTier, undefined, 'maxTier is commented out, with the reason');
    assert.equal(config.gate.maxSeverity, 'high');
    assert.equal(config.gate.failOnInconclusive, false, 'explicit, so the strict posture is one edit away');
    assert.match(configTemplate(), /# maxTier = "medium"/, 'the commented line shows what to uncomment');
  });
});
