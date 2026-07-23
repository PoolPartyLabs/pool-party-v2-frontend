/**
 * @id PP-REW-MOD-001 (POO-210)
 * @name DuckGame
 * @implements-rules-version v1
 *
 * The carnival Duck Shoot mini-game, ported from pool-party-interface and adapted
 * to this repo: motion/react animations, next/image duck art, the Button
 * primitive, i18n via useTranslations, and the usePlayDuckShoot hook (mock or
 * real). The six prize tiers mirror the backend outcome set so the won multiplier
 * always maps to a duck. Server is the sole source of randomness.
 */
"use client";

import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { forwardRef, useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { usePlayDuckShoot } from "../hooks/usePlayDuckShoot";

// ─── Types & constants ───────────────────────────────────────────────────────

type GamePhase = "idle" | "playing" | "result";

type Outcome = { value: number; label: string; weight: number };

/** Odds metadata for the legend only; the six tiers mirror the backend outcome set. */
const OUTCOMES: Outcome[] = [
  { value: 10, label: "10%", weight: 35 },
  { value: 50, label: "50%", weight: 25 },
  { value: 100, label: "100%", weight: 19 },
  { value: 150, label: "150%", weight: 15 },
  { value: 300, label: "300%", weight: 5 },
  { value: 1000, label: "1000%", weight: 1 },
];

const FALLBACK_OUTCOME: Outcome = { value: 10, label: "10%", weight: 35 };

const DUCK_SRC = "/rewards/duck.png";

// ─── CarnivalBackground ──────────────────────────────────────────────────────

function CarnivalBackground() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "repeating-conic-gradient(from 0deg, #b91c1c 0deg 15deg, #ea580c 15deg 30deg)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 90% 60% at 50% 38%, rgba(255,228,60,0.78) 0%, rgba(255,150,0,0.4) 36%, transparent 68%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: 68,
          background:
            "repeating-linear-gradient(180deg, #7f1d1d 0px, #7f1d1d 16px, #991b1b 16px, #991b1b 32px)",
          boxShadow: "10px 0 28px rgba(0,0,0,0.55)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: 68,
          background:
            "repeating-linear-gradient(180deg, #7f1d1d 0px, #7f1d1d 16px, #991b1b 16px, #991b1b 32px)",
          boxShadow: "-10px 0 28px rgba(0,0,0,0.55)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 72,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 220,
          background:
            "linear-gradient(to top, rgba(4,0,14,0.97) 0%, rgba(4,0,14,0.68) 48%, transparent 100%)",
        }}
      />
    </div>
  );
}

// ─── WaveDivider ─────────────────────────────────────────────────────────────

function WaveDivider() {
  return (
    <svg
      width="100%"
      height="32"
      viewBox="0 0 400 32"
      preserveAspectRatio="none"
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <path
        d="M0,16 Q33,3 66,16 Q99,29 132,16 Q165,3 198,16 Q231,29 264,16 Q297,3 330,16 Q363,29 400,16 L400,32 L0,32 Z"
        fill="#1565c0"
      />
      <path
        d="M0,21 Q33,8 66,21 Q99,34 132,21 Q165,8 198,21 Q231,34 264,21 Q297,8 330,21 Q363,34 400,21 L400,32 L0,32 Z"
        fill="#1e88e5"
        opacity="0.5"
      />
    </svg>
  );
}

// ─── Inline SVG gun ──────────────────────────────────────────────────────────

function GunSVG() {
  return (
    <svg width="50" height="92" viewBox="0 0 50 92" fill="none" aria-hidden="true">
      <rect x="18" y="0" width="14" height="44" rx="5" fill="#8B5E3C" />
      <rect x="20" y="1" width="10" height="42" rx="4" fill="#6B4423" />
      <rect x="22" y="2" width="4" height="36" rx="2" fill="rgba(255,255,255,0.18)" />
      <rect x="23" y="0" width="4" height="5" rx="1.5" fill="#4A2E14" />
      <rect x="13" y="40" width="24" height="16" rx="5" fill="#7A5235" />
      <rect x="15" y="42" width="8" height="4" rx="2" fill="rgba(255,255,255,0.1)" />
      <path
        d="M17 50 Q25 64 33 50"
        stroke="#4A2E14"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="22" y="53" width="6" height="9" rx="2" fill="#3D2010" />
      <path
        d="M15 54 Q13 60 13 67 L13 85 Q13 90 18 90 L32 90 Q37 90 37 85 L37 67 Q37 60 35 54 Z"
        fill="#8B5E3C"
      />
      <rect x="17" y="56" width="4" height="28" rx="2" fill="rgba(255,255,255,0.1)" />
      <line x1="19" y1="62" x2="31" y2="62" stroke="#4A2E14" strokeWidth="1" opacity="0.45" />
      <line x1="19" y1="67" x2="31" y2="67" stroke="#4A2E14" strokeWidth="1" opacity="0.45" />
      <line x1="19" y1="72" x2="31" y2="72" stroke="#4A2E14" strokeWidth="1" opacity="0.45" />
      <line x1="19" y1="77" x2="31" y2="77" stroke="#4A2E14" strokeWidth="1" opacity="0.45" />
      <line x1="19" y1="82" x2="31" y2="82" stroke="#4A2E14" strokeWidth="1" opacity="0.45" />
    </svg>
  );
}

