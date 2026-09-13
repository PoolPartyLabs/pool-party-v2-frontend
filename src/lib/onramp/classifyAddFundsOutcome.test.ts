/**
 * @id PP-CORE-LIB-109 (POO-1803), spec
 * @name add-funds outcome classifier, spec
 * @implements-rules-version v1 (POO-1803 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * [R4]: every outcome is classified by ONE question, could money have moved, with three answers.
 * The rows below are not invented: each `no` message was read out of the shipped 3.40.0 bundle at a
 * recorded offset (the table is in the module header). The fail-safe case at the end is the load
 * bearing one: an error we have never seen must never be able to render a cancellation.
 */
import { describe, expect, it } from "vitest";
import { classifyAddFundsOutcome } from "./classifyAddFundsOutcome";

/** The rejection shape the SDK produces: a plain `Error` with one of its literal messages. */
function rejected(message: string) {
  return { ok: false as const, error: new Error(message) };
}

describe("classifyAddFundsOutcome, provider claims (POO-1803 [R4])", () => {
  // @rule R4
  it("treats `confirmed` as a CLAIM that money may have moved, never as settlement", () => {
    const out = classifyAddFundsOutcome({
      ok: true,
      result: { method: "fiat", status: "confirmed" },
    });

    expect(out.moved).toBe("confirmed");
    expect(out.providerStatus).toBe("confirmed");
  });

  // @rule R4
  it("treats `submitted` the same way, because both are the provider's own claim", () => {
    const out = classifyAddFundsOutcome({
      ok: true,
      result: { method: "fiat", status: "submitted" },
    });

    expect(out.moved).toBe("confirmed");
    expect(out.providerStatus).toBe("submitted");
  });

  // @rule R4 -- we never pass `crypto`, so this should be unreachable. If it ever arrives it is
  // still a claim that funds moved, and must not be downgraded.
  it("does not downgrade an unexpected crypto completion", () => {
    const out = classifyAddFundsOutcome({
      ok: true,
      result: { method: "crypto", status: "completed" },
    });

    expect(out.moved).toBe("confirmed");
  });

  // @rule R4 -- a success shape we do not recognise is not a hard no.
  it("falls back to `maybe` on an unrecognised success status", () => {
    const out = classifyAddFundsOutcome({
      ok: true,
      result: { method: "fiat", status: "something-new" },
    });

    expect(out.moved).toBe("maybe");
  });
});

/**
 * Every message here was grepped out of the shipped bundle, with its offset recorded in the module
 * header. The seven `addFunds` pre-flight throws all fire BEFORE any surface opens, so nothing can
 * have been charged; the two popup failures fire when the window could not be opened at all.
 */
describe("classifyAddFundsOutcome, the hard `no` table (POO-1803 [R4])", () => {
  const preflight: ReadonlyArray<[string, string]> = [
    ["Invalid input: expected destination.address", "invalid_destination_address"],
    ["Invalid input: expected destination.chain", "invalid_destination_chain"],
    ["Invalid input: expected destination.asset", "invalid_destination_asset"],
    ["User must be authenticated to add funds", "not_authenticated"],
    ["Existing funding flow in progress", "flow_already_open"],
    ["Invalid input: expected non-empty fiat.source.assets", "empty_fiat_assets"],
    ["At least one of fiat or crypto config must be provided", "no_funding_config"],
    ["Unable to open payment window", "popup_blocked"],
    ["Unable to initialize flow", "popup_blocked"],
  ];

  for (const [message, reason] of preflight) {
    // @rule R4
    it(`classifies "${message}" as a hard no`, () => {
      const out = classifyAddFundsOutcome(rejected(message));

      expect(out.moved).toBe("no");
      expect(out.reason).toBe(reason);
    });
  }
});

describe("classifyAddFundsOutcome, the inconclusive exit (POO-1803 [R4], ADR-0006)", () => {
  // @rule R4 -- after 3.40.0 a charged card and an abandonment are indistinguishable here. The
  // bundle's own close handler falls through to this error whenever the state is neither
  // `provider-success` nor `provider-confirming`, which includes a card being charged in the popup.
  it("classifies `User exited flow` as `maybe`, never as a cancellation", () => {
    const out = classifyAddFundsOutcome(rejected("User exited flow"));

    expect(out.moved).toBe("maybe");
    expect(out.reason).toBe("user_exited");
  });
});

describe("classifyAddFundsOutcome, the fail-safe (POO-1803 [R4])", () => {
  // @rule R4 -- the rule that makes the table safe to be incomplete.
  it("classifies an unknown message as `maybe`", () => {
    const out = classifyAddFundsOutcome(rejected("Checkout failed after maximum retry attempts"));

    expect(out.moved).toBe("maybe");
    expect(out.reason).toBe("unknown_error");
  });

  // @rule R4 -- `User cancelled funding` is deliberately NOT in the hard-no table. It rejects from
  // the method chooser's `onCancel`, and the SDK's error handler can route BACK to that chooser
  // after a failed fiat attempt, so a cancel there may follow an attempt that already opened.
  it("does not treat `User cancelled funding` as a hard no", () => {
    const out = classifyAddFundsOutcome(rejected("User cancelled funding"));

    expect(out.moved).toBe("maybe");
  });

  // @rule R4 -- a rejection that is not an Error at all cannot be read for a message.
  it("classifies a non-Error rejection as `maybe`", () => {
    expect(classifyAddFundsOutcome({ ok: false, error: "a string" }).moved).toBe("maybe");
    expect(classifyAddFundsOutcome({ ok: false, error: undefined }).moved).toBe("maybe");
    expect(classifyAddFundsOutcome({ ok: false, error: { code: 42 } }).moved).toBe("maybe");
  });

  // @rule R4 -- matching is exact. A message that merely CONTAINS a hard-no string is not one.
  it("does not match a hard no by substring", () => {
    const out = classifyAddFundsOutcome(
      rejected("Wrapped: Invalid input: expected destination.asset"),
    );

    expect(out.moved).toBe("maybe");
  });
});
