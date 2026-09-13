/** @id PP-CP-E2E-001 @name Real Cash+ fork investor journey @implements-rules-version v1 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Address, createPublicClient, http } from "viem";
import { requireLocalForkUrl } from "../../scripts/cash-plus/compiler";
import { cashPlusVaultAbi } from "../../src/lib/cash-plus/abi/CashPlusVault";
import { parseCashPlusDeployment } from "../../src/lib/cash-plus/config/deployments";

const manifest = parseCashPlusDeployment(
  JSON.parse(readFileSync(resolve("src/lib/cash-plus/config/deployment.generated.json"), "utf8")),
);
const state = JSON.parse(readFileSync(resolve("scripts/cash-plus/.local/state.json"), "utf8"));
if (manifest.mode !== "fork" || manifest.chainId !== 31337) throw new Error("LOCAL_FORK_REQUIRED");
const rpc = requireLocalForkUrl(manifest.rpcUrl),
  owner = state.actors.investor as Address;
const client = createPublicClient({ transport: http(rpc) }),
  vault = manifest.vault as Address;
const output = resolve("../../outputs/cash-plus-evidence");
async function wallet(page: Page) {
  await page.addInitScript(
    ({ rpc, owner }) => {
      const provider = {
        async request({ method, params }: { method: string; params?: unknown[] }) {
          if (method === "eth_accounts" || method === "eth_requestAccounts") return [owner];
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "eth_sendTransaction") {
            const tx = params?.[0] as { from?: string };
            if (tx.from?.toLowerCase() !== owner.toLowerCase())
              throw new Error("Wrong demo account");
          }
          if (
            ![
              "eth_chainId",
              "eth_sendTransaction",
              "eth_getTransactionReceipt",
              "eth_getTransactionByHash",
              "eth_estimateGas",
            ].includes(method)
          )
            throw new Error(`Unsupported wallet method ${method}`);
          const response = await fetch(rpc, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
          });
          const body = await response.json();
          if (body.error)
            throw Object.assign(new Error(body.error.message), { code: body.error.code });
          return body.result;
        },
        on() {},
        removeListener() {},
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
    },
    { rpc, owner },
  );
}
async function capture(page: Page, name: string) {
  await page.screenshot({
    path: resolve(output, `${name}.png`),
    fullPage: !/(review|success|pending)/.test(name),
  });
}
test("invest → observed lending/conversion → withdraw on the official-protocol fork", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await wallet(page);
  await page.goto("/en/cash-plus", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Decline", exact: true })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(page.getByRole("heading", { name: "Invest in Cash+", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review investment", exact: true })).toBeEnabled();
  await capture(page, "fork-connected-before-investment-1440");
  const before = await client.readContract({
    address: vault,
    abi: cashPlusVaultAbi,
    functionName: "sharesOf",
    args: [owner],
  });
  await page.getByLabel("Amount in USDC", { exact: true }).fill("1000");
  await page.getByRole("button", { name: "Review investment", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm transaction", exact: true }),
  ).toBeEnabled();
  await capture(page, "deposit-review-1440");
  let releaseReceipt: () => void = () => {};
  const receiptGate = new Promise<void>((resolve) => {
    releaseReceipt = resolve;
  });
  let held = false;
  await page.route(`${rpc}**`, async (route) => {
    const data = route.request().postDataJSON();
    if (data?.method === "eth_getTransactionReceipt" && !held) {
      held = true;
      await receiptGate;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Confirm transaction", exact: true }).click();
  try {
    await expect(
      page.getByRole("heading", { name: "Transaction submitted", exact: true }),
    ).toBeVisible();
    await capture(page, "deposit-pending-1440");
  } finally {
    releaseReceipt();
  }
  await expect(
    page.getByRole("heading", { name: "Transaction confirmed", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await capture(page, "deposit-success-1440");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const funded = await client.readContract({
    address: vault,
    abi: cashPlusVaultAbi,
    functionName: "sharesOf",
    args: [owner],
  });
  expect(funded > before).toBe(true);
  execFileSync("pnpm", ["cash-plus:keeper", "--once"], { stdio: "pipe", timeout: 45000 });
  execFileSync("pnpm", ["cash-plus:counterparty", "--scenario", "normal", "--amount", "10"], {
    stdio: "pipe",
    timeout: 45000,
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Stablecoin conversion", { exact: true }).first()).toBeVisible();
  await capture(page, "invested-after-conversion-1440");
  for (const width of [360, 390, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await capture(page, `invested-${width}`);
    await page.screenshot({ path: resolve(output, `invested-viewport-${width}.png`) });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: "Review withdrawal", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Confirm transaction", exact: true }),
  ).toBeEnabled();
  await capture(page, "withdraw-review-1440");
  await page.getByRole("button", { name: "Confirm transaction", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transaction confirmed", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await capture(page, "withdraw-success-1440");
  const final = await client.readContract({
    address: vault,
    abi: cashPlusVaultAbi,
    functionName: "sharesOf",
    args: [owner],
  });
  expect(final).toBe(BigInt(0));
  writeFileSync(
    resolve(output, "ui-rehearsal.json"),
    JSON.stringify(
      {
        runId: manifest.runId,
        vault,
        owner,
        sharesBefore: before.toString(),
        sharesAfterDeposit: funded.toString(),
        sharesAfterExit: final.toString(),
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
});
