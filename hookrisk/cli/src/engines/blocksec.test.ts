/**
 * Tests for the BlockSec HookScan adapter's container plumbing.
 *
 * No Docker here. What these pin is the part that was wrong for months and
 * looked fine: the argument vector. The engine shipped an invocation that could
 * never have worked — no `--platform` on an amd64-only image, and the image's
 * own entrypoint, which dies before the analyser starts. Both failures are
 * invisible from the inside; the container exits, stdout has no JSON, and the
 * adapter reports "could not parse HookScan output".
 *
 * So the flags that make it run are asserted individually and by position,
 * rather than by eyeballing a snapshot. The end-to-end proof that this argument
 * vector really produces findings is in
 * docs/hackathon/evidence/blocksec-corroboration.md.
 */

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, describe } from 'node:test';

import {
  assertSolcVersion,
  buildRunArgs,
  cacheRoot,
  escapedLibraryReason,
  escapingLibraryRoots,
  isUsableSolc,
  libraryRootEntries,
  mountArgs,
  parseSolcVersions,
  platformArgs,
  solcBinaryName,
  solcCachePath,
  solcContainerPath,
  type Mount,
} from './blocksec.js';

const PROJECT: Mount = { host: '/host/project', container: '/project' };
const SOLC: Mount = { host: '/cache/solc', container: '/solc/v0.8.26/solc', readOnly: true };

function args(overrides: Partial<Parameters<typeof buildRunArgs>[0]> = {}): string[] {
  return buildRunArgs({
    image: 'futuretech6/hookscan',
    platform: 'linux/amd64',
    mounts: [PROJECT, SOLC],
    solcBin: '/solc/v0.8.26/solc',
    sourceFile: 'src/hooks/FeeHooks.sol',
    contractName: 'SkimmingFeeHook',
    ...overrides,
  });
}

/** Index of `needle` in `argv`, asserting it appears exactly once. */
function only(argv: string[], needle: string): number {
  const hits = argv.reduce<number[]>((acc, a, i) => (a === needle ? [...acc, i] : acc), []);
  assert.equal(hits.length, 1, `expected exactly one ${needle} in: ${argv.join(' ')}`);
  return hits[0]!;
}

describe('buildRunArgs', () => {
  test('pins the platform, because the image is amd64-only', () => {
    // Without this an arm64 host gets "no matching manifest for linux/arm64/v8"
    // and the engine is dead on the machines most people develop on.
    const argv = args();
    assert.equal(argv[only(argv, '--platform') + 1], 'linux/amd64');
  });

  test('an empty platform omits the flag rather than passing an empty value', () => {
    // `--platform ""` is an error, not a no-op, so opting out has to remove the
    // pair entirely.
    const argv = args({ platform: '' });
    assert.ok(!argv.includes('--platform'));
    assert.ok(!argv.includes(''));
  });

  test('bypasses the image entrypoint and invokes the module directly', () => {
    // /entrypoint.sh does groupadd/useradd from the uid of the mounted /project,
    // which is 0 under Docker Desktop; groupadd fails and `su scanner` never
    // reaches the analyser.
    const argv = args();
    const at = only(argv, '--entrypoint');
    assert.equal(argv[at + 1], 'python');
    assert.deepEqual(argv.slice(argv.indexOf('futuretech6/hookscan') + 1, argv.indexOf('--base-path')), [
      '-m',
      'hookscan',
    ]);
  });

  test('reproduces the argument list the entrypoint would have built', () => {
    // --base-path, --solc-bin, caller flags, then /project/<CONTRACT> — in that
    // order. HookScan takes the target positionally, so order is load-bearing.
    const argv = args();
    assert.equal(argv[only(argv, '--base-path') + 1], '/project');
    assert.equal(argv[only(argv, '--solc-bin') + 1], '/solc/v0.8.26/solc');
    assert.equal(argv.at(-1), '/project/src/hooks/FeeHooks.sol:SkimmingFeeHook');
    assert.equal(argv.at(-2), '--silent');
  });

  test('every flag precedes the image name and every hookscan argument follows it', () => {
    // A docker flag placed after the image name is silently handed to the
    // container instead, which is the kind of mistake that produces an empty
    // result rather than an error.
    const argv = args();
    const image = only(argv, 'futuretech6/hookscan');
    for (const flag of ['--platform', '--network', '--entrypoint', '-v']) {
      assert.ok(argv.indexOf(flag) < image, `${flag} must precede the image`);
    }
    for (const arg of ['-m', '--base-path', '--solc-bin', '--silent']) {
      assert.ok(argv.indexOf(arg) > image, `${arg} must follow the image`);
    }
  });

  test('the analysis container has no network', () => {
    // Any compiler download happens on the host before this container starts.
    const argv = args();
    assert.equal(argv[only(argv, '--network') + 1], 'none');
  });

  test('the target path is built with POSIX separators regardless of host', () => {
    const argv = args({ sourceFile: 'src/A.sol', contractName: 'A' });
    assert.equal(argv.at(-1), '/project/src/A.sol:A');
  });
});

