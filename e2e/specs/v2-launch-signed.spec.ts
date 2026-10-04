/**
 * @id PP-E2E-V2-003
 * @name opt-in v2 launch E2E
 * @implements-rules-version v3 (POO-2192)
 */
import { chmod, mkdir, open, readFile, writeFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { parseUnits } from "viem";
import type { FundLaunchDraft } from "../../src/features/manager/fund/launch/contracts";
import { deriveLaunchSteps } from "../../src/features/manager/fund/launch/plan";
import manager from "../../src/i18n/messages/en/manager.json";
import { test as base, expect } from "../fixtures";
import { prepareV2Launch } from "../flows/v2Launch";
import {
  assertV2LaunchSigningAllowed,
  safeV2WalletCall,
  v2LaunchFailure,
  v2LaunchMode,
  v2LaunchResumeState,
  v2LaunchStepLabel,
} from "../helpers/v2LaunchSigning";

const burner = "0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a";
const mode = v2LaunchMode(process.env.E2E_V2_SIGNED_DRY);
const resumeStatePath = process.env.E2E_V2_RESUME_STATE;
const drySeed =
  mode === "dry-launch" && process.env.E2E_V2_NO_SIGN === "1"
    ? process.env.E2E_V2_DRY_SEED_USDC
    : undefined;

function launchRows(page: Page) {
  return page.locator('main section ol[aria-live="polite"] > li');
}
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
        expose(name, async (...args: unknown[]) =>
          safeV2WalletCall(async () => {
            if (name === "__ppWalletBridge") {
              const request = args[0] as { method: string; params?: unknown[] };
              if (
                assertV2LaunchSigningAllowed(
                  request,
                  burner,
                  mode,
                  guard.armed,
                  process.env.E2E_V2_SIGNED,
                  process.env.E2E_V2_NO_SIGN,
                )
              ) {
                await guard.beforeSignature();
              }
            }
            return callback(...args);
          }),
        );
      await use(guard);
      guard.armed = false;
    },
    { auto: true },
  ],
});

