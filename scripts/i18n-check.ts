/**
 * i18n-check, SETUP-006 (Linear POO-52).
 *
 * Validates the translation message files under `src/i18n/messages/<locale>/*.json`:
 *   1. Locale key parity: every key defined in one locale must exist in all locales.
 *   2. ICU sanity: every message value has balanced braces and no empty placeholder.
 *   3. Used-but-undefined (best effort): keys referenced in code through a single,
 *      statically known `useTranslations` / `getTranslations` namespace per file must
 *      exist in the source locale (`en`).
 *   4. No em dash: no user-facing value may contain an em dash (U+2014). Standing copy
 *      rule (Linear POO-357): restructure with a period, comma, colon or hyphen instead.
 *
 * Exits with a non-zero code when any problem is found, so it can gate CI.
 *
 * PP-NOTE: check 3 is a pragmatic regex scanner, not a full AST pass. It only binds
 * `t('key')` calls when a file has exactly one translation namespace, to avoid false
 * positives that would break CI.
 * PP-TODO: upgrade the usage scan to a TypeScript AST walk when usage grows.
 *
 * @implements-rules-version: v1 (POO-357, no-em-dash rule)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { argv, cwd, exit } from "node:process";

const ROOT = cwd();
const MESSAGES_DIR = join(ROOT, "src", "i18n", "messages");
const SOURCE_LOCALE = "en";
const CODE_DIRS = [join(ROOT, "src")];
const CODE_EXTENSIONS = [".ts", ".tsx"];

export interface I18nProblem {
  kind: "missing-key" | "icu" | "used-undefined" | "em-dash";
  message: string;
}

/** Em dash (U+2014). Banned from user-facing copy by the POO-357 standing rule. */
export const EM_DASH = "—";

/** Recursively flatten a parsed JSON message object into `dot.path` -> string value. */
export function flattenMessages(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    if (prefix) out.set(prefix, value);
    return out;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      for (const [k, v] of flattenMessages(child, next)) out.set(k, v);
    }
  }
  return out;
}

/** Compare key sets across locales. Returns one problem per (locale, missing key). */
export function findMissingKeys(keysByLocale: Map<string, Set<string>>): I18nProblem[] {
  const problems: I18nProblem[] = [];
  const union = new Set<string>();
  for (const keys of keysByLocale.values()) {
    for (const k of keys) union.add(k);
  }
  for (const [locale, keys] of keysByLocale) {
    for (const key of union) {
      if (!keys.has(key)) {
        problems.push({
          kind: "missing-key",
          message: `locale "${locale}" is missing key "${key}"`,
        });
      }
    }
  }
  return problems;
}

/** Lightweight ICU sanity check: balanced braces and no empty `{}` placeholder. */
export function validateIcu(key: string, value: string): I18nProblem | null {
  if (/\{\s*\}/.test(value)) {
    return { kind: "icu", message: `key "${key}" has an empty {} placeholder` };
  }
  let depth = 0;
  for (const ch of value) {
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth < 0) {
        return { kind: "icu", message: `key "${key}" has an unbalanced "}" in: ${value}` };
      }
    }
  }
  if (depth !== 0) {
    return { kind: "icu", message: `key "${key}" has ${depth} unclosed "{" in: ${value}` };
  }
  return null;
}

/**
 * Standing copy rule (Linear POO-357): no em dash (U+2014) in user-facing strings.
 * Restructure with a period, comma, colon or a spaced hyphen instead. En dashes
 * (U+2013), used for numeric ranges, are intentionally allowed.
 */
export function findEmDash(key: string, value: string): I18nProblem | null {
  if (value.includes(EM_DASH)) {
    return {
      kind: "em-dash",
      message: `key "${key}" contains an em dash (${EM_DASH}); use a period, comma, colon or hyphen instead`,
    };
  }
  return null;
}

/** Resolve which used keys are missing from the defined set. */
export function findUsedButUndefined(used: Set<string>, defined: Set<string>): I18nProblem[] {
  const problems: I18nProblem[] = [];
  for (const key of used) {
    if (!defined.has(key)) {
      problems.push({
        kind: "used-undefined",
        message: `key "${key}" is used in code but not defined in "${SOURCE_LOCALE}"`,
      });
    }
  }
  return problems;
}

