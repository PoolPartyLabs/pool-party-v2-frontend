import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { parseUnits } from "viem";
import manager from "../../src/i18n/messages/en/manager.json";
import { test as base, expect } from "../fixtures";
import { prepareV2Launch } from "../flows/v2Launch";
import { rehearsalSignInAllowed } from "../helpers/rehearsalSignIn";

const burner = "0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a";
const dry = process.env.E2E_V2_SIGNED_DRY === "1";
const signingMethods = new Set([
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
]);
type Kind = keyof Pick<
  typeof manager.fundLaunch,
  | "approve"
  | "create"
  | "discover"
  | "spoke"
  | "profile"
  | "allocate"
  | "report"
  | "bridge"
  | "arrival"
  | "swap"
  | "open"
>;
type Step = {
  label: string;
  kind: Kind;
  chainId: number;
  txHash: string | null;
  explorerHref: string | null;
  status: string;
  clickedAt: string | null;
  hashShownAt: string | null;
  confirmedAt: string | null;
  observedAt: string;
  screenshot: string | null;
};
type Guard = { armed: boolean; beforeSignature: () => Promise<void> };
const test = base.extend<{ signingGuard: Guard }>({
  signingGuard: [
    async ({ page }, use) => {
      const guard: Guard = { armed: false, beforeSignature: async () => {} };
      const expose = page.exposeFunction.bind(page);
      page.exposeFunction = async (name, callback) =>
        expose(name, async (...args: unknown[]) => {
          if (name === "__ppWalletBridge") {
            const request = args[0] as { method: string; params?: unknown[] };
            const authentication =
              request.method === "personal_sign" &&
              rehearsalSignInAllowed(String(request.params?.[0] ?? ""), burner);
            if (
              !authentication &&
              (signingMethods.has(request.method) || request.method === "personal_sign")
            ) {
              if (dry || !guard.armed || process.env.E2E_V2_SIGNED !== "1")
                throw new Error("Launch signing is disarmed (dry mode never signs transactions)");
              if (request.method === "eth_sendRawTransaction")
                throw new Error("Only Node-side eth_sendTransaction signing is permitted");
              await guard.beforeSignature();
            }
          }
          return callback(...args);
        });
      await use(guard);
      guard.armed = false;
    },
    { auto: true },
  ],
});

async function readSteps(page: Page): Promise<Step[]> {
  const rows = await page.locator("main section > ol > li").all();
  const steps: Step[] = [];
  for (const row of rows) {
    const heading = row.locator("h2");
    const label = (await heading.count()) ? await heading.innerText() : await row.innerText();
    const [title, chain] = label.split(" · ");
    const kind = (Object.keys(manager.fundLaunch) as Array<keyof typeof manager.fundLaunch>).find(
      (key) => manager.fundLaunch[key] === title,
    ) as Kind | undefined;
    if (!kind) throw new Error(`Unknown launch step: ${label}`);
    const chainId =
      chain === "Arbitrum" ? 42161 : chain === "Robinhood Chain" ? 4663 : Number(chain);
    expect([42161, 4663]).toContain(chainId);
    const link = row.locator('a[href*="/tx/"]').first();
    steps.push({
      label,
      kind,
      chainId,
      txHash: (await link.count()) ? await link.innerText() : null,
      explorerHref: (await link.count()) ? await link.getAttribute("href") : null,
      status: (await heading.count())
        ? await row.locator(":scope > p").first().innerText()
        : "Review preview",
      clickedAt: null,
      hashShownAt: null,
      confirmedAt: null,
      observedAt: new Date().toISOString(),
      screenshot: null,
    });
  }
  expect(steps.length).toBeGreaterThan(0);
  return steps;
}

