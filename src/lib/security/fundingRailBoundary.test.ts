/**
 * @id PP-CORE-SEC-001 (POO-1050)
 * @name funding-rail security invariants, spec
 * @implements-rules-version v1
 * @hackathon POO-1022 (Universal Funding)
 *
 * The invariants the Universal Funding rail (epic POO-1022) has to keep, expressed as tests so they
 * cannot rot. Rules under test (POO-1050 rules v1):
 *
 *   [R2] no CSP change is required or made; `trade-api.gateway.uniswap.org` is absent from the policy
 *        and its ABSENCE is the test of the invariant (a PR that needs it has violated [R1])
 *   [R5] every server action the epic added derives the wallet from the SIWE session, and cannot be
 *        handed one: the parameter does not exist, so there is no check to loosen later
 *   [R6] a provider response never reaches a transaction unvalidated
 *   [R7] no secret, signature or raw address is logged
 *
 * Plus the two things the review was asked to audit by name: what the recovery journal puts in
 * `localStorage`, and whether one tab can take another tab's route.
 *
 * These are source-text guards, which is a deliberate choice over a runtime assertion: the failure
 * they catch is a line someone WRITES, and it has to fail in review rather than at a user's wallet.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimLease,
  createJournal,
  createJournalRecorder,
  FUNDING_JOURNAL_KEY,
  LEASE_TTL_MS,
} from "@/features/strategies/lib/fundingJournal";

const ROOT = resolve(__dirname, "..", "..", "..");
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

/**
 * The argument text of every `console.*` call in `source`, one entry per call.
 *
 * A balanced-paren scan rather than a regex, deliberately: any pattern that stops at a punctuation
 * character stops inside string literals too, and a log message is exactly where punctuation lives.
 * Quotes (including template literals) and escapes are tracked, so only a `)` that really closes the
 * call ends a capture. A call the scan cannot see is a call [R7] does not check, and that reads as a
 * pass, which is the one failure mode a source-text guard must not have.
 */
function consoleCallArguments(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(/console\.\w+\(/g)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let quote: string | undefined;
    let cursor = start;
    for (; cursor < source.length && depth > 0; cursor++) {
      const char = source[cursor];
      if (quote !== undefined) {
        if (char === "\\") cursor++;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "(") depth++;
      else if (char === ")") depth--;
    }
    calls.push(source.slice(start, cursor - 1));
  }
  return calls;
}

/** Every `"use server"` module the epic added. Each one is a public, callable RPC endpoint. */
const EPIC_SERVER_ACTIONS = [
  "src/lib/uniswap/actions.ts",
  "src/lib/provisioning/planActions.ts",
  "src/lib/balances/fundingInventoryActions.ts",
];

/** Every module of the client-side execution rail: the code that touches money in the browser. */
const RAIL_MODULES = [
  "src/features/strategies/lib/buildPlanSteps.ts",
  "src/features/strategies/lib/fundingAuthorisation.ts",
  "src/features/strategies/lib/fundingJournal.ts",
  "src/features/strategies/lib/reconcileFundingJournal.ts",
  "src/features/strategies/lib/awaitBridgeSettlement.ts",
  "src/features/strategies/hooks/useProvisioningRail.ts",
];

describe("[R2] the CSP is untouched, and that is load-bearing", () => {
  it("allowlists no Uniswap origin, because nothing is fetched from the browser", () => {
    const csp = read("src/lib/security/csp.ts");
    expect(csp).not.toMatch(/uniswap/i);
    expect(csp).not.toMatch(/trade-api/i);
  });

  it("names no Uniswap origin anywhere in the security layer", () => {
    expect(read("src/lib/security/headers.ts")).not.toMatch(/uniswap/i);
  });
});

