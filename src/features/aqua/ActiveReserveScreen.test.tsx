import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The screen calls router.refresh() after a confirmed transaction, so the app router has to
// exist. Only refresh is exercised here; the modal's own flow is covered by its unit tests.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  // The screen syncs the connected wallet into `?investor=` so the SERVER render can read the
  // position. These specs render with an explicit `position` prop and no wallet, so an empty
  // param set is the honest stand-in: the effect short-circuits on a missing address.
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: null }),
}));

import type { ActiveReserveState } from "@/lib/aqua/api/vaultState";
import { ActiveReserveScreen } from "./ActiveReserveScreen";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME } from "./copy";

const NOW = new Date("2026-07-25T12:00:00Z");
const deadlineIn = (seconds: number) => String(Math.floor(NOW.getTime() / 1000) + seconds);

const VAULT = "0x00000000000000000000000000000000000000A1" as const;
const ADAPTER = "0x00000000000000000000000000000000000000B2" as const;

function liveState(overrides: Partial<Extract<ActiveReserveState, { status: "live" }>> = {}) {
  const base: Extract<ActiveReserveState, { status: "live" }> = {
    status: "live",
    vault: VAULT,
    adapter: ADAPTER,
    price: { ethUsdE8: "186654000000", ageSeconds: 120, stale: false },
    sleeves: {
      hotBufferUsdc: "10000000", // 10 USDC
      parkedUsdc: "190000000", // 190 USDC
      acquiredWeth: "510000000000000000", // 0.51 ETH
    },
    nav: {
      totalAssetsUsdc: "1151936433",
      wethValuedUsdc: "951936433",
      totalShares: "200000000000",
    },
    bands: [
      {
        strategyHash: `0x${"aa".repeat(32)}`,
        mandate: "production",
        lowE8: "158655900000",
        highE8: "177321300000",
        spotAtShipE8: "186654000000",
        committedUsdc: "60000000",
        acquiredWeth: "0",
        epoch: 0,
        deadline: deadlineIn(3 * 86_400),
        shipTxHash: `0x${"cc".repeat(32)}`,
        active: true,
      },
    ],
    mandate: {
      assets: [
        { label: "USDC", maxPct: 100 },
        { label: "WETH", maxPct: 10 },
      ],
      protocols: [
        { label: "Aave v3", maxPct: 90 },
        { label: "1inch Aqua", maxPct: 10 },
      ],
      networks: ["Arbitrum"],
    },
    composition: [
      { label: "Lent on Aave", weight: 16.5 },
      { label: "Cash on hand", weight: 0.87 },
      { label: "ETH bought", weight: 82.63 },
    ],
    maxTvlUsdc: "5000000000",
    seeded: true,
    liquidUsdc: "190000000",
    fills: [
      {
        txHash: `0x${"dd".repeat(32)}`,
        when: "2026-07-25T11:00:00.000Z",
        mandate: "demo",
        amountIn: "500000000000000000",
        amountOut: "924433668",
        jitUnparked: true,
      },
      {
        txHash: `0x${"ee".repeat(32)}`,
        when: "2026-07-25T10:00:00.000Z",
        mandate: "demo",
        amountIn: "10000000000000000",
        amountOut: "18497409",
        jitUnparked: false,
      },
    ],
  };
  return { ...base, ...overrides };
}

describe("ActiveReserveScreen: product copy (FE-R10)", () => {
  it("uses the official name and the description verbatim", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.getByRole("heading", { level: 1, name: PRODUCT_NAME })).toBeInTheDocument();
    expect(screen.getByText(PRODUCT_DESCRIPTION)).toBeInTheDocument();
  });

  it("keeps the description at the 277 characters the rule and submission share", () => {
    expect(PRODUCT_DESCRIPTION).toHaveLength(277);
    expect(PRODUCT_DESCRIPTION.length).toBeLessThanOrEqual(280);
  });

  it("says cushioned and never protected (FE-R6)", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.getByText(/cushioned/i)).toBeInTheDocument();
    expect(screen.queryByText(/\bprotected\b/i)).not.toBeInTheDocument();
  });

  it("keeps maker/taker/opcode vocabulary off an investor surface (FE-R6)", () => {
    const { container } = render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    const text = container.textContent ?? "";
    for (const jargon of ["maker", "taker", "opcode", "strategyHash", "salt", "sleeve"]) {
      expect(text.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });
});

