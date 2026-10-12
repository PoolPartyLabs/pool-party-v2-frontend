/**
 * @id PP-MGR-CMP-107
 * @name raydium source text tests
 * @implements-rules-version v1 (POO-2343)
 * @analytics-events none, a locale check.
 *
 * R9: for Raydium, the panel text names DEX Screener as the source, in every locale.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MESSAGES = join(process.cwd(), "src/i18n/messages");
const locales = readdirSync(MESSAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function source(locale: string): string | undefined {
  const file = readFileSync(join(MESSAGES, locale, "manager.json"), "utf8");
  return (JSON.parse(file) as { solanaPreview: Record<string, string> }).solanaPreview
    .raydiumSource;
}

describe("R9: the Raydium panel names DEX Screener as the source", () => {
  // @rule R9
  it("[R9] has the source text in all 11 locales, with the source name and no em dash", () => {
    expect(locales).toHaveLength(11);
    for (const locale of locales) {
      const text = source(locale);
      expect(text, locale).toBeTruthy();
      expect(text, locale).toContain("DEX Screener");
      expect(text, locale).not.toContain("—");
    }
  });
});
