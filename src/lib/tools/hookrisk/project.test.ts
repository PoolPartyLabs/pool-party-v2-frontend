/**
 * @id PP-TOOLS-LIB-003
 * @name Foundry project materialisation, tests
 * @implements-rules-version v1
 * @analytics-events none
 *
 * Behavior under test:
 *   [R9]  a source path from the explorer can never escape the job directory. The paths in this
 *         input are chosen by whoever verified the contract, which is not us.
 *   [R10] the generated `foundry.toml` reproduces the original compilation: the same solc, the same
 *         optimizer, the same EVM version, and `src` pointing at the directory the entry file is in.
 *   [R11] remappings survive verbatim, because they are what makes the imports resolve.
 *   [R12] the hookrisk target is `<entry path>:<ContractName>`, the exact string the CLI takes.
 */
import { describe, expect, it } from "vitest";
import type { ContractSource } from "./explorer";
import { buildFoundryToml, hookriskTarget, planProject, sanitizeSourcePath } from "./project";

function source(overrides: Partial<ContractSource> = {}): ContractSource {
  return {
    contractName: "MyHook",
    solcVersion: "0.8.26",
    evmVersion: "cancun",
    optimizer: { enabled: true, runs: 200 },
    files: [{ path: "src/MyHook.sol", content: "contract MyHook {}" }],
    remappings: [],
    entryFile: "src/MyHook.sol",
    ...overrides,
  };
}

describe("sanitizeSourcePath [R9]", () => {
  it("keeps an ordinary relative path untouched", () => {
    expect(sanitizeSourcePath("src/hooks/MyHook.sol")).toBe("src/hooks/MyHook.sol");
    expect(sanitizeSourcePath("lib/v4-core/src/A.sol")).toBe("lib/v4-core/src/A.sol");
  });

  it("strips a leading slash so an absolute path becomes a relative one", () => {
    expect(sanitizeSourcePath("/etc/passwd")).toBe("etc/passwd");
  });

  it("drops every traversal segment", () => {
    expect(sanitizeSourcePath("../../../etc/passwd")).toBe("etc/passwd");
    expect(sanitizeSourcePath("src/../../../root/.ssh/id_rsa")).toBe("src/root/.ssh/id_rsa");
    expect(sanitizeSourcePath("./src/A.sol")).toBe("src/A.sol");
  });

  it("normalises backslashes and collapses repeated separators", () => {
    expect(sanitizeSourcePath("src\\\\win\\A.sol")).toBe("src/win/A.sol");
    expect(sanitizeSourcePath("src//a///B.sol")).toBe("src/a/B.sol");
  });

  it("returns null when nothing usable is left", () => {
    expect(sanitizeSourcePath("../..")).toBeNull();
    expect(sanitizeSourcePath("   ")).toBeNull();
    expect(sanitizeSourcePath("/")).toBeNull();
  });
});

describe("buildFoundryToml [R10]", () => {
  it("pins the solc, the optimizer and the EVM version the contract was built with", () => {
    const toml = buildFoundryToml(source(), "src");
    expect(toml).toContain('src = "src"');
    expect(toml).toContain('solc = "0.8.26"');
    expect(toml).toContain("optimizer = true");
    expect(toml).toContain("optimizer_runs = 200");
    expect(toml).toContain('evm_version = "cancun"');
  });

  it("omits solc entirely when the explorer reported a version we cannot pin", () => {
    // Better to let foundry choose than to pin a nightly that does not exist as a release.
    const toml = buildFoundryToml(source({ solcVersion: null, evmVersion: null }), "src");
    expect(toml).not.toContain("solc =");
    expect(toml).not.toContain("evm_version");
  });

  it("records the optimizer being OFF, rather than leaving the foundry default on", () => {
    const toml = buildFoundryToml(source({ optimizer: { enabled: false, runs: 1 } }), "contracts");
    expect(toml).toContain("optimizer = false");
    expect(toml).toContain('src = "contracts"');
  });
});

describe("planProject [R9][R10][R11]", () => {
  it("writes foundry.toml plus every source, and points src at the entry's own directory", () => {
    const plan = planProject(
      source({
        files: [
          { path: "contracts/MyHook.sol", content: "contract MyHook {}" },
          { path: "lib/v4-core/src/IHooks.sol", content: "interface IHooks {}" },
        ],
        entryFile: "contracts/MyHook.sol",
      }),
    );
    expect(plan.entryFile).toBe("contracts/MyHook.sol");
    expect(plan.srcDir).toBe("contracts");
    const paths = plan.files.map((file) => file.path);
    expect(paths).toContain("foundry.toml");
    expect(paths).toContain("contracts/MyHook.sol");
    expect(paths).toContain("lib/v4-core/src/IHooks.sol");
  });

  it("writes remappings.txt verbatim when the standard json carried any [R11]", () => {
    const plan = planProject(source({ remappings: ["v4-core/=lib/v4-core/", "@oz/=lib/oz/"] }));
    const remappings = plan.files.find((file) => file.path === "remappings.txt");
    expect(remappings?.content).toBe("v4-core/=lib/v4-core/\n@oz/=lib/oz/\n");
  });

  it("writes no remappings.txt when there were none, so foundry keeps its auto-detection", () => {
    const plan = planProject(source({ remappings: [] }));
    expect(plan.files.some((file) => file.path === "remappings.txt")).toBe(false);
  });

  it("puts a root-level file under src/ so `src` is never the project root [R10]", () => {
    const plan = planProject(
      source({
        files: [{ path: "MyHook.sol", content: "contract MyHook {}" }],
        entryFile: "MyHook.sol",
      }),
    );
    expect(plan.entryFile).toBe("src/MyHook.sol");
    expect(plan.srcDir).toBe("src");
    expect(plan.files.map((file) => file.path)).toContain("src/MyHook.sol");
  });

  it("drops a source whose path sanitises away rather than writing it somewhere arbitrary [R9]", () => {
    const plan = planProject(
      source({
        files: [
          { path: "src/MyHook.sol", content: "contract MyHook {}" },
          { path: "../../etc/passwd", content: "root:x:0:0" },
        ],
      }),
    );
    const passwd = plan.files.find((file) => file.content === "root:x:0:0");
    expect(passwd?.path).toBe("etc/passwd");
    for (const file of plan.files) {
      expect(file.path.startsWith("/"), file.path).toBe(false);
      expect(file.path.includes(".."), file.path).toBe(false);
    }
  });
});

describe("hookriskTarget [R12]", () => {
  it("is `<entry path>:<ContractName>`", () => {
    expect(hookriskTarget({ entryFile: "src/MyHook.sol", contractName: "MyHook" })).toBe(
      "src/MyHook.sol:MyHook",
    );
  });
});
