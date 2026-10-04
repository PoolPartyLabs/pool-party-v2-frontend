import {
  actions,
  balances,
  expect,
  field,
  formatUnits,
  login,
  openFund,
  prepare,
  save,
  shares,
  state,
  test,
  verifyNewTransactions,
} from "../helpers/v2Fund";

test.describe.configure({ mode: "serial" });
test("@v2 @v2-payout Instant payout of half the new deposit value", async ({
  page,
  wallet,
}, info) => {
  test.skip(process.env.E2E_V2_WRITE !== "1", "Explicit mainnet opt-in required");
  const run = state();
  test.skip(
    !run.fund || !run.sharesAfter,
    "No confirmed deposit/new shares; unsafe to payout pre-existing holdings",
  );
  if (!run.fund || !run.depositBudget || !run.sharesAfter) return;
  const minted = BigInt(run.sharesAfter) - BigInt(run.sharesBefore ?? "0");
  test.skip(
    minted < 2_000_000_000_000_000_000n,
    "Fund uses whole shares: half of one newly minted share cannot be paid; preserve holdings rather than burn all new shares",
  );
  test.setTimeout(1_200_000);
  await login(page, wallet.address);
  await openFund(page, run.fund);
  const panel = actions(page);
  const before = await balances();
  const sharesBefore = await shares(run.fund);
  const request = BigInt(run.depositBudget) / 2n;
  await panel.getByLabel("Amount (USDC)", { exact: true }).fill(formatUnits(request, 6));
  await prepare(page, "Instant payout", info);
  await expect(
    panel.getByRole("heading", { name: "Authoritative simulation", exact: true }),
  ).toBeVisible();
  const gross = await field(panel, "Gross assets");
  const fee = await field(panel, "Instant payout fee");
  const paid = await field(panel, "USDC paid");
  const burned = await field(panel, "Shares", 18);
  expect(fee >= (gross * 200n) / 10_000n - 1n && fee <= (gross * 200n) / 10_000n + 1n).toBe(true);
  expect(burned).toBeLessThanOrEqual(BigInt(run.sharesAfter) - BigInt(run.sharesBefore ?? "0"));
  await page.screenshot({ path: info.outputPath("payout-preview.png"), fullPage: true });
  const start = state().transactions.length;
  await panel.getByRole("button", { name: "Confirm in wallet", exact: true }).click();
  await expect.poll(() => state().transactions.length, { timeout: 120_000 }).toBeGreaterThan(start);
  await verifyNewTransactions(page, start, info);
  await expect(page.getByRole("status").filter({ hasText: "Transaction confirmed" })).toBeVisible();
  const after = await balances();
  const sharesAfter = await shares(run.fund);
  const received = after.usdc - before.usdc;
  expect(received >= paid - 1n && received <= paid + 1n).toBe(true);
  expect(sharesBefore - sharesAfter).toBe(burned);
  const result = state();
  const transaction = result.transactions.at(-1);
  if (transaction) {
    transaction.usdcIn = received.toString();
    transaction.payoutFee = fee.toString();
    transaction.sharesBurned = burned.toString();
  }
  save(result);
});
