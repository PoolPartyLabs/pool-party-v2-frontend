import { EXPLORERS, expect, FUNDS, login, openFund, test } from "../helpers/v2Fund";

test.describe.configure({ mode: "serial" });
test("@v2 @v2-read optional fund #2 discovery", async ({ page, wallet }) => {
  await login(page, wallet.address);
  await page.goto("/en/strategies");
  await page.getByRole("button", { name: /^V2$/ }).click();
  await expect(page.locator(`a[href$="/funds/${FUNDS[0]}"]`)).toBeVisible({ timeout: 60_000 });
  const second = page.locator(`a[href$="/funds/${FUNDS[1]}"]`);
  test.skip((await second.count()) === 0, "Fund #2 discovery requires deployed POO-2181");
  await expect(second).toBeVisible();
});
test("@v2 @v2-read fund discovery, valuation, positions and explorer addresses", async ({
  page,
  wallet,
}, info) => {
  await login(page, wallet.address);
  await page.goto("/en/strategies");
  await page.getByRole("button", { name: /^V2$/ }).click();
  await expect(page.locator(`a[href$="/funds/${FUNDS[0]}"]`)).toBeVisible({ timeout: 60_000 });
  if ((await page.locator(`a[href$="/funds/${FUNDS[1]}"]`).count()) === 0) {
    info.annotations.push({
      type: "skip",
      description: "Fund #2 discovery requires deployed POO-2181; fund #1 remains required",
    });
  } else await expect(page.locator(`a[href$="/funds/${FUNDS[1]}"]`)).toBeVisible();
  await openFund(page, FUNDS[0]);
  await expect(page.locator("article header h1")).not.toBeEmpty();
  for (const heading of ["Positions", "Limits usage", "Report", "Chains"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: /Aave v3|Uniswap v4/ }).first()).toBeVisible();
  const addressLinks = page.locator('article a[href*="/address/"]');
  expect(await addressLinks.count()).toBeGreaterThan(0);
  for (const link of await addressLinks.all()) {
    const href = await link.getAttribute("href");
    expect(href).toMatch(
      /^https:\/\/(arbiscan\.io|robinhoodchain\.blockscout\.com)\/address\/0x[0-9a-fA-F]{40}$/,
    );
  }
  for (const address of await page.locator("article").evaluate((article) => {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    const addresses: string[] = [];
    while (walker.nextNode()) {
      for (const match of walker.currentNode.textContent?.matchAll(
        /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g,
      ) ?? [])
        addresses.push(match[0]);
    }
    return addresses;
  })) {
    await expect(page.locator(`article a[href$="/address/${address}"]`).first()).toBeVisible();
  }
  const history = page.getByRole("button", { name: "Position history", exact: true });
  expect(await history.count()).toBeGreaterThan(0);
  if (await history.count()) {
    await history.first().click();
    await expect(
      page.getByRole("heading", { name: "Position history", exact: true }),
    ).toBeVisible();
    const transactions = page.locator('article a[href*="/tx/"]');
    expect(await transactions.count()).toBeGreaterThan(0);
    for (const link of await transactions.all()) {
      const href = await link.getAttribute("href");
      expect(href).toMatch(
        /^https:\/\/(arbiscan\.io|robinhoodchain\.blockscout\.com)\/tx\/0x[0-9a-fA-F]{64}$/,
      );
      const row = link.locator("..");
      if (/Robinhood|4663/.test(await row.innerText())) expect(href).toContain(EXPLORERS[4663]);
      if (/Arbitrum|42161/.test(await row.innerText())) expect(href).toContain(EXPLORERS[42161]);
    }
  }
  await page.screenshot({ path: info.outputPath("fund-detail.png"), fullPage: true });
});
