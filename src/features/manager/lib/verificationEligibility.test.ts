/**
 * @id PP-MGR-LIB-002
 * @name verificationEligibility — tests
 * @implements-rules-version v1
 *
 * POO-593 R2 / POO-579: a manager may request verification only once they expose the IDENTITY social
 * (X) as a safe absolute http(s) URL. Community links (Telegram/Discord/YouTube) and the website do NOT
 * satisfy the gate, and an unsafe/blank link never counts. Instagram is no longer a gate network — the
 * deployed registry does not persist an Instagram column (POO-579).
 */
import { describe, expect, it } from "vitest";
import type { ManagerSocials } from "@/lib/schemas";
import {
  hasVerificationIdentitySocial,
  VERIFICATION_IDENTITY_NETWORKS,
} from "./verificationEligibility";

describe("verificationEligibility (POO-593 R2 / POO-579)", () => {
  it("exposes X as the sole identity network (Instagram dropped, POO-579)", () => {
    expect(VERIFICATION_IDENTITY_NETWORKS).toEqual(["x"]);
  });

  it("is false when no socials are set", () => {
    expect(hasVerificationIdentitySocial({})).toBe(false);
  });

  it("is true when X is a valid link", () => {
    expect(hasVerificationIdentitySocial({ x: "https://x.com/handle" })).toBe(true);
  });

  it("is false when only NON-identity socials are set (telegram/discord/youtube/website)", () => {
    const socials: ManagerSocials = {
      telegram: "https://t.me/channel",
      discord: "https://discord.gg/server",
      youtube: "https://youtube.com/@channel",
      website: "https://example.xyz",
    };
    expect(hasVerificationIdentitySocial(socials)).toBe(false);
  });

  it("is false when the identity link is unsafe (javascript:) — never counts", () => {
    expect(hasVerificationIdentitySocial({ x: "javascript:alert(1)" })).toBe(false);
  });

  it("is false when the identity link is blank/whitespace", () => {
    expect(hasVerificationIdentitySocial({ x: "   " })).toBe(false);
    expect(hasVerificationIdentitySocial({ x: "" })).toBe(false);
  });
});
