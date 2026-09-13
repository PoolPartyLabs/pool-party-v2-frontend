/**
 * @id PP-CORE-LIB-106 (POO-1801) - tests
 * @name on-ramp limits - tests
 * @implements-rules-version v1 (POO-1801 rules v1)
 * @analytics-events none, two constants emit nothing.
 *
 * [R3] Our floor has ONE home. This app has been bitten by the opposite: `computeNeed.ts:85` records
 * FOUR independent $10 floors plus a hardcoded "as little as $10" in 12 locales, and an attempt to
 * raise one of them was reverted because moving one alone opens a band where the screen states a
 * minimum the app will not place. So the assertion that matters here is not the VALUE, it is that
 * this module re-exports rather than restates.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAYBIS_MIN_USD } from "@/lib/provisioning/computeNeed";
import { ON_RAMP_FLOOR_USD, STRIPE_SANDBOX_MAX_USD } from "./limits";

describe("ON_RAMP_FLOOR_USD", () => {
  // @rule R3
  it("[R3] IS the existing floor, by identity and not by coincidence", () => {
    expect(ON_RAMP_FLOOR_USD).toBe(PAYBIS_MIN_USD);
  });

  // @rule R3
  it("[R3] is a re-export, not a second literal", () => {
    // A value check cannot tell a re-export from a copy that happens to agree today, and the two
    // diverge the moment somebody edits `computeNeed.ts`. So the SOURCE is the assertion: no bare
    // number may be assigned to this name here.
    const source = readFileSync(join(__dirname, "limits.ts"), "utf8");
    expect(source).toMatch(/export\s*\{[^}]*PAYBIS_MIN_USD as ON_RAMP_FLOOR_USD/);
    expect(source).not.toMatch(/const\s+ON_RAMP_FLOOR_USD\s*=/);
  });
});

describe("STRIPE_SANDBOX_MAX_USD", () => {
  // @rule R3
  it("[R3] is the sandbox ceiling of $200", () => {
    expect(STRIPE_SANDBOX_MAX_USD).toBe(200);
  });

  // @rule R3
  it("[R3] is named as the SANDBOX's ceiling, never attributed to us", () => {
    // The naming is the rule: our floor is ours and is declared so, the vendor's test-mode ceiling
    // is theirs. Conflating them is how a provider limit becomes a product decision nobody made.
    const source = readFileSync(join(__dirname, "limits.ts"), "utf8");
    expect(source).toMatch(/sandbox/i);
    // The floor is declared OURS (D9), never attributed to a provider. The negative is written
    // against the SHAPE of the sentence someone would actually write, not against one exact phrase
    // nobody would type: "the floor is Stripe's" in any of its spellings is what must never appear.
    expect(source).not.toMatch(/floor is (Paybis|Stripe|the provider)/i);
  });
});
