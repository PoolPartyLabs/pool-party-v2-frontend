/**
 * @id PP-E2E-SPEC-008 (POO-1081)
 * @name embedded wallet chain switching
 * @implements-rules-version v1
 *
 * The probe that settles POO-1077/1078/1079/1080/1081.
 *
 * A user reported `WRONG_CHAIN` ("Wallet stayed on chain 137 after switching; this transaction
 * targets chain 8453") on a Privy EMBEDDED wallet, and crucially observed that a DIRECT invest on
 * Base switches 137 -> 8453 correctly while the provisioning rail never does. Five fixes shipped on
 * five plausible mechanisms; none was ever demonstrated, because the existing harness injects a viem
 * wallet, which Privy treats as EXTERNAL and which therefore cannot exhibit the behaviour at all.
 *
 * This asks the wallet directly, with NO funds and NO broadcast, which of the levers actually moves
 * an embedded wallet's reported chain:
 *
 *   1. read `eth_chainId`
 *   2. after a fresh `getEthereumProvider()`          <- the rail's old per-request pattern
 *   3. after `wallet.switchChain()` on the same handle <- what `useInvest` does, and it works
 *   4. after `wallet.switchChain()` then a FRESH provider
 *
 * Whichever row moves is the answer; the rest become dead hypotheses instead of deployed guesses.
 * Run headed to watch it: `HEADED=1 pnpm exec playwright test --grep @embedded`.
 */
import { expect, test } from "@playwright/test";
import { loginWithEmbeddedWallet } from "../helpers/embeddedLogin";

const POLYGON = 137;
const BASE = 8453;

test.describe("@embedded Privy embedded wallet chain switching", () => {
  test("reports which lever moves the wallet's chain", async ({ page }) => {
    const logs: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (text.includes("[PP]") || text.includes("chain")) logs.push(text);
    });

    await loginWithEmbeddedWallet(page);

    // Privy exposes the connected wallets on its React context, not on `window`, so the app under
    // test publishes a probe hook in NON-PRODUCTION builds only. Absent it, this reports what it
    // could not reach rather than silently passing.
    const probe = await page.evaluate(
      async (chains) => {
        const hook = (window as unknown as { __ppWalletProbe?: unknown }).__ppWalletProbe;
        if (typeof hook !== "function") return { available: false as const };
        return (await (hook as (c: { from: number; to: number }) => Promise<unknown>)({
          from: chains.polygon,
          to: chains.base,
        })) as {
          available: true;
          initial: string;
          afterFreshProvider: string;
          afterSdkSwitch: string;
          afterSdkSwitchFreshProvider: string;
        };
      },
      { polygon: POLYGON, base: BASE },
    );

    if (!probe.available) {
      test.skip(
        true,
        "__ppWalletProbe is not exposed by this build; deploy a build that includes it",
      );
      return;
    }

    // Recorded for the record: this table IS the finding.
    // eslint-disable-next-line no-console
    console.log("embedded wallet chain probe", probe, logs);

    // The claim under test: after the SDK switch, a freshly fetched provider agrees with it. If this
    // fails, the embedded provider is pinned to the app's configured chain and the rail must stop
    // re-fetching per request, which is exactly what POO-1081 changed.
    expect(probe.afterSdkSwitchFreshProvider).toBe(`0x${BASE.toString(16)}`);
  });
});
