/**
 * @id PP-MGR-SCR-002 (POO-309, POO-878, POO-882)
 * @name SeedLiquidityCard.test
 * @implements-rules-version v1
 *
 * Behavior: reads each token's on-chain decimals + balance, reports parsed wei amounts up, flags an
 * over-balance amount as invalid, and "Max" fills the wallet balance.
 * POO-878/882 rules v1: the wrapped-native (WETH/WPOL) leg gets an explicit native/wrapped funding
 * selector; balance display + validation follow the selected source; the choice rides up as
 * wrappedNativeFunding so the API-built funding path agrees with what the FE shows, per chain.
 */

import { parseUnits } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import type { SeedState } from "./SeedLiquidityCard";

const mocks = vi.hoisted(() => ({
  wallets: [{ address: "0x1111111111111111111111111111111111111111" }],
  readErc20Decimals: vi.fn(),
  readErc20Balance: vi.fn(),
  readNativeBalance: vi.fn(),
  quotePaired: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({ useWallets: () => ({ wallets: mocks.wallets }) }));
vi.mock("@/lib/tokens/readErc20", () => ({
  readErc20Decimals: mocks.readErc20Decimals,
  readErc20Balance: mocks.readErc20Balance,
  readNativeBalance: mocks.readNativeBalance,
}));
vi.mock("../operations/pairedAmountAction", () => ({
  quotePairedSeedAmountAction: mocks.quotePaired,
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { SeedLiquidityCard } from "./SeedLiquidityCard";

const TOKEN0 = "0xeee0000000000000000000000000000000000000"; // ETH, 18 decimals, balance 2
const TOKEN1 = "0xddd0000000000000000000000000000000000000"; // USDC, 6 decimals, balance 1000

const pool = {
  id: "0xpool",
  network: "base",
  networkName: "Base",
  token0: "ETH",
  token1: "USDC",
  feeBps: 5,
  tvlUsd: 1_000_000,
  aprPct: 12,
  currentPrice: 1700,
  address: "0xpool",
  token0Address: TOKEN0,
  token1Address: TOKEN1,
};

beforeEach(() => {
  mocks.readErc20Decimals.mockReset();
  mocks.readErc20Balance.mockReset();
  mocks.readErc20Decimals.mockImplementation(async (token: string) =>
    token.toLowerCase() === TOKEN0 ? 18 : 6,
  );
  mocks.readErc20Balance.mockImplementation(async (token: string) =>
    token.toLowerCase() === TOKEN0 ? parseUnits("2", 18) : parseUnits("1000", 6),
  );
  mocks.quotePaired.mockReset();
  mocks.readNativeBalance.mockReset();
});

describe("SeedLiquidityCard", () => {
  it("loads balances and reports valid parsed amounts up", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={null} tickUpper={null} onChange={onChange} />,
    );

    // Once balances load, the token inputs are enabled.
    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());
    const usdcInput = screen.getByLabelText("USDC");

    await user.type(ethInput, "1");
    await user.type(usdcInput, "500");

    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0];
      expect(last?.valid).toBe(true);
      expect(last?.amount0).toBe(parseUnits("1", 18));
      expect(last?.amount1).toBe(parseUnits("500", 6));
    });
  });

  it("flags an over-balance amount as invalid", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={null} tickUpper={null} onChange={onChange} />,
    );

    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());

    await user.type(ethInput, "5"); // balance is only 2 ETH
    expect(await screen.findByText("Insufficient balance")).toBeInTheDocument();
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0].valid).toBe(false));
  });

  it("auto-derives the paired amount from the range when a tick is typed", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    mocks.quotePaired.mockResolvedValue({
      amount0: parseUnits("1", 18).toString(),
      amount1: parseUnits("1700", 6).toString(),
    });
    // A wide range straddling the current price (current tick ≈ -201937 for price 1700, 18/6
    // decimals) is dual-asset, so both inputs render and stay linked.
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={-887220} tickUpper={887220} onChange={onChange} />,
    );

    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());
    await user.type(ethInput, "1");

    // The USDC input is auto-filled with the derived amount (debounced server-action result).
    const usdcInput = screen.getByLabelText("USDC") as HTMLInputElement;
    await waitFor(() => expect(usdcInput.value).toBe("1700"), { timeout: 2000 });
    expect(mocks.quotePaired).toHaveBeenCalledWith(
      expect.objectContaining({
        independentField: 0,
        feeTier: 500, // feeBps 5 → 500
        tickLower: -887220,
        tickUpper: 887220,
        independentAmount: parseUnits("1", 18).toString(),
      }),
    );
  });

  it("shows only the needed token for a one-sided range (mono-asset)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    // Current price 1700 (18/6 decimals) → current tick ≈ -201937; a [-100, 100] range sits entirely
    // above it, so the position is all token0 (ETH) and USDC is not required (nor rendered).
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={-100} tickUpper={100} onChange={onChange} />,
    );

    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());
    expect(screen.queryByLabelText("USDC")).not.toBeInTheDocument();

    await user.type(ethInput, "1");
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0];
      expect(last?.valid).toBe(true); // valid with only ETH
      expect(last?.amount0).toBe(parseUnits("1", 18));
      expect(last?.amount1).toBe(BigInt(0)); // the unneeded token reports 0
    });
    // The linked-input server action never fires for a one-sided range.
    expect(mocks.quotePaired).not.toHaveBeenCalled();
  });

  // @rule POO-354: two needed tokens render side by side, not stacked.
  it("lays the two seed inputs side by side for a dual-asset range", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    // A wide range straddling the current price needs both tokens.
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={-887220} tickUpper={887220} onChange={onChange} />,
    );
    const ethInput = await screen.findByLabelText("ETH");
    const usdcInput = screen.getByLabelText("USDC");
    // Both inputs share a common 2-column grid wrapper (side by side on >= sm).
    const wrapper = ethInput.closest("div.grid");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass("sm:grid-cols-2");
    expect(wrapper?.contains(usdcInput)).toBe(true);
  });

  // @rule R2/R3 (POO-497): a no-price pool (Number.MIN_VALUE sentinel) is filtered out of the picker,
  // so it must never reach the seed card. The former funded-token heuristic is retired; if a no-price
  // pool ever slips through it is a blocked/invalid state — the card reports valid=false and does not
  // run any seeding logic (no linked-input quote), so the create flow cannot proceed on it.
  it("[create-pool, no market price] is a blocked state, never seedable (POO-497 R2/R3)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    // Even with a fully funded wallet, a no-price pool must not become launchable.
    mocks.readErc20Balance.mockImplementation(async (token: string) =>
      token.toLowerCase() === TOKEN0 ? parseUnits("2", 18) : parseUnits("1000", 6),
    );
    const newPool = { ...pool, currentPrice: Number.MIN_VALUE };
    renderWithProviders(
      <SeedLiquidityCard pool={newPool} tickLower={-100} tickUpper={100} onChange={onChange} />,
    );

    // Give the effects a chance to settle, then assert the card never reports a valid seed.
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const call of onChange.mock.calls) {
      expect(call[0].valid).toBe(false);
    }
    // No dialog, and the linked-input server action never fires for a no-price pool.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.quotePaired).not.toHaveBeenCalled();

    // Filling BOTH inputs (when rendered) still cannot make a no-price pool valid — the create flow
    // must never proceed on it (the old funded-token heuristic would have reported valid here).
    const ethInput = screen.queryByLabelText("ETH");
    const usdcInput = screen.queryByLabelText("USDC");
    if (ethInput) await user.type(ethInput, "1");
    if (usdcInput) await user.type(usdcInput, "500");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onChange.mock.calls.at(-1)?.[0].valid).toBe(false);
  });

  it("does not auto-derive when no tick range is set (inputs stay independent)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={null} tickUpper={null} onChange={onChange} />,
    );
    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());
    await user.type(ethInput, "1");
    // Give the debounce window a chance; the quote must never fire without a range.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mocks.quotePaired).not.toHaveBeenCalled();
  });

  it("reads the NATIVE balance for a wrapped-native (WETH) pool token", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    const WETH_BASE = "0x4200000000000000000000000000000000000006"; // base wrapped-native
    mocks.readErc20Decimals.mockImplementation(async (token: string) =>
      token.toLowerCase() === WETH_BASE.toLowerCase() ? 18 : 6,
    );
    mocks.readNativeBalance.mockResolvedValue(parseUnits("3", 18)); // manager holds 3 native ETH
    renderWithProviders(
      <SeedLiquidityCard
        pool={{ ...pool, token0: "ETH", token0Address: WETH_BASE }}
        tickLower={null}
        tickUpper={null}
        onChange={onChange}
      />,
    );
    // The ETH row shows the native balance (3), not the always-zero WETH ERC-20 balance.
    expect(await screen.findByText("Balance 3")).toBeInTheDocument();
    expect(mocks.readNativeBalance).toHaveBeenCalled();
  });

  it("prompts to Deposit/Swap when a needed token has zero balance", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    // USDC balance is 0. A range straddling the current tick needs both tokens, so the manager cannot
    // seed USDC. POO-496 R2: the ticks are non-null here, so the check runs and names the missing side.
    mocks.readErc20Balance.mockImplementation(async (token: string) =>
      token.toLowerCase() === TOKEN0 ? parseUnits("2", 18) : BigInt(0),
    );
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={-887220} tickUpper={887220} onChange={onChange} />,
    );

    // The zero-balance prompt appears once balances settle, naming the missing token.
    expect(await screen.findByText("You need USDC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deposit" })).toBeEnabled();
    // Swap is present but disabled (coming soon).
    expect(screen.getByRole("button", { name: /Swap/ })).toBeDisabled();
  });

  it("'Max' fills the wallet balance", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={null} tickUpper={null} onChange={onChange} />,
    );

    const ethInput = (await screen.findByLabelText("ETH")) as HTMLInputElement;
    await waitFor(() => expect(ethInput).toBeEnabled());

    const ethMax = screen.getAllByRole("button", { name: "Max" })[0];
    if (!ethMax) throw new Error("expected the ETH Max button");
    await user.click(ethMax);
    expect(ethInput.value).toBe("2");
  });

  // POO-496 [R2]: the once-only zero-balance check must wait for the resolved range on a price-known
  // pool. While ticks are unresolved (null) seedTokensNeeded defaults to BOTH; firing then would name
  // a token the resolved range never needs. Current price 1700 → current tick ≈ -201936.
  it("[price known] does not fire the zero-balance prompt while the range ticks are unresolved (POO-496 R2)", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    // Both balances 0; with null ticks the old code would default to both-needed and prompt for both.
    mocks.readErc20Balance.mockImplementation(async () => BigInt(0));
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={null} tickUpper={null} onChange={onChange} />,
    );

    // Wait for balances to settle (phase ready): the ETH input becomes enabled.
    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());
    // Give any queued zero-check effect a chance to fire, then assert it did NOT.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("[price known, one-sided on token1] fires after ticks resolve, naming ONLY the needed token (POO-496 R2)", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    // Both balances 0. A range entirely BELOW the current tick (both ticks < -201936) needs token1
    // (USDC) only, so the prompt must name USDC and never ETH.
    mocks.readErc20Balance.mockImplementation(async () => BigInt(0));
    const { rerender } = renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={null} tickUpper={null} onChange={onChange} />,
    );

    // Balances settle first with the range still unresolved: no prompt yet.
    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Ticks resolve one-sided on token1 (USDC): the prompt fires now, naming USDC only.
    rerender(
      <SeedLiquidityCard pool={pool} tickLower={-887220} tickUpper={-300000} onChange={onChange} />,
    );
    expect(await screen.findByText("You need USDC")).toBeInTheDocument();
    // Never names the unneeded token0 (ETH) and never lists both.
    expect(screen.queryByText("You need ETH")).not.toBeInTheDocument();
    expect(screen.queryByText("You need ETH & USDC")).not.toBeInTheDocument();
    expect(screen.queryByText("You need USDC & ETH")).not.toBeInTheDocument();
  });

  it("[price known, straddling range] fires once for both tokens when both balances are zero (POO-496 R2)", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    // Both balances 0; a range straddling the current tick genuinely needs both tokens.
    mocks.readErc20Balance.mockImplementation(async () => BigInt(0));
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={-887220} tickUpper={887220} onChange={onChange} />,
    );
    // Both ticks are non-null from the first render, so the prompt legitimately names both.
    expect(await screen.findByText("You need ETH & USDC")).toBeInTheDocument();
  });

  // POO-496 [R3]: while a price-known non-full range is degenerate (createPoolTicks returned null →
  // ticks stay null), the zero-balance modal never fires; the Launch gate's missing-range chip is the
  // sole blocker. The check has not run, so it can still fire later if ticks become valid.
  it("[price known, degenerate range] never fires the zero-balance prompt while ticks stay null (POO-496 R3)", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    mocks.readErc20Balance.mockImplementation(async () => BigInt(0));
    renderWithProviders(
      <SeedLiquidityCard pool={pool} tickLower={null} tickUpper={null} onChange={onChange} />,
    );
    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());
    // Ticks never resolve for the whole test (degenerate range → createPoolTicks null upstream).
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// POO-878 / POO-882: the wrapped-native (WETH/WPOL) leg gets an explicit funding-source selector so the
// FE-displayed/validated balance source and the API-built funding path always agree per chain.
describe("SeedLiquidityCard — wrapped-native funding selector (POO-878/882)", () => {
  const WETH_BASE = "0x4200000000000000000000000000000000000006"; // Base wrapped-native
  const WPOL = "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"; // Polygon wrapped-native
  const USDC_POLYGON = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

  // Base pool whose token0 is the wrapped-native (shown as "ETH", WETH under the hood), token1 USDC.
  const wethPool = { ...pool, network: "base", token0: "ETH", token0Address: WETH_BASE };
  // A one-sided range entirely ABOVE the current price → only token0 (the wrapped-native) is needed,
  // isolating the wrapped leg (no token1 required, no linked-input quote). Mirrors the mono-asset test.
  const ONLY0 = { tickLower: -100, tickUpper: 100 };

  // WETH-row balances: mock native + wrapped ERC-20 explicitly; USDC keeps the beforeEach default.
  function mockWethBalances(nativeEth: string, wethErc20: string) {
    mocks.readErc20Decimals.mockImplementation(async (token: string) =>
      token.toLowerCase() === WETH_BASE.toLowerCase() ? 18 : 6,
    );
    mocks.readNativeBalance.mockResolvedValue(parseUnits(nativeEth, 18));
    mocks.readErc20Balance.mockImplementation(async (token: string) =>
      token.toLowerCase() === WETH_BASE.toLowerCase()
        ? parseUnits(wethErc20, 18)
        : parseUnits("1000", 6),
    );
  }

  // @rule POO-878 R1: the wrapped-native row shows an explicit native/wrapped funding selector.
  it("renders an ETH/WETH funding selector on the wrapped-native row", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    mockWethBalances("1", "5");
    renderWithProviders(
      <SeedLiquidityCard
        pool={wethPool}
        tickLower={ONLY0.tickLower}
        tickUpper={ONLY0.tickUpper}
        onChange={onChange}
      />,
    );
    await screen.findByLabelText("ETH");
    expect(screen.getByRole("button", { name: "ETH" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WETH" })).toBeInTheDocument();
  });

  // @rule POO-878 R3/R4: default native — validates against native and reports funding "native".
  it("defaults to native, validates against native, and reports funding 'native'", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    mockWethBalances("2", "5"); // 2 native ETH, 5 WETH
    renderWithProviders(
      <SeedLiquidityCard
        pool={wethPool}
        tickLower={ONLY0.tickLower}
        tickUpper={ONLY0.tickUpper}
        onChange={onChange}
      />,
    );
    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());
    // The row shows the native balance while native is the source.
    expect(await screen.findByText("Balance 2")).toBeInTheDocument();

    await user.type(ethInput, "1"); // within native (2)
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0];
      expect(last?.valid).toBe(true);
      expect(last?.amount0).toBe(parseUnits("1", 18));
      expect(last?.wrappedNativeFunding).toBe("native");
    });
  });

  // @rule POO-878 R3: auto-select WETH when native alone cannot cover the amount but WETH can.
  it("auto-selects WETH when native can't cover but WETH can, and reports funding 'erc20'", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    mockWethBalances("1", "5"); // 1 native ETH, 5 WETH
    renderWithProviders(
      <SeedLiquidityCard
        pool={wethPool}
        tickLower={ONLY0.tickLower}
        tickUpper={ONLY0.tickUpper}
        onChange={onChange}
      />,
    );
    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());

    await user.type(ethInput, "3"); // > 1 native, <= 5 WETH → auto-switch to WETH
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0];
      expect(last?.valid).toBe(true); // valid against the 5 WETH balance
      expect(last?.wrappedNativeFunding).toBe("erc20");
    });
    // The balance display follows the selected source (now WETH: 5).
    expect(screen.getByText("Balance 5")).toBeInTheDocument();
  });

  // @rule POO-878 R2/R4: the manager can switch sources; validation follows the SELECTED source.
  it("lets the manager switch to WETH and validates against the wrapped balance", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    mockWethBalances("5", "2"); // 5 native ETH, only 2 WETH
    renderWithProviders(
      <SeedLiquidityCard
        pool={wethPool}
        tickLower={ONLY0.tickLower}
        tickUpper={ONLY0.tickUpper}
        onChange={onChange}
      />,
    );
    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());

    await user.type(ethInput, "3"); // within native (5), so default native is valid
    await waitFor(() => expect(onChange.mock.calls.at(-1)?.[0].valid).toBe(true));

    // Manually pick WETH: 3 now exceeds the 2 WETH balance → invalid + insufficient message.
    await user.click(screen.getByRole("button", { name: "WETH" }));
    expect(await screen.findByText("Insufficient balance")).toBeInTheDocument();
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0];
      expect(last?.valid).toBe(false);
      expect(last?.wrappedNativeFunding).toBe("erc20");
    });
  });

  // @rule POO-878 R4: the zero-balance prompt fires ONLY when neither source can cover the leg.
  it("does not prompt zero-balance when native is empty but WETH is funded", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    mockWethBalances("0", "5"); // no native ETH, but 5 WETH
    renderWithProviders(
      <SeedLiquidityCard
        pool={wethPool}
        tickLower={ONLY0.tickLower}
        tickUpper={ONLY0.tickUpper}
        onChange={onChange}
      />,
    );
    const ethInput = await screen.findByLabelText("ETH");
    await waitFor(() => expect(ethInput).toBeEnabled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    // WETH covers the leg → no prompt; the source defaults to WETH so the balance is usable.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Balance 5")).toBeInTheDocument();
  });

  it("prompts zero-balance for the wrapped leg only when BOTH native and WETH are zero", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    mockWethBalances("0", "0"); // neither source can cover
    renderWithProviders(
      <SeedLiquidityCard
        pool={wethPool}
        tickLower={ONLY0.tickLower}
        tickUpper={ONLY0.tickUpper}
        onChange={onChange}
      />,
    );
    // Only token0 (ETH/WETH) is needed, and both its sources are empty → the prompt names ETH.
    expect(await screen.findByText("You need ETH")).toBeInTheDocument();
  });

  // @rule POO-878 R5: Max on the NATIVE source reserves $1.50-worth of native for gas; Max on the
  // wrapped ERC-20 stays exact (gas is paid in native, not the seeded token).
  it("reserves $1.50 of gas when Maxing native, but Max on WETH is exact", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(s: SeedState) => void>();
    mockWethBalances("2", "5"); // 2 native ETH, 5 WETH
    // The wrapped token (ETH row) carries a $2500 price, mirroring the pool's per-token USD price.
    const priced = { ...wethPool, token0PriceUsd: 2500 };
    renderWithProviders(
      <SeedLiquidityCard
        pool={priced}
        tickLower={ONLY0.tickLower}
        tickUpper={ONLY0.tickUpper}
        onChange={onChange}
      />,
    );
    const ethInput = (await screen.findByLabelText("ETH")) as HTMLInputElement;
    await waitFor(() => expect(ethInput).toBeEnabled());

    // Native is the default source → Max reserves $1.50 (0.0006 ETH at $2500) from the 2 ETH balance.
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(ethInput.value).toBe("1.9994");

    // Switch to WETH → Max is exact (the full 5 WETH), no reserve.
    await user.click(screen.getByRole("button", { name: "WETH" }));
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(ethInput.value).toBe("5");
  });

  // @rule POO-882 R1/R2: Polygon's wrapped-native (POL/WPOL) uses the SAME selector. The FE displays +
  // validates native POL and reports funding 'native', so the API-built funding path agrees per chain.
  it("[Polygon] gives the WPOL leg a POL/WPOL selector defaulting to native POL", async () => {
    const onChange = vi.fn<(s: SeedState) => void>();
    const polPool = {
      ...pool,
      network: "polygon",
      token0: "POL",
      token0Address: WPOL,
      token1: "USDC",
      token1Address: USDC_POLYGON,
      currentPrice: 0.5,
    };
    mocks.readErc20Decimals.mockImplementation(async (token: string) =>
      token.toLowerCase() === WPOL.toLowerCase() ? 18 : 6,
    );
    mocks.readNativeBalance.mockResolvedValue(parseUnits("4", 18)); // 4 native POL
    mocks.readErc20Balance.mockImplementation(async (token: string) =>
      token.toLowerCase() === WPOL.toLowerCase() ? BigInt(0) : parseUnits("1000", 6),
    );
    renderWithProviders(
      <SeedLiquidityCard pool={polPool} tickLower={null} tickUpper={null} onChange={onChange} />,
    );
    // The POL row shows the native balance and a POL/WPOL selector (never a WPOL Permit2 mismatch).
    expect(await screen.findByText("Balance 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "POL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WPOL" })).toBeInTheDocument();
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)?.[0].wrappedNativeFunding).toBe("native"),
    );
    // Native POL is present, so the WPOL-zero balance never triggers the zero-balance prompt.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
