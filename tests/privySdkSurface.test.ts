/**
 * @id PP-CORE-LAY (POO-1798), spec
 * @name Privy SDK surface pin, spec
 * @implements-rules-version v1 (POO-1798 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * A SURFACE PIN, not a behaviour test. It asserts that the SDK versions we pinned are the ones
 * actually installed, and that every symbol this app imports from them is still exported by the
 * shipped type declarations. It does not exercise a single line of Privy's runtime, and it cannot:
 * the two behaviours POO-1798 flagged for re-testing (MetaMask leaving Solana auto-connect in
 * 3.30.0, server-cookie self-healing in 3.33.1) live behind a real browser and a real Privy app id.
 *
 * It is therefore green on the OLD versions too, by construction: a pin whose job is "nothing was
 * removed" cannot go red until something is removed. What it buys is the next bump. When a symbol
 * disappears, this fails in seconds with the name, instead of `pnpm build` failing somewhere in a
 * component two hours later, or worse, a type-only removal surviving the build and landing.
 *
 * The export lists are read through the TypeScript compiler rather than grepped, so a re-export
 * (`export * from "./x"`), a renamed re-export and a type-only export all count exactly as the app's
 * own imports would resolve them.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** The worktree root: vitest runs from it, and the installed tree hangs off it. */
const ROOT = process.cwd();

interface InstalledPackage {
  version: string;
  dependencies?: Record<string, string>;
  types?: string;
  typings?: string;
  exports?: Record<string, unknown>;
}

/** Read an INSTALLED package's manifest, from the tree rather than from our own `package.json`. */
function installed(pkg: string): InstalledPackage {
  return JSON.parse(
    readFileSync(path.join(ROOT, "node_modules", pkg, "package.json"), "utf8"),
  ) as InstalledPackage;
}

/**
 * The declaration entry point the package advertises. The `"."` export condition first, since that
 * is how the app resolves these packages under `moduleResolution: bundler`, then the legacy
 * `types` / `typings` fields, for a package that ships no exports map.
 */
function typesEntry(pkg: string): string {
  const manifest = installed(pkg);
  const dot = manifest.exports?.["."] as Record<string, unknown> | undefined;
  const fromExports =
    typeof dot?.types === "string"
      ? dot.types
      : typeof (dot?.import as Record<string, unknown> | undefined)?.types === "string"
        ? ((dot?.import as Record<string, string>).types as string)
        : undefined;
  const entry = fromExports ?? manifest.types ?? manifest.typings;
  if (!entry) throw new Error(`${pkg}: no types entry in its manifest`);
  return path.join(ROOT, "node_modules", pkg, entry);
}

/** Every name the module exports, resolved the way a consumer's import would resolve it. */
function exportedNames(pkg: string): Set<string> {
  const entry = typesEntry(pkg);
  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
    allowJs: false,
  });
  const source = program.getSourceFile(entry);
  if (!source) throw new Error(`${pkg}: could not load ${entry}`);
  const moduleSymbol = program.getTypeChecker().getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`${pkg}: ${entry} is not a module`);
  return new Set(
    program
      .getTypeChecker()
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => symbol.getName()),
  );
}

/**
 * [R1]: every symbol the app consumes. Values and types together, because a type removal is the
 * failure mode a bundler would not catch. Kept as a literal list rather than derived from a grep of
 * `src/`, so that dropping an import from the app does not silently shrink what this pins.
 */
const CONSUMED: Record<string, readonly string[]> = {
  "@privy-io/react-auth": [
    "useWallets",
    "useSignTypedData",
    "usePrivy",
    // POO-1915: the on-ramp adapter's entry point (`usePrivyOnRamp.ts`, PP-CORE-HOK-035). It was
    // missing from this list because the list predates POO-1803, so the 3.40.0 -> 3.42.0 bump ran
    // without a pin on the one symbol the whole on-ramp rail hangs off. It carries
    // `@experimental This interface may change at any time.` in the shipped types, which makes it
    // the MOST likely name here to be renamed or withdrawn, not the least.
    "useAddFunds",
    "useLogin",
    "useLogout",
    "useSignMessage",
    "useExportWallet",
    "getEmbeddedConnectedWallet",
    "PrivyProvider",
    "ConnectedWallet",
    "SignTypedDataParams",
  ],
  "@privy-io/wagmi": ["createConfig", "WagmiProvider", "useSetActiveWallet"],
};

describe("Privy SDK surface (POO-1798)", () => {
  // @rule R2
  it("has the exact pinned versions installed, not a caret range's drift", () => {
    expect(installed("@privy-io/react-auth").version).toBe("3.42.0");
    expect(installed("@privy-io/wagmi").version).toBe("4.0.17");
  });

  // @rule R2
  it("gets @stripe/crypto from Privy's own dependencies, never from ours", () => {
    // From 3.36.0 Privy declares it, so adding it to our manifest would be us claiming ownership of
    // a transitive we do not import and cannot choose the version of.
    expect(installed("@privy-io/react-auth").dependencies).toHaveProperty("@stripe/crypto");

    const ours = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(ours.dependencies ?? {}).not.toHaveProperty("@stripe/crypto");
    expect(ours.devDependencies ?? {}).not.toHaveProperty("@stripe/crypto");
  });

  // @rule R2
  it("leaves the root viem and wagmi ranges alone", () => {
    const ours = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(ours.dependencies.viem).toBe("^2.52.2");
    expect(ours.dependencies.wagmi).toBe("^3.6.16");
    // The pins themselves: exact, no caret, or the next install drifts off the measured versions.
    expect(ours.dependencies["@privy-io/react-auth"]).toBe("3.42.0");
    expect(ours.dependencies["@privy-io/wagmi"]).toBe("4.0.17");
  });

  for (const [pkg, symbols] of Object.entries(CONSUMED)) {
    // @rule R1
    it(`still exports every symbol the app imports from ${pkg}`, () => {
      const exported = exportedNames(pkg);
      const missing = symbols.filter((symbol) => !exported.has(symbol));
      expect(missing).toEqual([]);
    });
  }
});
