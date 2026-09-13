/**
 * @id PP-TOOLS-LIB-002
 * @name verified-source fetch (Etherscan V2), tests
 * @implements-rules-version v1
 * @analytics-events none
 *
 * Behavior under test:
 *   [R5] only the five chains the UI offers are accepted.
 *   [R6] the three shapes Etherscan returns in `SourceCode` all parse: a bare Solidity file, the
 *        `{{ ... }}` standard-json-input, and the older single-brace file map.
 *   [R7] an unverified contract is a clean, named failure, never an empty project that then fails
 *        somewhere less legible.
 *   [R8] the entry file is the one that actually declares the contract, because that string is the
 *        `File.sol:Contract` target hookrisk is invoked with.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildSourceUrl,
  fetchVerifiedSource,
  isSupportedChain,
  parseCompilerVersion,
  parseSourceCodeResponse,
  SUPPORTED_CHAINS,
} from "./explorer";

const ADDRESS = "0x0000000000000000000000000000000000000001";

/** Etherscan's envelope, with `result[0]` overridden per case. */
function envelope(result: Record<string, unknown>): unknown {
  return {
    status: "1",
    message: "OK",
    result: [
      {
        SourceCode: "",
        ABI: "[]",
        ContractName: "",
        CompilerVersion: "v0.8.26+commit.8a97fa7a",
        OptimizationUsed: "1",
        Runs: "200",
        EVMVersion: "cancun",
        ...result,
      },
    ],
  };
}

describe("supported chains [R5]", () => {
  it("offers exactly Ethereum, Unichain, Base, Arbitrum and Polygon", () => {
    expect(SUPPORTED_CHAINS.map((chain) => chain.id)).toEqual([1, 130, 8453, 42161, 137]);
  });

  it("rejects any other chain id", () => {
    expect(isSupportedChain(1)).toBe(true);
    expect(isSupportedChain(10)).toBe(false);
    expect(isSupportedChain(Number.NaN)).toBe(false);
  });
});

describe("buildSourceUrl", () => {
  it("targets the V2 multichain endpoint with the chain as a query parameter", () => {
    const url = buildSourceUrl(130, ADDRESS, "KEY123");
    expect(url).toBe(
      "https://api.etherscan.io/v2/api?chainid=130&module=contract&action=getsourcecode" +
        `&address=${ADDRESS}&apikey=KEY123`,
    );
  });
});

describe("parseCompilerVersion", () => {
  it("strips the leading v and the commit suffix", () => {
    expect(parseCompilerVersion("v0.8.26+commit.8a97fa7a")).toBe("0.8.26");
    expect(parseCompilerVersion("0.8.24")).toBe("0.8.24");
  });

  it("returns null for a nightly or unparseable version rather than guessing one", () => {
    expect(parseCompilerVersion("v0.8.27-nightly.2024.8.1+commit.abc")).toBeNull();
    expect(parseCompilerVersion("")).toBeNull();
  });
});

