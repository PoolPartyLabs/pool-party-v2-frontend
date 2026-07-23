/**
 * @id PP-DASH-CMP-003
 * @name DiscoverCarousel
 * @implements-rules-version v2
 *
 * Mobile "Available investments" carousel — peeking strategy cards, auto-advance every 3s, and page
 * dots that reflect / drive the active card. Client component (timers + scroll). Desktop uses a table.
 *
 * v2 (POO-843 R3): the auto-advance PAUSES while the user is interacting (pointer down / active
 * scroll) and RESUMES a few seconds after they stop, and a manual swipe SYNCS `index` (and the dots)
 * to the card scrolled into view — so a swipe is never yanked back to a stale index on the next tick.
 * Programmatic (auto-advance / dot-tap) scrolls are flagged so their own scroll events do not count as
 * user interaction (which would stall the carousel). {@link activeCardIndex} is the pure snap-target.
 */
"use client";

import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { StrategyCard } from "@/features/strategies/components/StrategyCard";
import { Link } from "@/i18n/navigation";
import type { Strategy } from "@/lib/schemas";
import { cn } from "@/lib/utils/cn";

/** Auto-advance cadence (ms). */
const AUTO_ADVANCE_MS = 3000;
/** How long after the user's last interaction (release / scroll-idle) the auto-advance resumes (ms). */
const RESUME_DELAY_MS = 3000;
/** Window (ms) a programmatic smooth scroll is allowed to settle before its events count as manual. */
const PROGRAMMATIC_SETTLE_MS = 600;

/**
 * The index of the card whose start edge is nearest the track's current scroll position — the card a
 * horizontal swipe has snapped to. Pure so it is unit-testable without a real scroll container.
 * `cardStarts[i]` is card `i`'s left offset within the track; ties resolve to the earliest card.
 */
export function activeCardIndex(scrollLeft: number, cardStarts: readonly number[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < cardStarts.length; i += 1) {
    const distance = Math.abs((cardStarts[i] ?? 0) - scrollLeft);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Public props for {@link DiscoverCarousel}. */
export interface DiscoverCarouselProps {
  /** Strategies to surface for discovery. */
  strategies: Strategy[];
  /** Label for the trailing "explore more" card. */
  exploreLabel: string;
}

/** Auto-advancing strategy carousel with page dots. */
export function DiscoverCarousel({ strategies, exploreLabel }: DiscoverCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = strategies.length;

  // `index` mirror for the timers/scroll handlers (they must read the latest without re-subscribing).
  const indexRef = useRef(0);
  // True while the user is holding / actively scrolling the track: the auto-advance skips its tick.
  const interactingRef = useRef(false);
  // True during a programmatic (auto-advance / dot-tap) smooth scroll, so its scroll events are not
  // mistaken for a user gesture (which would pause the carousel and stall it).
  const programmaticRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setActive = useCallback((next: number) => {
    indexRef.current = next;
    setIndex(next);
  }, []);

  // Scroll the track to a card index, flagging the scroll as programmatic for the settle window.
  const scrollToIndex = useCallback((target: number) => {
    const track = trackRef.current;
    const card = track?.children[target] as HTMLElement | undefined;
    if (!track || !card) return;
    programmaticRef.current = true;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      programmaticRef.current = false;
    }, PROGRAMMATIC_SETTLE_MS);
    track.scrollTo?.({ left: card.offsetLeft - track.offsetLeft, behavior: "smooth" });
  }, []);

  // Auto-advance every 3s, looping — but never while the user is interacting (R3): the tick is
  // skipped, so the carousel does not fight a swipe or yank the card the reader is looking at.
  useEffect(() => {
    if (count <= 1) return;
    const id = setInterval(() => {
      if (interactingRef.current) return;
      const next = (indexRef.current + 1) % count;
      setActive(next);
      scrollToIndex(next);
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(id);
  }, [count, scrollToIndex, setActive]);

  // Clear any pending timers on unmount.
  useEffect(
    () => () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    },
    [],
  );

  // Schedule the auto-advance to resume once the user has been idle for RESUME_DELAY_MS.
  const scheduleResume = useCallback(() => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      interactingRef.current = false;
    }, RESUME_DELAY_MS);
  }, []);

  // Sync `index` (and the dots) to whatever card a manual swipe has scrolled into view, and pause the
  // auto-advance while the gesture is live. Programmatic scrolls (auto-advance / dot-tap) only sync
  // the index; they do NOT mark interaction, so they cannot stall the carousel.
  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const starts: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const child = track.children[i] as HTMLElement | undefined;
      if (child) starts.push(child.offsetLeft - track.offsetLeft);
    }
    const next = activeCardIndex(track.scrollLeft, starts);
    // POO-843 R3 (review B1): a programmatic scroll (auto-advance / dot-tap) already set the index via
    // setActive before scrollToIndex, so its INTERMEDIATE scroll events must not re-sync the index —
    // doing so blinked the active dot back to next-1 for the first half of the smooth-scroll animation.
    // Only a MANUAL scroll syncs the index here (and marks interaction to pause the auto-advance).
    if (!programmaticRef.current) {
      if (next !== indexRef.current) setActive(next);
      interactingRef.current = true;
      scheduleResume();
    }
  }, [count, setActive, scheduleResume]);

  const handlePointerDown = useCallback(() => {
    interactingRef.current = true;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
  }, []);

  const handlePointerRelease = useCallback(() => {
    scheduleResume();
  }, [scheduleResume]);

  return (
    <div>
      <div
        ref={trackRef}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2"
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerRelease}
        onPointerCancel={handlePointerRelease}
      >
        {strategies.map((strategy) => (
          <StrategyCard
            key={strategy.id}
            strategy={strategy}
            className="w-[85%] shrink-0 snap-start"
          />
        ))}
        <Link
          href="/strategies"
          className="flex w-32 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-xl border border-border border-dashed text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="size-5" aria-hidden="true" />
          <span className="text-sm">{exploreLabel}</span>
        </Link>
      </div>
      {count > 1 ? (
        <div className="mt-3 flex justify-center gap-1.5">
          {strategies.map((strategy, i) => (
            <button
              key={strategy.id}
              type="button"
              aria-label={strategy.name}
              aria-current={i === index}
              onClick={() => {
                setActive(i);
                scrollToIndex(i);
              }}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-4 bg-primary" : "w-1.5 bg-border",
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
