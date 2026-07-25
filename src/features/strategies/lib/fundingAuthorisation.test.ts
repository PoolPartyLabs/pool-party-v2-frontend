/**
 * @id PP-CORE-SEC-001 (POO-1050)
 * @name funding authorisation guard, spec
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * Rules under test (POO-1050 rules v1):
 *   [R3] approvals are sized to the plan, never unbounded
 *   [R4] a money-moving authorisation must be legible: what token, what spender, what amount
 *   [R6] provider responses are untrusted input, including the ones that become calldata
 *
 * The gap this closes. Before this guard the rail asked `/check_approval` for an amount sized to the
 * leg and then broadcast whatever calldata came back, unread. The request is not the authorisation:
 * the calldata is. A response that encodes `approve(anyone, MAX_UINT256)`, or a call to a contract
 * that is not the token at all, was signed by the user's wallet with nothing in the code path able to
 * tell the difference.
 */
import { describe, expect, it } from "vitest";
import {
  assertPermitAuthorisesLeg,
  assertZeroingApproval,
  boundApprovalToPlan,
  decodeErc20Approval,
  ERC20_APPROVE_SELECTOR,
  encodeErc20Approval,
  MAX_PERMIT_WINDOW_SECONDS,
} from "./fundingAuthorisation";

const POLYGON = 137;
const WETH = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const ROUTER = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
const ATTACKER = "0xBAdBAdBAdBAdBAdBAdBAdBAdBAdBAdBAdBAdBAd0";

/** The maximum uint256, the standard drainer payload. */
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);
/** Permit2's own unbounded allowance sentinel. */
const MAX_UINT160 = (BigInt(1) << BigInt(160)) - BigInt(1);

/** The leg the plan says we are funding: one token, one chain, one amount. */
const leg = { chainId: POLYGON, token: WETH, amount: "1000000000000000000" };

function approvalRequest(data: string, overrides: Record<string, unknown> = {}) {
  return {
    to: WETH,
    from: "0xc3673adC0d1F0E4E0e0a6bF9bD7d1e6a1a2b3c4d",
    data,
    value: "0x00",
    chainId: POLYGON,
    ...overrides,
  } as Parameters<typeof boundApprovalToPlan>[0];
}

function permit(values: Record<string, unknown>, domain: Record<string, unknown> = {}) {
  return {
    domain: { name: "Permit2", chainId: POLYGON, verifyingContract: PERMIT2, ...domain },
    types: {
      PermitDetails: [{ name: "token", type: "address" }],
      PermitSingle: [{ name: "details", type: "PermitDetails" }],
    },
    values,
  };
}

function permitSingle(overrides: { details?: Record<string, unknown> } = {}) {
  return permit({
    details: {
      token: WETH,
      amount: "1000000000000000000",
      expiration: 1_800_000_000,
      nonce: 0,
      ...overrides.details,
    },
    spender: ROUTER,
    sigDeadline: 1_799_000_000,
  });
}

/** A clock inside the permit fixture's window, so the expiry bound is exercised deliberately. */
const NOW_MS = 1_798_000_000_000;

describe("decodeErc20Approval", () => {
  it("round-trips a spender and an amount", () => {
    const data = encodeErc20Approval(ROUTER, BigInt(123));
    expect(data.startsWith(ERC20_APPROVE_SELECTOR)).toBe(true);
    expect(decodeErc20Approval(data)).toEqual({
      spender: ROUTER.toLowerCase(),
      amount: BigInt(123),
    });
  });

  it("decodes an unbounded approval rather than hiding it", () => {
    expect(decodeErc20Approval(encodeErc20Approval(PERMIT2, MAX_UINT256))?.amount).toBe(
      MAX_UINT256,
    );
  });

  it("refuses calldata that is not an approve at all", () => {
    // The Universal Router's `execute` selector: a real transaction, not an approval.
    expect(decodeErc20Approval("0x24856bc3deadbeef")).toBeNull();
  });

  it("refuses a truncated approve, which decodes to a different amount than it looks like", () => {
    expect(decodeErc20Approval("0x095ea7b3aaaa")).toBeNull();
  });

  it("refuses an address argument with dirty upper bytes", () => {
    const dirty = `${ERC20_APPROVE_SELECTOR}ff${"0".repeat(22)}${ROUTER.slice(2).toLowerCase()}${"0".repeat(64)}`;
    expect(decodeErc20Approval(dirty)).toBeNull();
  });
});

