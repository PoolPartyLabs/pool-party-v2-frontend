/**
 * @tests PP-MGR-CMP-108, PP-MGR-HOK-025, PP-MGR-ACT-015 (POO-2262)
 *
 * Dry three-chain launch journey against the LIVE dev API: the v6 launch page builds a real plan
 * (`build-creation`), takes the two EIP-712 consents from a THROWAWAY Manager key (mocked wallet
 * signatures: the key holds nothing and no transaction can follow), asks the API for the signed
 * rebuild, and stops on the seed balance check before any transaction. Every `eth_sendTransaction`,
 * every Solana signature and every Solana broadcast is refused and counted; the test asserts all
 * three counters stay at zero.
 *
 * Opt in: E2E_V2_SOLANA_DRY=1. Needs a real-mode server whose PP_API_URL reaches the dev API and
 * NEXT_PUBLIC_FEATURE_SOLANA_SPOKE=on (local next dev on :3000, or E2E_BASE_URL=https://v2.dev...).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, Route } from "@playwright/test";
import { test as base, expect } from "../fixtures";
import { connectAndSignIn } from "../helpers/connect";
import { rehearsalSignInAllowed } from "../helpers/rehearsalSignIn";

const DRAFT_ID = "e2e-solana-v6";
const DRAFT = JSON.parse(
  readFileSync(join(__dirname, "..", "fixtures", "solana-v6-draft.json"), "utf8"),
) as { key: string; value: string };
// A throwaway, unfunded, on-curve Solana key: it only connects; it never signs.
const SOLANA_ADDRESS = "G3FF47T19t1F1HchVDxgZLNvNS65eWWA8vs5rdyQjP43";
const READS = new Set([
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "net_version",
  "wallet_requestPermissions",
  "wallet_getPermissions",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_watchAsset",
  "eth_call",
  "eth_getBalance",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getLogs",
]);
const counters = {
  evmSendAttempts: 0,
  consentSignatures: [] as string[],
  refusedEvm: [] as string[],
  solanaSignAttempts: [] as string[],
  solanaBroadcasts: 0,
  solanaRpcMethods: [] as string[],
};

const test = base.extend<{ dryWallet: undefined }>({
  dryWallet: [
    async ({ page }, use) => {
      const expose = page.exposeFunction.bind(page);
      page.exposeFunction = async (name, callback) =>
        expose(name, async (...args: unknown[]) => {
          if (name !== "__ppWalletBridge") return callback(...args);
          const request = args[0] as { method?: string; params?: unknown[] };
          const method = request.method ?? "";
          if (method === "personal_sign") {
            const raw = String(request.params?.[0] ?? "");
            const address = String(request.params?.[1] ?? "");
            if (!rehearsalSignInAllowed(raw, address))
              throw new Error("Dry run permits SIWE authentication only");
            return callback(...args);
          }
          if (method === "eth_signTypedData_v4") {
            const typed = JSON.parse(String(request.params?.[1] ?? "{}")) as {
              primaryType?: string;
              domain?: { chainId?: number | string };
            };
            // Mocked consent: a throwaway key signs the two creation consents, nothing else.
            if (
              ["SolanaBootstrap", "SolanaSwapPolicy"].includes(typed.primaryType ?? "") &&
              Number(typed.domain?.chainId) === 42161
            ) {
              counters.consentSignatures.push(typed.primaryType ?? "");
              return callback(...args);
            }
          }
          if (method === "eth_sendTransaction") counters.evmSendAttempts += 1;
          if (!READS.has(method)) {
            counters.refusedEvm.push(method);
            throw new Error("Dry run refuses every financial signature and broadcast");
          }
          return callback(...args);
        });
      await use(undefined);
    },
    { auto: true },
  ],
});

async function installSolanaWallet(page: Page) {
  await page.exposeFunction("__ppSolanaSignAttempt", (feature: string) => {
    counters.solanaSignAttempts.push(feature);
  });
  await page.addInitScript((address) => {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let value = BigInt(0);
    for (const character of address)
      value = value * BigInt(58) + BigInt(alphabet.indexOf(character));
    const publicKey = new Uint8Array(32);
    for (let index = 31; index >= 0; index -= 1) {
      publicKey[index] = Number(value & BigInt(255));
      value >>= BigInt(8);
    }
    const w = window as unknown as Record<string, unknown>;
    const listeners: Record<string, ((value: unknown) => void)[]> = { change: [] };
    let accounts: unknown[] = [];
    const account = Object.freeze({
      address,
      publicKey,
      chains: ["solana:mainnet"],
      features: ["solana:signTransaction", "solana:signMessage", "solana:signAndSendTransaction"],
      label: "E2E Solana",
    });
    const refuse = (feature: string) => async () => {
      await (w.__ppSolanaSignAttempt as (value: string) => Promise<void>)(feature);
      throw new Error("E2E Solana signing disarmed");
    };
    const wallet = {
      version: "1.0.0",
      name: "E2E Solana Wallet",
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=",
      chains: ["solana:mainnet"],
      get accounts() {
        return accounts;
      },
      features: {
        "standard:connect": {
          version: "1.0.0",
          connect: async () => {
            accounts = [account];
            for (const listener of listeners.change ?? []) listener({ accounts });
            return { accounts };
          },
        },
        "standard:disconnect": {
          version: "1.0.0",
          disconnect: async () => {
            accounts = [];
          },
        },
        "standard:events": {
          version: "1.0.0",
          on: (event: string, listener: (value: unknown) => void) => {
            listeners[event] = [...(listeners[event] ?? []), listener];
            return () => {
              listeners[event] = (listeners[event] ?? []).filter((entry) => entry !== listener);
            };
          },
        },
        "solana:signTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signTransaction: refuse("solana:signTransaction"),
        },
        "solana:signAndSendTransaction": {
          version: "1.0.0",
          supportedTransactionVersions: ["legacy", 0],
          signAndSendTransaction: refuse("solana:signAndSendTransaction"),
        },
        "solana:signMessage": { version: "1.0.0", signMessage: refuse("solana:signMessage") },
      },
    };
    const register = (api: { register: (entry: unknown) => void }) => api.register(wallet);
    try {
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", { detail: register }),
      );
    } catch {}
    window.addEventListener("wallet-standard:app-ready", (event) =>
      register((event as CustomEvent).detail),
    );
  }, SOLANA_ADDRESS);
}

async function guardSolanaRpc(page: Page) {
  await page.route("**/api/solana-rpc", async (route: Route) => {
    const body = route.request().postDataJSON() as { method?: string; id?: unknown };
    counters.solanaRpcMethods.push(body.method ?? "");
    if (body.method === "sendTransaction") {
      counters.solanaBroadcasts += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: body.id ?? 1,
          error: { code: -32002, message: "dry run" },
        }),
      });
    }
    return route.continue();
  });
}

