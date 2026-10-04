import { test as base, expect } from "../fixtures";
import { connectAndSignIn } from "../helpers/connect";
import { rehearsalSignInAllowed } from "../helpers/rehearsalSignIn";

const burner = "0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a";
const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const hubPool = "0xfc7b3ad139daaf1e9c3637ed921c154d1b04286f8a82b805a6c352da57028653";
const spokePool = "0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593";
const fund = "0x89625f9e4B3941e503A2f0982c81046d82143e1f";
const test = base.extend<{ nonSpending: undefined }>({
  nonSpending: [
    async ({ page }, use) => {
      const expose = page.exposeFunction.bind(page);
      page.exposeFunction = async (name, callback) =>
        expose(name, async (...args: unknown[]) => {
          const request = args[0] as { method?: string; params?: unknown[] };
          if (name === "__ppWalletBridge") {
            const method = request.method ?? "";
            if (method === "personal_sign") {
              const raw = String(request.params?.[0] ?? "");
              if (!rehearsalSignInAllowed(raw, burner))
                throw new Error("Rehearsal permits SIWE authentication only");
            } else if (
              ![
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
              ].includes(method)
            )
              throw new Error("Non-spending rehearsal blocks signing and broadcast");
            try {
              return await callback(...args);
            } catch {
              throw new Error("Read-only wallet request failed; endpoint details suppressed");
            }
          }
          return callback(...args);
        });
      await use(undefined);
    },
    { auto: true },
  ],
});

