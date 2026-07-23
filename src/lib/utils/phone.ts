/**
 * @name phone
 * @implements-rules-version v1
 *
 * Optional-phone helpers for the profile Contact form (POO-699 [R4]). Semantics mirror the other
 * optional fields: blank CLEARS the field; a non-blank value must be a real, country-code-qualified
 * number, persisted as canonical E.164. Validity + canonical formatting come from `libphonenumber-js`
 * (the authoritative per-country metadata); `react-international-phone`'s `usePhoneInput` drives the
 * live formatting-as-you-type + country selection in {@link PhoneField}. These two pure functions back
 * both the seed normalization (mapping the stored value to its canonical form) and the Save gate.
 */
import { isValidPhoneNumber, parsePhoneNumber } from "libphonenumber-js";

/**
 * Canonical E.164 for a valid number, "" for a blank value, or the trimmed input UNCHANGED when it is
 * non-blank but not a valid number. A non-blank-invalid value never persists (Save is gated on
 * {@link isAcceptablePhone}); returning it verbatim keeps the field's on-screen state coherent.
 */
export function toE164(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  try {
    const parsed = parsePhoneNumber(trimmed);
    if (parsed?.isValid()) return parsed.number;
  } catch {
    // parsePhoneNumber throws on too-short / unparseable input; fall through to "invalid, unchanged".
  }
  return trimmed;
}

/** True when the phone is acceptable to save: blank (optional) OR a valid country-code number. */
export function isAcceptablePhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  return isValidPhoneNumber(trimmed);
}
