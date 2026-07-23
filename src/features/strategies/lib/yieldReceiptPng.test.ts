/**
 * @id PP-STR-CMP-006
 * @name yieldReceiptPng — tests
 * Behavior: the canvas renderer draws the pre-formatted amount in the gain / loss color (R6),
 * draws the referral link (R3) and never draws a percent sign (R1). POO-906: the drawn link is
 * the SHORTENED display form ([R1], same truncation as the DOM card) and the export REJECTS on
 * every failure path (null ctx / null blob) instead of degrading to a silent null ([R5]).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drawYieldReceipt,
  exportYieldReceiptPng,
  type ReceiptContext2D,
  type YieldReceiptData,
} from "./yieldReceiptPng";

interface DrawnText {
  text: string;
  fill: string;
  font: string;
}

/** A recording stub of the 2D context. */
function recordingContext() {
  const texts: DrawnText[] = [];
  const ctx = {
    fillStyle: "" as string,
    strokeStyle: "" as string,
    lineWidth: 0,
    font: "",
    textAlign: "center" as CanvasTextAlign,
    globalAlpha: 1,
    fillRect: () => {},
    fillText: (text: string) => {
      texts.push({ text, fill: String(ctx.fillStyle), font: ctx.font });
    },
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    roundRect: () => {},
    setLineDash: () => {},
  };
  return { ctx: ctx as unknown as ReceiptContext2D, texts };
}

const data: YieldReceiptData = {
  strategyName: "Stable Yield",
  riskLabel: "Conservative",
  amountText: "+$612.50",
  isGain: true,
  periodText: "Last 30 days",
  kicker: "Yield Receipt",
  earnedIn: "in fees & yield",
  strategyLabel: "Strategy",
  periodLabel: "Period",
  invite: "Invest with me",
  referralLink: "app.pool-party.xyz?ref=maria2026",
};

describe("drawYieldReceipt", () => {
  // @rule R6 — gain draws green, loss draws red
  it("draws the amount in the gain color", () => {
    const { ctx, texts } = recordingContext();
    drawYieldReceipt(ctx, data);
    const amount = texts.find((entry) => entry.text === "+$612.50");
    expect(amount?.fill).toBe("#22c55e");
  });

  it("draws a loss amount in the loss color", () => {
    const { ctx, texts } = recordingContext();
    drawYieldReceipt(ctx, { ...data, amountText: "-$321.40", isGain: false });
    const amount = texts.find((entry) => entry.text === "-$321.40");
    expect(amount?.fill).toBe("#fc3c25");
  });

  // @rule R1 — no percent sign in any drawn text
  it("never draws a percent sign", () => {
    const { ctx, texts } = recordingContext();
    drawYieldReceipt(ctx, data);
    expect(texts.some((entry) => entry.text.includes("%"))).toBe(false);
  });

  // @rule R3 — the referral link and the call are on the artifact
  it("draws the referral link and the invite call", () => {
    const { ctx, texts } = recordingContext();
    drawYieldReceipt(ctx, data);
    expect(texts.some((entry) => entry.text === "app.pool-party.xyz?ref=maria2026")).toBe(true);
    expect(texts.some((entry) => entry.text === "INVEST WITH ME")).toBe(true);
  });

  // @rule POO-906 R1 — the painter draws the SHORTENED display link, identical to the DOM card
  it("[R1] draws the shortened display form of a long strategy referral link", () => {
    const { ctx, texts } = recordingContext();
    const longLink =
      "v2.dev.pool-party.xyz/strategies/0x357d1E34aBcD9915ef33CAdd8888ffFF00001111?ref=Surfista";
    drawYieldReceipt(ctx, { ...data, referralLink: longLink });
    expect(texts.some((entry) => entry.text === longLink)).toBe(false);
    expect(
      texts.some(
        (entry) => entry.text === "v2.dev.pool-party.xyz/strategies/0x357d...?ref=Surfista",
      ),
    ).toBe(true);
  });

  // The page's real (hashed next/font) family must thread into every ctx.font, and the hero
  // amount uses 700 — the heaviest Poppins face the app ships.
  it("threads the resolved font family into every drawn text and caps the weight at 700", () => {
    const { ctx, texts } = recordingContext();
    drawYieldReceipt(ctx, data, "__poppins_abc123, sans-serif");
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((entry) => entry.font.includes("__poppins_abc123"))).toBe(true);
    const amount = texts.find((entry) => entry.text === "+$612.50");
    expect(amount?.font).toContain("700 132px");
    expect(texts.some((entry) => entry.font.startsWith("800"))).toBe(false);
  });
});

describe("exportYieldReceiptPng", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // @rule POO-906 R5 — a missing 2D context REJECTS (surfaced by the caller), never a silent null
  it("[R5] rejects when getContext returns no 2D context (jsdom default)", async () => {
    await expect(exportYieldReceiptPng(data)).rejects.toThrow(/2D context/);
  });

  // @rule POO-906 R5 — a null toBlob result REJECTS, never a silent null
  it("[R5] rejects when toBlob produces no image", async () => {
    const { ctx } = recordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback: BlobCallback) => {
      callback(null);
    });
    await expect(exportYieldReceiptPng(data)).rejects.toThrow(/no image/);
  });

  // @rule R5 — the exported canvas is exactly 1080x1080 and encodes as image/png
  it("draws into a 1080x1080 canvas and encodes image/png", async () => {
    const { ctx } = recordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    let blobType: string | undefined;
    let size: { w: number; h: number } | undefined;
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
    ) {
      size = { w: this.width, h: this.height };
      blobType = type;
      callback(new Blob(["png"], { type: "image/png" }));
    });
    const blob = await exportYieldReceiptPng(data);
    expect(blob).not.toBeNull();
    expect(size).toEqual({ w: 1080, h: 1080 });
    expect(blobType).toBe("image/png");
  });
});