describe("ActiveReserveScreen: honest empty states (FE-R7)", () => {
  it("shows a not-deployed message instead of zeros before launch", () => {
    render(
      <ActiveReserveScreen state={{ status: "not-launched", reason: "no vault" }} now={NOW} />,
    );
    expect(screen.getByText(/not deployed/i)).toBeInTheDocument();
    // No fabricated numbers anywhere.
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /total value/i })).not.toBeInTheDocument();
  });

  it("still shows the disclosure before launch", () => {
    render(
      <ActiveReserveScreen state={{ status: "not-launched", reason: "no vault" }} now={NOW} />,
    );
    expect(screen.getByRole("heading", { name: /what to know/i })).toBeInTheDocument();
  });

  it("hides the band section entirely when nothing is shipped", () => {
    render(<ActiveReserveScreen state={liveState({ bands: [] })} now={NOW} />);
    expect(screen.queryByRole("heading", { name: /buy band/i })).not.toBeInTheDocument();
  });

  it("explains an empty purchase list rather than showing a blank panel", () => {
    render(<ActiveReserveScreen state={liveState({ fills: [] })} now={NOW} />);
    expect(screen.getByText(/no purchases yet/i)).toBeInTheDocument();
  });

  it("warns when the price feed is stale rather than presenting the numbers as current", () => {
    const stale = liveState({
      price: { ethUsdE8: "186654000000", ageSeconds: 7200, stale: true },
    });
    render(<ActiveReserveScreen state={stale} now={NOW} />);
    expect(screen.getByRole("status")).toHaveTextContent(/has not updated recently/i);
  });
});

describe("ActiveReserveScreen: the numbers", () => {
  /** The metric tile grid replaced the standalone NAV card, matching the strategy detail layout. */
  it("shows the headline numbers in the metric tiles", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    // getAllBy because the action rail repeats TVL alongside the tile.
    expect(screen.getAllByText("$1,151.93").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$190.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/0\.51 ETH/).length).toBeGreaterThan(0);
  });

  it("states the 80 bps premium the program actually carries", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.getByText("0.80%")).toBeInTheDocument();
  });

  it("splits the sleeves by the MEASURED ratio, not a claimed 90/10", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    const sleeves = screen.getByRole("region", { name: /where the money is/i });
    // 190 of 200 USDC is 95%, and that is what must render.
    expect(within(sleeves).getByText(/\(95\.0%\)/)).toBeInTheDocument();
    expect(within(sleeves).queryByText(/90\/10/)).not.toBeInTheDocument();
  });

  it("places the band below the market price with its distance", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.getByText(/\$1,586\.55/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,773\.21/)).toBeInTheDocument();
    expect(screen.getByText(/-15\.0% to -5\.0% from market/)).toBeInTheDocument();
  });

  it("counts down to the band expiry", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.getByText("3d 0h")).toBeInTheDocument();
  });

  it("marks a band whose epoch has passed as expired", () => {
    const expired = liveState();
    expired.bands = [{ ...expired.bands[0]!, deadline: deadlineIn(-60) }];
    render(<ActiveReserveScreen state={expired} now={NOW} />);
    expect(screen.getByText("expired")).toBeInTheDocument();
  });
});

