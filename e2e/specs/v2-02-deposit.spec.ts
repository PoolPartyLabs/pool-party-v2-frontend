import {
  actions,
  balances,
  expect,
  FUNDS,
  field,
  formatUnits,
  login,
  openFund,
  parseUnits,
  prepare,
  save,
  shares,
  state,
  test,
  verifyNewTransactions,
} from "../helpers/v2Fund";

test.describe.configure({ mode: "serial" });
test("@v2 @v2-deposit approve and deposit at most 2.2 USDC", async ({ page, wallet }, info) => {
  test.skip(
    process.env.E2E_V2_WRITE !== "1",
    "Explicit E2E_V2_WRITE=1 required for real mainnet spend",
  );
  test.setTimeout(1_200_000);
  expect(
    process.env.E2E_PRIVATE_KEY,
    "Funded burner key must be supplied before writes",
  ).toBeTruthy();
  await login(page, wallet.address);
  const run = state();
  expect(
    run.transactions.some((transaction) => transaction.action === "deposit"),
    "Never repeat a broadcast deposit",
  ).toBe(false);
  let selected: (typeof FUNDS)[number] | undefined;
  let amount = 1_000_000n;
  const candidates = process.env.E2E_V2_FUND === "2" ? [FUNDS[1]] : FUNDS;
  for (const fund of candidates) {
    await openFund(page, fund);
    const minimumText = await actions(page)
      .getByText(/^Minimum deposit:/)
      .innerText();
    const minimum = parseUnits(minimumText.match(/([\d.]+) USDC/)?.[1] ?? "0", 6);
    amount = minimum > 1_000_000n ? minimum : 1_000_000n;
    if (amount <= 2_200_000n) {
      selected = fund;
      break;
    }
  }
  expect(selected, "Neither fund minimum fits the authorized budget").toBeDefined();
  if (!selected) return;
  run.fund = selected;
  run.sharesBefore = (await shares(selected)).toString();
  run.depositBudget = amount.toString();
  const before = await balances();
  save(run);
  const panel = actions(page);
  await panel.getByLabel("Amount (USDC)", { exact: true }).fill(formatUnits(amount, 6));
  await panel.getByLabel("Minimum whole shares", { exact: true }).fill("0");
  await prepare(page, "Deposit", info);
  const start = state().transactions.length;
  const approve = panel.getByRole("button", { name: "Approve and rebuild", exact: true });
  if (await approve.isVisible()) {
    await approve.click();
    await expect(panel.getByRole("button", { name: "Confirm in wallet", exact: true })).toBeVisible(
      { timeout: 120_000 },
    );
    await verifyNewTransactions(page, start, info);
  } else
    info.annotations.push({
      type: "approval",
      description: "Existing allowance: approval transaction not required",
    });
  await expect(
    panel.getByRole("heading", { name: "Authoritative simulation", exact: true }),
  ).toBeVisible();
  const previewShares = await field(panel, "Shares", 18);
  const previewCharged = await field(panel, "USDC charged");
  const previewFee = await field(panel, "Flow fee");
  expect(previewFee).toBe((amount * 25n) / 10_000n);
  expect(previewShares).toBeGreaterThan(0n);
  expect(previewCharged).toBeLessThanOrEqual(amount);
  await page.screenshot({ path: info.outputPath("deposit-preview.png"), fullPage: true });
  const depositStart = state().transactions.length;
  await panel.getByRole("button", { name: "Confirm in wallet", exact: true }).click();
  await expect
    .poll(() => state().transactions.length, { timeout: 120_000 })
    .toBeGreaterThan(depositStart);
  await verifyNewTransactions(page, depositStart, info);
  await expect(page.getByRole("status").filter({ hasText: "Transaction confirmed" })).toBeVisible();
  const after = await balances();
  const sharesAfter = await shares(selected);
  const result = state();
  result.sharesAfter = sharesAfter.toString();
  const transaction = result.transactions.at(-1);
  if (transaction) {
    transaction.usdcOut = (before.usdc - after.usdc).toString();
    transaction.sharesMinted = (sharesAfter - BigInt(run.sharesBefore)).toString();
  }
  save(result);
  expect(before.usdc - after.usdc).toBe(previewCharged);
  expect(sharesAfter - BigInt(run.sharesBefore)).toBe(previewShares);
  expect(sharesAfter).toBeGreaterThan(BigInt(run.sharesBefore));
  await expect
    .poll(
      async () => {
        await page.reload();
        return page
          .getByRole("heading", { name: "Your fund holdings", exact: true })
          .waitFor({ state: "visible", timeout: 20_000 })
          .then(() => 1)
          .catch(() => 0);
      },
      { timeout: 300_000, intervals: [30_000] },
    )
    .toBe(1);
  const holdings = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Your fund holdings", exact: true }) });
  await expect(holdings).toContainText(formatUnits(sharesAfter, 18));
});
