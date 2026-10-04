/**
 * @id PP-MGR-LIB-022
 * @name viewportMath tests
 * @implements-rules-version v1 (POO-2152 rules v1)
 * @analytics-events none, pure geometry; the Build screen (PP-MGR-SCR-002, S7) owns every event
 *
 * The geometry of the Build canvas viewport (handoff v1.2 [I8], [I9], default D8): fit, zoom around a
 * point, the control steps and their limits, the wheel, the pan threshold and reveal.
 *
 * The fit oracles are the handoff's own numbers: worked example 1 (reference canvas C, 608 x 674),
 * reference canvas A (2080 x 772) and reference canvas D (468 x 572), each in the 656 x 640 canvas
 * of the Build frames. The readout the frames print is the rounded percent of the same scale.
 */
import { describe, expect, it } from "vitest";
import {
  applyWheel,
  computeFit,
  ensureVisible,
  exceedsPanThreshold,
  formatZoom,
  type Size,
  stepZoom,
  type ViewTransform,
  ZOOM,
  zoomAround,
} from "./viewportMath";

const CANVAS: Size = { width: 656, height: 640 };

/** The graph point under a screen point, which zooming around that point must keep fixed. */
function graphPointAt(view: ViewTransform, screen: { x: number; y: number }) {
  return { x: (screen.x - view.x) / view.scale, y: (screen.y - view.y) / view.scale };
}

describe("ZOOM constants", () => {
  // @rule I8 (D8)
  it("[I8] steps 10% between 25% and 150%, fit pads 24 by 56, 16 from the top, pan after 4 px", () => {
    expect(ZOOM).toEqual({
      MIN: 0.25,
      MAX: 1.5,
      STEP: 0.1,
      FIT_PAD_X: 24,
      FIT_PAD_Y: 56,
      FIT_TOP: 16,
      PAN_THRESHOLD: 4,
    });
  });
});

describe("computeFit", () => {
  // @rule I8
  it("[I8] worked example 1 (608 x 674) fits at 0.8665, readout 87%", () => {
    const fit = computeFit(CANVAS, { width: 608, height: 674 });

    expect(fit.scale).toBe(584 / 674);
    expect(fit.scale).toBeCloseTo(0.8665, 4);
    expect(formatZoom(fit.scale)).toBe(87);
  });

  // @rule I8
  it("[I8] reference canvas A (2080 x 772) fits at 0.3038, below the 25% floor is allowed, readout 30%", () => {
    const fit = computeFit(CANVAS, { width: 2080, height: 772 });

    expect(fit.scale).toBe(632 / 2080);
    expect(fit.scale).toBeCloseTo(0.3038, 4);
    expect(formatZoom(fit.scale)).toBe(30);
  });

  // @rule I8
  it("[I8] reference canvas D (468 x 572) never zooms past 100% to fit, readout 100%", () => {
    const fit = computeFit(CANVAS, { width: 468, height: 572 });

    expect(fit.scale).toBe(1);
    expect(formatZoom(fit.scale)).toBe(100);
  });

  // @rule I8
  it("[I8] centres the graph horizontally and starts it 16 px from the top", () => {
    const c = computeFit(CANVAS, { width: 608, height: 674 });
    expect(c.x).toBeCloseTo((656 - 608 * c.scale) / 2, 6);
    expect(c.y).toBe(16);

    const d = computeFit(CANVAS, { width: 468, height: 572 });
    expect(d).toEqual({ scale: 1, x: 94, y: 16 });

    const a = computeFit(CANVAS, { width: 2080, height: 772 });
    expect(a.x).toBeCloseTo(12, 6);
    expect(a.y).toBe(16);
  });

  // @rule I8
  it("[I8] may go below 25% for a very large graph", () => {
    const fit = computeFit(CANVAS, { width: 6320, height: 772 });

    expect(fit.scale).toBeCloseTo(0.1, 6);
    expect(fit.scale).toBeLessThan(ZOOM.MIN);
  });

  // @rule I8
  it("[I8] an empty graph or an unmeasured canvas fits at 100% instead of dividing by zero", () => {
    expect(computeFit(CANVAS, { width: 0, height: 0 }).scale).toBe(1);
    expect(computeFit({ width: 0, height: 0 }, { width: 608, height: 674 }).scale).toBe(1);
  });
});