describe("ActiveReserveScreen: purchases", () => {
  it("links every fill to Arbiscan", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("https://arbiscan.io/tx/"));
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
  });

  it("shows the price actually paid per ETH", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    // 924.433668 USDC for 0.5 ETH is $1,848.86 per ETH (truncated, never rounded up).
    expect(screen.getByText(/\$1,848\.86/)).toBeInTheDocument();
  });

  it("badges the fill that was funded from Aave inside the settlement", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.getByText(/funded from aave in the same transaction/i)).toBeInTheDocument();
  });

  it("discloses that window fills are self-directed before listing them (BOT-R2 v2)", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.getByText(/settlement proofs executed by our own wallet/i)).toBeInTheDocument();
  });
});

describe("ActiveReserveScreen: deposit availability", () => {
  it("offers Add liquidity when the reserve is open", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.getAllByRole("button", { name: /add liquidity/i })[0]).toBeEnabled();
  });

  /**
   * A cap of zero means the manager wound the reserve down, not that it filled up. Saying
   * "at its deposit cap" there would suggest waiting for room that is never coming.
   */
  it("says CLOSED, not full, when the cap has been set to zero", () => {
    const closed = liveState({ maxTvlUsdc: "0" });
    render(<ActiveReserveScreen state={closed} now={NOW} />);
    expect(screen.getAllByText(/closed to new deposits/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/at its deposit cap/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /add liquidity/i })[0]).toBeDisabled();
  });

  it("says the cap is reached when the reserve is genuinely full", () => {
    const full = liveState({ maxTvlUsdc: "1151936433" });
    render(<ActiveReserveScreen state={full} now={NOW} />);
    expect(screen.getAllByText(/at its deposit cap/i).length).toBeGreaterThan(0);
  });

  it("blocks deposits before the manager has seeded (VLT-R2)", () => {
    render(<ActiveReserveScreen state={liveState({ seeded: false })} now={NOW} />);
    expect(screen.getAllByRole("button", { name: /add liquidity/i })[0]).toBeDisabled();
    expect(screen.getAllByText(/not open for deposits yet/i).length).toBeGreaterThan(0);
  });

  it("shows Remove liquidity only to an investor who holds shares", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.queryByRole("button", { name: /remove liquidity/i })).not.toBeInTheDocument();

    render(
      <ActiveReserveScreen
        state={liveState()}
        now={NOW}
        position={{ shares: "1000000000", valueUsdc: "5000000" }}
      />,
    );
    expect(screen.getAllByRole("button", { name: /remove liquidity/i })[0]).toBeInTheDocument();
  });
});

describe("ActiveReserveScreen: the mandate (what this actually touches)", () => {
  it("names Aave v3 and 1inch Aqua as the venues", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    // Once as a hero badge, again inside the mandate card.
    expect(screen.getAllByText("Aave v3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1inch Aqua").length).toBeGreaterThan(0);
  });

  it("shows the pair badge like the Uniswap hero does", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    expect(screen.getByText("WETH / USDC")).toBeInTheDocument();
  });
});

describe("ActiveReserveScreen: on-chain verification (FE-R2) ", () => {
  it("links the vault and both official 1inch contracts", () => {
    render(<ActiveReserveScreen state={liveState()} now={NOW} />);
    const verify = screen.getByRole("region", { name: /verify on-chain/i });
    const hrefs = within(verify)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.toLowerCase().includes(VAULT.toLowerCase()))).toBe(true);
    expect(
      hrefs.some((h) => h.toLowerCase().includes("0x1111113ccf1426a8e30e2bff5e005d929bf6a90a")),
    ).toBe(true);
    expect(
      hrefs.some((h) => h.toLowerCase().includes("0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de")),
    ).toBe(true);
  });

  it("omits the adapter row when there is no adapter rather than linking the zero address", () => {
    render(<ActiveReserveScreen state={liveState({ adapter: null })} now={NOW} />);
    const verify = screen.getByRole("region", { name: /verify on-chain/i });
    const hrefs = within(verify)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.includes("0x0000000000000000000000000000000000000000"))).toBe(false);
  });
});
