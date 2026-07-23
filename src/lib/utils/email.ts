/**
 * @name email
 * @implements-rules-version v1
 *
 * Minimal email-shape check for optional contact fields. Deliberately lenient (one @, a dot in the
 * domain, no spaces) - real verification happens server-side; this only catches obvious typos before
 * save. An empty string is the caller's concern (the field is optional), so it is NOT validated here.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when `value` looks like a syntactically valid email address. */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
