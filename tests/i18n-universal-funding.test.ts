/**
 * @id PP-CORE-I18N-001 (POO-1049)
 * @name Universal Funding copy sweep, tests
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * `pnpm i18n:check` proves the funding copy is PRESENT in all 11 locales. It cannot prove the copy
 * is any GOOD. This suite is the quality gate that sits next to it: it reads the values the epic
 * added and holds them to the rules the epic was written under.
 *
 * The epic's copy was produced by several agents over two days, so the failure mode it guards is
 * drift, not absence. Three surfaces (the funding-source selector, the cost breakdown and the
 * recovery banner) each acquired their own tone, their own word for "your funds", and in de / nl /
 * zh their own second-person register, all inside one file. A user never sees "the epic"; they see
 * one screen that flips from "Sie" to "du" halfway down.
 *
 * Why patterns rather than a golden file: a golden file freezes the copy and makes every future
 * wording change a merge conflict. These assertions freeze the RULES (no jargon, one register, one
 * word per concept) and leave the wording free, so the next person to touch this copy inherits the
 * constraints without inheriting the sentences.
 *
 * @see docs/_hackathon/04_I18N_REVIEW_NOTES.md for the per-locale glossary and the PP-I18N queue.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";

const MESSAGES_DIR = join(process.cwd(), "src", "i18n", "messages");
const REVIEW_NOTES = join(process.cwd(), "docs", "_hackathon", "04_I18N_REVIEW_NOTES.md");

/** Machine-translated tier (docs/01_TECH_STACK.md > Locale policy). Only these may carry PP-I18N. */
const MACHINE_TRANSLATED = ["fr", "de", "nl", "ja", "ko", "zh-CN", "zh-TW", "vi"] as const;

/**
 * The copy Universal Funding owns, by key prefix.
 *
 * Deliberately NOT all of `strategies.provisioning.*`: the `gas.*` sheet, `steps.*`, `plan.*` and
 * `exec.*` blocks pre-date the epic (POO-411) and are swept by their own issue. `gas.conversionNote`
 * is listed on its own because the epic rewrote that one value inside an otherwise pre-existing block.
 */
const OWNED_PREFIXES = [
  "swap.",
  "strategies.flow.error.kinds.wrongChain",
  "strategies.flow.error.kinds.gasBlocked",
  "strategies.provisioning.gasVerdict.",
  "strategies.provisioning.gas.conversionNote",
  "strategies.provisioning.requote.",
  "strategies.provisioning.captions.swapGas",
  "strategies.provisioning.captions.approve",
  "strategies.provisioning.bridge.",
  "strategies.provisioning.costs.",
  "strategies.provisioning.fundingSources.",
  "strategies.provisioning.recovery.",
] as const;

/** The namespaces those prefixes live in, so the reader loads two files instead of sixteen. */
const OWNED_NAMESPACES = ["strategies", "swap"] as const;

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    if (prefix) out.set(prefix, value);
    return out;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      for (const [k, v] of flatten(child, next)) out.set(k, v);
    }
  }
  return out;
}

/** Every value this epic owns, in one locale, keyed by `namespace.dot.path`. */
function ownedMessages(locale: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const namespace of OWNED_NAMESPACES) {
    const raw: unknown = JSON.parse(
      readFileSync(join(MESSAGES_DIR, locale, `${namespace}.json`), "utf8"),
    );
    for (const [key, value] of flatten(raw, namespace)) {
      if (OWNED_PREFIXES.some((p) => key.startsWith(p))) out.set(key, value);
    }
  }
  return out;
}

const byLocale = new Map(locales.map((locale) => [locale, ownedMessages(locale)] as const));
const english = byLocale.get("en");
if (!english) throw new Error("no en messages");
const translations = [...byLocale].filter(([locale]) => locale !== "en");

/** `key :: value` lines for whichever values broke a rule, so a failure reads as a work list. */
function offenders(pattern: RegExp, entries: Iterable<[string, string]>): string[] {
  const found: string[] = [];
  for (const [key, value] of entries) {
    // Fresh lastIndex per test: a shared /g regex is stateful across .test() calls.
    if (new RegExp(pattern.source, pattern.flags.replace("g", "")).test(value)) {
      found.push(`${key} :: ${value}`);
    }
  }
  return found;
}

