/**
 * @id PP-STR-CMP-006
 * @name yieldReceiptPng
 * @implements-rules-version v2 (POO-906 rules v1)
 *
 * Canvas renderer for the shareable Yield Receipt PNG (POO-275 R5: 1080x1080). Draws the same
 * artifact as the `YieldReceiptCard` DOM preview at full social resolution, dependency-free.
 * All copy arrives pre-localized so this module stays hook-free and unit-testable; the privacy
 * rule [R1] holds by construction (the only figure drawn is the pre-formatted earned amount).
 * Colors are the locked brand values of the Figma component (5888:522).
 *
 * POO-906 [R1]: the referral link is drawn in the SHORTENED display form (`truncateDisplayLink`,
 * identical to the DOM card), size-fitted to the ticket so it never overflows or wraps.
 * POO-906 [R5]: `exportYieldReceiptPng` THROWS on every failure path (no document / no 2D context /
 * a null `toBlob` result) instead of resolving null — callers surface the failure, never a silent
 * no-op. Taint audit (POO-906): this painter draws TEXT AND VECTORS ONLY — no `drawImage`, the DOM
 * preview's duck-head <img> is never painted here — so the canvas cannot be tainted and `toBlob`
 * cannot fail on origin grounds. If an image is ever added, it must be same-origin or loaded with
 * `crossOrigin="anonymous"`, or the export starts throwing SecurityError.
 */
import { BARCODE_PATTERN, truncateDisplayLink } from "../components/YieldReceiptCard";

/** Everything the renderer needs, pre-formatted and pre-localized. */
export interface YieldReceiptData {
  /** Strategy display name. */
  strategyName: string;
  /** Localized risk label (e.g. "Conservative"). */
  riskLabel: string;
  /** Pre-formatted signed amount, e.g. "+$612.50" or "-$321.40". */
  amountText: string;
  /** Gain renders green, loss renders red [R6]. */
  isGain: boolean;
  /** Localized period line, e.g. "Last 30 days". */
  periodText: string;
  /** Localized labels. */
  kicker: string;
  earnedIn: string;
  strategyLabel: string;
  periodLabel: string;
  invite: string;
  /** The user's referral link [R3]. */
  referralLink: string;
}

/** Card geometry (canvas pixels). */
export const PNG_SIZE = 1080;
const TICKET = { x: 150, y: 90, w: 780, h: 900, r: 28 };

const COLORS = {
  background: "#0c0c0e",
  ticket: "#1f1f1f",
  divider: "#3a3a3a",
  heading: "#ffffff",
  soft: "#a3a3a3",
  brand: "#efefef",
  gold: "#f7ce02",
  gain: "#22c55e",
  loss: "#fc3c25",
} as const;

/** Minimal 2D-context surface used by the renderer (test-stubbable). */
export type ReceiptContext2D = Pick<
  CanvasRenderingContext2D,
  | "fillRect"
  | "fillText"
  | "beginPath"
  | "arc"
  | "fill"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "roundRect"
  | "setLineDash"
> & {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  globalAlpha: number;
};

function text(
  ctx: ReceiptContext2D,
  value: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = "center",
) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
}

