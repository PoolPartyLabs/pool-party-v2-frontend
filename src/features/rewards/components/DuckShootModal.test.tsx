/**
 * @id PP-REW-MOD-001
 * @name DuckShootModal — tests
 *
 * The modal is a thin Dialog shell around DuckGame: it mounts the game when open
 * and passes the Duck Shoot state. Game behaviour is covered in DuckGame.test.
 */
import { describe, expect, it, vi } from "vitest";
import { rubberRush } from "@/mocks/data/rewards";
import {
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { DuckShootModal } from "./DuckShootModal";

vi.mock("@/lib/services", () => ({ isMockMode: true, rewardsService: { playDuckShoot: vi.fn() } }));

describe("DuckShootModal", () => {
  it("mounts the Duck Shoot game when open", () => {
    renderWithProviders(<DuckShootModal open onOpenChange={vi.fn()} data={rubberRush} />);
    // The carnival game renders its Start button (the player has tries in the fixture).
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("does not render the game when closed", () => {
    renderWithProviders(<DuckShootModal open={false} onOpenChange={vi.fn()} data={rubberRush} />);
    expect(screen.queryByRole("button", { name: "Start" })).not.toBeInTheDocument();
  });

  it("closes when the top-right close button is clicked", () => {
    const onOpenChange = vi.fn();
    renderWithProviders(<DuckShootModal open onOpenChange={onOpenChange} data={rubberRush} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
