import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Locator, Page, TestInfo } from "@playwright/test";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  erc20Abi,
  formatUnits,
  type Hex,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { arbitrum } from "viem/chains";
import { rpcUrl } from "../config";
import { expect, test as walletTest } from "../fixtures";
import { connectAndSignIn } from "./connect";

export const BURNER = "0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a";
export const FUNDS = [
  "0x89625f9e4B3941e503A2f0982c81046d82143e1f",
  "0xc097e204D3C44e8838dd0ab000515C2645c7CC0a",
] as const;
export const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export const EXPLORERS = {
  42161: "https://arbiscan.io",
  4663: "https://robinhoodchain.blockscout.com",
};
const coreAbi = parseAbi([
  "function deposit(uint256 usdcAmount, uint256 minShares) returns (uint256, uint256)",
  "function requestPayout(uint256 usdcAmount, uint8 mode, uint16 maxLossBps) payable",
  "function shareToken() view returns (address)",
]);
const rpc = http(rpcUrl("arbitrum"))({ chain: arbitrum });
export const client = createPublicClient({
  chain: arbitrum,
  transport: custom({
    request: async (request) => {
      try {
        return await rpc.request(request);
      } catch {
        throw new Error("Arbitrum RPC failed; endpoint details suppressed");
      }
    },
  }),
});
const statePath = "e2e/.auth/v2-run.json";
export interface RunState {
  fund?: Hex;
  sharesBefore?: string;
  sharesAfter?: string;
  depositBudget?: string;
  initialUsdc?: string;
  initialEth?: string;
  spent: string;
  transactions: Array<Record<string, string>>;
}
export function state(): RunState {
  return existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : { spent: "0", transactions: [] };
}
export function save(value: RunState) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(value, null, 2));
}
export async function balances() {
  return {
    usdc: await client.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [BURNER],
    }),
    eth: await client.getBalance({ address: BURNER }),
  };
}
export async function shares(fund: Hex) {
  const token = await client.readContract({
    address: fund,
    abi: coreAbi,
    functionName: "shareToken",
  });
  return client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [BURNER],
  });
}
export const test = walletTest.extend<{ safeWallet: undefined }>({
  safeWallet: [
    async ({ page }, use) => {
      const original = page.exposeFunction.bind(page);
      page.exposeFunction = async (name, callback) =>
        original(name, async (...args: unknown[]) => {
          const request = args[0] as {
            method: string;
            params?: Array<{ to?: Hex; data?: Hex; value?: Hex }>;
          };
          if (name !== "__ppWalletBridge" || request.method !== "eth_sendTransaction") {
            try {
              return await callback(...args);
            } catch {
              throw new Error("Wallet request failed; endpoint details suppressed");
            }
          }
          if (process.env.E2E_V2_WRITE !== "1")
            throw new Error("V2 mainnet writes require E2E_V2_WRITE=1");
          if (process.env.E2E_CHAIN !== "arbitrum")
            throw new Error("V2 writes restricted to Arbitrum");
          const transaction = request.params?.[0];
          if (!transaction?.to || !transaction.data)
            throw new Error("Missing transaction target/data");
          const to = transaction.to.toLowerCase();
          const run = state();
          let budget = 0n;
          let action: string;
          if (to === USDC.toLowerCase()) {
            const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
            if (decoded.functionName !== "approve")
              throw new Error("Only USDC approval is allowed");
            const [spender, amount] = decoded.args;
            if (
              !FUNDS.some((fund) => fund.toLowerCase() === spender.toLowerCase()) ||
              amount > 2_200_000n
            ) {
              throw new Error("Approval spender or amount exceeds burner limits");
            }
            action = "approve";
          } else {
            if (!run.fund || to !== run.fund.toLowerCase())
              throw new Error("Transaction is not for selected fund");
            const decoded = decodeFunctionData({ abi: coreAbi, data: transaction.data });
            action = decoded.functionName;
            if (action === "deposit") {
              budget = BigInt(decoded.args?.[0] ?? 0);
              if (run.transactions.some((item) => item.action === "deposit"))
                throw new Error("Deposit already broadcast; refusing duplicate");
              if (budget <= 0n || budget > 2_200_000n || BigInt(run.spent) + budget > 3_000_000n)
                throw new Error("Mainnet USDC budget exceeded");
            } else if (action === "requestPayout") {
              if (!run.sharesAfter) throw new Error("No verified new shares; payout blocked");
              const mode = Number(decoded.args?.[1]);
              const requested = BigInt(decoded.args?.[0] ?? 0);
              if (requested <= 0n || requested > BigInt(run.depositBudget ?? "0") / 2n)
                throw new Error("Payout exceeds half the authorized new deposit budget");
              if (mode !== 0 || run.transactions.some((item) => item.action === "requestPayout"))
                throw new Error("Only one Instant payout is authorized");
            } else throw new Error("Unauthorized fund operation");
          }
          if (BigInt(transaction.value ?? "0") !== 0n)
            throw new Error("Native-value transfers are not authorized");
          const balance = await balances();
          if (balance.eth < parseUnits("0.00002", 18))
            throw new Error("Gas is running short; stop without funding");
          if (balance.usdc < budget) throw new Error("Insufficient burner USDC");
          run.initialUsdc ??= balance.usdc.toString();
          run.initialEth ??= balance.eth.toString();
          run.spent = (BigInt(run.spent) + budget).toString();
          save(run);
          let hash: Hex;
          try {
            hash = await callback(...args);
          } catch {
            throw new Error(
              "Wallet broadcast failed; inspect burner nonce before retrying. RPC details suppressed.",
            );
          }
          run.transactions.push({
            action,
            hash,
            explorer: `${EXPLORERS[42161]}/tx/${hash}`,
            budget: budget.toString(),
          });
          save(run);
          return hash;
        });
      try {
        await use(undefined);
      } finally {
        page.exposeFunction = original;
        const run = state();
        for (const transaction of run.transactions) {
          if (transaction.status) continue;
          try {
            const receipt = await client.waitForTransactionReceipt({
              hash: transaction.hash as Hex,
              timeout: 120_000,
            });
            transaction.status = receipt.status;
            transaction.gasUsed = receipt.gasUsed.toString();
            transaction.gasEth = formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18);
          } catch {
            transaction.status = "unknown; do not resend";
          }
        }
        if (existsSync(statePath)) save(run);
      }
    },
    { auto: true },
  ],
});
export async function openFund(page: Page, fund: Hex) {
  await page.goto(`/en/funds/${fund}`);
  const toggle = page.getByRole("button", { name: /^V2$/ });
  if (await toggle.isVisible()) await toggle.click();
  await expect(page.getByText("Share Price", { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
}
export async function login(page: Page, address: string) {
  if (process.env.E2E_V2_WRITE === "1") expect(address.toLowerCase()).toBe(BURNER.toLowerCase());
  await connectAndSignIn(page);
}
export function actions(page: Page): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Actions", exact: true }) });
}
export async function field(panel: Locator, label: string, decimals = 6) {
  const row = panel
    .locator("dl > div")
    .filter({ has: panel.page().getByText(label, { exact: true }) })
    .first();
  return parseUnits((await row.locator("dd").innerText()).trim(), decimals);
}
export async function prepare(page: Page, name: string, info: TestInfo) {
  const panel = actions(page);
  await panel.getByRole("button", { name, exact: true }).click();
  const ready = panel.getByRole("button", { name: /^(Approve and rebuild|Confirm in wallet)$/ });
  const amount = await panel.getByLabel("Amount (USDC)", { exact: true }).inputValue();
  const minimum = await panel.getByLabel("Minimum whole shares", { exact: true }).inputValue();
  try {
    await expect(ready).toBeVisible({ timeout: 120_000 });
  } catch {
    const message = await panel.innerText();
    if (!/refreshing|stale/i.test(message)) throw new Error(`Frontend build blocked: ${message}`);
    info.annotations.push({
      type: "keeper-wait",
      description: "Stale valuation: waiting at most 12 minutes; retry once before any broadcast",
    });
    await expect(async () => {
      await page.reload();
      await expect(page.getByText(/· Fresh/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ intervals: [30_000], timeout: 720_000 });
    await panel.getByLabel("Amount (USDC)", { exact: true }).fill(amount);
    await panel.getByLabel("Minimum whole shares", { exact: true }).fill(minimum);
    await panel.getByRole("button", { name, exact: true }).click();
    await expect(ready).toBeVisible({ timeout: 120_000 });
  }
}
export async function verifyNewTransactions(page: Page, start: number, info: TestInfo) {
  const run = state();
  for (const transaction of run.transactions.slice(start)) {
    const receipt = await client.waitForTransactionReceipt({
      hash: transaction.hash as Hex,
      timeout: 120_000,
    });
    expect(receipt.status).toBe("success");
    expect(receipt.from.toLowerCase()).toBe(BURNER.toLowerCase());
    const rpc = process.env.E2E_ARBITRUM_RPC_URL;
    if (!rpc) throw new Error("Load Arbitrum RPC via rpc-env.sh before receipt verification");
    let castReceipt: { status: string; from: string };
    try {
      castReceipt = JSON.parse(
        execFileSync("cast", ["receipt", transaction.hash ?? "", "--json", "--rpc-url", rpc], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      );
    } catch {
      throw new Error("cast receipt verification failed; RPC details suppressed");
    }
    expect(castReceipt.status).toMatch(/^(0x1|1)$/);
    expect(castReceipt.from.toLowerCase()).toBe(BURNER.toLowerCase());
    transaction.gasUsed = receipt.gasUsed.toString();
    transaction.gasEth = formatUnits(receipt.gasUsed * receipt.effectiveGasPrice, 18);
    transaction.status = receipt.status;
    save(run);
    if (transaction.action === "deposit" && run.fund) {
      run.sharesAfter = (await shares(run.fund)).toString();
      save(run);
    }
    const link = page.locator(`a[href="${transaction.explorer}"]`);
    await expect(link.first()).toBeVisible();
    await expect(link.first()).toContainText(/0x/);
    await expect(link.first().locator("..")).toContainText(
      /Confirmed in block|Transaction confirmed/,
    );
    await page.screenshot({
      path: info.outputPath(`${transaction.action}-${transaction.hash}.png`),
      fullPage: true,
    });
    await info.attach(`${transaction.action}-receipt`, {
      body: JSON.stringify(transaction, null, 2),
      contentType: "application/json",
    });
  }
}
export { expect, formatUnits, parseUnits };
