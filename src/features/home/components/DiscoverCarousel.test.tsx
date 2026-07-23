/**
 * @id PP-DASH-CMP-003
 * @name DiscoverCarousel — tests
 * Behavior (POO-843 R3): the pure snap-target `activeCardIndex`; the 3s auto-advance moving the dots;
 * the auto-advance PAUSING while the user is interacting (pointer down) so a swipe is never yanked.
 */

import { act, fireEvent, render } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/schemas";
import { activeCardIndex, DiscoverCarousel } from "./DiscoverCarousel";

// Isolate carousel behavior from the card + router: a stub card, a plain anchor for the i18n Link.
vi.mock("@/features/strategies/components/StrategyCard", () => ({
  StrategyCard: ({ strategy }: { strategy: Strategy }) => <div>{strategy.name}</div>,
}));
vi.mock("@/i18n/navigation", () => ({
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

const strategies = [
  { id: "s-1", name: "Alpha" },
  { id: "s-2", name: "Bravo" },
  { id: "s-3", name: "Charlie" },
] as unknown as Strategy[];

/** The aria-label of the currently active dot (the one with aria-current="true"). */
function activeDotLabel(container: HTMLElement): string | null {
  return container.querySelector('[aria-current="true"]')?.getAttribute("aria-label") ?? null;
}

describe("activeCardIndex (POO-843 R3)", () => {
  it("returns the card whose start edge is nearest the scroll position", () => {
    const starts = [0, 300, 600];
    expect(activeCardIndex(0, starts)).toBe(0);
    expect(activeCardIndex(160, starts)).toBe(1); // past the midpoint toward card 1
    expect(activeCardIndex(590, starts)).toBe(2);
  });

  it("resolves ties to the earliest card and handles an empty track", () => {
    expect(activeCardIndex(150, [0, 300])).toBe(0); // equidistant → earliest
    expect(activeCardIndex(42, [])).toBe(0);
  });
});

describe("DiscoverCarousel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the first card active on mount", () => {
    const { container } = render(
      <DiscoverCarousel strategies={strategies} exploreLabel="Explore" />,
    );
    expect(activeDotLabel(container)).toBe("Alpha");
  });

  /** Stub the track + card geometry so the handleScroll → activeCardIndex path is exercisable in jsdom. */
  function stubGeometry(container: HTMLElement): HTMLElement {
    const track = container.querySelector(".snap-x") as HTMLElement;
    Object.defineProperty(track, "offsetLeft", { value: 0, configurable: true });
    const cards = Array.from(track.children) as HTMLElement[];
    [0, 300, 600].forEach((left, i) => {
      Object.defineProperty(cards[i], "offsetLeft", { value: left, configurable: true });
    });
    return track;
  }
  function scrollTo(track: HTMLElement, left: number) {
    Object.defineProperty(track, "scrollLeft", { value: left, configurable: true });
    fireEvent.scroll(track);
  }

  // @rule R3 (review B1): a programmatic scroll (dot-tap / auto-advance) already set the index, so its
  // intermediate scroll events must NOT re-sync it — otherwise the active dot blinks to next-1 mid-scroll.
  it("[POO-843 R3] keeps the active dot on the target during a programmatic scroll", () => {
    const { container } = render(
      <DiscoverCarousel strategies={strategies} exploreLabel="Explore" />,
    );
    const track = stubGeometry(container);
    // Jump to Charlie via its dot: sets index=2 AND flags the scroll programmatic (programmaticRef true).
    fireEvent.click(container.querySelector('[aria-label="Charlie"]') as HTMLElement);
    expect(activeDotLabel(container)).toBe("Charlie");
    // A mid-animation scroll event (nearest Bravo) must NOT revert the active dot.
    scrollTo(track, 320);
    expect(activeDotLabel(container)).toBe("Charlie");
  });

  // @rule R3: a MANUAL scroll (no programmatic flag) still syncs the active dot to the snapped card.
  it("[POO-843 R3] syncs the active dot to the snapped card on a manual scroll", () => {
    const { container } = render(
      <DiscoverCarousel strategies={strategies} exploreLabel="Explore" />,
    );
    const track = stubGeometry(container);
    scrollTo(track, 600);
    expect(activeDotLabel(container)).toBe("Charlie");
  });

  // @rule R3: the 3s auto-advance moves the active dot forward, looping.
  it("auto-advances the active dot every 3s", () => {
    const { container } = render(
      <DiscoverCarousel strategies={strategies} exploreLabel="Explore" />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(activeDotLabel(container)).toBe("Bravo");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(activeDotLabel(container)).toBe("Charlie");
  });

  // @rule R3: while the user is interacting (pointer held), the auto-advance is paused, so it never
  // yanks the card the reader is on; it resumes after the interaction ends.
  it("pauses the auto-advance while the user is interacting and resumes after release", () => {
    const { container } = render(
      <DiscoverCarousel strategies={strategies} exploreLabel="Explore" />,
    );
    const track = container.querySelector(".snap-x") as HTMLElement;

    fireEvent.pointerDown(track);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // Held down the whole time → the dot never moved off the first card.
    expect(activeDotLabel(container)).toBe("Alpha");

    fireEvent.pointerUp(track);
    // After the resume delay, the auto-advance ticks again.
    act(() => {
      vi.advanceTimersByTime(3000 + 3000);
    });
    expect(activeDotLabel(container)).toBe("Bravo");
  });

  // @rule R3: a dot tap jumps to that card and updates the active dot immediately.
  it("jumps to a tapped dot", () => {
    const { container } = render(
      <DiscoverCarousel strategies={strategies} exploreLabel="Explore" />,
    );
    fireEvent.click(container.querySelector('[aria-label="Charlie"]') as HTMLElement);
    expect(activeDotLabel(container)).toBe("Charlie");
  });
});