describe("boundApprovalToPlan — [R3] sized to the plan, never unbounded", () => {
  it("caps an unbounded approval to the amount the plan spends", () => {
    const result = boundApprovalToPlan(
      approvalRequest(encodeErc20Approval(PERMIT2, MAX_UINT256)),
      leg,
    );

    expect(result.capped).toBe(true);
    expect(decodeErc20Approval(result.request.data)).toEqual({
      spender: PERMIT2.toLowerCase(),
      amount: BigInt(leg.amount),
    });
  });

  it("keeps the provider's spender when it caps, because the target varies by route", () => {
    const result = boundApprovalToPlan(
      approvalRequest(encodeErc20Approval(ROUTER, MAX_UINT256)),
      leg,
    );
    expect(decodeErc20Approval(result.request.data)?.spender).toBe(ROUTER.toLowerCase());
  });

  it("leaves an already-exact approval untouched", () => {
    const exact = encodeErc20Approval(PERMIT2, BigInt(leg.amount));
    const result = boundApprovalToPlan(approvalRequest(exact), leg);

    expect(result.capped).toBe(false);
    expect(result.request.data).toBe(exact);
  });

  it("leaves an approval SMALLER than the plan untouched, so the leg fails loudly on-chain", () => {
    const small = encodeErc20Approval(PERMIT2, BigInt(1));
    expect(boundApprovalToPlan(approvalRequest(small), leg).request.data).toBe(small);
  });

  it("refuses an approval aimed at anything other than the token being spent", () => {
    const request = approvalRequest(encodeErc20Approval(PERMIT2, MAX_UINT256), { to: ATTACKER });
    expect(() => boundApprovalToPlan(request, leg)).toThrow(/token/i);
  });

  it("refuses calldata that is not an approve, whatever the endpoint called it", () => {
    expect(() => boundApprovalToPlan(approvalRequest("0x24856bc3deadbeef"), leg)).toThrow(
      /approve/i,
    );
  });

  it("refuses an approval that also moves native value", () => {
    const request = approvalRequest(encodeErc20Approval(PERMIT2, BigInt(1)), {
      value: "0x0de0b6b3a7640000",
    });
    expect(() => boundApprovalToPlan(request, leg)).toThrow(/value/i);
  });

  it("carries a typed code, so the panel classifies it instead of showing 'something went wrong'", () => {
    try {
      boundApprovalToPlan(approvalRequest("0x24856bc3deadbeef"), leg);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { cause?: { code?: string } }).cause?.code).toBe(
        "PROVISIONING_APPROVAL_UNSAFE",
      );
    }
  });
});

describe("assertZeroingApproval — the USDT-class cancel", () => {
  it("accepts an approve to zero", () => {
    const decoded = assertZeroingApproval(
      approvalRequest(encodeErc20Approval(PERMIT2, BigInt(0))),
      leg,
    );
    expect(decoded.amount).toBe(BigInt(0));
  });

  it("refuses a 'cancel' that actually grants an allowance", () => {
    const request = approvalRequest(encodeErc20Approval(ATTACKER, MAX_UINT256));
    expect(() => assertZeroingApproval(request, leg)).toThrow(/zero/i);
  });

  it("refuses a cancel aimed at another contract", () => {
    const request = approvalRequest(encodeErc20Approval(PERMIT2, BigInt(0)), { to: ATTACKER });
    expect(() => assertZeroingApproval(request, leg)).toThrow(/token/i);
  });
});

describe("assertPermitAuthorisesLeg — [R4] a signature is a money-moving authorisation", () => {
  it("returns what the permit authorises, so a surface can say it out loud", () => {
    expect(assertPermitAuthorisesLeg(permitSingle(), leg, NOW_MS)).toEqual([
      {
        token: WETH.toLowerCase(),
        amount: "1000000000000000000",
        spender: ROUTER.toLowerCase(),
        expiration: "1800000000",
        sigDeadline: "1799000000",
      },
    ]);
  });

  it("pins the verifying contract to Permit2 on the leg's own chain", () => {
    const spoofed = permitSingle();
    spoofed.domain.verifyingContract = ATTACKER;
    expect(() => assertPermitAuthorisesLeg(spoofed, leg, NOW_MS)).toThrow(/permit2/i);
  });

  it("refuses a permit scoped to a different chain, which is how a replay hides", () => {
    const other = permitSingle();
    other.domain.chainId = 8453;
    expect(() => assertPermitAuthorisesLeg(other, leg, NOW_MS)).toThrow(/chain/i);
  });

  it("refuses a permit for a token the plan is not spending", () => {
    expect(() =>
      assertPermitAuthorisesLeg(permitSingle({ details: { token: ATTACKER } }), leg, NOW_MS),
    ).toThrow(/token/i);
  });

  it("refuses an effectively infinite expiration, a standing drain authorisation", () => {
    const forever = permitSingle({ details: { expiration: "281474976710655" } });
    expect(() => assertPermitAuthorisesLeg(forever, leg, NOW_MS)).toThrow(/expir/i);
  });

  it("accepts an expiration inside the window", () => {
    const inWindow = permitSingle({
      details: { expiration: String(Math.floor(NOW_MS / 1000) + MAX_PERMIT_WINDOW_SECONDS - 60) },
    });
    expect(assertPermitAuthorisesLeg(inWindow, leg, NOW_MS)).toHaveLength(1);
  });

  it("reports an unbounded permit amount rather than rejecting it, because the ERC-20 cap bounds it", () => {
    const unbounded = permitSingle({ details: { amount: MAX_UINT160.toString() } });
    expect(assertPermitAuthorisesLeg(unbounded, leg, NOW_MS)[0]?.amount).toBe(
      MAX_UINT160.toString(),
    );
  });

  it("checks every entry of a PermitBatch, not just the first", () => {
    const batch = permit({
      details: [
        { token: WETH, amount: "1", expiration: 1_800_000_000, nonce: 0 },
        { token: ATTACKER, amount: "1", expiration: 1_800_000_000, nonce: 0 },
      ],
      spender: ROUTER,
      sigDeadline: 1_799_000_000,
    });
    expect(() => assertPermitAuthorisesLeg(batch, leg, NOW_MS)).toThrow(/token/i);
  });

  it("refuses a permit with no details at all rather than signing an unread struct", () => {
    expect(() => assertPermitAuthorisesLeg(permit({ spender: ROUTER }), leg, NOW_MS)).toThrow(
      /details/i,
    );
  });

  it("carries a typed code", () => {
    try {
      assertPermitAuthorisesLeg(permit({ spender: ROUTER }), leg, NOW_MS);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as { cause?: { code?: string } }).cause?.code).toBe(
        "PROVISIONING_PERMIT_UNSAFE",
      );
    }
  });
});