describe("Universal Funding copy, 11 locales (POO-1049)", () => {
  describe("[R1] every surface ships translated, in every locale", () => {
    it("carries the same key set in all 11 locales, non-empty", () => {
      for (const [locale, messages] of translations) {
        expect([...messages.keys()].sort(), locale).toEqual([...english.keys()].sort());
        expect(
          [...messages].filter(([, v]) => v.trim() === "").map(([k]) => k),
          `${locale} has empty values`,
        ).toEqual([]);
      }
    });

    it("never leaves an English string standing in for a translation", () => {
      for (const [locale, messages] of translations) {
        const untranslated = [...messages]
          .filter(([key, value]) => english.get(key) === value)
          .map(([key]) => key);
        expect(untranslated, `${locale} still shows the English source`).toEqual([]);
      }
    });
  });

  describe("[R2] no em dash, anywhere", () => {
    it("uses no em dash and no spaced en dash standing in for one", () => {
      for (const [locale, messages] of byLocale) {
        // The en dash is allowed for numeric ranges (5-10); a SPACED one is an em dash in disguise.
        expect(offenders(/—|\s–\s/, messages), locale).toEqual([]);
      }
    });
  });

  describe("[R3] the investor app abstracts crypto jargon", () => {
    // Manager-Console-only terms per the i18n-translation-rules skill. "bridge" and "swap" describe
    // the rail, not the user's intent, and "gas" is a protocol word for a cost the user just pays.
    const JARGON = /\b(bridge|bridged|bridging|swap|swaps|swapped|swapping|gas|slippage|LP|AMM)\b/i;
    // The same terms transliterated, which is how they slip past a Latin-script regex.
    const TRANSLITERATED = /(ガス|가스|스왑|브릿지|瓦斯|燃料费)/;

    it("keeps rail vocabulary out of every locale's funding copy", () => {
      for (const [locale, messages] of byLocale) {
        expect(offenders(JARGON, messages), `${locale} leaks DeFi jargon`).toEqual([]);
        expect(offenders(TRANSLITERATED, messages), `${locale} leaks DeFi jargon`).toEqual([]);
      }
    });
  });

  describe("[R4] blocked, failed and recovering states say what to do", () => {
    it("tells the user their next move when a source cannot reach the target chain", () => {
      // The one blocked state the UI gives no escape buttons for: FundingSourceSelector suppresses
      // `escapes` when `unreachable`, so the sentence itself has to carry the way out.
      const unreachable = english.get("strategies.provisioning.fundingSources.unreachable") ?? "";
      const sentences = unreachable.split(/(?<=[.?!])\s+/).filter(Boolean);
      expect(sentences.length, `no next step offered: ${unreachable}`).toBeGreaterThanOrEqual(2);
    });

    it("keeps the recovery surface reassuring, never alarming", () => {
      // The money is fine and in transit (02_BRIDGE_ARCHITECTURE.md §3.9). Failure vocabulary here
      // reads as "your funds are gone". "lost" is absent from this list on purpose: the copy says
      // "Nothing is lost", which is the reassurance itself.
      const ALARM = /\b(error|failed|failure|problem|sorry|went wrong|unable)\b/i;
      const recovery = [...english].filter(([key]) =>
        key.startsWith("strategies.provisioning.recovery."),
      );
      expect(offenders(ALARM, recovery)).toEqual([]);
    });
  });

  describe("[R5] one register and one glossary per locale", () => {
    // Measured against the namespaces this epic never touched, which is the house style these
    // surfaces have to sit beside: de 161/27 formal, nl 67/24 formal, zh 81/25 formal, es 100/8
    // informal. The skill mandates the same for de and nl.
    const REGISTER: Record<string, RegExp> = {
      de: /\b([Dd]u|[Dd]ein\w*|[Dd]ir|[Dd]ich)\b/,
      nl: /\b(je|jouw|jij|jullie)\b/,
      "zh-CN": /你/,
      "zh-TW": /你/,
      es: /\busted\b/i,
    };

    it("never flips second-person register between funding surfaces", () => {
      for (const [locale, pattern] of Object.entries(REGISTER)) {
        const messages = byLocale.get(locale);
        expect(messages, locale).toBeDefined();
        expect(offenders(pattern, messages ?? []), `${locale} mixes register`).toEqual([]);
      }
    });

    // One word per concept. Each entry is a variant that lost: the winner is either the house term
    // measured in the untouched namespaces, or the locale tier's own standard (es is neutral Latin
    // American, so Peninsular "coste"/"céntimo"/"importe" are out).
    const GLOSSARY: Record<string, RegExp> = {
      es: /\bcoste|céntimo|\bimporte/i,
      "pt-BR": /a gente|\bpasso\b/i,
      vi: /tiền mã hóa|tiền điện tử/i,
      de: /\bMittel\b|\bGeld\b/,
      nl: /\btegoed\b/i,
      "zh-TW": /金融卡/,
    };

    it("uses one word per concept across the epic's surfaces", () => {
      for (const [locale, pattern] of Object.entries(GLOSSARY)) {
        const messages = byLocale.get(locale);
        expect(messages, locale).toBeDefined();
        expect(offenders(pattern, messages ?? []), `${locale} uses two words`).toEqual([]);
      }
    });
  });

  describe("[R6] suspect machine translations are flagged, not silently fixed", () => {
    it("queues every PP-I18N flag against a real key and a machine-translated locale", () => {
      const notes = readFileSync(REVIEW_NOTES, "utf8");
      // `| <locale> | <key> | ... | PP-I18N ...` rows in the review queue table.
      const rows = [...notes.matchAll(/^\|\s*`([\w-]+)`\s*\|\s*`([^`]+)`\s*\|/gm)];
      expect(rows.length, "no PP-I18N flags recorded").toBeGreaterThan(0);
      for (const [, locale, key] of rows) {
        expect(MACHINE_TRANSLATED, `${locale} is not machine-translated`).toContain(locale);
        expect(english.has(key ?? ""), `${key} is not a Universal Funding key`).toBe(true);
      }
    });
  });
});
