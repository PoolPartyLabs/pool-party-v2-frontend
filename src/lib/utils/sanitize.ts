/**
 * @id PP-CORE-LIB-024 (POO-552)
 * @name sanitize
 * @implements-rules-version v1
 *
 * Input hardening for user-authored, later-rendered text (manager profile: display name, bio, social
 * links). React escapes text on render, so this is defense in depth, NOT the only guard: it strips
 * control / zero-width / bidi-override characters (which enable spoofing + log/UI injection), collapses
 * whitespace, and caps length. `safeHttpUrl` is the SECURITY-CRITICAL one: the social links become
 * `href`s on the PUBLIC profile, so a `javascript:` / `data:` URL is stored XSS - it returns a URL only
 * when it parses to an absolute http/https address, else null (used to validate on input AND to gate the
 * href on render). See the `frontend-security` skill (signing/supply-chain are separate, higher risks).
 */

/**
 * Codepoint ranges to strip everywhere (built from ASCII source, no literal control chars): C0 controls
 * except TAB/LF/CR (handled per `allowNewlines`), DEL + C1 controls, zero-width joiners + BOM, and the
 * Unicode bidi OVERRIDE/EMBED/ISOLATE controls (U+202A-202E, U+2066-2069) that can visually reverse text
 * to spoof a name/URL. Ordinary marks/emoji stay intact.
 */
const STRIP_RANGES: [number, number][] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200d],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const hex = (n: number) => `\\u${n.toString(16).padStart(4, "0")}`;
const STRIP_ALWAYS = new RegExp(
  `[${STRIP_RANGES.map(([a, b]) => `${hex(a)}-${hex(b)}`).join("")}]`,
  "g",
);

/** Options for {@link sanitizeText}. */
export interface SanitizeTextOptions {
  /** Hard cap on the returned length (characters). Applied last, after trimming. */
  maxLength?: number;
  /** Keep line breaks (bio/description). Default false: newlines collapse to a single space. */
  allowNewlines?: boolean;
}

/**
 * Sanitize a single user text field. Strips control/zero-width/bidi chars, normalizes whitespace, trims,
 * and caps length. Single-line by default (name/handle); pass `allowNewlines` for a bio/description.
 */
export function sanitizeText(value: string, options: SanitizeTextOptions = {}): string {
  const { maxLength, allowNewlines = false } = options;
  let out = (value ?? "").replace(STRIP_ALWAYS, "");
  if (allowNewlines) {
    // Normalize line endings, drop TAB, cap runs of blank lines at one, collapse in-line runs of spaces.
    out = out
      .replace(/\r\n?/g, "\n")
      .replace(/\t/g, " ")
      .replace(/ {2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n");
  } else {
    // Any whitespace run (incl. the just-stripped-adjacent) collapses to one space.
    out = out.replace(/\s+/g, " ");
  }
  out = out.trim();
  if (maxLength != null && out.length > maxLength) out = out.slice(0, maxLength).trim();
  return out;
}

/** True when the string has a leading URL scheme like `http:`, `javascript:`, `mailto:`. */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

/**
 * True when `value` starts with a URL scheme (`http:`, `https:`, `javascript:`, ...). Reuses the
 * single {@link HAS_SCHEME} regex so callers never re-derive scheme detection (e.g. the profile's
 * prefixed handle inputs use it to skip the domain prefix when a full URL is pasted).
 */
export function hasUrlScheme(value: string): boolean {
  return HAS_SCHEME.test(value);
}

/**
 * Return a safe absolute http/https URL, or null. A missing scheme is assumed https (so "x.com/me"
 * works), but an explicit non-http(s) scheme (javascript:, data:, mailto:, vbscript:, ...) is REJECTED -
 * this is what stops a stored-XSS `href`. Returns the parsed, normalized `href`.
 */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(STRIP_ALWAYS, "").trim();
  if (!trimmed) return null;
  // No scheme -> assume https; an existing scheme is preserved so a bad one can be rejected below.
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Require a real dotted host (rejects "https://localhost", "https://x", and bare schemes).
    if (!url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Normalize a handle to a URL-safe slug: lowercased, only `[a-z0-9-]`, no leading/trailing or doubled
 * hyphens, capped to `maxLength`. Used to validate/normalize a handle wherever it becomes editable.
 */
export function sanitizeHandle(value: string, maxLength = 30): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}
