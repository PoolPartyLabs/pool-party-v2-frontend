import { writeFileSync } from "node:fs";
import { expect, FUNDS, login, openFund, state, test } from "../helpers/v2Fund";

test("fund read-only history diagnostic", async ({ page, wallet }) => {
  test.skip(
    process.env.E2E_V2_HISTORY !== "1",
    "Five-minute deployed history diagnostic requires E2E_V2_HISTORY=1 after a deposit",
  );
  test.setTimeout(420000);
  await login(page, wallet.address);
  await openFund(page, FUNDS[0]);
  const holdings = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Your fund holdings", exact: true }) });
  await expect(holdings).toContainText("Shares");
  await expect(
    holdings
      .locator("dl > div")
      .filter({ has: page.getByText("Shares", { exact: true }) })
      .locator("dd"),
  ).toHaveText("1");
  const results: Array<unknown> = [];
  page.on("response", async (response) => {
    if (response.request().method() !== "POST") return;
    const body = await response.text().catch(() => "");
    if (!body.includes('"history"')) return;
    const lines = body.split("\n").filter((line) => line.includes('"history"'));
    results.push({
      at: new Date().toISOString(),
      route: response.url().split("?")[0],
      request: response.request().postData(),
      body: lines.join("\n"),
    });
    writeFileSync("e2e/.auth/history-diagnostic.json", JSON.stringify(results, null, 2));
  });
  await page.getByRole("button", { name: "Position history", exact: true }).first().click();
  await page.waitForTimeout(10000);
  await page.screenshot({ path: "e2e/.auth/history-start.png", fullPage: true });
  await page.waitForTimeout(300000);
  await page.getByRole("button", { name: "Position history", exact: true }).first().click();
  await page.waitForTimeout(10000);
  await page.screenshot({ path: "e2e/.auth/history-five-minutes.png", fullPage: true });
  expect(
    state().transactions.filter((transaction) => transaction.action === "deposit"),
  ).toHaveLength(1);
});
