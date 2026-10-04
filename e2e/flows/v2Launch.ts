import type { Page, TestInfo } from "@playwright/test";
import type { FundLaunchDraft } from "../../src/features/manager/fund/launch/contracts";
import { expect } from "../fixtures";
import { connectAndSignIn } from "../helpers/connect";

const usdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const hubPool = "0xfc7b3ad139daaf1e9c3637ed921c154d1b04286f8a82b805a6c352da57028653";
const spokePool = "0xfcfae8fa0bd6da961bcf5d990f27690932deac4f093e99bf3e871691c6586593";

export async function prepareV2Launch(
  page: Page,
  info: TestInfo,
  capture: (label: string) => Promise<void> = async () => {},
  mark: (phase: string) => void = () => {},
) {
  if (process.env.E2E_V2_AUTH_STATE) {
    expect(
      (await page.context().cookies()).some((cookie) => cookie.name === "pp_access_token"),
      "E2E_V2_AUTH_STATE must contain an authenticated cookie; no SIWE fallback",
    ).toBe(true);
    await page.goto("/en/manager");
    await expect(page).not.toHaveURL(/sign-in/);
  } else {
    await connectAndSignIn(page);
  }
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
  await page.getByRole("slider", { name: "Max share for Robinhood Chain", exact: true }).fill("50");
  for (const control of await page
    .getByRole("checkbox", { name: /^No cap for (Aave v3|Uniswap v4|WETH on)/ })
    .all()) {
    if ((await control.getAttribute("aria-checked")) !== "true") await control.click();
  }
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
    const panel = page.locator("[data-block-panel]");
    await panel
      .getByRole("button", {
        name: kind.source.startsWith("Uniswap")
          ? /^Use .*USDC.*WETH|^Use .*WETH.*USDC/
          : "Use USDC",
      })
      .click();
    const allocation = panel.getByRole("slider", { name: "Allocation", exact: true });
    await allocation.press("Home");
    for (let increment = 0; increment < 6; increment++) await allocation.press("ArrowRight");
    await expect(allocation).toHaveAttribute("aria-valuenow", "30");
    if (kind.source.startsWith("Uniswap")) {
      await panel
        .locator("[data-price-range]")
        .getByRole("button", { name: "±10%", exact: true })
        .click();
      await panel
        .locator("[data-fund-slippage]")
        .getByRole("button", { name: "0.5%", exact: true })
        .click();
    }
    await panel.getByRole("button", { name: "Apply changes", exact: true }).click();
    await expect(panel.getByText("All changes applied", { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath(
        kind.source.startsWith("Uniswap") ? "panel-uniswap-arbitrum.png" : "panel-aave-usdc.png",
      ),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Fit to view", exact: true }).click();
  await page.getByRole("button", { name: "Add network", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Robinhood Chain/ }).click();
  await page.getByRole("button", { name: "Add protocol on Robinhood Chain", exact: true }).click();
  await page.getByRole("menuitem", { name: /Uniswap v4 Liquidity position/ }).click();
  const spokePanel = page.locator("[data-block-panel]");
  await spokePanel.getByRole("button", { name: /^Use / }).first().click();
  const spokeAllocation = spokePanel.getByRole("slider", { name: "Allocation", exact: true });
  await spokeAllocation.press("Home");
  for (let increment = 0; increment < 8; increment++) await spokeAllocation.press("ArrowRight");
  await expect(spokeAllocation).toHaveAttribute("aria-valuenow", "40");
  await spokePanel
    .locator("[data-price-range]")
    .getByRole("button", { name: "±20%", exact: true })
    .click();
  await spokePanel
    .locator("[data-fund-slippage]")
    .getByRole("button", { name: "1%", exact: true })
    .click();
  await spokePanel.getByRole("button", { name: "Apply changes", exact: true }).click();
  await page.screenshot({ path: info.outputPath("panel-uniswap-robinhood.png"), fullPage: true });
  await page.getByRole("button", { name: "Next: Review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review your strategy", exact: true }),
  ).toBeVisible();
  mark("Build");
  const draft = await page.evaluate(() => {
    const payload = JSON.parse(localStorage.getItem("pp.manager.mandateDrafts.v1") ?? "{}");
    return Object.values(payload.drafts ?? {}).at(-1) as FundLaunchDraft;
  });
  expect(draft.pools.map((pool) => pool.poolId).sort()).toEqual([hubPool, spokePool].sort());
  expect(draft.aaveV3Reserves?.map((address) => address.toLowerCase())).toEqual([
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
  if (process.env.E2E_V2_REVIEW_ENTRY !== "fallback") {
    await page.locator("#review-name").fill(name);
    await page.getByLabel("Performance fee", { exact: true }).fill("20");
    await page.getByLabel("Management fee", { exact: true }).fill("0");
    await page.getByLabel("Instant withdrawal fee", { exact: true }).fill("2");
    await page.getByLabel("Minimum first deposit", { exact: true }).fill("2");
    await page.getByLabel("First deposit amount", { exact: true }).fill("2");
    await page.getByLabel("First deposit amount", { exact: true }).blur();
    await expect(page.getByRole("button", { name: "Launch strategy", exact: true })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Launch steps", exact: true })).toBeVisible();
    await expect(page.locator("main ol li").filter({ hasText: "Open position" })).toHaveCount(3);
    await expect(page.locator("main [role='status']")).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("murilo-review-before-launch.png"),
      fullPage: true,
    });
    await capture("review");
    mark("Murilo Review");
    return { draft, name };
  }
  await page.getByRole("button", { name: "Back to Build", exact: true }).click();
  await page.getByRole("button", { name: "Save & exit", exact: true }).click();
  await expect(page).toHaveURL(/\/manager(?:\?|$)/);
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
  return { draft, name };
}
