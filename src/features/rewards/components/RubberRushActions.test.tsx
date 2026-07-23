/**
 * @id PP-REW-SCR-001
 * @name RubberRushActions — tests
 * Behavior: the daily Say Quack check-in (idle → done), Claim Roles (external Zealy quest-board link,
 * POO-765), and opening the Duck Shoot mini-game. The rewards service is mocked so the action handlers
 * resolve deterministically.
 */
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rubberRush } from "@/mocks/data/rewards";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { RubberRushActions } from "./RubberRushActions";

const services = vi.hoisted(() => ({
  sayQuack: vi.fn(),
  claimRoles: vi.fn(),
  playDuckShoot: vi.fn(),
}));

vi.mock("@/lib/services", () => ({ isMockMode: true, rewardsService: services }));

const routerRefresh = vi.hoisted(() => vi.fn());

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
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

beforeEach(() => {
  window.dataLayer = [];
  routerRefresh.mockClear();
  services.sayQuack.mockResolvedValue({ quacksAwarded: 25, quackedToday: true });
  services.claimRoles.mockResolvedValue({ claimed: true, roles: ["Swimmer"] });
  services.playDuckShoot.mockResolvedValue({
    hitIndex: 3,
    multiplierPct: 300,
    quacksWon: 144,
    triesLeft: 6,
  });
});

describe("RubberRushActions", () => {
  it("renders the Say Quack and Play Duck Shoot actions", () => {
    renderWithProviders(<RubberRushActions data={rubberRush} />);
    expect(screen.getByRole("button", { name: "Say Quack" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play Duck Shoot" })).toBeInTheDocument();
  });

  it("runs the daily Say Quack check-in and shows the done state", async () => {
    renderWithProviders(<RubberRushActions data={rubberRush} />);
    fireEvent.click(screen.getByRole("button", { name: "Say Quack" }));
    expect(services.sayQuack).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Quacked today/)).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "reward_claimed", value: 25 }),
    );
  });

  // POO-546 R1: the awarded Quacks must show without a manual reload — the check-in refetches the read.
  it("[POO-546 R1] refetches via onRefresh after an award (real-mode loader)", async () => {
    const onRefresh = vi.fn();
    renderWithProviders(<RubberRushActions data={rubberRush} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Say Quack" }));
    expect(await screen.findByText(/Quacked today/)).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledOnce();
    // The loader-provided refetch is used in preference to a full route refresh.
    expect(routerRefresh).not.toHaveBeenCalled();
  });

  // POO-546 R1: the mock SSR path has no loader refetch, so it re-runs the route read instead.
  it("[POO-546 R1] falls back to router.refresh when no onRefresh is provided (mock SSR)", async () => {
    renderWithProviders(<RubberRushActions data={rubberRush} />);
    fireEvent.click(screen.getByRole("button", { name: "Say Quack" }));
    expect(await screen.findByText(/Quacked today/)).toBeInTheDocument();
    expect(routerRefresh).toHaveBeenCalledOnce();
  });

  it("renders Claim Roles as an external quest-board link (no in-app claim) — POO-765", () => {
    renderWithProviders(<RubberRushActions data={rubberRush} />);
    const link = screen.getByRole("link", { name: /Claim roles/ });
    expect(link).toHaveAttribute("href", "https://zealy.io/cw/poolpartyxyz/questboard/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(services.claimRoles).not.toHaveBeenCalled();
  });

  it("opens the Duck Shoot mini-game", async () => {
    renderWithProviders(<RubberRushActions data={rubberRush} />);
    fireEvent.click(screen.getByRole("button", { name: "Play Duck Shoot" }));
    // The carnival game mounts with its Start button.
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});
