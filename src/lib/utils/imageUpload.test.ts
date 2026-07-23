/**
 * @id PP-CORE-LIB-026
 * @name validateImageFile — tests
 * @implements-rules-version POO-586 v1
 *
 * POO-586 R1/R2/R4: the shared client-side image-upload guard. Type must be PNG or JPG (R1),
 * size must be at most 10 MB (R2), and the check is order-sensitive: a bad type is reported as
 * "type" even when the file is also oversized (R1 is checked before R2). Exactly 10 MB is allowed.
 */
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_IMAGE_TYPES,
  IMAGE_ACCEPT_ATTR,
  MAX_IMAGE_BYTES,
  validateImageFile,
} from "./imageUpload";

/**
 * Build a File whose reported `size` is `bytes` WITHOUT allocating that many bytes (a 10 MB
 * allocation per test is wasteful). jsdom derives `File.size` from the blob parts, so we override
 * the getter — this is exactly what the pick handlers read.
 */
function fileOfSize(bytes: number, type: string, name = "x"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: bytes, configurable: true });
  return file;
}

describe("validateImageFile", () => {
  // @rule POO-586 R4: the exported constants back every entry point so the rule can't drift.
  it("exposes the shared constants", () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(ACCEPTED_IMAGE_TYPES).toEqual(["image/png", "image/jpeg"]);
    expect(IMAGE_ACCEPT_ATTR).toBe("image/png,image/jpeg");
  });

  // @rule POO-586 R1: PNG is accepted.
  it("accepts a PNG", () => {
    expect(validateImageFile(fileOfSize(1024, "image/png", "a.png"))).toEqual({ ok: true });
  });

  // @rule POO-586 R1: JPEG is accepted.
  it("accepts a JPEG", () => {
    expect(validateImageFile(fileOfSize(1024, "image/jpeg", "a.jpg"))).toEqual({ ok: true });
  });

  // @rule POO-586 R1: GIF is rejected as a wrong type.
  it("rejects a GIF as type", () => {
    expect(validateImageFile(fileOfSize(1024, "image/gif", "a.gif"))).toEqual({
      ok: false,
      reason: "type",
    });
  });

  // @rule POO-586 R1: WebP is rejected as a wrong type.
  it("rejects a WebP as type", () => {
    expect(validateImageFile(fileOfSize(1024, "image/webp", "a.webp"))).toEqual({
      ok: false,
      reason: "type",
    });
  });

  // @rule POO-586 R1: SVG is rejected as a wrong type (also the XSS-risk format).
  it("rejects an SVG as type", () => {
    expect(validateImageFile(fileOfSize(1024, "image/svg+xml", "a.svg"))).toEqual({
      ok: false,
      reason: "type",
    });
  });

  // @rule POO-586 R1: an empty MIME type is rejected as type (never trusted as an image).
  it("rejects an empty type", () => {
    expect(validateImageFile(fileOfSize(1024, "", "a"))).toEqual({ ok: false, reason: "type" });
  });

  // @rule POO-586 R2: exactly 10 MB is allowed (the boundary is inclusive).
  it("accepts a PNG at exactly 10 MB", () => {
    expect(validateImageFile(fileOfSize(MAX_IMAGE_BYTES, "image/png", "big.png"))).toEqual({
      ok: true,
    });
  });

  // @rule POO-586 R2: one byte over 10 MB is rejected as size.
  it("rejects a PNG one byte over 10 MB as size", () => {
    expect(validateImageFile(fileOfSize(MAX_IMAGE_BYTES + 1, "image/png", "big.png"))).toEqual({
      ok: false,
      reason: "size",
    });
  });

  // @rule POO-586 R2: an 11 MB JPEG is rejected as size.
  it("rejects an 11 MB JPEG as size", () => {
    expect(validateImageFile(fileOfSize(11 * 1024 * 1024, "image/jpeg", "big.jpg"))).toEqual({
      ok: false,
      reason: "size",
    });
  });

  // @rule POO-586 R1 before R2: a wrong-type file that is ALSO oversized reports "type" first.
  it("reports type (not size) when an oversized file is also the wrong type", () => {
    expect(validateImageFile(fileOfSize(11 * 1024 * 1024, "image/gif", "big.gif"))).toEqual({
      ok: false,
      reason: "type",
    });
  });
});
