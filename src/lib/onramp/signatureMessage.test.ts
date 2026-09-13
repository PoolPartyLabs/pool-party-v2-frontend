/**
 * @id PP-CORE-LIB-063 (POO-1132)
 * @name on-ramp signature message tests
 * @implements-rules-version v2 (POO-1132 rules v2)
 *
 * Rules under test (POO-1132 rules v2):
 *   the signature message keeps v1's shape (`Wallet: <addr>` + ISO `Timestamp:`) because the backend
 *   parses BOTH and enforces a 5-minute replay window (`on-ramp.service.ts:62-98`). These lock the
 *   exact three things `verifyOnRampSignature` does with the string, so a drift breaks signing loudly
 *   here instead of silently in production.
 */
import { describe, expect, it } from "vitest";
import { buildOnRampSignatureMessage } from "./signatureMessage";

const WALLET = "0x1111111111111111111111111111111111111111";
const CHECKSUMMED = "0xAbC1111111111111111111111111111111111111";

/** The `Timestamp:` line's value, extracted with the exact regex the backend uses. */
function timestampOf(message: string): string {
  const match = message.match(/Timestamp: (.+)$/m);
  if (!match?.[1]) throw new Error("message carries no Timestamp line");
  return match[1];
}

describe("buildOnRampSignatureMessage (POO-1132)", () => {
  // @rule POO-1132: the message keeps v1's `Wallet: <addr>` line, which the backend matches with an
  // includes-check (`on-ramp.service.ts:62-98`).
  it("carries a `Wallet: <addr>` line the backend's includes-check will match", () => {
    const message = buildOnRampSignatureMessage(WALLET);
    expect(message).toContain(`Wallet: ${WALLET}`);
    // The backend does `message.toLowerCase().includes("wallet: " + addr.toLowerCase())`.
    expect(message.toLowerCase()).toContain(`wallet: ${WALLET.toLowerCase()}`);
  });

  // @rule POO-1132: the check lowercases both sides, so a checksummed address still matches.
  it("matches the includes-check regardless of address casing", () => {
    const message = buildOnRampSignatureMessage(CHECKSUMMED);
    expect(message.toLowerCase()).toContain(`wallet: ${CHECKSUMMED.toLowerCase()}`);
  });

  // @rule POO-1132: the ISO `Timestamp:` line is the other half the backend parses, for its replay
  // window.
  it("carries a `Timestamp:` line the backend regex extracts to a valid date", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const parsed = new Date(timestampOf(buildOnRampSignatureMessage(WALLET, now)));
    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getTime()).toBe(now.getTime());
  });

  // @rule POO-1132: the shape is fixed, so the same instant produces the same string to sign.
  it("is deterministic for a fixed instant", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(buildOnRampSignatureMessage(WALLET, now)).toBe(buildOnRampSignatureMessage(WALLET, now));
  });

  // @rule POO-1132: the backend enforces a 5-minute replay window, so the default stamp is "now".
  it("defaults to a timestamp inside the 5-minute replay window", () => {
    const before = Date.now();
    const message = buildOnRampSignatureMessage(WALLET);
    const after = Date.now();
    const stamp = new Date(timestampOf(message)).getTime();
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(after);
  });

  // @rule POO-1132: v1's preamble stays, so the user signs the thing they were shown.
  it("keeps the consent preamble so the user signs what they agreed to", () => {
    const message = buildOnRampSignatureMessage(WALLET);
    expect(message).toContain("Pool Party On-Ramp Verification");
    expect(message).toContain("requires no KYC");
  });
});
