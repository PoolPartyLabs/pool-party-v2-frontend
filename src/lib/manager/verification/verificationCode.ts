/**
 * @id PP-MGR-LIB-011
 * @name verificationCode
 * @implements-rules-version v1
 *
 * POO-745: mock-mode generator for the manager account-verification code. The REAL code is minted
 * server-side (POO-744, CSPRNG); this only backs mock mode, but matches the API's format so a mocked
 * code is indistinguishable from a real one: 8 characters of uppercase Crockford base32 (the base32
 * alphabet with the ambiguous I/L/O/U removed), drawn from `crypto.getRandomValues`. ~40 bits of
 * entropy — sufficient for a staff-evaluated, non-secret-bearing DM challenge.
 *
 * PP-MOCK: real codes come from POO-744's `POST /managers/me/verification/request`; this is the mock
 * stand-in only (see the mock `managerService.requestVerification`).
 */

/** Crockford base32 alphabet (32 symbols; excludes I, L, O, U to avoid transcription ambiguity). */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Number of characters in a verification code (matches the POO-744 API format). */
const CODE_LENGTH = 8;

/**
 * Generate an 8-char uppercase Crockford base32 code from the platform CSPRNG. Rejection-free: each
 * byte is masked to the low 5 bits (0-31), indexing directly into the 32-symbol alphabet with a
 * uniform distribution.
 */
export function generateVerificationCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += CROCKFORD_ALPHABET[byte & 0x1f];
  return code;
}