test.describe("@v2-launch non-spending demo rehearsal", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.describe.configure({ mode: "serial", timeout: 900_000 });
  test.skip(process.env.E2E_V2_REHEARSAL !== "1", "Opt in to the non-spending deployed rehearsal");

  test("Mandate → Build → fallback Review, stops before Launch", async ({ page, wallet }, info) => {
    const diagnostics: unknown[] = [];
    const pending: Promise<void>[] = [];
    page.on("pageerror", (error) => diagnostics.push({ kind: "pageerror", name: error.name }));
    page.on("console", (message) => {
      if (message.type() === "error")
        diagnostics.push({
          kind: "console",
          type: "error",
          path: message.location().url ? new URL(message.location().url).pathname : null,
        });
    });
    page.on("requestfailed", (request) =>
      diagnostics.push({
        kind: "requestfailed",
        path: new URL(request.url()).pathname,
        method: request.method(),
        failure: request.failure()?.errorText,
      }),
    );
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame())
        diagnostics.push({ kind: "navigation", path: new URL(frame.url()).pathname });
    });
    page.on("response", (response) => {
      if (response.request().method() !== "POST" && response.status() < 400) return;
      const operation = response
        .text()
        .then((body) => {
          diagnostics.push({
            kind: "response",
            path: new URL(response.url()).pathname,
            status: response.status(),
            fields:
              body.match(
                /"(?:ok|status|code|reason|step|error)":(?:true|false|\d+|"[A-Za-z0-9_ -]{0,100}"|\{"status":\d+,"code":"[A-Za-z0-9_]+"\})/g,
              ) ?? [],
          });
        })
        .catch(() => {});
      pending.push(operation);
    });
    const capture = async (label: string) => {
      await Promise.all(pending);
      diagnostics.push({
        kind: "snapshot",
        label,
        path: new URL(page.url()).pathname,
        sessionCookie: (await page.context().cookies()).some(
          (cookie) => cookie.name === "pp_access_token",
        ),
        ...(await page.evaluate(() => ({
          nextButtons: [...document.querySelectorAll("button")]
            .filter((button) => button.textContent?.includes("Next:"))
            .map((button) => ({
              text: button.textContent,
              disabled: button.disabled,
              ariaDisabled: button.getAttribute("aria-disabled"),
            })),
          messages: [...document.querySelectorAll('[role="alert"], [role="status"]')].map(
            (element) => ({
              text: element.textContent?.slice(0, 200),
              label: element.getAttribute("aria-label"),
            }),
          ),
          funnel: (window.dataLayer ?? [])
            .filter((entry) => String(entry.event).startsWith("builder_mandate"))
            .map(({ event, step, reason }) => ({ event, step, reason })),
        }))),
      });
      await info.attach(`mandate-${label}`, {
        body: JSON.stringify(diagnostics, null, 2),
        contentType: "application/json",
      });
    };
    expect(wallet.address.toLowerCase()).toBe(burner.toLowerCase());
    const timings: Array<{ phase: string; seconds: number }> = [];
    let started = Date.now();
    const mark = (phase: string) => {
      timings.push({ phase, seconds: (Date.now() - started) / 1000 });
      started = Date.now();
    };
    await connectAndSignIn(page);
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).some((cookie) => cookie.name === "pp_access_token"),
        { timeout: 60000 },
      )
      .toBe(true);
    await expect(page.getByRole("button", { name: "Open wallet", exact: true })).toBeVisible();
    await page.goto("/en/manager");
    await page.getByRole("button", { name: "V2", exact: true }).click();
    await page.goto("/en/manager/new");
    await page.getByRole("checkbox", { name: "Robinhood Chain", exact: true }).click();
    await capture("before-next");
    await expect(page.getByRole("status", { name: "Loading v2 catalog", exact: true })).toHaveCount(
      0,
      { timeout: 60000 },
    );
    await capture("catalog-ready");
    await expect(page.getByText("The v2 catalog is unavailable.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Next: Protocols", exact: true }).click();
    await capture("after-next");
    await expect(page.locator('[data-mandate-step="protocols"]')).toBeVisible();
    const aave = page.getByRole("checkbox", { name: "Aave v3", exact: true });
    if ((await aave.getAttribute("aria-checked")) !== "true") await aave.click();
    const v4 = page.getByRole("checkbox", { name: "Uniswap v4", exact: true });
    for (const control of await v4.all()) {
      if (
        await control.evaluate((element) =>
          element instanceof HTMLInputElement
            ? !element.checked
            : element.getAttribute("aria-checked") !== "true",
        )
      )
        await control.click();
    }
    await page.getByRole("button", { name: "Next: Tokens", exact: true }).click();
    const tokenCard = page
      .locator('[data-mandate-step="tokens"] [data-mandate-row]')
      .filter({ hasText: /Wrapped Ether/ })
      .first();
    await tokenCard.getByRole("button").first().click();
    await page.getByRole("button", { name: "Next: Pools", exact: true }).click();
    for (const [network, pool] of [
      ["Arbitrum", hubPool],
      ["Robinhood Chain", spokePool],
    ]) {
      await page.getByRole("button", { name: /^Network:/ }).click();
      await page.getByRole("option", { name: network, exact: true }).click();
      await page.getByLabel("Token, pair or pool address", { exact: true }).fill(pool ?? "");
      await page.getByRole("button", { name: "Add", exact: true }).first().click();
    }
    await page.getByRole("button", { name: "Next: Limits", exact: true }).click();
    const noCap = page.getByRole("checkbox", { name: "No cap for Robinhood Chain", exact: true });
    if ((await noCap.getAttribute("aria-checked")) === "true") await noCap.click();
    await page
      .getByRole("slider", { name: "Max share for Robinhood Chain", exact: true })
      .fill("50");
    const now = new Date();
    const name = `Rehearsal ${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
    await page.getByRole("button", { name: "Next: Build strategy", exact: true }).click();
    await page.getByLabel("Draft name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save and continue", exact: true }).click();
    mark("Mandate");
    await expect(
      page.getByRole("heading", { name: "Build your strategy", exact: true }),
    ).toBeVisible();
    for (const kind of [/Uniswap v4 Liquidity position/, /Aave v3 Supply/]) {
      await page.getByRole("button", { name: "Add protocol on Arbitrum", exact: true }).click();
      await page.getByRole("menuitem", { name: kind }).click();
    }
    await page.getByRole("button", { name: "Fit to view", exact: true }).click();
    await page.getByRole("button", { name: "Add network", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Robinhood Chain/ }).click();
    await page
      .getByRole("button", { name: "Add protocol on Robinhood Chain", exact: true })
      .click();
    await page.getByRole("menuitem", { name: /Uniswap v4 Liquidity position/ }).click();
    await page.getByRole("button", { name: "Save & exit", exact: true }).click();
    await expect(page).toHaveURL(/\/manager(?:\?|$)/);
    mark("Build");
    const draft = await page.evaluate(() => {
      const payload = JSON.parse(localStorage.getItem("pp.manager.mandateDrafts.v1") ?? "{}");
      return Object.values(payload.drafts ?? {}).at(-1) as {
        id: string;
        tokens: Array<{ address: string }>;
        pools: Array<{ poolId: string }>;
        aaveV3Reserves: string[];
        spokeCapPercent: number;
      };
    });
    expect(draft.pools.map((pool) => pool.poolId).sort()).toEqual([hubPool, spokePool].sort());
    expect(draft.aaveV3Reserves.map((address) => address.toLowerCase())).toEqual([
      usdc.toLowerCase(),
    ]);
    expect(draft.spokeCapPercent).toBe(50);
    await info.attach("saved-mandate-plan", {
      body: JSON.stringify(draft, null, 2),
      contentType: "application/json",
    });
    const cooldown = Number(process.env.E2E_CATALOG_COOLDOWN_MS ?? 0);
    if (Number.isFinite(cooldown) && cooldown > 0) {
      await page.waitForTimeout(Math.min(cooldown, 120_000));
      mark("Catalog throttle cooldown (not launch waiting)");
    }
    await page.goto("/en/manager");
    await page.getByRole("link", { name: "Review & launch drafts (v2)", exact: true }).click();
    await page.locator(`a[href*="/${draft.id}"]`).filter({ hasText: "Review" }).click();
    await page.getByLabel("Name (10-50 characters)", { exact: true }).fill(name);
    await page.getByLabel("Instant fee (%)", { exact: true }).fill("2");
    await page.getByLabel("Performance fee (%)", { exact: true }).fill("20");
    await page.getByLabel("Management fee (%)", { exact: true }).fill("0");
    await page.getByLabel("Minimum first deposit (USDC)", { exact: true }).fill("2");
    await page.getByLabel("First deposit / seed (USDC)", { exact: true }).fill("2");
    await capture("review");
    await info.attach("review-text", {
      body: await page.locator("main").innerText(),
      contentType: "text/plain",
    });
    await expect(page.getByRole("button", { name: /^Launch · \d+ signatures$/ })).toBeEnabled();
    await page.reload();
    await expect(page.getByLabel("Name (10-50 characters)", { exact: true })).toHaveValue(name);
    await page.screenshot({ path: info.outputPath("review-before-launch.png"), fullPage: true });
    mark("Review");
    await info.attach("prelaunch-evidence", {
      body: JSON.stringify(
        {
          draftId: draft.id,
          name,
          timings,
          signing: "not performed",
          reason: "Human signs real-mainnet financial transactions",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });

  test("fund #1 history includes deposit and Instant payout explorer links", async ({
    page,
    wallet,
  }, info) => {
    expect(wallet.address.toLowerCase()).toBe(burner.toLowerCase());
    await connectAndSignIn(page);
    await expect
      .poll(
        async () =>
          (await page.context().cookies()).some((cookie) => cookie.name === "pp_access_token"),
        { timeout: 60000 },
      )
      .toBe(true);
    await page.goto("/en/strategies");
    await page.getByRole("button", { name: "V2", exact: true }).click();
    await page.goto(`/en/funds/${fund}`);
    const history = page.getByRole("region", { name: "Fund history", exact: true });
    await expect(history).toBeVisible();
    await history.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(history.getByRole("status")).toHaveCount(0);
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const more = history.getByRole("button", { name: "Load more events", exact: true });
      if (!(await more.isVisible())) break;
      await more.click();
      await expect(history.getByRole("status")).toHaveCount(0);
    }
    await expect(history.locator('a[href*="/tx/0x95785603"]')).toBeVisible();
    await expect(history.locator('a[href*="/tx/0x408c9825"]').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("fund1-history.png"), fullPage: true });
  });
});