async function assertReviewSafety(page: Page, address: string) {
  expect(address.toLowerCase(), "Authorized manager wallet only").toBe(burner.toLowerCase());
  const connected = await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        __ppWalletBridge: (request: { method: string }) => Promise<string[]>;
      }
    ).__ppWalletBridge;
    return bridge({ method: "eth_accounts" });
  });
  expect(connected.map((account) => account.toLowerCase())).toEqual([burner.toLowerCase()]);
  const seed = await page.getByLabel("First deposit / seed (USDC)", { exact: true }).inputValue();
  const preview = await page
    .locator("p[aria-live='polite']")
    .filter({ hasText: "Seed preview:" })
    .innerText();
  const fee = preview.match(/, ([\d.]+) USDC fee,/);
  const principal = preview.match(/, ([\d.]+) USDC principal,/);
  if (!fee?.[1] || !principal?.[1])
    throw new Error("Cannot establish seed and flow fee from Review");
  const total = parseUnits(seed, 6) + parseUnits(fee[1], 6);
  expect(parseUnits(principal[1], 6)).toBeLessThanOrEqual(parseUnits(seed, 6));
  expect(total, "Seed plus displayed protocol flow fee exceeds 2.1 USDC").toBeLessThanOrEqual(
    2_100_000n,
  );
  return { seedUsdc: seed, flowFeeUsdc: fee[1], totalUsdcRaw: total.toString(), preview };
}

async function assertLaunchedFund(page: Page, core: string, name: string) {
  for (const route of ["/en/strategies", "/en/manager"]) {
    await page.goto(route);
    await page.getByRole("button", { name: "V2", exact: true }).click();
    await expect(
      page.locator(`a[href*="/funds/${core}"]`).filter({ hasText: name }).first(),
    ).toBeVisible({ timeout: 120_000 });
  }
  await page.goto(`/en/funds/${core}`);
  const positions = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Positions", exact: true }) });
  await expect(positions.locator('a[href*="arbiscan.io/address/"]').first()).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    positions.locator('a[href*="robinhoodchain.blockscout.com/address/"]').first(),
  ).toBeVisible({ timeout: 120_000 });
  const history = page.getByRole("region", { name: "Fund history", exact: true });
  await expect(history).toBeVisible();
  await history.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(history.locator('a[href*="/tx/"]').first()).toBeVisible({ timeout: 120_000 });
}

