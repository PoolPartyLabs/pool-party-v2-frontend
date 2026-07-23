/**
 * @id PP-REW-MOD-001 (POO-210)
 * @name DuckGame — tests
 *
 * The carnival game's idle states: the Start button + odds legend when the
 * player has tries, the shooting instruction after Start, and the no-tries
 * message when out of tries. The play/data path is covered by the hook + write
 * submitter tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { DuckGame } from "./DuckGame";

const services = vi.hoisted(() => ({ playDuckShoot: vi.fn() }));
vi.mock("@/lib/services", () => ({ isMockMode: true, rewardsService: services }));

beforeEach(() => {
  services.playDuckShoot.mockReset();
});

describe("DuckGame", () => {
  it("renders the Start button and the odds legend when the player has tries", () => {
    renderWithProviders(<DuckGame triesRemaining={7} weeklyTriesLeft={7} />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByText("10% (35% odds)")).toBeInTheDocument();
    expect(screen.getByText("1000% (1% odds)")).toBeInTheDocument();
  });

  it("shows the shooting instruction after pressing Start", () => {
    renderWithProviders(<DuckGame triesRemaining={7} weeklyTriesLeft={7} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(screen.getByText("Click anywhere to shoot!")).toBeInTheDocument();
  });

  it("shows the no-tries message and hides Start when out of tries", () => {
    renderWithProviders(<DuckGame triesRemaining={0} weeklyTriesLeft={3} />);
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
    expect(screen.getByText(/Make transactions in the protocol to play/)).toBeInTheDocument();
  });
});
