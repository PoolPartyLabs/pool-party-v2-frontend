/**
 * @id PP-CORE-LIB-024 — tests
 * Behavior: sanitizeText strips control/zero-width/bidi chars, normalizes whitespace and caps length;
 * safeHttpUrl accepts only absolute http/https (the stored-XSS guard) and assumes https when schemeless;
 * sanitizeHandle slugs to a URL-safe handle.
 */
import { describe, expect, it } from "vitest";
import { hasUrlScheme, safeHttpUrl, sanitizeHandle, sanitizeText } from "./sanitize";

const ZWSP = String.fromCharCode(0x200b); // zero-width space
const RLO = String.fromCharCode(0x202e); // right-to-left override (bidi spoof)
const NUL = String.fromCharCode(0x00);
const TAB = String.fromCharCode(0x09);

describe("sanitizeText", () => {
  it("strips control, zero-width and bidi-override chars", () => {
    expect(sanitizeText(`a${NUL}b${ZWSP}c${RLO}d`)).toBe("abcd");
  });

  it("collapses whitespace and trims on a single line", () => {
    expect(sanitizeText(`  hello   world \n${TAB} x `)).toBe("hello world x");
  });

  it("keeps line breaks when allowNewlines, capping blank runs and inline spaces", () => {
    expect(sanitizeText("line1\r\n\n\n\nline2   end", { allowNewlines: true })).toBe(
      "line1\n\nline2 end",
    );
  });

  it("caps to maxLength (after trimming)", () => {
    expect(sanitizeText("abcdefgh", { maxLength: 5 })).toBe("abcde");
    expect(sanitizeText("   spaced   ", { maxLength: 4 })).toBe("spac");
  });

  it("returns empty for whitespace-only / control-only input", () => {
    expect(sanitizeText("   ")).toBe("");
    expect(sanitizeText(`${NUL}${ZWSP}`)).toBe("");
  });
});

describe("safeHttpUrl", () => {
  it("accepts absolute http and https URLs", () => {
    expect(safeHttpUrl("https://x.com/me")).toBe("https://x.com/me");
    expect(safeHttpUrl("http://t.me/chan")).toBe("http://t.me/chan");
  });

  it("assumes https for a schemeless host", () => {
    expect(safeHttpUrl("x.com/me")).toBe("https://x.com/me");
  });

  it("rejects javascript:, data:, mailto: and any non-http(s) scheme (stored-XSS guard)", () => {
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeHttpUrl("mailto:a@b.com")).toBeNull();
    expect(safeHttpUrl("  JavaScript:alert(1)  ")).toBeNull();
    expect(safeHttpUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("rejects junk, empty and non-dotted hosts", () => {
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl("https://localhost")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });

  it("strips zero-width/bidi chars before parsing", () => {
    expect(safeHttpUrl(`https://x.com/${ZWSP}me`)).toBe("https://x.com/me");
  });
});

describe("sanitizeHandle", () => {
  it("slugs to lowercase [a-z0-9-]", () => {
    expect(sanitizeHandle("Carlos Mendes!!")).toBe("carlos-mendes");
  });

  it("collapses and trims hyphens (underscores + symbols become hyphens)", () => {
    expect(sanitizeHandle("--a__b  c--")).toBe("a-b-c");
  });

  it("caps length and never leaves a trailing hyphen", () => {
    expect(sanitizeHandle("abcdefghij", 5)).toBe("abcde");
    expect(sanitizeHandle("abcd efghij", 5)).toBe("abcd");
  });
});

describe("hasUrlScheme", () => {
  it("is true for a value with a leading URL scheme", () => {
    expect(hasUrlScheme("https://x.com/foo")).toBe(true);
    expect(hasUrlScheme("http://t.me/chan")).toBe(true);
    expect(hasUrlScheme("javascript:alert(1)")).toBe(true);
    expect(hasUrlScheme("mailto:a@b.com")).toBe(true);
  });

  it("is false for a bare handle or schemeless value", () => {
    expect(hasUrlScheme("carlos")).toBe(false);
    expect(hasUrlScheme("@carlos")).toBe(false);
    expect(hasUrlScheme("x.com/foo")).toBe(false);
    expect(hasUrlScheme("")).toBe(false);
  });
});
