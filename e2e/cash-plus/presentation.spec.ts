/** @id PP-CP-E2E-002 @name Cash+ locale and read-failure visual checks @implements-rules-version v1 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const deployment = JSON.parse(
  readFileSync(resolve("src/lib/cash-plus/config/deployment.generated.json"), "utf8"),
);
const pt = JSON.parse(readFileSync(resolve("src/i18n/messages/pt-BR/cashPlus.json"), "utf8"));
const output = resolve("../../outputs/cash-plus-evidence");
test("Portuguese mobile page and explicitly illustrative calculator", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/pt-BR/cash-plus");
  await page
    .getByRole("button", { name: /Recusar|Rejeitar/ })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(page.getByRole("heading", { name: pt.invest.title, exact: true })).toBeVisible();
  await page.getByText(pt.simulation.title, { exact: true }).click();
  await expect(page.getByText(pt.simulation.disclaimer, { exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, "pt-br-simulation-390.png"), fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
test("loading then unavailable reads stay explicit without fixture fallback", async ({ page }) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${deployment.rpcUrl}/**`, async (route) => {
    await gate;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"test unavailable"}',
    });
  });
  await page.goto("/en/cash-plus", { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Decline", exact: true })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(page.getByRole("status", { name: "Loading Cash+", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(output, "loading-1440.png") });
  release();
  await expect(page.getByText("We couldn't load Cash+", { exact: true })).toBeVisible({
    timeout: 45000,
  });
  await page.screenshot({ path: resolve(output, "rpc-unavailable-1440.png") });
  await expect(page.getByText("Illustrative preview", { exact: true })).toHaveCount(0);
});
