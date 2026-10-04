import { describe, expect, it } from "vitest";
import {
  assertV2LaunchSigningAllowed,
  safeV2WalletCall,
  v2LaunchFailure,
  v2LaunchMode,
  v2LaunchResumePath,
  v2LaunchResumeState,
  v2LaunchStepLabel,
} from "../e2e/helpers/v2LaunchSigning";
import { buildLegacySiweMessage } from "../src/lib/auth/siweMessage";

const address = "0x3A3ea619C0f37a7D2fF07FF442d863f316A99A7a";
const financialMethods = [
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "personal_sign",
];

describe("v2 launch signing safety", () => {
  it("R4 normalizes numeric Review chains into journey heading names", () => {
    expect(v2LaunchStepLabel("Approve USDC", 42161)).toBe("Approve USDC · Arbitrum");
    expect(v2LaunchStepLabel("Create Robinhood spoke", 4663)).toBe(
      "Create Robinhood spoke · Robinhood Chain",
    );
    expect(() => v2LaunchStepLabel("Approve USDC", 1)).toThrow("V2_LAUNCH_UNKNOWN_CHAIN");
  });
  it("keeps review-only and signed modes and recognizes launch-only dry mode", () => {
    expect(v2LaunchMode("1")).toBe("dry");
    expect(v2LaunchMode("launch")).toBe("dry-launch");
    for (const value of [undefined, "0", ""]) expect(v2LaunchMode(value)).toBe("signed");
  });

  it.each([
    "dry",
    "dry-launch",
  ] as const)("blocks every financial method in %s even when armed and opted in", (mode) => {
    for (const method of financialMethods) {
      expect(() =>
        assertV2LaunchSigningAllowed(
          { method, params: ["Authorize fund launch"] },
          address,
          mode,
          true,
          "1",
        ),
      ).toThrow("Launch signing is disarmed");
    }
  });

  it.each([
    "dry",
    "signed",
  ] as const)("allows only allowlisted SIWE authentication and reads without arming in %s", (mode) => {
    expect(
      assertV2LaunchSigningAllowed(
        {
          method: "personal_sign",
          params: [buildLegacySiweMessage(address, "nonce12345"), address.toLowerCase()],
        },
        address,
        mode,
        false,
        undefined,
      ),
    ).toBe(false);
    expect(
      assertV2LaunchSigningAllowed({ method: "eth_accounts" }, address, mode, false, undefined),
    ).toBe(false);
    expect(() =>
      assertV2LaunchSigningAllowed(
        {
          method: "personal_sign",
          params: [buildLegacySiweMessage(`0x${"1".repeat(40)}`, "nonce12345")],
        },
        address,
        mode,
        false,
        "1",
      ),
    ).toThrow("Launch signing is disarmed");
  });

  it("blocks SIWE too in launch-dry, even with explicit opt-in and arming", () => {
    expect(() =>
      assertV2LaunchSigningAllowed(
        {
          method: "personal_sign",
          params: [buildLegacySiweMessage(address, "nonce12345"), address],
        },
        address,
        "dry-launch",
        true,
        "1",
      ),
    ).toThrow("Launch signing is disarmed");
  });

  it.each([
    "dry",
    "dry-launch",
    "signed",
  ] as const)("NO_SIGN blocks every signature including SIWE in %s without blocking reads", (mode) => {
    for (const method of financialMethods) {
      expect(() =>
        assertV2LaunchSigningAllowed(
          { method, params: [buildLegacySiweMessage(address, "nonce12345"), address] },
          address,
          mode,
          true,
          "1",
          "1",
        ),
      ).toThrow("Launch signing is disarmed");
    }
    expect(
      assertV2LaunchSigningAllowed({ method: "eth_accounts" }, address, mode, true, "1", "1"),
    ).toBe(false);
  });

  it("requires both arming and explicit opt-in for signed financial requests", () => {
    for (const method of financialMethods) {
      const request = { method, params: ["Authorize fund launch", address] };
      expect(() => assertV2LaunchSigningAllowed(request, address, "signed", false, "1")).toThrow(
        "Launch signing is disarmed",
      );
      expect(() =>
        assertV2LaunchSigningAllowed(request, address, "signed", true, undefined),
      ).toThrow("Launch signing is disarmed");
      expect(() => assertV2LaunchSigningAllowed(request, address, "signed", true, "0")).toThrow(
        "Launch signing is disarmed",
      );
      if (method === "eth_sendRawTransaction") {
        expect(() => assertV2LaunchSigningAllowed(request, address, "signed", true, "1")).toThrow(
          "Only Node-side eth_sendTransaction signing is permitted",
        );
      } else {
        expect(assertV2LaunchSigningAllowed(request, address, "signed", true, "1")).toBe(true);
      }
    }
  });
  it("denies unknown RPC and wallet methods even in armed signed mode", () => {
    for (const method of [
      "eth_sendUserOperation",
      "wallet_sendCalls",
      "eth_signTransaction",
      "wallet_unknown",
      "debug_traceCall",
      "made_up",
    ]) {
      expect(() => assertV2LaunchSigningAllowed({ method }, address, "signed", true, "1")).toThrow(
        "Wallet method is not allowlisted",
      );
    }
  });
  it("requires the personal_sign signer to match the authorized wallet", () => {
    for (const signer of [undefined, `0x${"1".repeat(40)}`, "invalid"]) {
      expect(() =>
        assertV2LaunchSigningAllowed(
          {
            method: "personal_sign",
            params: [buildLegacySiweMessage(address, "nonce12345"), signer],
          },
          address,
          "signed",
          true,
          "1",
        ),
      ).toThrow("Unauthorized personal_sign signer");
    }
  });
  it("allows explicitly listed read RPC and wallet controls", () => {
    for (const method of [
      "eth_call",
      "eth_getBalance",
      "eth_getTransactionReceipt",
      "eth_feeHistory",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
    ]) {
      expect(
        assertV2LaunchSigningAllowed({ method }, address, "dry-launch", false, undefined),
      ).toBe(false);
    }
  });
  it("sanitizes callback failures before they can cross the browser bridge", async () => {
    const secret = `0x${"a".repeat(64)}`;
    await expect(
      safeV2WalletCall(async () => {
        throw new Error(`upstream endpoint ${secret}`);
      }),
    ).rejects.toThrow(/^V2_WALLET_REQUEST_FAILED$/);
    expect(await safeV2WalletCall(async () => "public result")).toBe("public result");
  });
  it("R1-R5 persists only fixed failure codes rather than exception or UI text", () => {
    expect(v2LaunchFailure(false)).toEqual({ error: "V2_LAUNCH_FAILED" });
    expect(v2LaunchFailure(true)).toEqual({
      error: "V2_LAUNCH_FAILED",
      uiError: "V2_LAUNCH_UI_ERROR",
    });
  });
});