describe('mountArgs', () => {
  test('renders read-only and read-write bindings', () => {
    assert.deepEqual(mountArgs([PROJECT, SOLC]), [
      '-v',
      '/host/project:/project',
      '-v',
      '/cache/solc:/solc/v0.8.26/solc:ro',
    ]);
  });

  test('the compiler is mounted read-only', () => {
    // The container must not be able to replace the compiler it is judged with.
    assert.ok(mountArgs([SOLC])[1]!.endsWith(':ro'));
  });
});

describe('platformArgs', () => {
  test('present when set, absent when empty', () => {
    assert.deepEqual(platformArgs('linux/amd64'), ['--platform', 'linux/amd64']);
    assert.deepEqual(platformArgs(''), []);
  });
});

describe('solc cache paths', () => {
  test('defaults under ~/.cache/hookrisk/solc/<version>/solc', () => {
    const path = solcCachePath('0.8.26', {});
    assert.ok(path.endsWith(join('.cache', 'hookrisk', 'solc', '0.8.26', 'solc')), path);
  });

  test('HOOKRISK_CACHE_DIR replaces the cache root', () => {
    assert.equal(
      solcCachePath('0.8.26', { HOOKRISK_CACHE_DIR: '/var/cache/hr' }),
      '/var/cache/hr/solc/0.8.26/solc',
    );
    assert.equal(cacheRoot({ HOOKRISK_CACHE_DIR: '/var/cache/hr' }), '/var/cache/hr');
  });

  test('a blank override falls back to the default rather than resolving to cwd', () => {
    assert.equal(cacheRoot({ HOOKRISK_CACHE_DIR: '   ' }), cacheRoot({}));
  });

  test('the mount destination and --solc-bin are the same string', () => {
    // They are derived separately in run(); if they ever drift, the compiler is
    // mounted at a path the analyser does not look at and the container falls
    // back to a version that cannot compile v4-core.
    const version = ' 0.8.26 ';
    assert.equal(solcContainerPath(version), '/solc/v0.8.26/solc');
    const argv = args({ solcBin: solcContainerPath(version) });
    assert.equal(argv[argv.indexOf('--solc-bin') + 1], SOLC.container);
  });

  test('a version that is not MAJOR.MINOR.PATCH is refused, not interpolated', () => {
    // The version reaches us from foundry.toml and lands in a URL, a host path
    // and a container path. `^0.8.26` or `../../etc` must never get that far.
    for (const bad of ['^0.8.26', '0.8', '../../etc/passwd', '0.8.26 && rm -rf /', '']) {
      assert.throws(() => assertSolcVersion(bad), /expected MAJOR\.MINOR\.PATCH/, bad);
    }
    assert.equal(assertSolcVersion(' 0.8.26 '), '0.8.26');
  });
});

describe('parseSolcVersions', () => {
  test('reads the versions the image ships', () => {
    const listing = 'v0.8.14\nv0.8.15\nv0.8.23\nv0.8.24\n';
    assert.deepEqual(parseSolcVersions(listing), ['0.8.14', '0.8.15', '0.8.23', '0.8.24']);
    // The published image tops out below what v4-core pins, which is why the
    // download path is not an edge case but the normal path.
    assert.ok(!parseSolcVersions(listing).includes('0.8.26'));
  });

  test('column output and stray lines do not become versions', () => {
    assert.deepEqual(parseSolcVersions('v0.8.14  v0.8.15\ntotal 4\nREADME\n'), ['0.8.14', '0.8.15']);
  });

  test('an empty or failed listing yields nothing rather than throwing', () => {
    assert.deepEqual(parseSolcVersions(''), []);
  });
});

describe('solcBinaryName', () => {
  const list = {
    releases: { '0.8.26': 'solc-linux-amd64-v0.8.26+commit.8a97fa7a' },
  };

  test('resolves a version to the exact published filename', () => {
    // The commit hash is not derivable, so guessing a URL is not an option.
    assert.equal(solcBinaryName(list, '0.8.26'), 'solc-linux-amd64-v0.8.26+commit.8a97fa7a');
  });

  test('an unpublished version fails with "not published", not a 404 later', () => {
    assert.throws(() => solcBinaryName(list, '0.8.99'), /not published as a linux-amd64/);
    assert.throws(() => solcBinaryName(null, '0.8.26'), /not published as a linux-amd64/);
    assert.throws(() => solcBinaryName({ releases: {} }, '0.8.26'), /not published/);
  });
});