// ─── DuckCard ────────────────────────────────────────────────────────────────

type DuckCardProps = { outcome: Outcome; flipped: boolean; index: number };

const DUCK_SIZE = 92;

function DuckCard({ outcome, flipped, index }: DuckCardProps) {
  return (
    <div style={{ perspective: 700, flexShrink: 0 }}>
      <motion.div
        animate={{ y: [0, -9, 0], rotate: [-2, 2, -2] }}
        transition={{
          repeat: Number.POSITIVE_INFINITY,
          duration: 2.2,
          ease: "easeInOut",
          delay: (index % 6) * 0.36,
        }}
      >
        <div
          style={{
            position: "relative",
            width: DUCK_SIZE,
            height: DUCK_SIZE,
            transformStyle: "preserve-3d",
            transition: "transform 0.5s ease",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden" }}>
            <div style={{ position: "relative", width: DUCK_SIZE, height: DUCK_SIZE }}>
              <Image src={DUCK_SRC} width={DUCK_SIZE} height={DUCK_SIZE} alt="" />
              <div
                style={{
                  position: "absolute",
                  bottom: 2,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "rgba(0,0,0,0.82)",
                  border: "1.5px solid rgba(255,255,255,0.55)",
                  borderRadius: 14,
                  padding: "2px 7px",
                  fontSize: 11,
                  fontWeight: 900,
                  color: "#fff",
                  whiteSpace: "nowrap",
                  lineHeight: "15px",
                  letterSpacing: 0.3,
                }}
              >
                {outcome.label}
              </div>
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
            }}
          >
            <div style={{ position: "relative", width: DUCK_SIZE, height: DUCK_SIZE }}>
              <Image src={DUCK_SRC} width={DUCK_SIZE} height={DUCK_SIZE} alt="" />
              <div
                style={{
                  position: "absolute",
                  top: "72%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "rgba(200,0,0,0.5)",
                  border: "2.5px solid rgba(255,255,255,0.8)",
                  boxShadow: "0 0 0 4px rgba(255,0,0,0.18)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.9)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── DuckTrack ───────────────────────────────────────────────────────────────

function DuckTrack({ flipped, paused }: { flipped: boolean; paused: boolean }) {
  const doubled = [...OUTCOMES, ...OUTCOMES];
  return (
    <div style={{ overflow: "hidden", height: 124, position: "relative", borderRadius: 10 }}>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 36,
          background:
            "linear-gradient(to top, rgba(21,101,192,0.55) 0%, rgba(30,136,229,0.2) 60%, transparent 100%)",
          zIndex: 1,
          pointerEvents: "none",
        }}
      />
      <div
        className="animate-duck-scroll"
        style={{
          display: "flex",
          width: "max-content",
          alignItems: "center",
          height: "100%",
          animationPlayState: paused ? "paused" : "running",
        }}
      >
        {doubled.map((outcome, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: the doubled track is a fixed, never-reordered list
            key={i}
            style={{
              flexShrink: 0,
              width: 108,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <DuckCard outcome={outcome} flipped={flipped} index={i} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Gun ─────────────────────────────────────────────────────────────────────

const Gun = forwardRef<HTMLDivElement, { angle: number }>(function Gun({ angle }, ref) {
  return (
    <div
      ref={ref}
      style={{
        transform: `rotate(${angle}deg)`,
        transformOrigin: "50% 100%",
        filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.75))",
      }}
    >
      <GunSVG />
    </div>
  );
});

// ─── BangEffect ──────────────────────────────────────────────────────────────

function BangEffect({ x, y }: { x: number; y: number }) {
  return (
    <motion.div
      className="pointer-events-none absolute z-10 select-none font-black"
      style={{
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        color: "#fbbf24",
        fontSize: 32,
        letterSpacing: 2,
        textShadow: "0 0 12px rgba(251,191,36,0.9), 0 0 24px rgba(250,100,0,0.6)",
      }}
      initial={{ opacity: 1, scale: 0.3 }}
      animate={{ opacity: 0, scale: 2.2 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
    >
      BANG!
    </motion.div>
  );
}

// ─── ResultCard ──────────────────────────────────────────────────────────────

function ResultCard({
  outcome,
  onPlayAgain,
  visible,
}: {
  outcome: Outcome;
  onPlayAgain: () => void;
  visible: boolean;
}) {
  const t = useTranslations("rewards");
  const isJackpot = outcome.value >= 1000;
  const isBig = outcome.value >= 300;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute inset-0 z-20 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.84)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="flex flex-col items-center gap-3 rounded-3xl border border-border p-8"
            style={{ background: "#0d0e14", maxWidth: 300, width: "88%" }}
            initial={{ scale: 0.65, y: 28 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.65, y: 28 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <div
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <motion.div
                animate={{ y: [0, -10, 0], rotate: [-3, 3, -3] }}
                transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2.2, ease: "easeInOut" }}
              >
                <Image src={DUCK_SRC} width={120} height={120} alt="" />
              </motion.div>
              <motion.svg
                width="140"
                height="20"
                viewBox="0 0 140 20"
                style={{ marginTop: -14, display: "block" }}
                animate={{ x: [-8, 8, -8] }}
                transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2.2, ease: "easeInOut" }}
                aria-hidden="true"
              >
                <path
                  d="M0,10 Q17,2 35,10 Q52,18 70,10 Q87,2 105,10 Q122,18 140,10"
                  stroke="#1976d2"
                  strokeWidth="2.5"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M0,14 Q17,6 35,14 Q52,22 70,14 Q87,6 105,14 Q122,22 140,14"
                  stroke="#42a5f5"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  opacity="0.5"
                />
              </motion.svg>
            </div>

            {isJackpot && (
              <motion.p
                className="font-black tracking-widest"
                style={{ color: "#fbbf24", fontSize: 13, letterSpacing: 3 }}
                animate={{ scale: [1, 1.12, 1] }}
                transition={{ repeat: Number.POSITIVE_INFINITY, duration: 0.9 }}
              >
                {t("rubberRush.duckShoot.jackpot")}
              </motion.p>
            )}

            <p
              className="font-black"
              style={{
                fontSize: isJackpot ? 52 : isBig ? 44 : 36,
                lineHeight: 1,
                color: isJackpot ? "#fbbf24" : isBig ? "#4ade80" : "#fff",
                textShadow: isJackpot ? "0 0 28px rgba(251,191,36,0.55)" : undefined,
              }}
            >
              {outcome.label}
            </p>

            <p style={{ color: "#6b7280", fontSize: 13, textAlign: "center", lineHeight: 1.45 }}>
              {t("rubberRush.duckShoot.boostResult", { percent: outcome.value })}
            </p>

            <Button onClick={onPlayAgain} className="mt-1 w-full">
              {t("rubberRush.duckShoot.playAgain")}
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── DuckGame (main export) ──────────────────────────────────────────────────

/** Public props for {@link DuckGame}. */
export interface DuckGameProps {
  /** Tries the player can use this week. */
  triesRemaining: number;
  /** Tries left to earn this week (shown in the no-tries message). */
  weeklyTriesLeft: number;
  /** Called after a successful play so the parent can refresh status. */
  onPlayed?: () => void;
}

/** The carnival Duck Shoot mini-game. */
export function DuckGame({ triesRemaining, weeklyTriesLeft, onPlayed }: DuckGameProps) {
  const t = useTranslations("rewards");
  const { play } = usePlayDuckShoot();

  const [phase, setPhase] = useState<GamePhase>("idle");
  const [triesLeft, setTriesLeft] = useState(triesRemaining);
  const [gunAngle, setGunAngle] = useState(0);
  const [shotPos, setShotPos] = useState<{ x: number; y: number } | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [isShooting, setIsShooting] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const gunRef = useRef<HTMLDivElement>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastShotAtRef = useRef<number>(0);

  const hasNoTries = triesLeft <= 0;

  const updateGunAngle = useCallback((clientX: number, clientY: number) => {
    const gun = gunRef.current;
    if (!gun) return;
    const rect = gun.getBoundingClientRect();
    const pivotX = rect.left + rect.width / 2;
    const pivotY = rect.top + rect.height;
    const raw = Math.atan2(clientY - pivotY, clientX - pivotX) * (180 / Math.PI) + 90;
    setGunAngle(Math.max(-78, Math.min(78, raw)));
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (phase !== "playing") return;
      updateGunAngle(e.clientX, e.clientY);
    },
    [phase, updateGunAngle],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (phase !== "playing") return;
      const touch = e.touches[0];
      if (touch) updateGunAngle(touch.clientX, touch.clientY);
    },
    [phase, updateGunAngle],
  );

  const handleShot = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (phase !== "playing" || isShooting) return;
      const now = Date.now();
      if (now - lastShotAtRef.current < 2000) return;
      lastShotAtRef.current = now;

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setShotPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setIsShooting(true);

      const outcome = await play();
      setIsShooting(false);

      if (outcome.status !== "played") {
        setShotPos(null);
        if (outcome.status === "no_tries") {
          setTriesLeft(0);
          setPhase("idle");
        }
        // already_played_recently / error: silently let the player try again.
        return;
      }

      const matched = OUTCOMES.find((o) => o.value === outcome.result.multiplierPct);
      setResult(matched ?? { ...FALLBACK_OUTCOME, value: outcome.result.multiplierPct });
      setTriesLeft(outcome.result.triesLeft);
      setPhase("result");
      resultTimerRef.current = setTimeout(() => setShowResult(true), 420);
      onPlayed?.();
    },
    [phase, isShooting, play, onPlayed],
  );

  const handleStart = useCallback(() => {
    setPhase("playing");
    setGunAngle(0);
    setShotPos(null);
    setResult(null);
    setShowResult(false);
  }, []);

  const handlePlayAgain = useCallback(() => {
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    setPhase("idle");
    setShowResult(false);
    setShotPos(null);
    setResult(null);
    setGunAngle(0);
  }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the play surface is an inherently pointer-aim shooting area; the real controls (Start / Play again) are buttons.
    // biome-ignore lint/a11y/useKeyWithClickEvents: aiming + firing is a continuous pointer/touch gesture with no meaningful keyboard equivalent; keyboard users use the Start/Play again buttons.
    <div
      ref={containerRef}
      style={{
        position: "relative",
        // Contain the game's internal z-index layers (background/content/result)
        // so they don't paint over the dialog's close button (PP-REW-MOD-001).
        isolation: "isolate",
        borderRadius: 24,
        overflow: "hidden",
        userSelect: "none",
        minHeight: 440,
        cursor: phase === "playing" ? "crosshair" : "default",
      }}
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onClick={phase === "playing" ? handleShot : undefined}
    >
      <CarnivalBackground />

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ textAlign: "center", paddingTop: 18, paddingBottom: 12 }}>
          <div
            style={{
              display: "inline-block",
              background: "linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)",
              border: "2px solid #d97706",
              borderRadius: 10,
              padding: "5px 28px",
              boxShadow: "0 4px 18px rgba(0,0,0,0.6)",
            }}
          >
            <span
              style={{
                color: "#fbbf24",
                fontSize: 20,
                fontWeight: 900,
                letterSpacing: 5,
                textShadow: "0 1px 8px rgba(0,0,0,0.55)",
              }}
            >
              {t("rubberRush.duckShoot.title")}
            </span>
          </div>
        </div>

        <div style={{ padding: "0 16px 0" }}>
          <DuckTrack flipped={phase !== "idle"} paused={phase === "result"} />
        </div>

        <div style={{ marginTop: -44 }}>
          <WaveDivider />
        </div>

        <div
          style={{
            minHeight: 220,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px 16px 20px",
            gap: 10,
          }}
        >
          <AnimatePresence>
            {phase === "idle" && !hasNoTries && (
              <motion.div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "center",
                  gap: "3px 10px",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {OUTCOMES.map((o) => (
                  <span key={o.value} style={{ fontSize: 11, color: "#9ca3af" }}>
                    {t("rubberRush.duckShoot.oddsItem", { percent: o.value, weight: o.weight })}
                  </span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {phase === "idle" && hasNoTries && (
              <motion.p
                style={{
                  color: "#e5e7eb",
                  fontSize: 14,
                  textAlign: "center",
                  maxWidth: 360,
                  lineHeight: 1.5,
                  padding: "0 12px",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {t("rubberRush.duckShoot.noTries", { count: weeklyTriesLeft })}
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {phase === "idle" && !hasNoTries && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.15 }}
              >
                <Button onClick={handleStart} className="px-14 py-3 font-black tracking-widest">
                  {t("rubberRush.duckShoot.start")}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {phase === "playing" && (
              <motion.p
                style={{ color: "#9ca3af", fontSize: 13 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {t("rubberRush.duckShoot.instruction")}
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {(phase === "playing" || phase === "result") && (
              <motion.div
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 28 }}
                transition={{ duration: 0.25 }}
              >
                <Gun angle={gunAngle} ref={gunRef} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {shotPos && phase === "result" && <BangEffect x={shotPos.x} y={shotPos.y} />}
      </AnimatePresence>

      {result && <ResultCard outcome={result} onPlayAgain={handlePlayAgain} visible={showResult} />}
    </div>
  );
}