describe("wallet-local launch resume", () => {
  const origin = "https://v2.dev.pool-party.xyz";
  const draftId = "416268a3-35e7-4ce9-874d-41dad4c29e4e";
  const journeyId = `${address.toLowerCase()}:${draftId}`;
  const journey = {
    version: 1,
    journeyId,
    manager: address.toLowerCase(),
    draftId,
    createdAt: "2026-10-04T00:00:00Z",
    draft: { id: draftId, review: { name: "Existing launch", seed: "2" } },
  };
  const journal = {
    version: 1,
    draftId,
    manager: address.toLowerCase(),
    frozen: journey.draft,
    steps: [{ id: "approve", chain: 42161, kind: "approve", dependencies: [] }],
    checkpoints: {},
    addresses: {},
  };
  const entries = (): [{ name: string; value: string }, { name: string; value: string }] => [
    { name: `pp:v2:journey:1:${journeyId}`, value: JSON.stringify(journey) },
    { name: `pp:v2:launch:1:${journeyId}`, value: JSON.stringify(journal) },
  ];
  const state = (localStorage: Array<{ name: string; value: string }> = entries()) => ({
    cookies: [],
    origins: [{ origin, localStorage }],
  });

  it("uses the exact encoded wallet:draft route, never the review route", () => {
    expect(v2LaunchResumePath(journeyId, address)).toBe(
      `/en/manager/fund-launch/${encodeURIComponent(journeyId)}`,
    );
    for (const invalid of [
      `${`0x${"1".repeat(40)}`}:${draftId}`,
      `${address}:`,
      `${address}:../review`,
      `${address}:draft?new=1`,
      encodeURIComponent(journeyId),
    ]) {
      expect(() => v2LaunchResumePath(invalid, address)).toThrow(/^V2_LAUNCH_INVALID_RESUME$/);
    }
  });

  it("reads persisted metadata and the existing unfinished journal for the exact origin", () => {
    expect(v2LaunchResumeState(state(), origin, address)).toEqual({
      path: `/en/manager/fund-launch/${encodeURIComponent(journeyId)}`,
      journeyId,
      draftId,
      name: "Existing launch",
      seed: "2",
      failed: false,
    });
    expect(() => v2LaunchResumeState(state(), "http://localhost:3000", address)).toThrow(
      /^V2_LAUNCH_INVALID_RESUME$/,
    );
  });

  it("selects Retry failed step only for a persisted failure", () => {
    const localStorage = entries();
    localStorage[1].value = JSON.stringify({
      ...journal,
      checkpoints: { approve: { stepId: "approve", chain: 42161, status: "failed" } },
    });
    expect(v2LaunchResumeState(state(localStorage), origin, address).failed).toBe(true);
  });

  it("refuses missing journals, completed journeys, and mismatched wallet or draft metadata", () => {
    const complete = entries();
    complete[1].value = JSON.stringify({
      ...journal,
      checkpoints: { approve: { stepId: "approve", chain: 42161, status: "confirmed" } },
    });
    const wrongManager = entries();
    wrongManager[0].value = JSON.stringify({ ...journey, manager: `0x${"1".repeat(40)}` });
    const wrongDraft = entries();
    wrongDraft[0].value = JSON.stringify({ ...journey, draft: { ...journey.draft, id: "other" } });
    const wrongJournal = entries();
    wrongJournal[1].value = JSON.stringify({ ...journal, manager: `0x${"1".repeat(40)}` });
    for (const localStorage of [
      [],
      entries().slice(0, 1),
      complete,
      wrongManager,
      wrongDraft,
      wrongJournal,
    ]) {
      expect(() => v2LaunchResumeState(state(localStorage), origin, address)).toThrow(
        /^V2_LAUNCH_INVALID_RESUME$/,
      );
    }
    expect(() => v2LaunchResumeState(state(), origin, `0x${"1".repeat(40)}`)).toThrow(
      /^V2_LAUNCH_INVALID_RESUME$/,
    );
  });

  it("fails ambiguity instead of choosing the newest draft or another origin", () => {
    const secondId = `${address.toLowerCase()}:second`;
    const localStorage = [
      ...entries(),
      {
        name: `pp:v2:journey:1:${secondId}`,
        value: JSON.stringify({
          ...journey,
          journeyId: secondId,
          draftId: "second",
          draft: { ...journey.draft, id: "second" },
        }),
      },
      {
        name: `pp:v2:launch:1:${secondId}`,
        value: JSON.stringify({ ...journal, draftId: "second" }),
      },
    ];
    expect(() => v2LaunchResumeState(state(localStorage), origin, address)).toThrow(
      /^V2_LAUNCH_AMBIGUOUS_RESUME$/,
    );
  });

  it("ignores completed journeys and unrelated origins without changing the selected journal", () => {
    const completeId = `${address.toLowerCase()}:complete`;
    const localStorage = [
      ...entries(),
      {
        name: `pp:v2:journey:1:${completeId}`,
        value: JSON.stringify({
          ...journey,
          journeyId: completeId,
          draftId: "complete",
          draft: { ...journey.draft, id: "complete" },
        }),
      },
      {
        name: `pp:v2:launch:1:${completeId}`,
        value: JSON.stringify({
          ...journal,
          draftId: "complete",
          checkpoints: { approve: { stepId: "approve", chain: 42161, status: "confirmed" } },
        }),
      },
    ];
    const original = JSON.stringify(localStorage);
    const stored = state(localStorage);
    stored.origins.push({ origin: "http://localhost:3000", localStorage: entries() });
    expect(v2LaunchResumeState(stored, origin, address).journeyId).toBe(journeyId);
    expect(JSON.stringify(localStorage)).toBe(original);
  });

  it("rejects duplicate origins, duplicate storage keys, and malformed checkpoints", () => {
    const duplicateOrigin = state();
    duplicateOrigin.origins.push({ origin, localStorage: entries() });
    const malformedJournal = entries();
    malformedJournal[1].value = JSON.stringify({
      ...journal,
      checkpoints: { approve: { stepId: "other", chain: 42161, status: "confirmed" } },
    });
    for (const stored of [
      duplicateOrigin,
      state([...entries(), ...entries()]),
      state(malformedJournal),
    ]) {
      expect(() => v2LaunchResumeState(stored, origin, address)).toThrow(
        /^V2_LAUNCH_INVALID_RESUME$/,
      );
    }
  });

  it("never leaks keys or cookie values through validation failures", () => {
    const secret = `0x${"a".repeat(64)}`;
    const invalid = state([{ name: `pp:v2:journey:1:${journeyId}`, value: secret }]);
    expect(() => v2LaunchResumeState(invalid, origin, address)).toThrow(
      /^V2_LAUNCH_INVALID_RESUME$/,
    );
    expect(() => v2LaunchResumePath(secret, address)).toThrow(/^V2_LAUNCH_INVALID_RESUME$/);
  });
});
/**
 * @id PP-E2E-V2-003
 * @name launch safety regressions R1-R5
 * @implements-rules-version v1
 */