test.describe("@v2-launch-signed opt-in mainnet launch", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.describe.configure({ mode: "serial", timeout: 90 * 60_000 });
  test.skip(process.env.E2E_V2_SIGNED !== "1", "Human operator must explicitly opt in");

  test("launch with evidence, reload and Resume (or stop at Review in dry mode)", async ({
    page,
    wallet,
    signingGuard,
  }, info) => {
    const evidence: {
      mode: string;
      outcome: string;
      startedAt: string;
      finishedAt?: string;
      review?: Awaited<ReturnType<typeof assertReviewSafety>>;
      launchButton?: string;
      draftId?: string;
      name?: string;
      steps: Step[];
      observations: Array<{ at: string; steps: Step[] }>;
      reloadAt?: string;
      resumeAt?: string;
      coreVault?: string;
      spokeVaults?: string[];
      error?: string;
      uiError?: string;
    } = {
      mode: dry ? "dry" : "signed",
      outcome: "preparing",
      startedAt: new Date().toISOString(),
      steps: [],
      observations: [],
    };
    const evidencePath = path.resolve("test-results/v2-launch-signed-evidence.json");
    await mkdir(path.dirname(evidencePath), { recursive: true });
    const persist = async () => writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    const snapshot = async (clicked = false) => {
      const current = await readSteps(page);
      const active = current.findIndex((step) => step.status !== "Confirmed");
      for (const [index, step] of current.entries()) {
        const previous = evidence.steps[index];
        step.clickedAt =
          previous?.clickedAt ?? (clicked && index === active ? step.observedAt : null);
        step.hashShownAt = previous?.hashShownAt ?? (step.txHash ? step.observedAt : null);
        step.confirmedAt =
          previous?.confirmedAt ?? (step.status === "Confirmed" ? step.observedAt : null);
        step.screenshot = previous?.screenshot ?? null;
        if (
          !previous?.screenshot ||
          previous.status !== step.status ||
          previous.txHash !== step.txHash
        ) {
          step.screenshot = info.outputPath(
            `step-${index + 1}-${step.kind}-${step.status.replace(/\W+/g, "-")}.png`,
          );
          await page
            .locator("main section > ol > li")
            .nth(index)
            .screenshot({ path: step.screenshot });
        }
      }
      evidence.steps = current;
      evidence.observations.push({ at: new Date().toISOString(), steps: current });
      await persist();
    };
    try {
      expect(process.env.E2E_PRIVATE_KEY, "Explicit authorized key required").toBeTruthy();
      expect(wallet.address.toLowerCase()).toBe(burner.toLowerCase());
      const prepared = await prepareV2Launch(page, info);
      evidence.draftId = prepared.draft.id;
      evidence.name = prepared.name;
      evidence.review = await assertReviewSafety(page, wallet.address);
      const launch = page.getByRole("button", { name: /^Launch · \d+ signatures$/ });
      await expect(launch).toBeEnabled();
      evidence.launchButton = await launch.innerText();
      await snapshot();
      if (dry) {
        evidence.outcome = "dry-completed-without-launch";
        return;
      }
      signingGuard.beforeSignature = async () => {
        expect(wallet.address.toLowerCase()).toBe(burner.toLowerCase());
        const accounts = await page.evaluate(async () =>
          (
            window as unknown as {
              __ppWalletBridge: (request: { method: string }) => Promise<string[]>;
            }
          ).__ppWalletBridge({ method: "eth_accounts" }),
        );
        expect(accounts.map((account) => account.toLowerCase())).toEqual([burner.toLowerCase()]);
        await snapshot(true);
      };
      signingGuard.armed = true;
      await launch.click();
      await expect(
        page.getByRole("heading", { name: "Fund launch journey", exact: true }),
      ).toBeVisible();
      evidence.outcome = "running";
      const deadline = Date.now() + 85 * 60_000;
      while (Date.now() < deadline) {
        await snapshot();
        const alerts = await page.locator("main [role='alert']").allTextContents();
        if (alerts.length || evidence.steps.some((step) => step.status === "Failed")) {
          evidence.uiError = alerts.join("\n");
          throw new Error("Launch journey failed; no further signatures will be requested");
        }
        if (
          await page
            .getByRole("status")
            .filter({ hasText: /^Launch completed$/ })
            .isVisible()
        ) {
          evidence.outcome = "completed";
          break;
        }
        if (
          !evidence.reloadAt &&
          evidence.steps.some((step) => step.chainId === 4663 && step.status === "Confirmed")
        ) {
          evidence.reloadAt = new Date().toISOString();
          await persist();
          await page.reload();
          const resume = page.getByRole("button", { name: "Resume journey", exact: true });
          await expect(resume).toBeEnabled();
          evidence.resumeAt = new Date().toISOString();
          await persist();
          await resume.click();
        } else {
          const sign = page.getByRole("button", { name: "Sign next step", exact: true });
          if (await sign.isEnabled()) {
            await snapshot(true);
            await sign.click();
          }
        }
        await page.waitForTimeout(10_000);
      }
      expect(evidence.outcome, "Journey did not complete before deadline").toBe("completed");
      expect(evidence.resumeAt, "Cross-chain reload/Resume was exercised").toBeTruthy();
      const fundLink = page.getByRole("link", { name: "View fund", exact: true });
      evidence.coreVault = (await fundLink.getAttribute("href"))?.match(
        /\/funds\/(0x[\da-f]{40})/i,
      )?.[1];
      const spoke = await page.locator('a[href*="/address/"]').allTextContents();
      evidence.spokeVaults = spoke
        .filter((text) => /^spokeVault:/i.test(text))
        .map((text) => text.split(": ")[1] ?? "");
      expect(evidence.coreVault).toMatch(/^0x[\da-f]{40}$/i);
      expect(evidence.spokeVaults.length).toBeGreaterThan(0);
      for (const address of evidence.spokeVaults) expect(address).toMatch(/^0x[\da-f]{40}$/i);
      await persist();
      signingGuard.armed = false;
      await assertLaunchedFund(page, evidence.coreVault as string, prepared.name);
    } catch (error) {
      evidence.outcome = "failed";
      evidence.error = error instanceof Error ? error.message : "Launch test failed";
      evidence.uiError ??= (
        await page
          .locator("main [role='alert']")
          .allTextContents()
          .catch(() => [])
      ).join("\n");
      throw error;
    } finally {
      signingGuard.armed = false;
      evidence.finishedAt = new Date().toISOString();
      await persist();
      await info.attach("v2-launch-signed-evidence", {
        path: evidencePath,
        contentType: "application/json",
      });
    }
  });
});
