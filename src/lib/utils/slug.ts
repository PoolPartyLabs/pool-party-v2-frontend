/**
 * @id PP-CORE-LIB-025
 * @name toHandleSlug
 * @implements-rules-version POO-575 v2
 *
 * Pure slugifier for the editable manager handle (POO-575 R2). Turns any typed OR pasted value into a
 * URL-safe, lowercase slug so the field is always slug-shaped (a "live slug"): NFKD-decomposable
 * accented letters transliterate to their base letter, whitespace/underscores → "-", every other
 * disallowed char is DROPPED, hyphen runs collapse, leading/trailing hyphens trim, length caps.
 *
 * POO-746: two rules the manager reported. (R1a) NFKD-decomposable accented Latin letters
 * transliterate to their ASCII base (`ã→a`, `é→e`, `ç→c`) instead of becoming a hyphen — so the
 * display-name suggestion of "João" is "joao", not "jo-o". Non-decomposing Latin letters (`ø`, `ł`,
 * `ß`, `æ`, `œ`, `đ`) have no NFKD ASCII base, so they are DROPPED by the strict `[a-z0-9-]` filter
 * rather than converted (`Søren→sren`, `Straße→strae`) — there is no transliteration map. (R1b) any
 * remaining char outside `[a-z0-9-]` is DROPPED, not turned into a hyphen, so pasted junk
 * (symbols/emoji/non-Latin) can never inject a stray "-" — the output is only ever `[a-z0-9-]`.
 * Whitespace + underscore stay word separators (a single hyphen).
 *
 * Supersedes {@link sanitizeHandle} (POO-552) for the strict `[a-z0-9-]` handle rule and has since
 * diverged from it: POO-552 hyphenates every disallowed char and does no NFKD folding, whereas this
 * helper NFKD-folds accents and DROPS disallowed chars. It is the single, explicitly-named,
 * length-parameterized helper POO-575 drives its input and display through, and is unit-tested
 * against the rule. ASCII-only by design, matching what the URL layer accepts today.
 */

/**
 * Normalize `input` to a URL-safe handle slug capped at `maxLen` (default 30).
 * Returns `""` for empty, whitespace-only, or fully-stripped input.
 */
export function toHandleSlug(input: string, maxLen = 30): string {
  return (
    (input ?? "")
      // POO-746 R1a: decompose accented letters (é → e + combining accent) and drop the combining
      // marks, so an accent transliterates to its base letter instead of being stripped to a hyphen.
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      // Whitespace and underscores are word separators → a single hyphen.
      .replace(/[\s_]+/g, "-")
      // POO-746 R1b: drop everything else outside the handle alphabet (symbols/emoji/non-Latin) —
      // removed, NOT hyphenated, so pasted junk can't inject a stray "-". Hyphens are preserved.
      .replace(/[^a-z0-9-]+/g, "")
      // Collapse hyphen runs (including ones the separator step introduced).
      .replace(/-{2,}/g, "-")
      // Trim leading/trailing hyphens before capping.
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLen)
      // Capping can leave a trailing hyphen on the boundary; trim it off.
      .replace(/-+$/g, "")
  );
}
