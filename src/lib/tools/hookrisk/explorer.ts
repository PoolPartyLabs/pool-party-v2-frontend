/**
 * @id PP-TOOLS-LIB-002
 * @name verified-source fetch (Etherscan V2)
 * @implements-rules-version v1
 * @analytics-events none (the screen PP-TOOLS-CMP-001 reports the outcome)
 *
 * Reads a deployed hook's VERIFIED source from the block explorer, which is the only input this
 * whole feature has. A hook is analysable exactly when somebody published the source that produced
 * its bytecode; when nobody did, the honest answer is "not verified", and it is returned as a named
 * failure rather than an empty project that fails later inside `forge build` with a message about
 * something else.
 *
 * Etherscan V2 is one endpoint for every chain (`?chainid=`), so adding a chain is a row in
 * {@link SUPPORTED_CHAINS} and nothing else.
 *
 * `SourceCode` comes back in three shapes and the caller cannot choose which: a bare Solidity file,
 * a standard-json-input wrapped in DOUBLED braces (`{{ ... }}`, which is not valid JSON until the
 * outer layer is peeled), or the older single-brace `{ "path": { "content": ... } }` file map. All
 * three are parsed here so nothing downstream has to know about them.
 */
import "server-only";
import { isSupportedChain } from "./contract";

// The chain table is shared with the client-side picker, so it lives in the `server-only`-free
// contract module and is re-exported here: a caller reading verified source has no reason to know
// about that split.
export { isSupportedChain, SUPPORTED_CHAINS, type SupportedChain } from "./contract";

/** Why a source read failed. Each maps to one sentence the user actually reads. */
export type ExplorerErrorCode =
  | "UNSUPPORTED_CHAIN"
  | "EXPLORER_KEY_MISSING"
  | "EXPLORER_ERROR"
  | "NOT_VERIFIED"
  | "SOURCE_UNPARSEABLE";

/** One Solidity file, at the path the original compilation used. */
export interface SourceFile {
  path: string;
  content: string;
}

/** Everything needed to reproduce the original compilation locally. */
export interface ContractSource {
  contractName: string;
  /** `0.8.26`, or null when the explorer reported a nightly we cannot pin. */
  solcVersion: string | null;
  evmVersion: string | null;
  optimizer: { enabled: boolean; runs: number };
  files: SourceFile[];
  /** Remappings from `settings.remappings`; empty for a single-file verification. */
  remappings: string[];
  /** The file that declares {@link contractName}: the left half of hookrisk's `File.sol:Contract`. */
  entryFile: string;
}

export type SourceResult =
  | { ok: true; source: ContractSource }
  | { ok: false; code: ExplorerErrorCode; message: string };

const ETHERSCAN_V2 = "https://api.etherscan.io/v2/api";

/** The `getsourcecode` URL for one contract. */
export function buildSourceUrl(chainId: number, address: string, apiKey: string): string {
  return (
    `${ETHERSCAN_V2}?chainid=${chainId}&module=contract&action=getsourcecode` +
    `&address=${address}&apikey=${apiKey}`
  );
}

/**
 * `v0.8.26+commit.8a97fa7a` to `0.8.26`, or null.
 *
 * Null on a nightly is deliberate. Foundry's `solc = "x.y.z"` takes a release; handing it a
 * nightly string makes `forge build` fail with a download error, and letting foundry pick its own
 * version is a better failure than pinning one that does not exist.
 */
export function parseCompilerVersion(raw: string): string | null {
  const match = /^v?(\d+\.\d+\.\d+)(?:\+commit\.[0-9a-f]+)?$/.exec(raw.trim());
  return match?.[1] ?? null;
}

function fail(code: ExplorerErrorCode, message: string): SourceResult {
  return { ok: false, code, message };
}

/** The file declaring `contractName`, or the last one as a fallback (never throws). */
function findEntryFile(files: readonly SourceFile[], contractName: string): string {
  const declaration = new RegExp(`(?:^|\\s)(?:abstract\\s+)?contract\\s+${contractName}\\b`, "m");
  const declaring = files.find((file) => declaration.test(file.content));
  // `files` is non-empty by the time this runs; the `?? ""` only satisfies noUncheckedIndexedAccess.
  return declaring?.path ?? files[files.length - 1]?.path ?? "";
}

/** `{ "path": { content } }` or `{ "path": "..." }` to a file list, or null when the shape is wrong. */
function readSourceMap(value: unknown): SourceFile[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const files: SourceFile[] = [];
  for (const [path, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") {
      files.push({ path, content: entry });
      continue;
    }
    const content = (entry as Record<string, unknown> | null)?.content;
    if (typeof content !== "string") return null;
    files.push({ path, content });
  }
  return files.length > 0 ? files : null;
}

