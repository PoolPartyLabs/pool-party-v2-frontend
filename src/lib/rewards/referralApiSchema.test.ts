/**
 * @id PP-REW-LIB-002 (POO-661)
 * @name referralApiSchema tests
 * @implements-rules-version v1
 *
 * [R3] Zod for the pp-api `GET /referral/:wallet` read. It must accept the full referrer shape, the
 * referee-only shape (empty `code`), and tolerate the fields the FE does not consume, so a benign
 * backend addition never fails the read.
 */
import { describe, expect, it } from "vitest";
import { apiReferralSchema } from "./referralApiSchema";

describe("apiReferralSchema", () => {
  // @rule R3: the full referrer shape parses (code + referees + referredBy + isReferee)
  it("parses the full referrer payload", () => {
    const payload = {
      wallet: "0xabc",
      code: "MARIA2026",
      referees: [
        {
          wallet: "0x1111111111111111111111111111111111111111",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          wallet: "0x2222222222222222222222222222222222222222",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      isReferee: false,
      referredBy: undefined,
    };
    const result = apiReferralSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.code).toBe("MARIA2026");
      expect(result.data.referees).toHaveLength(2);
    }
  });

  // @rule R3: a referee-only wallet (empty code, no referees, referredBy present) parses
  it("parses the referee-only payload with an empty code", () => {
    const payload = {
      wallet: "0xabc",
      code: "",
      referees: [],
      createdAt: "",
      isReferee: true,
      referredBy: { wallet: "0xdef", code: "OTHER99", referredAt: "2026-03-01T00:00:00.000Z" },
    };
    const result = apiReferralSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe("");
  });

  // @rule R3: tolerate missing optional fields (only wallet present)
  it("tolerates missing referees / optional fields", () => {
    const result = apiReferralSchema.safeParse({ wallet: "0xabc" });
    expect(result.success).toBe(true);
  });

  // @rule R3: an unknown extra key is stripped, not rejected
  it("strips unknown extra keys instead of failing", () => {
    const result = apiReferralSchema.safeParse({ wallet: "0xabc", code: "X", futureField: 1 });
    expect(result.success).toBe(true);
    if (result.success) expect("futureField" in result.data).toBe(false);
  });

  // @rule R3: a non-object payload is rejected (so a null must be handled by the caller, not the schema)
  it("rejects a non-object payload", () => {
    expect(apiReferralSchema.safeParse("nope").success).toBe(false);
    expect(apiReferralSchema.safeParse(42).success).toBe(false);
  });
});
