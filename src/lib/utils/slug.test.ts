/**
 * @id PP-CORE-LIB-025
 * @name toHandleSlug — tests
 * @implements-rules-version POO-575 v1
 *
 * The pure slugifier behind the editable manager handle (POO-575 R2): lowercase, spaces/underscores
 * to "-", drop anything outside [a-z0-9-], collapse repeated "-", trim leading/trailing "-", cap
 * length. Live-slug semantics: whatever the user types, the shown value is always slug-shaped.
 */
import { describe, expect, it } from "vitest";
import { toHandleSlug } from "./slug";

describe("toHandleSlug (POO-575 R2)", () => {
  it("lowercases and keeps an already-clean slug", () => {
    expect(toHandleSlug("carlos")).toBe("carlos");
    expect(toHandleSlug("Carlos")).toBe("carlos");
  });

  it("turns spaces and underscores into hyphens", () => {
    expect(toHandleSlug("Carlos Mendes")).toBe("carlos-mendes");
    expect(toHandleSlug("carlos_mendes")).toBe("carlos-mendes");
    expect(toHandleSlug("carlos   mendes")).toBe("carlos-mendes");
  });

  it("strips characters outside [a-z0-9-]", () => {
    expect(toHandleSlug("Carlos!!! Mendes ⚡")).toBe("carlos-mendes");
    // POO-746: accents transliterate to their base letter and symbols are DROPPED (not hyphenated).
    expect(toHandleSlug("josé.o'brien")).toBe("joseobrien");
    expect(toHandleSlug("númen")).toBe("numen");
  });

  it("[POO-746] transliterates accented Latin letters to their ASCII base", () => {
    expect(toHandleSlug("João Silva")).toBe("joao-silva");
    expect(toHandleSlug("café")).toBe("cafe");
    expect(toHandleSlug("Ñoño")).toBe("nono");
    expect(toHandleSlug("Beyoncé")).toBe("beyonce");
    expect(toHandleSlug("Málaga Çelik")).toBe("malaga-celik");
  });

  it("[POO-746] drops disallowed symbols instead of turning them into hyphens", () => {
    // A symbol between letters is removed (the letters join) — never a stray hyphen, incl. from paste.
    expect(toHandleSlug("a!b")).toBe("ab");
    expect(toHandleSlug("o'brien")).toBe("obrien");
    expect(toHandleSlug("weird#chars")).toBe("weirdchars");
    expect(toHandleSlug("@weird#chars")).toBe("weirdchars");
    expect(toHandleSlug("café###")).toBe("cafe");
    // Whitespace + underscore stay word separators (→ a single hyphen).
    expect(toHandleSlug("multi word_handle")).toBe("multi-word-handle");
  });

  it("collapses repeated hyphens", () => {
    expect(toHandleSlug("carlos---mendes")).toBe("carlos-mendes");
    expect(toHandleSlug("a - - b")).toBe("a-b");
  });

  it("trims leading and trailing hyphens", () => {
    expect(toHandleSlug("-carlos-")).toBe("carlos");
    expect(toHandleSlug("  carlos  ")).toBe("carlos");
    expect(toHandleSlug("!!!")).toBe("");
  });

  it("keeps digits", () => {
    expect(toHandleSlug("Fund 2024")).toBe("fund-2024");
  });

  it("caps at the default max length (30) without a trailing hyphen", () => {
    const long = "a".repeat(40);
    expect(toHandleSlug(long)).toHaveLength(30);
    // A hyphen that would land exactly on the boundary is trimmed off.
    expect(toHandleSlug(`${"a".repeat(29)}-tail`)).toBe("a".repeat(29));
  });

  it("respects a custom max length", () => {
    expect(toHandleSlug("carlos-mendes", 6)).toBe("carlos");
  });

  it("returns an empty string for empty or nullish input", () => {
    expect(toHandleSlug("")).toBe("");
    expect(toHandleSlug("   ")).toBe("");
    // @ts-expect-error runtime guard: callers may pass an undefined field value.
    expect(toHandleSlug(undefined)).toBe("");
  });
});