async function readSteps(page: Page): Promise<Step[]> {
  if (await page.getByRole("heading", { name: "Review your strategy", exact: true }).count()) {
    const draft = await page.evaluate(() => {
      const payload = JSON.parse(localStorage.getItem("pp.manager.mandateDrafts.v1") ?? "{}");
      return Object.values(payload.drafts ?? {}).at(-1) as FundLaunchDraft;
    });
    return deriveLaunchSteps(
      draft.plan,
      draft.launchExecution ?? {},
      true,
      draft.networks.includes("robinhood"),
    ).map((step) => ({
      label: v2LaunchStepLabel(manager.fundLaunch[step.kind], step.chain),
      kind: step.kind,
      chainId: step.chain,
      txHash: null,
      explorerHref: null,
      status: "Review preview",
      clickedAt: null,
      hashShownAt: null,
      confirmedAt: null,
      observedAt: new Date().toISOString(),
      screenshot: null,
    }));
  }
  const rows = await launchRows(page).all();
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
  const statuses = new Set([
    "Review preview",
    ...["idle", "building", "signing", "submitted", "waiting", "confirmed", "failed"].map(
      (key) => manager.fundLaunch[key as keyof typeof manager.fundLaunch],
    ),
  ]);
  for (const step of steps)
    if (!statuses.has(step.status)) throw new Error("V2_LAUNCH_UNKNOWN_STATUS");
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
  const muriloReview = await page.getByLabel("First deposit amount", { exact: true }).count();
  const seed = await page
    .getByLabel(muriloReview ? "First deposit amount" : "First deposit / seed (USDC)", {
      exact: true,
    })
    .inputValue();
  const preview = muriloReview
    ? await page
        .locator('[aria-live="polite"]')
        .filter({ hasText: "Estimate before signing" })
        .innerText()
    : await page.locator("p[aria-live='polite']").filter({ hasText: "Seed preview:" }).innerText();
  const fee = preview.match(muriloReview ? /Protocol fee\s+([\d.]+) USDC/ : /, ([\d.]+) USDC fee,/);
  const principal = muriloReview ? ["", seed] : preview.match(/, ([\d.]+) USDC principal,/);
  if (!fee?.[1] || !principal?.[1])
    throw new Error("Cannot establish seed and flow fee from Review");
  const total = parseUnits(seed, 6) + parseUnits(fee[1], 6);
  expect(parseUnits(principal[1], 6)).toBeLessThanOrEqual(parseUnits(seed, 6));
  if (drySeed) expect(seed).toBe(drySeed);
  expect(
    total,
    "Seed plus displayed protocol flow fee exceeds authorized ceiling",
  ).toBeLessThanOrEqual(drySeed ? 10_100_000n : 2_100_000n);
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
  test.use({
    viewport: { width: 1920, height: 1080 },
    storageState: process.env.E2E_V2_RESUME_STATE ?? process.env.E2E_V2_AUTH_STATE,
  });
  test.describe.configure({ mode: "serial", timeout: 90 * 60_000 });
  test.skip(process.env.E2E_V2_SIGNED !== "1", "Human operator must explicitly opt in");

  test("launch with evidence, reload and Resume (or stop before signing in dry modes)", async ({
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
      launchClickedAt?: string;
      signNextEnabled?: boolean;
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
      mode,
      outcome: "preparing",
      startedAt: new Date().toISOString(),
      steps: [],
      observations: [],
    };
    const evidencePath =
      mode === "dry-launch"
        ? info.outputPath("v2-launch-dry-launch-evidence.json")
        : info.outputPath("v2-launch-signed-evidence.json");
    await mkdir(info.outputDir, { recursive: true });
    const persist = async () => writeFile(evidencePath, JSON.stringify(evidence, null, 2));
    const storageDir = info.outputPath("storage-evidence");
    await mkdir(storageDir, { recursive: true, mode: 0o700 });
    await chmod(storageDir, 0o700);
    let checkpointSequence = 0;
    let checkpointQueue = Promise.resolve();
    let checkpointFailed = false;
    const checkpoint = (label: string) => {
      checkpointQueue = checkpointQueue
        .then(async () => {
          const state = JSON.stringify(await page.context().storageState(), null, 2);
          const filename = `${String(++checkpointSequence).padStart(4, "0")}-${label.replace(/[^\w-]/g, "-")}.json`;
          for (const path of [`${storageDir}/${filename}`, `${storageDir}/storage-state.json`]) {
            const handle = await open(path, "w", 0o600);
            try {
              await handle.chmod(0o600);
              await handle.writeFile(state);
            } finally {
              await handle.close();
            }
          }
        })
        .catch(() => {
          checkpointFailed = true;
        });
      return checkpointQueue;
    };
    await page.exposeFunction("__ppV2StorageCheckpoint", (label: string) =>
      checkpoint(
        /^(step-\d+-(approve|create|discover|spoke|profile|allocate|report|bridge|arrival|swap|open)-(idle|building|signing|submitted|waiting|confirmed|failed)|journal-changed)$/.test(
          label,
        )
          ? label
          : "journal-changed",
      ),
    );
    await page.addInitScript(() => {
      const observed = new Map<string, string>();
      window.addEventListener("pp:v2:launch-changed", () => {
        const notify = (
          window as unknown as {
            __ppV2StorageCheckpoint: (label: string) => Promise<void>;
          }
        ).__ppV2StorageCheckpoint;
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (!key?.startsWith("pp:v2:launch:1:")) continue;
          try {
            const journal = JSON.parse(localStorage.getItem(key) ?? "null") as {
              steps: Array<{ id: string; kind: string }>;
              checkpoints: Record<string, { status: string }>;
            };
            for (const [stepIndex, step] of journal.steps.entries()) {
              const status = journal.checkpoints[step.id]?.status ?? "idle";
              const identity = `${key}:${step.id}`;
              if (observed.get(identity) === status) continue;
              observed.set(identity, status);
              void notify(`step-${stepIndex + 1}-${step.kind}-${status}`).catch(() => {});
            }
          } catch {
            void notify("journal-changed").catch(() => {});
          }
        }
      });
    });
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
        if (step.status === "Confirmed" && previous?.status !== "Confirmed")
          await checkpoint(`step-${index + 1}-${step.kind}-confirmed-observed`);
        if (
          !previous?.screenshot ||
          previous.status !== step.status ||
          previous.txHash !== step.txHash
        ) {
          step.screenshot = info.outputPath(
            `step-${index + 1}-${step.kind}-${step.status.replace(/\W+/g, "-")}.png`,
          );
          const rows = launchRows(page);
          const isReview = await page
            .getByRole("heading", { name: "Review your strategy", exact: true })
            .count();
          await (isReview ? page.locator("main") : rows.nth(index)).screenshot({
            path: step.screenshot,
          });
        }
      }
      evidence.steps = current;
      evidence.observations.push({ at: new Date().toISOString(), steps: current });
      await persist();
      await checkpointQueue;
      expect(checkpointFailed, "V2_LAUNCH_STORAGE_CHECKPOINT_FAILED").toBe(false);
    };
    try {
      expect(process.env.E2E_PRIVATE_KEY, "Explicit authorized key required").toBeTruthy();
      expect(wallet.address.toLowerCase()).toBe(burner.toLowerCase());
      let resumed: ReturnType<typeof v2LaunchResumeState> | undefined;
      if (resumeStatePath) {
        resumed = v2LaunchResumeState(
          JSON.parse(await readFile(resumeStatePath, "utf8")),
          process.env.E2E_BASE_URL ?? "http://localhost:3000",
          burner,
        );
        expect(
          BigInt(resumed.totalUsdcRaw),
          "Frozen seed plus flow fee exceeds 2.1 USDC",
        ).toBeLessThanOrEqual(2_100_000n);
        evidence.draftId = resumed.draftId;
        evidence.name = resumed.name;
        await page.goto(resumed.path);
        await expect(page).toHaveURL((url) => url.pathname === resumed?.path);
        await expect(
          page.getByRole("heading", { name: "Fund launch journey", exact: true }),
        ).toBeVisible();
        expect(
          v2LaunchResumeState(await page.context().storageState(), page.url(), burner),
        ).toEqual(resumed);
        await checkpoint("resume-loaded");
      } else {
        const prepared = await prepareV2Launch(page, info);
        evidence.draftId = prepared.draft.id;
        evidence.name = prepared.name;
        evidence.review = await assertReviewSafety(page, wallet.address);
        await checkpoint("review-ready");
      }
      const launch = page.getByRole("button", {
        name: /^Launch · \d+ signatures$|^Launch strategy$/,
      });
      if (!resumed) {
        await expect(launch).toBeEnabled();
        evidence.launchButton = await launch.innerText();
      }
      await snapshot();
      if (mode === "dry") {
        evidence.outcome = "dry-completed-without-launch";
        return;
      }
      if (mode === "dry-launch" && !resumed) {
        const expectedSteps: Array<[Kind, number]> = [
          ["approve", 42161],
          ["create", 42161],
          ["discover", 42161],
          ["spoke", 4663],
          ["discover", 4663],
          ["profile", 42161],
          ["allocate", 42161],
          ["swap", 42161],
          ["open", 42161],
          ["open", 42161],
          ["report", 42161],
          ["bridge", 42161],
          ["arrival", 4663],
          ["swap", 4663],
          ["open", 4663],
        ];
        expect(evidence.steps.map((step) => [step.kind, step.chainId])).toEqual(expectedSteps);
        const expectedLabels = evidence.steps.map((step) =>
          v2LaunchStepLabel(manager.fundLaunch[step.kind], step.chainId),
        );
        expect(signingGuard.armed).toBe(false);
        await launch.click();
        evidence.launchClickedAt = new Date().toISOString();
        await expect(page).toHaveURL(/\/manager\/fund-launch\/[^/?]+/);
        await expect(
          page.getByRole("heading", { name: "Fund launch journey", exact: true }),
        ).toBeVisible();
        const rows = launchRows(page);
        await expect(rows).toHaveCount(expectedSteps.length);
        await expect(rows.locator("h2")).toHaveText(expectedLabels);
        const sign = page.getByRole("button", { name: "Sign next step", exact: true });
        await expect(sign).toBeEnabled();
        await page.screenshot({
          path: info.outputPath("murilo-launch-journey.png"),
          fullPage: true,
        });
        evidence.signNextEnabled = true;
        await snapshot();
        const frozenDraft = await page.evaluate(() => {
          const journeyId = decodeURIComponent(location.pathname.split("/").at(-1) ?? "");
          return JSON.parse(localStorage.getItem(`pp:v2:journey:1:${journeyId}`) ?? "{}")
            .draft as FundLaunchDraft;
        });
        const configuredSteps = deriveLaunchSteps(
          frozenDraft.plan,
          frozenDraft.launchExecution ?? {},
          true,
          frozenDraft.networks.includes("robinhood"),
        );
        expect(frozenDraft.plan.hub.chains.map((chain) => chain.sharePct)).toEqual([30, 30]);
        expect(frozenDraft.plan.spokes[0]?.sharePct).toBe(40);
        const pools = configuredSteps.filter(
          (step) => step.kind === "open" && step.protocol === "uniswap-v4",
        );
        expect(pools.map((step) => step.config?.maxLossBps)).toEqual([50, 100]);
        for (const pool of pools) {
          const chains =
            pool.chain === 42161
              ? frozenDraft.plan.hub.chains
              : (frozenDraft.plan.spokes[0]?.chains ?? []);
          const panelStep = chains
            .flatMap((chain) => chain.steps)
            .find((step) => step.id === pool.blockId);
          const panelConfig =
            panelStep?.family === "position" && panelStep.kind === "uniswapV4Pool"
              ? panelStep.config
              : undefined;
          expect(pool.config?.tickLower).toBe(panelConfig?.tickLower);
          expect(pool.config?.tickUpper).toBe(panelConfig?.tickUpper);
          expect(pool.config?.tickLower).toBeLessThan(pool.config?.tickUpper ?? 0);
        }
        await info.attach("panel-derived-launch-steps", {
          body: JSON.stringify(configuredSteps, null, 2),
          contentType: "application/json",
        });
        expect(evidence.steps.map((step) => [step.kind, step.chainId])).toEqual(expectedSteps);
        for (const step of evidence.steps) {
          expect(step.status).toBe(manager.fundLaunch.idle);
          expect(step.txHash).toBeNull();
          expect(step.clickedAt).toBeNull();
        }
        expect(signingGuard.armed).toBe(false);
        evidence.outcome = "dry-launch-completed-without-signing";
        return;
      }
      if (mode === "dry-launch") {
        expect(signingGuard.armed).toBe(false);
        evidence.outcome = "dry-resume-inspected-without-signing";
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
        v2LaunchResumeState(await page.context().storageState(), page.url(), burner);
        await snapshot(true);
      };
      signingGuard.armed = true;
      if (resumed) {
        const resume = page.getByRole("button", {
          name: resumed.failed ? "Retry failed step" : "Resume journey",
          exact: true,
        });
        await expect(resume).toBeEnabled();
        evidence.resumeAt = new Date().toISOString();
        await checkpoint(resumed.failed ? "before-retry" : "before-resume");
        await resume.click();
      } else {
        await launch.click();
      }
      await expect(
        page.getByRole("heading", { name: "Fund launch journey", exact: true }),
      ).toBeVisible();
      evidence.outcome = "running";
      const deadline = Date.now() + 85 * 60_000;
      while (Date.now() < deadline) {
        await snapshot();
        const alerts = await page.locator("main [role='alert']").allTextContents();
        if (alerts.length || evidence.steps.some((step) => step.status === "Failed")) {
          evidence.uiError = "V2_LAUNCH_UI_ERROR";
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
          !resumed &&
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
      await assertLaunchedFund(page, evidence.coreVault as string, evidence.name as string);
    } catch {
      evidence.outcome = "failed";
      const alerts = await page
        .locator("main [role='alert']")
        .allTextContents()
        .catch(() => []);
      Object.assign(evidence, v2LaunchFailure(alerts.length > 0));
      throw new Error("V2_LAUNCH_FAILED");
    } finally {
      signingGuard.armed = false;
      evidence.finishedAt = new Date().toISOString();
      await checkpoint(evidence.outcome === "failed" ? "failure" : "final");
      await persist();
      await info.attach("v2-launch-signed-evidence", {
        path: evidencePath,
        contentType: "application/json",
      });
      expect(checkpointFailed, "V2_LAUNCH_STORAGE_CHECKPOINT_FAILED").toBe(false);
    }
  });
});
