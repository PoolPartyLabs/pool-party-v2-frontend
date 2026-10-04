import { test as base, expect } from "../fixtures";
import { prepareV2Launch } from "../flows/v2Launch";
import { connectAndSignIn } from "../helpers/connect";
import { rehearsalSignInAllowed } from "../helpers/rehearsalSignIn";

const burner = "0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a";
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
      await Promise.race([Promise.all(pending), page.waitForTimeout(5_000)]);
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
    const { draft, name } = await prepareV2Launch(page, info, capture, mark);
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
    await expect(history.locator('a[href*="/tx/0x95785603"]').first()).toBeVisible();
    await expect(history.locator('a[href*="/tx/0x408c9825"]').first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("fund1-history.png"), fullPage: true });
  });
});