describe('isUsableSolc', () => {
  const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(2_000_000)]);
  let dir: string;

  function write(name: string, bytes: Buffer, mode: number): string {
    dir ??= mkdtempSync(join(tmpdir(), 'hookrisk-solc-'));
    const path = join(dir, name);
    writeFileSync(path, bytes);
    chmodSync(path, mode);
    return path;
  }

  test('accepts an executable ELF of plausible size', () => {
    assert.equal(isUsableSolc(write('good', elf, 0o755)), true);
  });

  test('rejects a cached HTML error page even when it is executable', () => {
    // The realistic corruption is not truncation: it is a proxy error page
    // written to the cache and then mounted as `solc`, which surfaces as an
    // inscrutable "exec format error" on every later run.
    const page = Buffer.concat([Buffer.from('<!DOCTYPE html>'), Buffer.alloc(2_000_000, 0x20)]);
    assert.equal(isUsableSolc(write('html', page, 0o755)), false);
  });

  test('rejects a truncated download and a non-executable file', () => {
    assert.equal(isUsableSolc(write('short', elf.subarray(0, 1024), 0o755)), false);
    assert.equal(isUsableSolc(write('noexec', elf, 0o644)), false);
  });

  test('a missing file is unusable, not an exception', () => {
    assert.equal(isUsableSolc(join(tmpdir(), 'hookrisk-does-not-exist', 'solc')), false);
  });

  test.after(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
});

describe('libraryRootEntries', () => {
  const remappings = [
    'forge-std/=lib/forge-std/src/',
    'ds-test/=lib/forge-std/lib/ds-test/src/',
    '@uniswap/v4-core/=lib/v4-core/',
    'vendor/=node_modules/vendor/',
  ].join('\n');

  test('collects the first path segment of every remapping target', () => {
    assert.deepEqual(libraryRootEntries(remappings, ''), ['lib', 'node_modules']);
  });

  test('picks up libs from foundry.toml too', () => {
    assert.deepEqual(libraryRootEntries('', 'libs = ["lib", "deps"]\nsrc = "src"\n'), [
      'deps',
      'lib',
    ]);
  });

  test('ignores absolute and parent-relative targets', () => {
    // Nothing mounted at /project/<name> could stand in for those, so claiming
    // them as candidates would only produce a misleading failure message.
    assert.deepEqual(libraryRootEntries('a/=/opt/a/\nb/=../shared/b/\nc/=./lib/c/', ''), ['lib']);
  });

  test('comments and blank lines are not path segments', () => {
    assert.deepEqual(libraryRootEntries('# a comment\n\nforge-std/=lib/forge-std/src/\n', ''), [
      'lib',
    ]);
  });
});

describe('escapingLibraryRoots', () => {
  const made: string[] = [];
  function project(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hookrisk-proj-'));
    made.push(dir);
    return dir;
  }

  test('a lib/ pointing above the project root is reported with where it lands', () => {
    // This is the corpus project's shape, kept deliberately (see
    // corpus/foundry.toml). Only the project root is mounted, so solc resolves
    // every import to a path outside its allowed directories and compiles
    // nothing — a scan that reports nothing, which reads exactly like a clean
    // hook.
    const root = project();
    const proj = join(root, 'corpus');
    mkdirSync(join(root, 'sibling', 'lib'), { recursive: true });
    mkdirSync(proj);
    writeFileSync(join(proj, 'remappings.txt'), '@uniswap/v4-core/=lib/v4-core/\n');
    symlinkSync('../sibling/lib', join(proj, 'lib'));

    assert.deepEqual(escapingLibraryRoots(proj), [
      { name: 'lib', target: '../sibling/lib', resolvedInContainer: '/sibling/lib' },
    ]);
  });

  test('a symlink that stays inside the project is fine', () => {
    // It resolves to a path under /project, so the single bind mount carries it
    // and solc is happy. Refusing here would be a false alarm.
    const proj = project();
    mkdirSync(join(proj, 'vendor', 'lib'), { recursive: true });
    writeFileSync(join(proj, 'foundry.toml'), 'libs = ["lib"]\n');
    symlinkSync('vendor/lib', join(proj, 'lib'));
    assert.deepEqual(escapingLibraryRoots(proj), []);
  });

  test('an absolute symlink target always escapes', () => {
    const proj = project();
    writeFileSync(join(proj, 'foundry.toml'), 'libs = ["lib"]\n');
    symlinkSync('/opt/shared/lib', join(proj, 'lib'));
    assert.deepEqual(escapingLibraryRoots(proj), [
      { name: 'lib', target: '/opt/shared/lib', resolvedInContainer: '/opt/shared/lib' },
    ]);
  });

  test('a real directory is not reported', () => {
    const proj = project();
    mkdirSync(join(proj, 'lib'));
    writeFileSync(join(proj, 'foundry.toml'), 'libs = ["lib"]\n');
    assert.deepEqual(escapingLibraryRoots(proj), []);
  });

  test('a project with no remappings and no foundry.toml yields nothing', () => {
    assert.deepEqual(escapingLibraryRoots(project()), []);
  });

  test('the failure names the symlink, where it lands, and what to do', () => {
    // The engine reports this as `failed`, not `ok` with zero findings. A tool
    // that reports nothing looks exactly like success, so the reason has to be
    // actionable on its own.
    const reason = escapedLibraryReason('/repo/corpus', [
      { name: 'lib', target: '../harness/lib', resolvedInContainer: '/harness/lib' },
    ]);
    assert.match(reason, /lib symlink cannot be followed inside the container/);
    assert.match(reason, /lib -> \.\.\/harness\/lib/);
    assert.match(reason, /lands at \/harness\/lib/);
    assert.match(reason, /replace the symlink with the directory it points at/);
  });

  test.after(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });
});
