import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EM_DASH,
  extractUsedKeys,
  findEmDash,
  findMissingKeys,
  findUsedButUndefined,
  flattenMessages,
  validateIcu,
} from "../scripts/i18n-check";

describe("i18n-check", () => {
  describe("flattenMessages", () => {
    it("flattens nested objects into dot paths under a namespace", () => {
      const flat = flattenMessages({ a: { b: "x" }, c: "y" }, "ns");
      expect([...flat.keys()].sort()).toEqual(["ns.a.b", "ns.c"]);
      expect(flat.get("ns.a.b")).toBe("x");
    });
  });

  describe("findMissingKeys", () => {
    it("flags a key present in one locale but not in another", () => {
      const byLocale = new Map<string, Set<string>>([
        ["en", new Set(["common.save", "common.cancel"])],
        ["pt-BR", new Set(["common.save"])],
      ]);
      const problems = findMissingKeys(byLocale);
      expect(problems).toHaveLength(1);
      expect(problems[0]?.kind).toBe("missing-key");
      expect(problems[0]?.message).toContain("pt-BR");
      expect(problems[0]?.message).toContain("common.cancel");
    });

    it("passes when all locales share the same keys", () => {
      const byLocale = new Map<string, Set<string>>([
        ["en", new Set(["common.save"])],
        ["pt-BR", new Set(["common.save"])],
      ]);
      expect(findMissingKeys(byLocale)).toHaveLength(0);
    });
  });

  describe("validateIcu", () => {
    it("accepts a balanced ICU placeholder", () => {
      expect(validateIcu("k", "{count} items left")).toBeNull();
    });

    it("rejects unbalanced braces", () => {
      expect(validateIcu("k", "{count items")?.kind).toBe("icu");
    });

    it("rejects an empty placeholder", () => {
      expect(validateIcu("k", "a {} b")?.kind).toBe("icu");
    });
  });

  describe("findUsedButUndefined", () => {
    it("flags a key used in code but not defined", () => {
      const problems = findUsedButUndefined(
        new Set(["common.save", "common.ghost"]),
        new Set(["common.save"]),
      );
      expect(problems).toHaveLength(1);
      expect(problems[0]?.message).toContain("common.ghost");
    });

    it("passes when every used key is defined", () => {
      expect(findUsedButUndefined(new Set(["common.save"]), new Set(["common.save"]))).toHaveLength(
        0,
      );
    });
  });

  describe("extractUsedKeys", () => {
    it("binds t() calls to a single file namespace", () => {
      const src = `const t = useTranslations("common"); t("save"); t("cancel");`;
      expect(extractUsedKeys(src).sort()).toEqual(["common.cancel", "common.save"]);
    });

    it("skips files with ambiguous namespaces to avoid false positives", () => {
      const src = `useTranslations("a"); useTranslations("b"); t("x");`;
      expect(extractUsedKeys(src)).toEqual([]);
    });
  });

  describe("findEmDash", () => {
    // @rule R1 no em dash (U+2014) in user-facing copy
    it("flags a value that contains an em dash", () => {
      const problem = findEmDash("k", `Boost applied ${EM_DASH} +5 today`);
      expect(problem?.kind).toBe("em-dash");
      expect(problem?.message).toContain("k");
    });

    // @rule R1 replacements (period/comma/colon/hyphen) must pass
    it("accepts copy restructured with a period, comma or hyphen", () => {
      expect(findEmDash("k", "Boost applied. +5 today")).toBeNull();
      expect(findEmDash("k", "Open to anyone, no approval needed.")).toBeNull();
      expect(findEmDash("k", "-")).toBeNull();
    });

    // @rule R1 en dashes (U+2013) for numeric ranges are intentionally allowed
    it("allows an en dash used for a numeric range", () => {
      expect(findEmDash("k", "Name must be 10–50 characters.")).toBeNull();
    });
  });

  // Regression lock (POO-357): the real message files must stay em-dash-free.
  // This fails while any locale value still contains U+2014 and passes after the sweep.
  describe("message files are em-dash-free", () => {
    const MESSAGES_DIR = join(__dirname, "..", "src", "i18n", "messages");

    function readLocaleValues(localeDir: string): Map<string, string> {
      const all = new Map<string, string>();
      for (const file of readdirSync(localeDir)) {
        if (!file.endsWith(".json")) continue;
        const namespace = file.slice(0, -".json".length);
        const parsed: unknown = JSON.parse(readFileSync(join(localeDir, file), "utf8"));
        for (const [k, v] of flattenMessages(parsed, `${namespace}`)) all.set(k, v);
      }
      return all;
    }

    const locales = readdirSync(MESSAGES_DIR).filter((name) =>
      statSync(join(MESSAGES_DIR, name)).isDirectory(),
    );

    // @rule R1 no em dash anywhere in any configured locale's user-facing values
    it.each(locales)("locale %s has no em dash in any value", (locale) => {
      const values = readLocaleValues(join(MESSAGES_DIR, locale));
      const offenders = [...values]
        .map(([key, value]) => findEmDash(`${locale}:${key}`, value))
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .map((p) => p.message);
      expect(offenders).toEqual([]);
    });
  });
});