function dashedDivider(ctx: ReceiptContext2D, y: number) {
  ctx.strokeStyle = COLORS.divider;
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 12]);
  ctx.beginPath();
  ctx.moveTo(TICKET.x + 48, y);
  ctx.lineTo(TICKET.x + TICKET.w - 48, y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Perforation notches punched in the ticket edges, filled with the page background.
  ctx.fillStyle = COLORS.background;
  for (const cx of [TICKET.x, TICKET.x + TICKET.w]) {
    ctx.beginPath();
    ctx.arc(cx, y, 22, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Draw the full receipt into a 1080x1080 context. Exported separately for unit tests.
 * `fontFamily` must be the page's REAL font stack: next/font registers Poppins under a hashed
 * family name, so a literal "Poppins" never resolves in production (see resolveFontFamily).
 */
export function drawYieldReceipt(
  ctx: ReceiptContext2D,
  data: YieldReceiptData,
  fontFamily: string = "Poppins, sans-serif",
): void {
  const centerX = PNG_SIZE / 2;
  const font = (weight: number, size: number) => `${weight} ${size}px ${fontFamily}`;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, PNG_SIZE, PNG_SIZE);

  ctx.fillStyle = COLORS.ticket;
  ctx.beginPath();
  ctx.roundRect(TICKET.x, TICKET.y, TICKET.w, TICKET.h, TICKET.r);
  ctx.fill();

  // Brand lockup (text only at canvas scale) + kicker.
  text(ctx, "Pool Party", centerX, 188, font(600, 44), COLORS.brand);
  text(ctx, data.kicker.toUpperCase(), centerX, 248, font(500, 26), COLORS.soft);

  dashedDivider(ctx, 296);

  // Strategy identity.
  text(ctx, data.strategyName, centerX, 386, font(600, 52), COLORS.heading);
  text(ctx, data.riskLabel, centerX, 436, font(500, 30), COLORS.soft);

  // Hero amount: the only figure on the card [R1]; green gain / red loss [R6]. Weight 700 — the
  // heaviest Poppins face the app ships (no 800 woff2); the DOM preview uses font-bold to match.
  text(ctx, data.amountText, centerX, 572, font(700, 132), data.isGain ? COLORS.gain : COLORS.loss);
  text(ctx, data.earnedIn, centerX, 642, font(500, 36), COLORS.soft);

  // STRATEGY / PERIOD rows.
  const leftX = TICKET.x + 64;
  const rightX = TICKET.x + TICKET.w - 64;
  text(ctx, data.strategyLabel.toUpperCase(), leftX, 716, font(500, 22), COLORS.soft, "left");
  text(ctx, data.strategyName, leftX, 758, font(600, 34), COLORS.heading, "left");
  text(ctx, data.periodLabel.toUpperCase(), rightX, 716, font(500, 22), COLORS.soft, "right");
  text(ctx, data.periodText, rightX, 758, font(600, 34), COLORS.heading, "right");

  dashedDivider(ctx, 806);

  // Referral call + link [R3]. POO-906 [R1]: the SHORTENED display form (host + truncated path +
  // full ?ref=, same helper as the DOM card), single line. The base 34px size scales down for long
  // links and fillText's maxWidth hard-caps the line inside the ticket, so it can never overflow.
  text(ctx, data.invite.toUpperCase(), centerX, 862, font(600, 24), COLORS.gold);
  const displayLink = truncateDisplayLink(data.referralLink);
  const linkMaxWidth = TICKET.w - 128;
  const linkSize =
    displayLink.length <= 34 ? 34 : Math.max(22, Math.round((34 * 34) / displayLink.length));
  ctx.font = font(700, linkSize);
  ctx.fillStyle = COLORS.heading;
  ctx.textAlign = "center";
  ctx.fillText(displayLink, centerX, 912, linkMaxWidth);

  // Decorative barcode stub (deterministic pattern shared with the DOM preview).
  const totalWidth = BARCODE_PATTERN.reduce((sum, width) => sum + width * 3 + 3, -3);
  let barX = centerX - totalWidth / 2;
  ctx.fillStyle = COLORS.gold;
  ctx.globalAlpha = 0.85;
  for (const width of BARCODE_PATTERN) {
    ctx.fillRect(barX, 938, width * 3, 36);
    barX += width * 3 + 3;
  }
  ctx.globalAlpha = 1;
}

/**
 * The page's computed font stack. next/font/local exposes Poppins only through a hashed family
 * name (via the --font-poppins variable), so canvas text must use the computed stack — a literal
 * "Poppins" silently falls back to generic sans-serif.
 */
function resolveFontFamily(): string {
  const family = getComputedStyle(document.body).fontFamily;
  return family && family.trim().length > 0 ? family : "Poppins, sans-serif";
}

/**
 * Render the receipt into an offscreen canvas and return it as a PNG blob. POO-906 [R5]: every
 * failure path REJECTS with a descriptive error — no document (non-browser context), no 2D
 * context, or a null `toBlob` result — so callers can surface it; never a silent null.
 */
export async function exportYieldReceiptPng(data: YieldReceiptData): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("yield-receipt export: document unavailable (non-browser context)");
  }
  const canvas = document.createElement("canvas");
  canvas.width = PNG_SIZE;
  canvas.height = PNG_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("yield-receipt export: canvas 2D context unavailable");
  // Canvas drawing never triggers font loading: wait for the page's faces (already requested by
  // the DOM preview) before drawing, or the first export races the font load.
  if (document.fonts?.ready) await document.fonts.ready;
  drawYieldReceipt(ctx, data, resolveFontFamily());
  return new Promise((resolve, reject) => {
    // A synchronous toBlob throw (the SecurityError of a tainted canvas — impossible today, see the
    // header taint audit) rejects via the Promise-executor contract; a null blob rejects explicitly.
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("yield-receipt export: canvas produced no image"));
    }, "image/png");
  });
}
