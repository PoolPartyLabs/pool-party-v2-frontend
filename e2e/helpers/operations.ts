/**
 * Operation drivers for the liquidity flows. Every write is: open a modal → set an amount → confirm →
 * the wallet-step sequence (approve / permit / build / send) runs, all AUTO-SIGNED by the headless
 * shim → the modal lands on a success phase. Because the app ships almost no `data-testid`s, these
 * target visible i18n text + ARIA roles.
 *
 * VALIDATE: the read helpers + invest are the reference; the manager ops (remove/close/move-range/
 * collect) are mapped from the code but need one funded run to tune selectors/timing. Adding a dozen
 * `data-testid`s to the operation CTAs/inputs/success states is the highest-leverage hardening.
 */
import { expect, type Page } from "@playwright/test";

/** Long enough for on-chain confirmation (receipt poll is up to 5 min) + a build round-trip. */
export const WRITE_TIMEOUT_MS = 6 * 60_000;

/** Open the strategies catalog and navigate into the first strategy; returns its id. */
export async function openFirstStrategy(page: Page, locale = "en"): Promise<string> {
  await page.goto(`/${locale}/strategies`);
  // The desktop table row link and the mobile "View details" link are both `a[href*="/strategies/"]`;
  // the responsive variant not shown is `hidden`, so read the href off the first ATTACHED match (works
  // on hidden elements) and navigate directly rather than requiring a visible click.
  const link = page.locator('a[href*="/strategies/"]').first();
  await link.waitFor({ state: "attached", timeout: 30_000 });
  const href = await link.getAttribute("href");
  if (!href) throw new Error("openFirstStrategy: no strategy detail link found on /strategies");
  await page.goto(href);
  await page.waitForURL(/\/strategies\/[^/]+/);
  return new URL(page.url()).pathname.split("/strategies/")[1]?.split("/")[0] ?? "";
}

/** Open a manager-owned strategy's manage detail (hosts add/remove/close/move-range/collect). */
export async function openManageDetail(
  page: Page,
  strategyId: string,
  locale = "en",
): Promise<void> {
  await page.goto(`/${locale}/manager?manage=${strategyId}`);
  await expect(
    page
      .getByRole("dialog")
      .or(page.getByText(/live position|operations/i))
      .first(),
  ).toBeVisible({ timeout: 30_000 });
}

/** Fill the first numeric input inside the active dialog. */
async function fillAmount(page: Page, amount: number | string): Promise<void> {
  const dialog = page.getByRole("dialog").last();
  const input = dialog.locator('input[inputmode="decimal"], input[type="number"]').first();
  await input.fill(String(amount));
}

/**
 * After confirming a write, every wallet step is auto-signed; wait for the terminal success phase.
 * The flows have no toasts — success is a phase with a Done / View position CTA (or "closed" copy).
 */
export async function waitForWriteSuccess(page: Page, timeoutMs = WRITE_TIMEOUT_MS): Promise<void> {
  const dialog = page.getByRole("dialog").last();
  // Match the real terminal-success CTA only — NOT the modal's always-present "Close" (X) button,
  // which would false-pass before the sign steps run. Invest/withdraw land on "View position"; the
  // manager close/compound flows land on "Done"/"Finish".
  await expect(
    dialog.getByRole("button", { name: /view position|^done$|^finish$/i }).first(),
  ).toBeVisible({ timeout: timeoutMs });
}

/** Invest (add liquidity) from a strategy detail page. `amountUsd` must clear the dev min ($1). */
export async function invest(page: Page, amountUsd: number): Promise<void> {
  await page.getByRole("button", { name: "Invest", exact: true }).first().click();
  await fillAmount(page, amountUsd);
  const dialog = page.getByRole("dialog").last();
  // amount phase primary CTA → confirm phase CTA. VALIDATE exact labels on a funded run.
  await dialog
    .getByRole("button", { name: /^(invest|deposit|continue)/i })
    .first()
    .click();
  await dialog
    .getByRole("button", { name: /confirm|invest/i })
    .first()
    .click();
  await waitForWriteSuccess(page);
}

/** Investor withdraw from a strategy detail page. `percent` 1..100. */
export async function withdraw(page: Page, percent: number): Promise<void> {
  await page.getByRole("button", { name: "Withdraw", exact: true }).first().click();
  await fillAmount(page, percent);
  const dialog = page.getByRole("dialog").last();
  await dialog
    .getByRole("button", { name: /withdraw|continue|confirm/i })
    .first()
    .click();
  await waitForWriteSuccess(page);
}

/** Manager remove liquidity from the manage detail. `percent` 1..100 (>50% / dust → full close). */
export async function removeLiquidity(page: Page, percent: number): Promise<void> {
  await page.getByRole("button", { name: "Withdraw", exact: true }).first().click();
  const dialog = page.getByRole("dialog").last();
  // POO-548 R2: the amount opens in $ mode — flip to % so `percent` means what it says.
  await dialog.getByRole("button", { name: "%", exact: true }).click();
  await fillAmount(page, percent);
  await dialog
    .getByRole("button", { name: /remove|withdraw|close/i })
    .first()
    .click();
  // POO-804 R3: a promoted close (>50% / dust) interposes a Continue / Keep-the-strategy dialog.
  const proceed = page.getByRole("button", { name: "Continue", exact: true });
  if (
    await proceed
      .waitFor({ state: "visible", timeout: 2_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await proceed.click();
  }
  // POO-596 handshake: the build lands on a Review whose CTA signs (Withdraw / Close strategy).
  await dialog
    .getByRole("button", { name: /^(withdraw|close strategy)$/i })
    .first()
    .click();
  await waitForWriteSuccess(page);
}

/** Close the manager-owned position (100% removal). */
export async function closePosition(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Close strategy", exact: true }).first().click();
  // POO-804 R3: the close ConfirmDialog's CTA is "Continue" (cancel = "Keep the strategy").
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // RemoveLiquidityModal(closeMode) builds, then the Review carries the close CTA.
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Close strategy", exact: true })
    .click();
  await waitForWriteSuccess(page);
}

/** Move range on the manager-owned position (recenter). */
export async function moveRange(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /move range/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog").last();
  // Optional recenter/preset then review → confirm. VALIDATE the preset + confirm labels.
  await dialog
    .getByRole("button", { name: /recenter|review|continue/i })
    .first()
    .click();
  await dialog
    .getByRole("button", { name: /confirm/i })
    .first()
    .click();
  await waitForWriteSuccess(page);
}

/** Collect accrued fees on the manager-owned position (needs fees to have accrued). */
export async function collectFees(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /collect|compound/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog").last();
  await dialog
    .getByRole("button", { name: /collect|confirm/i })
    .first()
    .click();
  await waitForWriteSuccess(page);
}