describe("[R5] the wallet comes from the session, and cannot be handed in", () => {
  it.each(EPIC_SERVER_ACTIONS)("%s derives it from getSessionWallet", (file) => {
    const source = read(file);
    expect(source).toMatch(/^\s*(["'])use server\1/m);
    expect(source).toContain("getSessionWallet");
  });

  it.each(EPIC_SERVER_ACTIONS)("%s exposes no caller-supplied address parameter", (file) => {
    // The rule is structural: an action's INPUT TYPES must not carry an address-shaped field. A
    // validated one would still be a path the day the validation is loosened.
    const source = read(file);
    const interfaces = [
      ...source.matchAll(/export interface \w+(?:Input|Scope)\s*\{([\s\S]*?)\n\}/g),
    ];
    for (const [, body] of interfaces) {
      expect(body).not.toMatch(/^\s*(wallet|walletAddress|swapper|owner|from|account)\??\s*:/m);
    }
  });

  it("every exported action in the Uniswap layer opens with the session read", () => {
    const source = read("src/lib/uniswap/actions.ts");
    const exported = [...source.matchAll(/export async function (\w+)\(/g)].map(([, name]) => name);
    expect(exported.length).toBeGreaterThan(0);
    for (const name of exported) {
      const body = source.slice(source.indexOf(`export async function ${name}(`));
      const firstStatements = body.slice(0, body.indexOf("\n}\n") + 1);
      expect(firstStatements, `${name} must read the session`).toContain(
        "await getSessionWallet()",
      );
    }
  });

  it("assembles outgoing bodies field by field rather than spreading caller input", () => {
    // `...input` would forward whatever the caller put on the object, including a `swapper` that
    // overwrites the session's. Every body in this module is built key by key on purpose.
    expect(read("src/lib/uniswap/actions.ts")).not.toMatch(/\.\.\.input\b/);
  });
});

describe("[R6] a provider response cannot reach a transaction unvalidated", () => {
  it("the transport parses every response against a schema before returning it", () => {
    const client = read("src/lib/uniswap/client.ts");
    expect(client).toContain("schema.safeParse");
    // The ONLY return of a body is the parsed one. A bare `return body` would bypass the contract.
    expect(client).toMatch(/return parsed\.data;/);
  });

  it("calldata is asserted non-empty hex again at the broadcast, not only at the schema", () => {
    const rail = read("src/features/strategies/lib/buildPlanSteps.ts");
    expect(rail).toContain("CALLDATA_PATTERN");
    expect(rail).toMatch(/PROVISIONING_EMPTY_CALLDATA/);
  });

  it("the rail broadcasts nothing it has not decoded first", () => {
    const rail = read("src/features/strategies/lib/buildPlanSteps.ts");
    expect(rail).toContain("boundApprovalToPlan");
    expect(rail).toContain("assertZeroingApproval");
    expect(rail).toContain("assertPermitAuthorisesLeg");
  });
});

describe("[R7] nothing sensitive is logged", () => {
  it.each(RAIL_MODULES)("%s logs no secret, signature or address", (file) => {
    for (const args of consoleCallArguments(read(file))) {
      expect(args).not.toMatch(
        /\b(signature|apiKey|api_key|permitData|owner|wallet|address|txHash)\b/,
      );
    }
  });

  it("reads a log whose MESSAGE contains a semicolon, which an earlier scan skipped entirely", () => {
    // The regression this locks: the scan used to capture arguments with `[^;]*`, so a `;` inside a
    // message string ended the match and the whole call went uninspected. `buildPlanSteps` has
    // exactly one log and its message has exactly that semicolon, so the module the invariant most
    // needed to read was the one it silently skipped, while still reporting green.
    expect(
      consoleCallArguments('console.warn("journal write failed; the leg continues", signature);'),
    ).toEqual(['"journal write failed; the leg continues", signature']);
  });

  it("the transport never interpolates the key, not even into an error it throws", () => {
    const client = read("src/lib/uniswap/client.ts");
    expect(client).not.toMatch(/console\./);
    // `apiKey` appears exactly twice: the read, and the header it is injected into.
    expect([...client.matchAll(/\bapiKey\b/g)]).toHaveLength(2);
  });
});

describe("the recovery journal's localStorage contents", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("holds no signature, calldata, permit or quote after a full leg lifecycle", async () => {
    const journal = createJournal({
      wallet: "0xc3673adC0d1F0E4E0e0a6bF9bD7d1e6a1a2b3c4d",
      operation: { kind: "invest", targetChainId: 42161 },
      legs: [
        {
          index: 0,
          kind: "bridge",
          chainId: 137,
          tokenIn: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
          tokenOut: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
          amountIn: "1000000",
          minAmountOut: "990000",
          destChainId: 42161,
        },
      ],
    });
    const recorder = createJournalRecorder(journal.journalId, { readNonce: async () => 7 });
    await recorder.beginLeg({
      index: 0,
      kind: "bridge",
      chainId: 137,
      tokenIn: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      tokenOut: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      amountIn: "1000000",
      minAmountOut: "990000",
    });
    recorder.recordBroadcast(0, `0x${"ab".repeat(32)}`);

    const raw = localStorage.getItem(FUNDING_JOURNAL_KEY) ?? "";
    expect(raw).not.toMatch(/signature|permit|calldata|"data"|quote|apiKey/i);
    // Nothing hex-shaped may be longer than a transaction hash: calldata is the thing that would be.
    for (const hex of raw.match(/0x[0-9a-fA-F]+/g) ?? []) {
      expect(hex.length, `${hex.slice(0, 12)}… is longer than a hash`).toBeLessThanOrEqual(66);
    }
  });
});

describe("the cross-tab lease cannot be taken from a live holder", () => {
  const JOURNAL_ID = "journal-1";
  const now = 1_800_000_000_000;

  /** A store record written by hand, which is what a corrupt or crafted `localStorage` looks like. */
  function seed(lease: Record<string, unknown>, updatedAt: number): void {
    localStorage.setItem(
      FUNDING_JOURNAL_KEY,
      JSON.stringify({
        version: 1,
        journals: [
          {
            journalId: JOURNAL_ID,
            wallet: "0xc3673adc0d1f0e4e0e0a6bf9bd7d1e6a1a2b3c4d",
            createdAt: now - 1000,
            updatedAt,
            operation: { kind: "invest", targetChainId: 42161 },
            legs: [
              {
                index: 0,
                kind: "swap-token",
                chainId: 137,
                tokenIn: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
                tokenOut: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
                amountIn: "1",
                minAmountOut: "1",
                status: "planned",
              },
            ],
            ...lease,
          },
        ],
      }),
    );
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it("refuses a second tab while the holder is heartbeating", () => {
    seed({ activeTabId: "tab-a", heartbeatAt: now - 1_000 }, now - 1_000);
    expect(claimLease(JOURNAL_ID, "tab-b", now)).toBe(false);
  });

  it("refuses a second tab when the heartbeat field is missing but the record is fresh", () => {
    // The two lease fields are written together, so this shape is only reachable through a corrupt
    // or hand-crafted store: exactly the input a lease must not be talked out of by.
    seed({ activeTabId: "tab-a" }, now - 1_000);
    expect(claimLease(JOURNAL_ID, "tab-b", now)).toBe(false);
  });

  it("still lets a second tab take over from a holder that is genuinely gone", () => {
    seed({ activeTabId: "tab-a" }, now - LEASE_TTL_MS - 1);
    expect(claimLease(JOURNAL_ID, "tab-b", now)).toBe(true);
  });
});
