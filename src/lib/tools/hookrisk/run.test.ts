/**
 * @id PP-TOOLS-LIB-004
 * @name hookrisk toolchain preflight and exit codes, tests
 * @implements-rules-version v1
 * @analytics-events none
 *
 * Behavior under test:
 *   [R13] exit 2 is a RESULT. A failed gate is the tool working, and reporting it as an error would
 *         hide the one report the user came for.
 *   [R14] 10 and above mean hookrisk could not run, and the page must say so rather than show a
 *         report that does not exist.
 *   [R15] a missing tool fails FAST and names the tool plus the command that installs it. A demo
 *         that silently degrades to "no findings" is the failure mode this whole tool exists against.
 *   [R16] the CLI argv is exactly what the runbook documents.
 */
import { describe, expect, it } from "vitest";
import { buildScanArgs, describeMissingTools, interpretExitCode, resolveSlitherBin } from "./run";

describe("interpretExitCode [R13][R14]", () => {
  it("treats 0 as a completed scan whose gate passed", () => {
    expect(interpretExitCode(0)).toEqual({ kind: "result", gatePassed: true });
  });

  it("treats 2 as a completed scan whose gate FAILED, which is still a report [R13]", () => {
    expect(interpretExitCode(2)).toEqual({ kind: "result", gatePassed: false });
  });

  it("treats 64 as our own bug in the command line, not the user's hook", () => {
    expect(interpretExitCode(64)).toEqual({ kind: "usage" });
  });

  it("treats 10 and above as could-not-run [R14]", () => {
    for (const code of [10, 30, 64 - 1, 70]) {
      expect(interpretExitCode(code), String(code)).toEqual({ kind: "cannot-run" });
    }
  });

  it("treats an uncaught crash (1) and anything unmapped as could-not-run", () => {
    expect(interpretExitCode(1)).toEqual({ kind: "cannot-run" });
    expect(interpretExitCode(137)).toEqual({ kind: "cannot-run" });
  });
});

describe("describeMissingTools [R15]", () => {
  it("is null when everything is present", () => {
    expect(describeMissingTools({ forge: true, slither: true, cli: true })).toBeNull();
  });

  it("names foundry and foundryup when forge is missing", () => {
    const message = describeMissingTools({ forge: false, slither: true, cli: true });
    expect(message).toContain("forge");
    expect(message).toContain("foundryup");
  });

  it("names slither and pip when slither is missing", () => {
    const message = describeMissingTools({ forge: true, slither: false, cli: true });
    expect(message).toContain("slither");
    expect(message).toContain("pip install slither-analyzer");
  });

  it("names the hookrisk build and `make setup` when the CLI was never built", () => {
    const message = describeMissingTools({ forge: true, slither: true, cli: false });
    expect(message).toContain("cli/dist/cli.js");
    expect(message).toContain("make setup");
  });

  it("lists every missing tool at once rather than one per attempt", () => {
    const message = describeMissingTools({ forge: false, slither: false, cli: false });
    expect(message).toContain("forge");
    expect(message).toContain("slither");
    expect(message).toContain("cli/dist/cli.js");
  });
});

describe("resolveSlitherBin", () => {
  it("prefers an explicit HOOKRISK_SLITHER_BIN", () => {
    expect(resolveSlitherBin({ HOOKRISK_SLITHER_BIN: "/venv/bin/slither" }, "/opt/hookrisk")).toBe(
      "/venv/bin/slither",
    );
  });

  it("falls back to the checkout's own virtualenv, which is what `make setup` creates", () => {
    expect(resolveSlitherBin({}, "/opt/hookrisk")).toBe("/opt/hookrisk/.venv/bin/slither");
  });
});

describe("buildScanArgs [R16]", () => {
  it("is `scan <target> --out <dir> --root <dir>`, the runbook's invocation", () => {
    expect(buildScanArgs("/opt/hookrisk/cli/dist/cli.js", "src/A.sol:A", "/work/job")).toEqual([
      "/opt/hookrisk/cli/dist/cli.js",
      "scan",
      "src/A.sol:A",
      "--root",
      "/work/job",
      "--out",
      "/work/job",
      "--log-json",
    ]);
  });
});
