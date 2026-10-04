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
  shareMetadata,
  shares,
  state,
  test,
  verifyNewTransactions,
} from "../helpers/v2Fund";

test.describe.configure({ mode: "serial" });
test("@v2 @v2-payout Instant payout of exactly one whole share", async ({ page, wallet }, info) => {
  test.skip(process.env.E2E_V2_WRITE !== "1", "Explicit mainnet opt-in required");
  const run = state();
  test.skip(
    !run.fund || !run.sharesAfter,
    "No confirmed deposit/new shares; unsafe to payout pre-existing holdings",
  );
  if (!run.fund || !run.depositBudget || !run.sharesAfter) return;
  test.setTimeout(1_200_000);
  await login(page, wallet.address);
  await openFund(page, run.fund);
  const panel = actions(page);
  const before = await balances();
  const sharesBefore = await shares(run.fund);
  const metadata = await shareMetadata(run.fund);
  const wholeUnit = 10n ** BigInt(metadata.decimals);
  const wholeShares = sharesBefore / wholeUnit;
  expect(wholeShares, "Only the authorized one-share holding may be redeemed").toBe(1n);
  expect(sharesBefore % wholeUnit).toBe(0n);
  const targetRaw = wholeShares * wholeUnit;
  const scale = wholeUnit * 10n ** 18n;
  const value = (targetRaw * metadata.price + scale - 1n) / scale;
  const request = value + value / 100n;
  run.payoutRequest = request.toString();
  save(run);
  info.annotations.push({
    type: "payout-sizing",
    description: `ShareToken decimals=${metadata.decimals}; whole shares=${wholeShares}; target raw shares=${targetRaw}; requested USDC base units=${request}. One-percent request headroom protects against price movement; burn capped at one-share balance.`,
  });
  await panel.getByLabel("Amount (USDC)", { exact: true }).fill(formatUnits(request, 6));
  await page.screenshot({ path: info.outputPath("whole-share-request.png"), fullPage: true });
  await prepare(page, "Instant payout", info);
  await expect(
    panel.getByRole("heading", { name: "Authoritative simulation", exact: true }),
  ).toBeVisible();
  const gross = await field(panel, "Gross assets");
  const fee = await field(panel, "Instant payout fee");
  const flowFee = await field(panel, "Flow fee");
  const paid = await field(panel, "USDC paid");
  const burned = await field(panel, "Shares", 18);
  expect(
    burned,
    "Authoritative payout preview must burn a positive raw share amount",
  ).toBeGreaterThan(0n);
  expect(burned).toBe(targetRaw);
  expect(fee >= (gross * 200n) / 10_000n - 1n && fee <= (gross * 200n) / 10_000n + 1n).toBe(true);
  expect(burned).toBeLessThanOrEqual(BigInt(run.sharesAfter) - BigInt(run.sharesBefore ?? "0"));
  await page.screenshot({ path: info.outputPath("payout-preview.png"), fullPage: true });
  const start = state().transactions.length;
  await panel.getByRole("button", { name: "Confirm in wallet", exact: true }).click();
  await expect.poll(() => state().transactions.length, { timeout: 120_000 }).toBeGreaterThan(start);
  const receiptVerified = verifyNewTransactions(page, start, info);
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
    transaction.usdcGross = gross.toString();
    transaction.previewPaid = paid.toString();
    transaction.flowFee = flowFee.toString();
  }
  save(result);
  await receiptVerified;
  await expect(page.getByRole("status").filter({ hasText: "Transaction confirmed" })).toBeVisible();
});