const NS_RE = /(?:useTranslations|getTranslations)\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const KEY_RE = /\bt\(\s*["'`]([^"'`]+)["'`]/g;

/** Best effort: collect fully qualified keys from files that have a single namespace. */
export function extractUsedKeys(source: string): string[] {
  const namespaces = [...source.matchAll(NS_RE)]
    .map((m) => m[1])
    .filter((ns): ns is string => ns !== undefined);
  const uniqueNs = [...new Set(namespaces)];
  if (uniqueNs.length !== 1) return [];
  const ns = uniqueNs[0];
  if (ns === undefined) return [];
  const keys: string[] = [];
  for (const m of source.matchAll(KEY_RE)) {
    const key = m[1];
    if (key !== undefined) keys.push(`${ns}.${key}`);
  }
  return keys;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Read all `<namespace>.json` files under a locale dir into flattened keys + values. */
function readLocaleMessages(localeDir: string): Map<string, string> {
  const all = new Map<string, string>();
  for (const file of listDir(localeDir)) {
    if (!file.endsWith(".json")) continue;
    const namespace = file.slice(0, -".json".length);
    const parsed: unknown = JSON.parse(readFileSync(join(localeDir, file), "utf8"));
    for (const [k, v] of flattenMessages(parsed, namespace)) all.set(k, v);
  }
  return all;
}

function walkCodeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of listDir(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (isDirectory(full)) {
      if (full === MESSAGES_DIR) continue;
      walkCodeFiles(full, acc);
    } else if (
      CODE_EXTENSIONS.some((ext) => entry.endsWith(ext)) &&
      !entry.endsWith(".d.ts") &&
      !/\.(test|spec|stories)\.[tj]sx?$/.test(entry)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

function main(): number {
  const problems: I18nProblem[] = [];

  const locales = listDir(MESSAGES_DIR).filter((name) => isDirectory(join(MESSAGES_DIR, name)));
  if (locales.length === 0) {
    console.error(`i18n:check: no locale directories found under ${relative(ROOT, MESSAGES_DIR)}`);
    return 1;
  }

  const messagesByLocale = new Map<string, Map<string, string>>();
  for (const locale of locales) {
    messagesByLocale.set(locale, readLocaleMessages(join(MESSAGES_DIR, locale)));
  }

  // Check 1: key parity across locales.
  const keysByLocale = new Map<string, Set<string>>();
  for (const [locale, msgs] of messagesByLocale) {
    keysByLocale.set(locale, new Set(msgs.keys()));
  }
  problems.push(...findMissingKeys(keysByLocale));

  // Check 2 (ICU sanity) + Check 4 (no em dash), one pass over every value.
  for (const [locale, msgs] of messagesByLocale) {
    for (const [key, value] of msgs) {
      const icu = validateIcu(`${locale}:${key}`, value);
      if (icu) problems.push(icu);
      const emDash = findEmDash(`${locale}:${key}`, value);
      if (emDash) problems.push(emDash);
    }
  }

  // Check 3: keys used in code but not defined in the source locale.
  const sourceKeys = keysByLocale.get(SOURCE_LOCALE) ?? new Set<string>();
  const used = new Set<string>();
  for (const dir of CODE_DIRS) {
    for (const file of walkCodeFiles(dir)) {
      for (const key of extractUsedKeys(readFileSync(file, "utf8"))) used.add(key);
    }
  }
  problems.push(...findUsedButUndefined(used, sourceKeys));

  if (problems.length > 0) {
    console.error(`i18n:check found ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  [${p.kind}] ${p.message}`);
    return 1;
  }

  console.log(
    `i18n:check passed. ${locales.length} locales, ${sourceKeys.size} source keys; parity, ICU and usage OK.`,
  );
  return 0;
}

const invoked = argv[1] ?? "";
const isDirectRun = invoked.endsWith("i18n-check.ts") || invoked.endsWith("i18n-check.js");
if (isDirectRun) exit(main());