describe("parseSourceCodeResponse [R7]", () => {
  it("names an unverified contract as such", () => {
    const parsed = parseSourceCodeResponse(envelope({ SourceCode: "", ContractName: "" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe("NOT_VERIFIED");
  });

  it("surfaces an explorer-level error (bad key, rate limit) under its own code", () => {
    const parsed = parseSourceCodeResponse({
      status: "0",
      message: "NOTOK",
      result: "Invalid API Key",
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.code).toBe("EXPLORER_ERROR");
      expect(parsed.message).toContain("Invalid API Key");
    }
  });

  it("rejects a body that is not the envelope at all", () => {
    const parsed = parseSourceCodeResponse("<html>rate limited</html>");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe("EXPLORER_ERROR");
  });
});

describe("parseSourceCodeResponse, single Solidity file [R6][R8]", () => {
  const source = "// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract MyHook {}\n";

  it("writes it under src/<ContractName>.sol and targets that path", () => {
    const parsed = parseSourceCodeResponse(
      envelope({ SourceCode: source, ContractName: "MyHook" }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Trimmed: the explorer pads the field, and trailing whitespace is not part of the source.
    expect(parsed.source.files).toEqual([{ path: "src/MyHook.sol", content: source.trim() }]);
    expect(parsed.source.entryFile).toBe("src/MyHook.sol");
    expect(parsed.source.contractName).toBe("MyHook");
    expect(parsed.source.remappings).toEqual([]);
    expect(parsed.source.solcVersion).toBe("0.8.26");
    expect(parsed.source.evmVersion).toBe("cancun");
    expect(parsed.source.optimizer).toEqual({ enabled: true, runs: 200 });
  });
});

describe("parseSourceCodeResponse, standard-json input [R6][R8]", () => {
  const standardJson = {
    language: "Solidity",
    sources: {
      "lib/v4-core/src/interfaces/IHooks.sol": { content: "interface IHooks {}" },
      "src/MyHook.sol": { content: "contract MyHook is BaseHook {}" },
    },
    settings: {
      remappings: ["v4-core/=lib/v4-core/", "@openzeppelin/=lib/openzeppelin-contracts/"],
      optimizer: { enabled: false, runs: 999 },
      evmVersion: "shanghai",
    },
  };

  it("unwraps the doubled braces and keeps every source path verbatim", () => {
    const parsed = parseSourceCodeResponse(
      envelope({
        SourceCode: `{{${JSON.stringify(standardJson).slice(1, -1)}}}`,
        ContractName: "MyHook",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.source.files.map((file) => file.path)).toEqual([
      "lib/v4-core/src/interfaces/IHooks.sol",
      "src/MyHook.sol",
    ]);
    expect(parsed.source.remappings).toEqual([
      "v4-core/=lib/v4-core/",
      "@openzeppelin/=lib/openzeppelin-contracts/",
    ]);
    expect(parsed.source.optimizer).toEqual({ enabled: false, runs: 999 });
    expect(parsed.source.evmVersion).toBe("shanghai");
  });

  it("picks the file that DECLARES the contract as the entry, not the first one listed [R8]", () => {
    const parsed = parseSourceCodeResponse(
      envelope({
        SourceCode: `{{${JSON.stringify(standardJson).slice(1, -1)}}}`,
        ContractName: "MyHook",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.source.entryFile).toBe("src/MyHook.sol");
  });

  it("finds an `abstract contract` declaration too", () => {
    const parsed = parseSourceCodeResponse(
      envelope({
        SourceCode: JSON.stringify({
          language: "Solidity",
          sources: {
            "a.sol": { content: "// nothing here" },
            "b.sol": { content: "abstract  contract   Weird is X {}" },
          },
          settings: {},
        })
          .replace(/^\{/, "{{")
          .replace(/\}$/, "}}"),
        ContractName: "Weird",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.source.entryFile).toBe("b.sol");
  });

  it("falls back to the last source when no file declares the name (never throws)", () => {
    const parsed = parseSourceCodeResponse(
      envelope({
        SourceCode: JSON.stringify({
          sources: { "a.sol": { content: "x" }, "b.sol": { content: "y" } },
        })
          .replace(/^\{/, "{{")
          .replace(/\}$/, "}}"),
        ContractName: "Ghost",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.source.entryFile).toBe("b.sol");
  });

  it("reports a standard json with no sources as a parse failure", () => {
    const parsed = parseSourceCodeResponse(
      envelope({ SourceCode: '{{"sources":{}}}', ContractName: "MyHook" }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.code).toBe("SOURCE_UNPARSEABLE");
  });
});

describe("parseSourceCodeResponse, legacy single-brace file map [R6]", () => {
  it('reads `{ "A.sol": { content } }` as the file map it is', () => {
    const parsed = parseSourceCodeResponse(
      envelope({
        SourceCode: JSON.stringify({
          "src/A.sol": { content: "contract A {}" },
          "src/B.sol": { content: "contract B {}" },
        }),
        ContractName: "B",
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.source.files).toHaveLength(2);
    expect(parsed.source.entryFile).toBe("src/B.sol");
  });
});

describe("fetchVerifiedSource", () => {
  it("refuses an unsupported chain before it ever calls out", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchVerifiedSource(
      { chainId: 10, address: ADDRESS, apiKey: "K" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNSUPPORTED_CHAIN");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to call out without an API key, and says which one", async () => {
    const fetchImpl = vi.fn();
    const result = await fetchVerifiedSource(
      { chainId: 1, address: ADDRESS, apiKey: "" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EXPLORER_KEY_MISSING");
      expect(result.message).toContain("ETHERSCAN_API_KEY");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("turns a non-200 into a named failure rather than a thrown parse error", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const result = await fetchVerifiedSource(
      { chainId: 1, address: ADDRESS, apiKey: "K" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPLORER_ERROR");
  });

  it("turns a transport failure into a named failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const result = await fetchVerifiedSource(
      { chainId: 1, address: ADDRESS, apiKey: "K" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXPLORER_ERROR");
  });

  it("parses a good response end to end", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify(envelope({ SourceCode: "contract MyHook {}", ContractName: "MyHook" })),
          { status: 200 },
        ),
    );
    const result = await fetchVerifiedSource(
      { chainId: 42161, address: ADDRESS, apiKey: "K" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source.contractName).toBe("MyHook");
  });
});
