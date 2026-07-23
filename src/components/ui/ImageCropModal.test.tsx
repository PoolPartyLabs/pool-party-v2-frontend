/**
 * @id PP-CORE-MOD-007
 * @name ImageCropModal — tests
 * Behavior: renders title + zoom slider + safe area, applies (jsdom falls back to the source URL)
 * and cancels without applying. Also covers the round frame + below-cover (minZoom < 1) options.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";
import { clampPan, coverBaseScale, coverRect, ImageCropModal, PAN_SLACK } from "./ImageCropModal";

// jsdom does not implement the Pointer Capture API; the drag handlers call
// setPointerCapture on pointerdown. Stub it so the interactive drag test can exercise the real
// handlers (a no-op here; the browser provides the real thing). Test-only, no production impact.
beforeAll(() => {
  // jsdom lacks the Pointer Capture API; assign no-op stubs directly. A runtime `in` guard would
  // narrow the prototype type to `never` under tsc (the DOM lib declares these methods as present).
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => false;
});

const SRC = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";

function setup(overrides: Partial<Parameters<typeof ImageCropModal>[0]> = {}) {
  const onApply = vi.fn();
  const onOpenChange = vi.fn();
  renderWithProviders(
    <ImageCropModal
      open
      onOpenChange={onOpenChange}
      src={SRC}
      aspect={16 / 9}
      title="Adjust your banner"
      description="Drag to reposition."
      showSafeArea
      safeAreaLabel="Safe area"
      zoomLabel="Zoom"
      applyLabel="Apply"
      cancelLabel="Cancel"
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onApply, onOpenChange };
}

describe("ImageCropModal", () => {
  it("renders the title, safe area and zoom slider", () => {
    setup();
    expect(screen.getByText("Adjust your banner")).toBeInTheDocument();
    expect(screen.getByText("Safe area")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Zoom" })).toBeInTheDocument();
  });

  it("applies the crop (jsdom: falls back to the original source) and closes", () => {
    const { onApply, onOpenChange } = setup();
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(SRC);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cancels without applying", () => {
    const { onApply, onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("defaults to a rounded-rect frame and a zoom floor of 1", () => {
    setup();
    expect(screen.getByRole("slider", { name: "Zoom" })).toHaveAttribute("min", "1");
    expect(screen.getByTestId("crop-viewport").className).toContain("rounded-xl");
  });

  it("supports a round frame and zooming out below the cover fit", () => {
    setup({ round: true, minZoom: 0.5 });
    const slider = screen.getByRole("slider", { name: "Zoom" });
    expect(slider).toHaveAttribute("min", "0.5");
    const viewport = screen.getByTestId("crop-viewport");
    expect(viewport.className).toContain("rounded-full");
    expect(viewport.className).not.toContain("rounded-xl");
    // The slider now accepts a value below 1 (image smaller than the frame, padded).
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect((slider as HTMLInputElement).value).toBe("0.5");
  });
});

// POO-545: the preview <img> and the export canvas share coverRect, so what the frame shows and what
// gets rasterized are the same rectangle by construction — they can never diverge for off-aspect
// images the way the old object-cover preview did.
describe("ImageCropModal geometry (POO-545)", () => {
  it("[R1] cover-fits a wide image into a square frame, centered (overflows sideways)", () => {
    // 1600×900 into a 400×400 frame: base = max(400/1600, 400/900) = 0.4444.
    const rect = coverRect(400, 400, 1600, 900, 1, 0, 0);
    expect(rect.width).toBeCloseTo(711.11, 1);
    expect(rect.height).toBe(400);
    expect(rect.left).toBeCloseTo(-155.56, 1); // overflows left/right
    expect(rect.top).toBe(0); // flush top/bottom
  });

  it("[R1] cover-fits a tall image into a 16:9 frame, covering the width", () => {
    // 500×500 into 800×450 (16:9): base = max(800/500, 450/500) = 1.6.
    const rect = coverRect(800, 450, 500, 500, 1, 0, 0);
    expect(rect.width).toBe(800);
    expect(rect.height).toBe(800);
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(-175); // (450 - 800) / 2
  });

  it("[R1][R3] panning a wide image to its clamp limit reveals the far edge (was clipped before)", () => {
    const maxX = (1600 * coverBaseScale(400, 400, 1600, 900) - 400) / 2; // 155.56
    const rect = coverRect(400, 400, 1600, 900, 1, maxX, 0);
    // At the max rightward pan the image's LEFT edge aligns with the frame's left edge — a region the
    // old object-cover preview could never show, so preview and export now agree on it.
    expect(rect.left).toBeCloseTo(0, 5);
  });

  it("[R2] clampPan lets the no-gap bound dominate when the image overflows past the slack", () => {
    // Zoomed-in wide image (zoom 2): horizontal overflow (511.11) exceeds the slack (200), so the
    // no-gap bound still governs X and the frame stays gap-free horizontally. Vertical overflow here
    // is exactly 200, equal to the slack, so Y sits at that same bound.
    const c = clampPan(400, 400, 1600, 900, 2, 9999, 9999);
    expect(c.x).toBeCloseTo(511.11, 1); // (1600 * 0.4444 * 2 - 400) / 2
    expect(c.y).toBeCloseTo(200, 5); // max(no-gap 200, slack 0.5 * 400 = 200)
  });

  it("[R5] grants a slack drag range on every axis, even for a cover-exact / zoom-1 image", () => {
    // Aspect-matched image at zoom 1: the no-gap bound is 0 on both axes, so pre-R5 it was pinned.
    // Now each axis opens up to PAN_SLACK * viewport dimension so drag always has room.
    const exact = clampPan(400, 300, 400, 300, 1, 9999, 9999);
    expect(exact.x).toBeCloseTo(PAN_SLACK * 400, 5); // 200
    expect(exact.y).toBeCloseTo(PAN_SLACK * 300, 5); // 150
    // Wide image at zoom 1: overflow X (155.56) is below the slack (200), so X also gets the slack;
    // Y (no overflow) gets the slack too. Both axes are now draggable.
    const wide = clampPan(400, 400, 1600, 900, 1, 9999, 9999);
    expect(wide.x).toBeCloseTo(200, 5);
    expect(wide.y).toBeCloseTo(200, 5);
    // Zoomed below cover (minZoom 0.5, POO-360): a smaller-than-frame image also gets the slack.
    expect(clampPan(400, 400, 400, 400, 0.5, 9999, 9999)).toEqual({ x: 200, y: 200 });
  });

  it("degrades safely before measurement (zero viewport / natural size)", () => {
    expect(coverBaseScale(0, 0, 0, 0)).toBe(1);
    expect(coverRect(0, 0, 0, 0, 1, 0, 0)).toEqual({ width: 0, height: 0, left: 0, top: 0 });
  });
});

// POO-571 [R4]: the INTERACTIVE path jsdom used to skip. jsdom reports naturalWidth 0, complete
// false, and clientWidth/Height 0, so `previewRect` was always null and the <img> stuck in the
// object-cover fallback with no inline geometry — pan and zoom were visually dead. We stub a decoded
// natural size and a laid-out viewport, then assert the preview activates (coverRect geometry, not
// object-cover) and responds to drag + zoom. These lock the failure class from POO-545's onLoad race.
describe("ImageCropModal interactive preview (POO-571 [R4])", () => {
  // A wide 1600×900 image in the square-ish 400×400 stub gives horizontal pan room at zoom 1, and
  // any zoom change resizes the rect — enough slack to observe both axes moving.
  const NAT = { w: 1600, h: 900 };
  const VP = { w: 400, h: 400 };

  /**
   * Make jsdom look like a real, already-decoded image in a laid-out dialog:
   * override the <img> natural size + `complete` and the viewport client box, then fire load so the
   * component captures the natural size AND re-measures the viewport (POO-571 [R1]+[R2]).
   */
  function primeDecodedImage() {
    const img = document.querySelector("[data-testid=crop-viewport] img") as HTMLImageElement;
    const viewport = screen.getByTestId("crop-viewport");
    Object.defineProperty(img, "naturalWidth", { configurable: true, value: NAT.w });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: NAT.h });
    Object.defineProperty(img, "complete", { configurable: true, value: true });
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: VP.w });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: VP.h });
    // The load event is the fix's re-measure trigger; the completeness path also captures natural
    // size, so the preview must activate regardless of onLoad timing.
    fireEvent.load(img);
    return { img, viewport };
  }

  // @rule R1 @rule R2 @rule R3
  it("activates the coverRect preview once the image is decoded (not the object-cover fallback)", () => {
    setup();
    const { img } = primeDecodedImage();
    // previewRect active: absolutely positioned via inline left/top/width/height, NOT object-cover.
    expect(img.className).not.toContain("object-cover");
    expect(img.style.left).not.toBe("");
    expect(img.style.width).not.toBe("");
    // Sanity: the width matches coverRect for the stubbed sizes at zoom 1 (base = max(400/1600,
    // 400/900) = 0.4444 → 1600 * 0.4444 = 711.11px).
    expect(Number.parseFloat(img.style.width)).toBeCloseTo(711.11, 0);
  });

  // @rule R1 @rule R3 @rule R5
  it("moves the preview on BOTH axes on a pointer drag, even at zoom 1", () => {
    setup();
    const { img, viewport } = primeDecodedImage();
    const beforeLeft = img.style.left;
    const beforeTop = img.style.top;
    // Drag diagonally at zoom 1. Pre-R5 the vertical axis was pinned (height == frame, no overflow);
    // R5's slack now gives both axes a drag range, so `left` AND `top` must change.
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 120, clientY: 130 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });
    expect(img.style.left).not.toBe(beforeLeft);
    expect(img.style.top).not.toBe(beforeTop);
  });

  // @rule R1 @rule R3
  it("resizes the preview width/height when the zoom changes", () => {
    setup();
    const { img } = primeDecodedImage();
    const beforeWidth = img.style.width;
    const beforeHeight = img.style.height;
    fireEvent.change(screen.getByRole("slider", { name: "Zoom" }), { target: { value: "2" } });
    expect(img.style.width).not.toBe(beforeWidth);
    expect(img.style.height).not.toBe(beforeHeight);
    // Zooming in 2x doubles the rect (coverRect scales linearly with zoom).
    expect(Number.parseFloat(img.style.width)).toBeCloseTo(Number.parseFloat(beforeWidth) * 2, 0);
  });
});
