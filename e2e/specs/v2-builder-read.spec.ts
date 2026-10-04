import { expect, test } from "../fixtures";
import { connectAndSignIn } from "../helpers/connect";

test("@v2-builder-read routes, real-mode manager and retained Tools", async ({
  page,
  wallet,
}, info) => {
  test.skip(process.env.E2E_V2_NO_SIGN !== "1", "Read-only verification requires signing disarmed");
  expect(wallet.address.toLowerCase()).toBe("0x3a3ea619c0f37a7d2ff07ff442d863f316a99a7a");
  await connectAndSignIn(page);
  for (const route of ["/en", "/en/strategies", "/en/manager", "/en/manager/new", "/en/tools"]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole("button", { name: "Open wallet", exact: true })).toBeVisible();
    await expect(page.getByText("MOCK", { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath(`${route.replaceAll("/", "-")}.png`),
      fullPage: true,
    });
  }
  await expect(
    page.getByRole("heading", { name: "Uniswap v4 hook risk", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Hook contract address", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze", exact: true })).toBeEnabled();
  const response = await page.request.get("/api/tools/hookrisk?jobId=invalid");
  expect(response.status()).toBe(400);
  expect((await response.json()).code).toBe("BAD_JOB_ID");
});