async function seedDraft(page: Page) {
  await page.addInitScript((draft) => {
    if (!localStorage.getItem(draft.key)) localStorage.setItem(draft.key, draft.value);
  }, DRAFT);
}

function stepRow(page: Page, label: string) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByText(label, { exact: false }) })
    .first();
}

test.describe("@v2-solana-launch dry three-chain launch against the live dev API", () => {
  test.describe.configure({ mode: "serial", timeout: 600_000 });
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.skip(process.env.E2E_V2_SOLANA_DRY !== "1", "Opt in with E2E_V2_SOLANA_DRY=1");

  test("Review routes to the v6 page; the plan, consents and signed rebuild run, nothing is sent", async ({
    page,
    wallet,
  }, info) => {
    const evidence: Record<string, unknown> = { manager: wallet.address };
    await installSolanaWallet(page);
    await guardSolanaRpc(page);
    await seedDraft(page);
    await connectAndSignIn(page);

    // Review: the Solana plan is not blocked and names the v6 journey.
    await page.goto(`/en/manager/new?draft=${DRAFT_ID}&phase=review`);
    const reviewSummary = page.getByText(/Launch opens the Solana journey/i);
    evidence.reviewSummaryVisible = await reviewSummary
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => true)
      .catch(() => false);

    // The v6 launch page.
    await page.goto(`/en/manager/fund-launch/solana/${DRAFT_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Solana Demo Fund", {
      timeout: 60_000,
    });
    // DEC-204: the stock tokens are listed, flagged unavailable (live creation-options).
    for (const stock of ["TSLAx", "NVDAx"])
      await expect(page.getByText(new RegExp(`^${stock} · Unavailable$`))).toBeVisible({
        timeout: 60_000,
      });
    await expect(page.getByText(/^SOL$/)).toBeVisible();

    // Connect the Manager's Solana wallet through Privy (detected_solana_wallets).
    await page.getByRole("button", { name: "Connect Solana wallet" }).click();
    const option = page.getByRole("button", { name: /E2E Solana Wallet/ }).first();
    await option.waitFor({ state: "visible", timeout: 30_000 });
    await option.click();
    await expect(page.getByText(SOLANA_ADDRESS)).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape").catch(() => {});

    // Typed launch amounts (API #198): 2 USDC seed, minimum and spoke cap.
    const seed = page.getByLabel("Seed (your first deposit)");
    await expect(seed).toHaveValue("2");
    await page.getByRole("button", { name: "Create the Fund" }).click();

    // The live API builds the plan; the predicted accounts come from it.
    await expect(stepRow(page, "Build the plan").getByRole("status")).toHaveText("Done", {
      timeout: 120_000,
    });
    await expect(page.getByText("Fund accounts (predicted)")).toBeVisible();
    const core = await page
      .getByRole("link", { name: /^0x[0-9a-fA-F]{40}$/ })
      .first()
      .textContent();
    evidence.predictedCore = core;
    await expect(stepRow(page, "Sign the Solana binding").getByRole("status")).toHaveText("Done", {
      timeout: 60_000,
    });
    await expect(stepRow(page, "Sign the swap policy").getByRole("status")).toHaveText("Done", {
      timeout: 60_000,
    });
    // The signed rebuild runs, then the throwaway Manager's empty USDC balance stops the launch.
    await expect(
      page.getByText("The Manager wallet does not hold the seed in USDC on Arbitrum."),
    ).toBeVisible({ timeout: 120_000 });
    await expect(stepRow(page, "Approve the seed").getByRole("status")).toHaveText("Failed");
    await expect(stepRow(page, "Create the Fund").getByRole("status")).toHaveText("Pending");

    evidence.counters = counters;
    evidence.steps = await page.evaluate(
      ([prefix]) => {
        const key = Object.keys(localStorage).find((entry) => entry.startsWith(prefix));
        if (!key) return null;
        const state = JSON.parse(localStorage.getItem(key) ?? "{}") as {
          steps?: Record<string, { status: string; error?: string }>;
          request?: unknown;
        };
        return { steps: state.steps, request: state.request };
      },
      ["pp:v2:solana-launch:1:"],
    );
    await page.screenshot({ path: info.outputPath("solana-launch-dry.png"), fullPage: true });
    await info.attach("evidence", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });

    expect(counters.consentSignatures.sort()).toEqual(["SolanaBootstrap", "SolanaSwapPolicy"]);
    expect(counters.evmSendAttempts).toBe(0);
    expect(counters.solanaSignAttempts).toEqual([]);
    expect(counters.solanaBroadcasts).toBe(0);
  });

  test("the live three-chain demo Fund shows its Solana spoke", async ({ page }) => {
    await page.goto("/en/strategies/0x1E45E497a734b3BcD67e514F0681F161EC78a718");
    await expect(page.getByText(/Solana/).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Robinhood/).first()).toBeVisible();
  });
});
