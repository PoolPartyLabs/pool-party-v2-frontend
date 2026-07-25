/**
 * @id PP-STR-MOD-001 (POO-1025)
 * @name InvestModal — the gate preempts the deposit deep link
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The defect: the invest USDC branch of the provisioning gate was DEAD CODE. `needsDeposit = amount >
 * balance` made `handlePrimary()` return early into the `/deposit` round trip BEFORE `gate.evaluate`
 * was ever reached, so a user holding funds on another chain was told to go buy more fiat rather than
 * being offered the funds they already have.
 *
 * Rules under test (POO-1025 rules v1):
 *   [R1] short wallet + the gate can provision  → provision phase, NO deposit navigation
 *   [R2] short wallet + the gate cannot provision → the deposit deep link, unchanged
 *   [R3] the deep-link query contract is preserved exactly (strategy, amount=shortfall, invest, origin)
 *   [R4] `strategy_invest_submitted` fires exactly once when an invest actually starts, and NOT on
 *        the deposit bailout (which starts no invest)
 *   [R5] cancelling provisioning returns to the amount step, not to /deposit
 *
 * [R2]/[R3] are pinned under BOTH of the independent guards that keep the fallback alive: the flag
 * being off, and real mode being inert. They are not the same test. The flag is on in local dev, so
 * only the real-mode case speaks to what production does today.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { InvestModal } from "./InvestModal";

const push = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
/** Flag state is per-test: the gate is only consulted when `provisioning` is on. */
const flagOn = vi.hoisted(() => ({ value: true }));
/**
 * Mock-vs-real is per-test too, and INDEPENDENT of the flag. `buildProvisioningInput` reads
 * `isMockMode` at call time, so overriding it with a getter (the `TransactionStatus.test.tsx`
 * precedent) flips the gate's data source mid-file. Spread the real barrel rather than replacing it:
 * the rest of `@/lib/services` stays intact for everything else the modal tree touches.
 */
const mockMode = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({
    isEnabled: (key: string) => key === "provisioning" && flagOn.value,
    flags: {},
  }),
}));

vi.mock("@/lib/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services")>()),
  get isMockMode() {
    return mockMode.value;
  },
}));

vi.mock("@/lib/analytics/useAnalytics", () => ({
  useAnalytics: () => ({ track }),
}));

vi.mock("@/lib/strategies/revalidateStrategies", () => ({
  revalidateStrategiesAction: vi.fn(async () => {}),
}));

vi.mock("./settle", () => ({
  settleOutcome: vi.fn(() => "success"),
  settleTxError: vi.fn(() => ({ code: "-32603", message: "execution reverted: mock" })),
  settleTxHash: vi.fn(() => "0x7a3f5b8c0d1e2f4a6b8c0d1e2f4a6b8c0d1e9c2e"),
  settleDeployedUsd: vi.fn((requested: number) => requested),
}));

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const strategy = {
  id: "s1",
  name: "Stable Yield",
  manager: "Pool Party Labs",
  riskLevel: 2,
  minInvestment: 50,
  tvl: 1_000_000,
  investors: 100,
  estReturn: 8,
  rateType: "APY",
  status: "active",
  detail: { lockupDays: 0, managerVerified: true, about: "x", composition: [] },
} as unknown as Strategy;

/** Render with `balance`, then enter `amount`. `amount > balance` is the short-wallet case. */
function enterAmount(amount: number, balance: number) {
  renderWithProviders(
    <InvestModal open onOpenChange={vi.fn()} strategy={strategy} balance={balance} />,
  );
  fireEvent.change(screen.getByLabelText("Amount to invest"), {
    target: { value: String(amount) },
  });
}

afterEach(() => {
  push.mockReset();
  track.mockReset();
  flagOn.value = true;
  mockMode.value = true;
});

describe("InvestModal — gate preempts the deposit deep link (POO-1025)", () => {
  // [R1] The whole point: funds elsewhere beat "go buy more fiat".
  it("routes a short wallet to provisioning instead of /deposit when the gate can provision", async () => {
    enterAmount(200, 50);

    // The CTA still reads "Deposit & invest" while short; the destination is what changed.
    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));

    expect(await screen.findByText("Invest in Stable Yield")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  // [R2] + [R3] The fallback must still work, byte-for-byte.
  it("falls back to the deposit deep link with the exact query contract when the gate cannot provision", () => {
    flagOn.value = false; // the gate declines → today's behavior
    enterAmount(200, 50);

    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/deposit?strategy=s1&amount=150&invest=200");
  });

  /**
   * [R2] + [R3] in the condition that actually ships. This test exists to pin the production-safety
   * claim of POO-1025 DIRECTLY, rather than transitively through the flag-off case above.
   *
   * "Real mode is inert" is the entire argument that this behavior change is safe to merge: the flag
   * is ON in local dev, so the flag-off test proves nothing about production. The load-bearing part
   * is `realProvisioningInput`'s non-triggering stub, which keeps `computeProvisioningNeed().needed`
   * false and sends a short wallet down the unchanged /deposit path even with the gate switched on.
   * Those are two independent guards, and only this test covers the second one. When POO-1042 wires
   * live per-chain balances into that stub, THIS is the test that must be revisited deliberately.
   */
  it("keeps the deposit deep link in REAL mode even with the provisioning flag on", () => {
    mockMode.value = false; // flagOn stays true: the gate is consulted and declines on its own.
    enterAmount(200, 50);

    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/deposit?strategy=s1&amount=150&invest=200");
    // Never the provision phase: its op anchor is what the [R1] test waits on.
    expect(screen.queryByText("Invest in Stable Yield")).not.toBeInTheDocument();
  });

  // [R4] The bailout starts no invest, so it must not report one.
  it("does not fire strategy_invest_submitted on the deposit bailout", () => {
    flagOn.value = false;
    enterAmount(200, 50);

    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));

    expect(track).not.toHaveBeenCalledWith("strategy_invest_submitted", expect.anything());
  });

  // [R4] The provisioning path DOES start an invest, so it reports exactly one.
  it("fires strategy_invest_submitted exactly once when provisioning starts the invest", async () => {
    enterAmount(200, 50);

    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));
    await screen.findByText("Invest in Stable Yield");

    const submitted = track.mock.calls.filter(([name]) => name === "strategy_invest_submitted");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.[1]).toMatchObject({ strategy_id: "s1", value: 200 });
  });

  // [R5] Backing out returns to the amount step with the entered amount intact, never to /deposit.
  it("returns to the amount step on cancel, preserving the entered amount", async () => {
    enterAmount(200, 50);

    fireEvent.click(screen.getByRole("button", { name: "Deposit & invest" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Amount to invest")).toHaveValue("200");
    expect(push).not.toHaveBeenCalled();
  });

  // A funded wallet is untouched by this change: it still consults the gate for gas / network.
  it("leaves the funded path unchanged", async () => {
    enterAmount(200, 500);

    fireEvent.click(screen.getByRole("button", { name: "Invest" }));

    // Flag on + mock scenarios means the gate trips on gas; either way it never deep-links.
    await screen.findByText("Invest in Stable Yield");
    expect(push).not.toHaveBeenCalled();
  });
});
