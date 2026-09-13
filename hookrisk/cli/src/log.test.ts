/**
 * Tests for the scan logger.
 *
 * Two properties matter and they pull in opposite directions. The human mode is
 * a compatibility surface: the verbose output people already grep must not move
 * a byte. The JSON mode is a contract: one object per line, every line carrying
 * the run id, the envelope fields never displaceable by a caller's payload —
 * because a log a machine cannot join on is a log nobody joins on.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createLogger, type LogFields } from './log.js';

/** Collects what the logger writes, and splits JSON output into objects. */
function sink(): { write(chunk: string): void; text: string; lines(): Array<Record<string, unknown>> } {
  const chunks: string[] = [];
  return {
    write(chunk: string): void {
      chunks.push(chunk);
    },
    get text(): string {
      return chunks.join('');
    },
    lines(): Array<Record<string, unknown>> {
      return chunks
        .join('')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    },
  };
}

const AT = (): Date => new Date('2026-09-12T10:00:00.000Z');

describe('human mode', () => {
  test('reproduces the pre-logger verbose line exactly', () => {
    const out = sink();
    const log = createLogger({ json: false, verbose: true, runId: 'r1', stream: out, now: AT });

    log.stage('harness')('harness: MyHook.sol:MyHook flags=0x2000');

    // Two spaces, the message, one newline. This is the text `--verbose` has
    // always produced; anything else is a breaking change to a CLI surface.
    assert.equal(out.text, '  harness: MyHook.sol:MyHook flags=0x2000\n');
  });

  test('stays silent without --verbose', () => {
    const out = sink();
    const log = createLogger({ json: false, verbose: false, runId: 'r1', stream: out, now: AT });

    log.stage('harness')('harness: something happened');
    log.event('warn', 'scan', 'a warning');

    assert.equal(out.text, '');
  });

  test('does not print the stage tag', () => {
    // The stage exists for machines. Human messages already name themselves,
    // and prefixing them would double up: `harness: harness: …`.
    const out = sink();
    const log = createLogger({ json: false, verbose: true, runId: 'r1', stream: out, now: AT });

    log.event('info', 'engine:hookrisk', 'slither: 4 finding(s)');

    assert.equal(out.text, '  slither: 4 finding(s)\n');
  });
});

describe('json mode', () => {
  test('emits one object per line with the full envelope', () => {
    const out = sink();
    const log = createLogger({ json: true, verbose: false, runId: 'run-7', stream: out, now: AT });

    log.event('info', 'scan', 'started');
    log.stage('engine:blocksec')('pulling image');

    const lines = out.lines();
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], {
      ts: '2026-09-12T10:00:00.000Z',
      runId: 'run-7',
      level: 'info',
      stage: 'scan',
      msg: 'started',
    });
    assert.equal(lines[1]!.stage, 'engine:blocksec');
    assert.equal(lines[1]!.msg, 'pulling image');
  });

  test('emits without --verbose', () => {
    // A machine consumer that asked for the log wants all of it; gating JSON on
    // a human-readability flag would make `--log-json` alone produce nothing.
    const out = sink();
    const log = createLogger({ json: true, verbose: false, runId: 'run-7', stream: out, now: AT });

    log.stage('harness')('forge test');

    assert.equal(out.lines().length, 1);
  });

  test('every line carries the same run id', () => {
    const out = sink();
    const log = createLogger({ json: true, verbose: true, runId: 'run-7', stream: out, now: AT });

    log.event('debug', 'a', 'one');
    log.event('warn', 'b', 'two');
    log.event('error', 'c', 'three');

    assert.deepEqual(
      out.lines().map((l) => l.runId),
      ['run-7', 'run-7', 'run-7'],
    );
    assert.deepEqual(
      out.lines().map((l) => l.level),
      ['debug', 'warn', 'error'],
    );
  });

  test('carries extra fields alongside the envelope', () => {
    const out = sink();
    const log = createLogger({ json: true, verbose: false, runId: 'run-7', stream: out, now: AT });

    log.event('info', 'engine:hookrisk', 'finished', { status: 'ok', durationMs: 1234, findings: 3 });

    const line = out.lines()[0]!;
    assert.equal(line.status, 'ok');
    assert.equal(line.durationMs, 1234);
    assert.equal(line.findings, 3);
  });

  test('a field cannot displace an envelope key', () => {
    const out = sink();
    const log = createLogger({ json: true, verbose: false, runId: 'run-7', stream: out, now: AT });

    // Reserved keys are what a reader greps and what a collector joins on. A
    // caller that happens to name a field `msg` must not silently rewrite them.
    log.event('info', 'scan', 'real message', {
      msg: 'impostor',
      runId: 'other',
      level: 'error',
      stage: 'elsewhere',
      ts: 'never',
    } as LogFields);

    assert.deepEqual(out.lines()[0], {
      ts: '2026-09-12T10:00:00.000Z',
      runId: 'run-7',
      level: 'info',
      stage: 'scan',
      msg: 'real message',
    });
  });

  test('a newline in a message stays on one line', () => {
    // Multi-line tool output reaches the log; one event must remain one line or
    // the format is not line-delimited JSON at all.
    const out = sink();
    const log = createLogger({ json: true, verbose: false, runId: 'run-7', stream: out, now: AT });

    log.event('error', 'engine:hookrisk', 'compile failed:\nError (7920)\n  --> src/X.sol:1:1');

    assert.equal(out.lines().length, 1);
    assert.equal(out.lines()[0]!.msg, 'compile failed:\nError (7920)\n  --> src/X.sol:1:1');
  });
});

describe('run id', () => {
  test('is generated when not supplied and is stable for the scan', () => {
    const out = sink();
    const log = createLogger({ json: true, verbose: false, stream: out, now: AT });

    log.event('info', 'scan', 'one');
    log.event('info', 'scan', 'two');

    assert.match(log.runId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(new Set(out.lines().map((l) => l.runId)), new Set([log.runId]));
  });

  test('two loggers get different ids', () => {
    const a = createLogger({ json: false, verbose: false });
    const b = createLogger({ json: false, verbose: false });
    assert.notEqual(a.runId, b.runId);
  });
});
