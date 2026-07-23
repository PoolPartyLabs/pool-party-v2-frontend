/**
 * @id PP-ACCOUNT (POO-544)
 * @name useExportPrivateKey
 * @implements-rules-version v2
 *
 * The single seam behind the "Export private key" action. It mirrors useAccountService's build-time
 * isMockMode guard so the Privy hooks are reached ONLY in a real build (PrivyProvider is unmounted in
 * mock/test/Storybook — see src/app/providers.tsx — so calling a Privy hook there would crash).
 *
 * POO-544 security rules:
 *  - [R1] Real mode reveals the key via Privy's exportWallet(), which renders it in a cross-origin
 *    iframe modal and resolves to void. The key never enters our JS / state / DOM / clipboard / logs.
 *    We MUST use exportWallet(); we must NEVER use Privy's useGetWalletPrivateKey(), which returns key
 *    material into app code.
 *  - [R3] Mock mode keeps the throwaway 0xMOCK... behavior; no key literal ever lives in source.
 *  - [R4] Missing embedded wallet throws a non-secret marker error the caller renders gracefully.
 */
"use client";

import { getEmbeddedConnectedWallet, useExportWallet, useWallets } from "@privy-io/react-auth";
import { useCallback, useMemo } from "react";
import { isMockMode } from "@/lib/services";

/** Result of {@link useExportPrivateKey}, discriminated by mode. */
export type ExportPrivateKey =
  | { isMock: true; revealMockKey: () => string }
  | { isMock: false; exportReal: () => Promise<void>; canExport: boolean };

/**
 * Generate a throwaway, per-reveal mock private key so the export UI works without any key literal in
 * source. A hardcoded key string trips secret scanners and is a deploy blocker (POO-223); this value
 * is generated at runtime from the Web Crypto RNG, never leaves the client, and controls no funds.
 * PP-MOCK (POO-541 R1): it carries an obvious `0xMOCK` prefix so a realistic-looking value is never
 * mistaken for a real private key. The value is display / clipboard only (never parsed as hex), so the
 * non-hex `0xMOCK` marker is safe; it stays roughly key-length (66 chars) so the reveal layout holds.
 */
export function generateMockPrivateKey(): string {
  // 30 random bytes -> 60 hex chars; the "0xMOCK" prefix makes the total 66 (real-key length).
  const bytes = new Uint8Array(30);
  crypto.getRandomValues(bytes);
  return `0xMOCK${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Returns the mock or real export surface, selected by the build-time mock seam. */
export function useExportPrivateKey(): ExportPrivateKey {
  if (isMockMode) {
    // biome-ignore lint/correctness/useHookAtTopLevel: isMockMode is a build-time constant
    return useMemo(() => ({ isMock: true as const, revealMockKey: generateMockPrivateKey }), []);
  }

  // Real branch. Privy hooks sit strictly AFTER the guard (mirrors useAccountService) — safe because
  // isMockMode is a build-time NEXT_PUBLIC constant, so exactly one branch is reachable per build.
  // biome-ignore lint/correctness/useHookAtTopLevel: build-time constant
  const { exportWallet } = useExportWallet();
  // biome-ignore lint/correctness/useHookAtTopLevel: build-time constant
  const { wallets } = useWallets();
  // Export the user's OWN embedded (Privy) wallet, deterministically — never the active/first wallet,
  // which may be an external one. getEmbeddedConnectedWallet is Privy's official helper.
  const embeddedAddress = getEmbeddedConnectedWallet([...wallets])?.address;

  // biome-ignore lint/correctness/useHookAtTopLevel: build-time constant
  const exportReal = useCallback(async () => {
    if (!embeddedAddress) throw new Error("no-embedded-wallet");
    // Opens Privy's cross-origin iframe modal; resolves once the user exits it. The key never touches
    // our code (it lives in the iframe on a separate domain). The caller closes its own dialog BEFORE
    // this runs, so Privy's modal is not left inert under our focus-trap.
    await exportWallet({ address: embeddedAddress });
  }, [exportWallet, embeddedAddress]);

  // biome-ignore lint/correctness/useHookAtTopLevel: build-time constant
  return useMemo(
    () => ({ isMock: false as const, exportReal, canExport: Boolean(embeddedAddress) }),
    [exportReal, embeddedAddress],
  );
}
