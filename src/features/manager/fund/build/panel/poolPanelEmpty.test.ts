/**
 * @id PP-MGR-LIB-031
 * @name panelCatalogView POO-2351 empty-state and locale tests
 * @implements-rules-version v1 (POO-2351)
 * @analytics-events none, pure checks of source text and locale files.
 *
 * Rules under test (POO-2351 rules v1):
 *   [R1] the Build screen has no "unavailable" panel bodies for the EVM kinds
 *   [R2] the empty Uniswap v4 panel has its own caption in all locales
 *   [R8] the new texts exist in all locales, have no em dash and pt-BR has its own text
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FUND = join(ROOT, "src/features/manager/fund");
const MESSAGES = join(ROOT, "src/i18n/messages");
const source = (path: string) => readFileSync(join(FUND, path), "utf8");
const locales = readdirSync(MESSAGES).filter((name) => !name.startsWith("."));
const manager = (locale: string) =>
  JSON.parse(readFileSync(join(MESSAGES, locale, "manager.json"), "utf8")) as {
    fundBuilder: { canvas: { panel: { pool: Record<string, string> } } };
    solanaPreview: Record<string, string>;
  };
const EM_DASH = String.fromCharCode(0x2014);

describe("POO-2351 R1: the EVM panels work with Solana in the mandate", () => {
  // @rule R1
  it("does not hand the Build screen a panel map that makes EVM kinds unavailable", () => {
    expect(source("build/BuildScreen.tsx")).not.toContain("LOCAL_PANEL_BODIES");
    const bodies = source("solana-preview/SolanaBuilderPanelBodies.tsx");
    expect(bodies).not.toContain("LOCAL_PANEL_BODIES");
    expect(bodies).not.toContain("unavailableBody");
  });
});

describe("POO-2351 R2 and R8: the new texts", () => {
  // @rule R2
  it("has a caption for the empty Uniswap v4 panel in all locales, with the network", () => {
    expect(locales.length).toBeGreaterThanOrEqual(11);
    for (const locale of locales) {
      const caption = manager(locale).fundBuilder.canvas.panel.pool.emptyCaption;
      expect(caption, locale).toBeTruthy();
      expect(caption, locale).toContain("{network}");
    }
  });

  // @rule R8
  it("has the Kamino token title in all locales, with the token", () => {
    for (const locale of locales) {
      expect(manager(locale).solanaPreview.supplyToken, locale).toContain("{token}");
    }
  });

  // @rule R8
  it("uses no em dash, and pt-BR has its own text", () => {
    for (const locale of locales) {
      const data = manager(locale);
      expect(data.fundBuilder.canvas.panel.pool.emptyCaption).not.toContain(EM_DASH);
      expect(data.solanaPreview.supplyToken).not.toContain(EM_DASH);
    }
    const en = manager("en");
    const pt = manager("pt-BR");
    expect(pt.fundBuilder.canvas.panel.pool.emptyCaption).not.toBe(
      en.fundBuilder.canvas.panel.pool.emptyCaption,
    );
    expect(pt.solanaPreview.supplyToken).not.toBe(en.solanaPreview.supplyToken);
  });
});