/** Parse Etherscan's `getsourcecode` body into a compilable source set. */
export function parseSourceCodeResponse(body: unknown): SourceResult {
  if (!body || typeof body !== "object") {
    return fail("EXPLORER_ERROR", "The block explorer returned a body that is not JSON.");
  }
  const envelope = body as Record<string, unknown>;
  if (envelope.status !== "1") {
    const detail =
      typeof envelope.result === "string"
        ? envelope.result
        : typeof envelope.message === "string"
          ? envelope.message
          : "unknown error";
    return fail("EXPLORER_ERROR", `The block explorer refused the request: ${detail}`);
  }
  const entry = Array.isArray(envelope.result) ? envelope.result[0] : undefined;
  if (!entry || typeof entry !== "object") {
    return fail("EXPLORER_ERROR", "The block explorer returned no result for this address.");
  }
  const record = entry as Record<string, unknown>;
  const rawSource = typeof record.SourceCode === "string" ? record.SourceCode.trim() : "";
  const contractName = typeof record.ContractName === "string" ? record.ContractName.trim() : "";

  if (rawSource.length === 0 || contractName.length === 0) {
    return fail(
      "NOT_VERIFIED",
      "This contract has no verified source on the block explorer, so there is nothing to analyse. " +
        "hookrisk reads source, never bytecode.",
    );
  }

  const solcVersion = parseCompilerVersion(
    typeof record.CompilerVersion === "string" ? record.CompilerVersion : "",
  );
  const evmVersionRaw = typeof record.EVMVersion === "string" ? record.EVMVersion.trim() : "";
  const optimizer = {
    enabled: record.OptimizationUsed === "1" || record.OptimizationUsed === 1,
    runs: Number.parseInt(String(record.Runs ?? "200"), 10) || 200,
  };

  let files: SourceFile[] | null = null;
  let remappings: string[] = [];
  let evmVersion: string | null =
    evmVersionRaw.length > 0 && evmVersionRaw.toLowerCase() !== "default" ? evmVersionRaw : null;

  if (rawSource.startsWith("{")) {
    // `{{ ... }}` is a standard-json-input; one layer of braces has to come off before it is JSON.
    const doubled = rawSource.startsWith("{{") && rawSource.endsWith("}}");
    const candidate = doubled ? rawSource.slice(1, -1) : rawSource;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return fail(
        "SOURCE_UNPARSEABLE",
        "The verified source is JSON the explorer could not hand back intact.",
      );
    }
    const asObject = (parsed ?? {}) as Record<string, unknown>;
    if ("sources" in asObject) {
      files = readSourceMap(asObject.sources);
      const settings = (asObject.settings ?? {}) as Record<string, unknown>;
      if (Array.isArray(settings.remappings)) {
        remappings = settings.remappings.filter((item): item is string => typeof item === "string");
      }
      if (typeof settings.evmVersion === "string" && settings.evmVersion !== "default") {
        evmVersion = settings.evmVersion;
      }
      const settingsOptimizer = settings.optimizer as Record<string, unknown> | undefined;
      if (settingsOptimizer && typeof settingsOptimizer.enabled === "boolean") {
        optimizer.enabled = settingsOptimizer.enabled;
        if (typeof settingsOptimizer.runs === "number") optimizer.runs = settingsOptimizer.runs;
      }
    } else {
      // The older format: the object IS the file map.
      files = readSourceMap(asObject);
    }
  } else {
    // A bare Solidity file. It has no path of its own, so it gets the conventional one.
    files = [{ path: `src/${contractName}.sol`, content: rawSource }];
  }

  if (!files || files.length === 0) {
    return fail(
      "SOURCE_UNPARSEABLE",
      "The verified source came back with no Solidity files in it.",
    );
  }

  return {
    ok: true,
    source: {
      contractName,
      solcVersion,
      evmVersion,
      optimizer,
      files,
      remappings,
      entryFile: findEntryFile(files, contractName),
    },
  };
}

/** What {@link fetchVerifiedSource} needs. `apiKey` is server-only and never reaches the browser. */
export interface FetchSourceInput {
  chainId: number;
  address: string;
  apiKey: string;
}

/**
 * Read one contract's verified source.
 *
 * PP-INTEGRATION-POINT: the Etherscan V2 `getsourcecode` endpoint. This is a real third-party call
 * made from the Node runtime with a server-only key; there is no mock branch, because a fabricated
 * "verified source" would produce a risk report about a contract that does not exist.
 */
export async function fetchVerifiedSource(
  input: FetchSourceInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SourceResult> {
  if (!isSupportedChain(input.chainId)) {
    return fail(
      "UNSUPPORTED_CHAIN",
      `Chain ${input.chainId} is not one of the chains this tool reads.`,
    );
  }
  if (input.apiKey.trim().length === 0) {
    return fail(
      "EXPLORER_KEY_MISSING",
      "ETHERSCAN_API_KEY is not set on the server, so the verified source cannot be read.",
    );
  }

  let body: unknown;
  try {
    const response = await fetchImpl(buildSourceUrl(input.chainId, input.address, input.apiKey), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return fail(
        "EXPLORER_ERROR",
        `The block explorer answered ${response.status} for this address.`,
      );
    }
    body = await response.json();
  } catch (error) {
    return fail(
      "EXPLORER_ERROR",
      `The block explorer could not be reached: ${error instanceof Error ? error.message : "unknown"}.`,
    );
  }

  return parseSourceCodeResponse(body);
}