describe("zoomAround", () => {
  // @rule I8
  it("[I8] keeps the graph point under the pointer where it was", () => {
    const view: ViewTransform = { scale: 0.8, x: 40, y: 16 };
    const pointer = { x: 300, y: 250 };
    const before = graphPointAt(view, pointer);

    const next = zoomAround(view, 1.2, pointer);

    expect(next.scale).toBe(1.2);
    const after = graphPointAt(next, pointer);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  // @rule I8
  it("[I8] places the transform exactly for a simple case", () => {
    expect(zoomAround({ scale: 1, x: 10, y: 20 }, 2, { x: 110, y: 220 })).toEqual({
      scale: 2,
      x: -90,
      y: -180,
    });
  });
});

describe("stepZoom", () => {
  const at = (scale: number): ViewTransform => ({ scale, x: 0, y: 0 });

  // @rule I8 (D8)
  it("[I8] rounds to the 10% grid in the direction of the step", () => {
    expect(stepZoom(at(0.8665), 1, CANVAS).scale).toBe(0.9);
    expect(stepZoom(at(0.8665), -1, CANVAS).scale).toBe(0.8);
    expect(stepZoom(at(0.30385), 1, CANVAS).scale).toBe(0.4);
    expect(stepZoom(at(0.30385), -1, CANVAS).scale).toBe(0.3);
  });

  // @rule I8 (D8)
  it("[I8] steps exactly 10% from a scale already on the grid, floating point included", () => {
    expect(stepZoom(at(1), 1, CANVAS).scale).toBe(1.1);
    expect(stepZoom(at(1), -1, CANVAS).scale).toBe(0.9);
    expect(stepZoom(at(0.7), 1, CANVAS).scale).toBe(0.8);
    expect(stepZoom(at(0.1 * 3), 1, CANVAS).scale).toBe(0.4);
  });

  // @rule I8 (D8)
  it("[I8] clamps at 150% and zoom in there changes nothing", () => {
    expect(stepZoom(at(1.45), 1, CANVAS).scale).toBe(1.5);
    const top = at(1.5);
    expect(stepZoom(top, 1, CANVAS)).toEqual(top);
  });

  // @rule I8 (D8)
  it("[I8] clamps at 25% and zoom out there, or below it, changes nothing", () => {
    expect(stepZoom(at(0.3), -1, CANVAS).scale).toBe(0.25);
    const floor = at(0.25);
    expect(stepZoom(floor, -1, CANVAS)).toEqual(floor);
    const below = at(0.2);
    expect(stepZoom(below, -1, CANVAS)).toEqual(below);
  });

  // @rule I8 (D8)
  it("[I8] zoom in from below 25% goes to 25%, then on to the grid", () => {
    expect(stepZoom(at(0.2), 1, CANVAS).scale).toBe(0.25);
    expect(stepZoom(at(0.25), 1, CANVAS).scale).toBe(0.3);
  });

  // @rule I8
  it("[I8] zooms around the centre of the canvas", () => {
    const view: ViewTransform = { scale: 0.8665, x: 64.6, y: 16 };
    const centre = { x: CANVAS.width / 2, y: CANVAS.height / 2 };
    const before = graphPointAt(view, centre);

    const after = graphPointAt(stepZoom(view, 1, CANVAS), centre);

    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe("applyWheel", () => {
  const view: ViewTransform = { scale: 1, x: 100, y: 50 };
  const pointer = { x: 320, y: 200 };

  // @rule I8
  it("[I8] a plain wheel pans by its delta", () => {
    const next = applyWheel(view, {
      deltaX: 30,
      deltaY: 120,
      deltaMode: 0,
      zoom: false,
      shiftKey: false,
      pointer,
    });

    expect(next).toEqual({ scale: 1, x: 70, y: -70 });
  });

  // @rule I8
  it("[I8] a wheel in lines pans by 16 px per line", () => {
    const next = applyWheel(view, {
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      zoom: false,
      shiftKey: false,
      pointer,
    });

    expect(next).toEqual({ scale: 1, x: 100, y: 2 });
  });

  // @rule I8
  it("[I8] Shift + a vertical wheel pans sideways, for a mouse with one wheel", () => {
    const next = applyWheel(view, {
      deltaX: 0,
      deltaY: 40,
      deltaMode: 0,
      zoom: false,
      shiftKey: true,
      pointer,
    });

    expect(next).toEqual({ scale: 1, x: 60, y: 50 });
  });

  // @rule I8
  it("[I8] with the zoom modifier, wheel up zooms in and down zooms out, around the pointer", () => {
    const zoomIn = applyWheel(view, {
      deltaX: 0,
      deltaY: -50,
      deltaMode: 0,
      zoom: true,
      shiftKey: false,
      pointer,
    });
    const zoomOut = applyWheel(view, {
      deltaX: 0,
      deltaY: 50,
      deltaMode: 0,
      zoom: true,
      shiftKey: false,
      pointer,
    });

    expect(zoomIn.scale).toBeGreaterThan(1);
    expect(zoomOut.scale).toBeLessThan(1);
    const before = graphPointAt(view, pointer);
    const after = graphPointAt(zoomIn, pointer);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  // @rule I8 (D8)
  it("[I8] the wheel zoom stays inside 25% to 150%", () => {
    const big = applyWheel(
      { scale: 1.45, x: 0, y: 0 },
      { deltaX: 0, deltaY: -5000, deltaMode: 0, zoom: true, shiftKey: false, pointer },
    );
    const small = applyWheel(
      { scale: 0.3, x: 0, y: 0 },
      { deltaX: 0, deltaY: 5000, deltaMode: 0, zoom: true, shiftKey: false, pointer },
    );

    expect(big.scale).toBe(1.5);
    expect(small.scale).toBe(0.25);
  });

  // @rule I8 (D8)
  it("[I8] below 25% (a large fit) the wheel never zooms further out, and zooming in still works", () => {
    const fitted: ViewTransform = { scale: 0.18, x: 0, y: 0 };

    const out = applyWheel(fitted, {
      deltaX: 0,
      deltaY: 80,
      deltaMode: 0,
      zoom: true,
      shiftKey: false,
      pointer,
    });
    const inward = applyWheel(fitted, {
      deltaX: 0,
      deltaY: -10,
      deltaMode: 0,
      zoom: true,
      shiftKey: false,
      pointer,
    });

    expect(out.scale).toBe(0.18);
    expect(inward.scale).toBeGreaterThan(0.18);
  });
});

describe("exceedsPanThreshold", () => {
  // @rule I5 (part)
  it("[I5] a press that moves more than 4 px is a pan; 4 px or less is still a click", () => {
    expect(exceedsPanThreshold(4, 0)).toBe(false);
    expect(exceedsPanThreshold(0, -4)).toBe(false);
    expect(exceedsPanThreshold(3, 3)).toBe(true);
    expect(exceedsPanThreshold(5, 0)).toBe(true);
  });
});

describe("ensureVisible", () => {
  const canvas: Size = { width: 600, height: 400 };
  const view: ViewTransform = { scale: 1, x: 0, y: 0 };

  // @rule I9 (part)
  it("[I9] leaves the view alone when the rect is already in view with its margin", () => {
    expect(ensureVisible(view, { x: 100, y: 100, w: 176, h: 62 }, canvas)).toBe(view);
  });

  // @rule I9 (part)
  it("[I9] pans the minimum to bring a rect on the right or below into view with a 24 margin", () => {
    const next = ensureVisible(view, { x: 700, y: 500, w: 176, h: 62 }, canvas);

    expect(next.scale).toBe(1);
    expect(next.x).toBe(600 - 24 - 876);
    expect(next.y).toBe(400 - 24 - 562);
  });

  // @rule I9 (part)
  it("[I9] pans the minimum to bring a rect on the left or above into view", () => {
    const next = ensureVisible(
      { scale: 1, x: -300, y: -200 },
      { x: 100, y: 50, w: 176, h: 62 },
      canvas,
    );

    expect(next).toEqual({ scale: 1, x: 24 - 100, y: 24 - 50 });
  });

  // @rule I9 (part)
  it("[I9] works in screen space at any scale and never changes the scale", () => {
    const zoomed: ViewTransform = { scale: 0.5, x: 0, y: 0 };

    const next = ensureVisible(zoomed, { x: 1200, y: 100, w: 176, h: 62 }, canvas);

    expect(next.scale).toBe(0.5);
    // Right edge on screen: 1376 * 0.5 + x must land at 600 - 24.
    expect(1376 * 0.5 + next.x).toBe(576);
    expect(next.y).toBe(0);
  });

  // @rule I9 (part)
  it("[I9] a rect larger than the view shows its top-left corner", () => {
    const next = ensureVisible(view, { x: 300, y: 300, w: 900, h: 700 }, canvas);

    expect(next).toEqual({ scale: 1, x: 24 - 300, y: 24 - 300 });
  });

  // @rule I9 (part)
  it("[I9] takes a custom margin", () => {
    const next = ensureVisible(view, { x: 700, y: 0, w: 100, h: 62 }, canvas, 0);

    expect(next.x).toBe(600 - 800);
  });
});

describe("formatZoom", () => {
  // @rule I8
  it("[I8] the readout is the rounded percent of the scale", () => {
    expect(formatZoom(0.866468)).toBe(87);
    expect(formatZoom(0.303846)).toBe(30);
    expect(formatZoom(1)).toBe(100);
    expect(formatZoom(1.5)).toBe(150);
    expect(formatZoom(0.255)).toBe(26);
  });
});
