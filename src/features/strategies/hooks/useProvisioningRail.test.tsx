/**
 * @id PP-STR-HOK-020 (POO-1043, POO-1136, POO-1578, POO-1573)
 * @name useProvisioningRail — journal + re-quote + on-ramp mint binding tests
 * @implements-rules-version v8 (POO-1573 rules v2) · v7 (POO-1578 rules v1) · v3 (POO-1136 / POO-1129 rules v3) · v2 (POO-1043 rules v1)
 * @hackathon POO-1022 (Universal Funding)
 *
 * The two loose ends POO-1042 left on the bound rail, closed here:
 *
 *   [R7] the rail gets a REAL recovery journal, minted at the confirm. Without it POO-1038's
 *        idempotency machinery does not run in production at all, and a killed tab mid-bridge has no
 *        in-flight record to reconcile.
 *   [R8] a materially worse re-quote reaches a CONFIRMER instead of aborting the leg. Refusing is the
 *        correct default with nobody to ask; it is a dead end once there is somebody.
 *
 * POO-1136 adds the on-ramp mint site, whose rule is the money-safety property of that issue:
 *
 *   [R7] one purchase per step, EVER. `mintOnRampRequest` resumes a journaled in-flight `requestId`
 *        instead of minting beside it, so the paid-but-not-landed window cannot double-charge.
 *
 * POO-1573 pins the CURRENCY half, on the leg the empty-wallet buyer actually takes:
 *
 *   [R1] the gas-first `ETH-BASE` leg is quoted RECEIVED-FIXED against an ETH target and omits
 *        `currencyCodeFrom`, so a European is charged in euros and offered the euro method set. It
 *        was the one leg still pinning "USD" on both calls, which is why POO-1512's fix never
 *        reached the buyer who needs it.
 *   [R5] (rules v2) an unpriceable ETH REFUSES the purchase, loudly, and the buyer goes back to
 *        review. Rules v1 fell back to the shipped spend-fixed USD leg, which re-pins the currency,
 *        re-fetches the method list in dollars and opens the widget on a card: the defect verbatim.
 *
 * POO-1578 pins the MINT half of the chosen-payment-method path, which is the boundary POO-1513 lost
 * the buyer's selection at once already (the picker's choice was discarded at the rail's edge and
 * every purchase opened on a card):
 *
 *   [S3] the caller's `paymentMethod` reaches BOTH the quote and the mint, so the widget opens on the
 *        method the buyer chose and the `quoteId` that rides with it was priced for that method.
 *   [S4] a selection the pair no longer offers falls back to `pickDefaultPaymentMethod` rather than
 *        dead-ending, and the raw caller string never passes through to Paybis. The fallback is
 *        REPORTED (`onramp.selection_unavailable`), because a silent substitution on a money path is
 *        invisible everywhere else, exactly as for the two divergences beside it.
 *
 * The rail runs for real: the wallet is an EIP-1193 handler map (so the shipped chain and account
 * assertions execute), and the journal is the real `localStorage` store, because the property under
 * test IS the persistence and its ordering. No network, no timers.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findResumableOnRampRequest,
  markOnRampRequest,
  recordOnRampRequest,
} from "@/lib/onramp/onRampJournal";
// POO-1573 [R5] v2: the code the refused mint throws, from the on-ramp's pure client-safe module.
import { ONRAMP_ETH_UNPRICED_CODE } from "@/lib/onramp/schemas";
import type { ProvisioningLeg, ProvisioningPlan, ProvisioningStep } from "@/lib/provisioning";
import type { Eip1193Provider } from "@/lib/tx/sendTransaction";
import type { UniswapQuoteResponse } from "@/lib/uniswap/schemas";
import { PROVISIONING_BUFFER_EXCEEDED_CODE } from "../lib/buildPlanSteps";
import { FUNDING_JOURNAL_KEY, type FundingJournal } from "../lib/fundingJournal";

const OWNER = "0xC3673ADc0000000000000000000000000000BEEF";
const POLYGON = 137;
const POLYGON_HEX = "0x89";
const ARBITRUM = 42161;

const WETH_POLYGON = {
  address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  symbol: "WETH",
  decimals: 18,
  chainId: POLYGON,
};
const USDC_POLYGON = {
  address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  symbol: "USDC",
  decimals: 6,
  chainId: POLYGON,
};

const mocks = vi.hoisted(() => ({
  activeAddress: "0xC3673ADc0000000000000000000000000000BEEF" as string | undefined,
  /** Privy's wallet-SDK chain switch: the FALLBACK path. */
  switchChain: vi.fn(async (_chainId: number) => {}),
  /** wagmi's connector-level switch: what the rail tries first (POO-1079). */
  switchChainAsync: vi.fn(async (_args: { chainId: number }) => {}),
  /** Base-unit output the fresh `/quote` offers. Worsened per-test to trip the re-quote gate. */
  quotedOut: "3000000000",
  nonce: 7,
  sent: [] as string[],
  /** Every `personal_sign` the rail asked the wallet for (POO-1136: a resume must ask for none). */
  signed: [] as string[],
  /** The server mint. POO-1136's rule is about how often this is REACHED, not what it returns. */
  getOnRampPaymentMethods: vi.fn(
    async (_input: unknown): Promise<Record<string, unknown>> => ({
      ok: true,
      // POO-1512: the fiat the action actually fetched the list for (override or server-resolved),
      // which the prefill threads into the quote so one flow never straddles two resolutions.
      currencyCodeFrom: "USD",
      methods: [
        {
          paymentMethod: "poolparty-credit-card",
          displayName: "Card",
          minUsd: 10,
          minCurrencyCode: "USD",
        },
      ],
    }),
  ),
  getOnRampQuote: vi.fn(
    async (_input: unknown): Promise<Record<string, unknown>> => ({
      ok: true,
      quote: {
        quoteId: "quote-abc",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "source",
        // POO-1413: PRICED, which the default fixture was not. It shipped as `[]`, the exact shape
        // that produced the production 500 on 2026-08-07, and the prefill test below asserted a
        // `quoteId` came out of it. The fixture was pinning the defect as correct behaviour.
        //
        // This is the NORMALIZED `OnRampQuotePaymentMethod` the hook consumes (`schemas.ts`), not the
        // Paybis wire shape: `chargeUsd`/`chargeAmount`/`receiveAmount`, not `amountFrom`/`amountTo`
        // (which are `{ amount, currencyCode }` objects on the wire anyway). The mock is typed
        // `Record<string, unknown>`, so `tsc` cannot catch a wrong shape here. `id` is the real token
        // captured live on 2026-08-07, and `chargeUsd` clears `minUsd: 10` above so the default path
        // does NOT trip the minimum report; the test below drives that branch deliberately.
        paymentMethods: [
          {
            id: "poolparty-credit-card",
            name: "Credit/Debit Card",
            chargeUsd: 125.51,
            chargeAmount: "125.51",
            chargeCurrencyCode: "USD",
            receiveAmount: "120.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    }),
  ),
  /**
   * POO-1573: the ETH target the gas-first leg is quoted received-fixed against, solved server-side
   * because the price read lives inside the `"use server"` boundary. `0.001 + 120/2500 = 0.049`.
   */
  getOnRampEthTarget: vi.fn(
    async (_input: unknown): Promise<Record<string, unknown>> => ({
      ok: true,
      ethAmount: "0.049",
    }),
  ),
  reportClientError: vi.fn(),
  createOnRampRequest: vi.fn(async (_input: unknown) => ({
    ok: true as const,
    requestId: "req-minted",
  })),
  /** Journal snapshots taken the instant the provider is asked for a receipt (the §3.4 probe). */
  journalAtReceipt: [] as (FundingJournal | undefined)[],
  /**
   * The wallets `useWallets()` currently returns.
   *
   * A mutable array on purpose: Privy hands out a NEW `ConnectedWallet` array whenever its state
   * moves, which is the fact POO-1080 turns on. Reassigning this models that, so a spec can prove
   * the rail reads the live handle at execution time rather than the one it captured.
   */
  wallets: [] as unknown[],
}));

vi.mock("@/lib/services", () => ({ isMockMode: false }));

vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ wallets: mocks.wallets }),
  useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0xsignature" }) }),
}));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.activeAddress }) }));
// The CONNECTOR-level switch the rail prefers (POO-1079). Privy's wallet SDK is the fallback.
vi.mock("wagmi", () => ({ useSwitchChain: () => ({ switchChainAsync: mocks.switchChainAsync }) }));

// PP-INTEGRATION-POINT (ADR 0003): the three Uniswap calls are `"use server"` actions. The rail
// injects them, so the suite replaces functions rather than a transport, and no key is involved.
vi.mock("@/lib/uniswap/actions", () => ({
  quoteSwap: async () => ({
    ok: true as const,
    quote: {
      routing: "CLASSIC",
      quote: {
        input: { amount: "1000000000000000000", token: WETH_POLYGON.address },
        output: { amount: mocks.quotedOut, token: USDC_POLYGON.address },
      },
    } as UniswapQuoteResponse,
  }),
  checkApproval: async () => ({ ok: true as const, approval: null, cancel: null }),
  buildSwapTx: async () => ({
    ok: true as const,
    swap: {
      to: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
      from: OWNER,
      data: "0x24856bc3deadbeef",
      value: "0x00",
      chainId: POLYGON,
    },
  }),
}));

// PP-INTEGRATION-POINT (POO-1136): the on-ramp mint is a `"use server"` action, so it is an RPC stub
// on the client. Replaced here for the same reason the Uniswap actions are: no key is involved.
vi.mock("@/lib/onramp/onRampActions", () => ({
  createOnRampRequestAction: (input: unknown) => mocks.createOnRampRequest(input),
  // POO-1375: the widget prefill lookups. Mocked HERE and not merely absent: an undefined export
  // would throw, be swallowed by the helper's catch, and leave the prefill assertions passing
  // vacuously.
  getOnRampPaymentMethodsAction: (input: unknown) => mocks.getOnRampPaymentMethods(input),
  getOnRampQuoteAction: (input: unknown) => mocks.getOnRampQuote(input),
  // POO-1573: the ETH price read, server-side for the same reason as the currency resolution.
  getOnRampEthTargetAction: (input: unknown) => mocks.getOnRampEthTarget(input),
}));

vi.mock("@/lib/observability/reportClientError", () => ({
  reportClientError: (...args: unknown[]) => mocks.reportClientError(...args),
}));

// The chain reads the rail and the journal make. Balances are irrelevant to these rules (the swap
// leg is not re-sized), so one flat figure is honest; the NONCE is what §3.4 step 1 turns on.
vi.mock("@/lib/tokens/readErc20", () => ({
  readErc20Balance: async () => BigInt("1000000000000000000"),
  readNativeBalance: async () => BigInt("1000000000000000000"),
  readTransactionCount: async () => mocks.nonce,
}));

const provider: Eip1193Provider = {
  request: async ({ method, params }) => {
    switch (method) {
      case "eth_accounts":
        return [OWNER];
      case "eth_chainId":
        return chainHex;
      case "wallet_switchEthereumChain": {
        chainHex = (params?.[0] as { chainId: string }).chainId;
        return null;
      }
      case "eth_sendTransaction": {
        mocks.sent.push(`0x${(mocks.sent.length + 1).toString(16).padStart(64, "0")}`);
        return mocks.sent[mocks.sent.length - 1];
      }
      case "eth_getTransactionReceipt": {
        mocks.journalAtReceipt.push(storedJournals()[0]);
        return { status: "0x1", blockNumber: "0x1", logs: [] };
      }
      case "personal_sign": {
        mocks.signed.push(String(params?.[0]));
        return "0xonrampsignature";
      }
      default:
        return null;
    }
  },
};
let chainHex = POLYGON_HEX;

import { useProvisioningRail } from "./useProvisioningRail";

/** Read the store WITHOUT `readJournals`, which prunes a fully-terminal record on sight. */
function storedJournals(): FundingJournal[] {
  const raw = localStorage.getItem(FUNDING_JOURNAL_KEY);
  return raw ? (JSON.parse(raw) as { journals: FundingJournal[] }).journals : [];
}

const SWAP_LEG: ProvisioningLeg = {
  index: 0,
  kind: "swap-token",
  chainId: POLYGON,
  tokenIn: WETH_POLYGON,
  tokenOut: USDC_POLYGON,
  amountIn: "1000000000000000000",
  amountOutQuoted: "3000000000",
  minAmountOut: "2940000000",
  routing: "CLASSIC",
  gasUsd: 0.04,
  requoteAtExecution: false,
};

const SWAP_STEP: ProvisioningStep = {
  type: "swap-token",
  key: "swap-token-0",
  labelKey: "provisioning.steps.swapToken",
  chainId: POLYGON,
  amountUsd: 3000,
  method: "SEND_TX",
  leg: SWAP_LEG,
};

function plan(): ProvisioningPlan {
  return {
    needed: true,
    reason: ["usdc"],
    variant: "multi",
    steps: [
      SWAP_STEP,
      { type: "op", key: "op", labelKey: "provisioning.steps.op", amountUsd: 3000 },
    ],
    quote: {
      shortfallUsd: 3000,
      bufferUsd: 60,
      feesUsd: 4,
      totalPayUsd: 3064,
      quotedAt: "2026-07-25T12:00:00.000Z",
      ttlMs: 30_000,
    },
    slippagePct: 2,
  };
}

const OPERATION = { kind: "invest" as const, targetChainId: ARBITRUM, strategyId: "strat-1" };

/** Run every rail step in order, threading the context exactly as `useWalletSignFlow` does. */
async function runRail(
  steps: { key: string; run: (ctx: Record<string, unknown>) => Promise<unknown> }[],
): Promise<void> {
  let ctx: Record<string, unknown> = {};
  for (const step of steps) {
    const result = (await step.run(ctx)) as Record<string, unknown> | undefined;
    const { txHash: _hash, skipped: _skipped, ...partial } = result ?? {};
    ctx = { ...ctx, ...partial };
  }
}

function mountRail(options: Parameters<typeof useProvisioningRail>[0] = {}) {
  return renderHook(() => useProvisioningRail(options)).result;
}

beforeEach(() => {
  localStorage.clear();
  chainHex = POLYGON_HEX;
  mocks.activeAddress = OWNER;
  mocks.quotedOut = "3000000000";
  mocks.nonce = 7;
  mocks.sent = [];
  mocks.signed = [];
  mocks.journalAtReceipt = [];
  mocks.createOnRampRequest.mockClear();
  // POO-1375: clear these too. Without it a later test reads an EARLIER test's call and asserts
  // against the wrong order, which is how the ETH-BASE case first "failed" while the code was right.
  mocks.getOnRampPaymentMethods.mockClear();
  mocks.getOnRampQuote.mockClear();
  mocks.getOnRampEthTarget.mockClear();
  // ...and RESTORE its happy answer. `mockClear` keeps the implementation, so a test that stubs a
  // failed price read would otherwise make every later gas-first mint REFUSE ([R5] v2) and leave the
  // methods/quote `…Once` fixtures those tests queued unconsumed, one test behind, for the rest of
  // the file. That is a whole-suite failure with no relation to the code under test.
  mocks.getOnRampEthTarget.mockResolvedValue({ ok: true, ethAmount: "0.049" });
  // POO-1413: same reason. `toHaveBeenCalledWith` tolerates earlier calls, so an uncleared spy makes
  // the R2 assertion below quietly vacuous the moment any other test in this file trips a report.
  mocks.reportClientError.mockClear();
  // The default wallet: an EXTERNAL one, whose provider is live regardless of which object holds it.
  mocks.wallets = [
    {
      address: OWNER,
      getEthereumProvider: async (): Promise<Eip1193Provider> => provider,
      switchChain: mocks.switchChain,
    },
  ];
  mocks.switchChain.mockClear();
  mocks.switchChainAsync.mockClear();
  mocks.switchChainAsync.mockImplementation(async () => {});
});

afterEach(() => {
  vi.useRealTimers();
});

// POO-1078 — a Privy EMBEDDED wallet ignores the provider's raw `wallet_switchEthereumChain`, so it
// never lands on the target chain and the broadcast choke point refuses with WRONG_CHAIN ("stayed on
// chain 137"). Every other operation in this app switches through the wallet SDK first; the rail was
// the one path that did not, and a cross-chain plan is the one that changes chain mid-flow.
describe("useProvisioningRail — chain switching goes through the wallet SDK [R1]", () => {
  it("wires Privy's switchChain into the rail rather than leaving it to the provider", async () => {
    const rail = mountRail({ operation: OPERATION });
    const steps = rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} });

    expect(steps).toBeDefined();
    await steps?.[0]?.run?.({});

    // The CONNECTOR switch, which is what the provider actually follows.
    expect(mocks.switchChainAsync).toHaveBeenCalled();
    for (const [args] of mocks.switchChainAsync.mock.calls) expect(args.chainId).toBe(POLYGON);
    // And not also the SDK: on an external wallet each path prompts, so asking twice for one
    // switch would be its own bug.
    expect(mocks.switchChain).not.toHaveBeenCalled();
  });

  it("falls back to the wallet SDK when the connector switch is unavailable", async () => {
    mocks.switchChainAsync.mockImplementation(async () => {
      throw new Error("connector cannot switch");
    });
    const rail = mountRail({ operation: OPERATION });
    const steps = rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} });
    await steps?.[0]?.run?.({});

    expect(mocks.switchChain).toHaveBeenCalled();
    for (const [chainId] of mocks.switchChain.mock.calls) expect(chainId).toBe(POLYGON);
  });
});

describe("useProvisioningRail — the recovery journal [R7]", () => {
  it("mints nothing until the user confirms the route", () => {
    const rail = mountRail({ operation: OPERATION });
    // Building the steps is what happens when the PLAN resolves, which is not consent (§3.7).
    rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} });

    expect(storedJournals()).toEqual([]);
  });

  it("mints a journal carrying every leg of the approved route", () => {
    const rail = mountRail({ operation: OPERATION });
    rail.current.openJournal(plan());

    const [journal] = storedJournals();
    expect(journal?.wallet).toBe(OWNER.toLowerCase());
    expect(journal?.operation).toEqual(OPERATION);
    expect(journal?.legs).toHaveLength(1);
    expect(journal?.legs[0]).toMatchObject({
      index: 0,
      kind: "swap-token",
      chainId: POLYGON,
      tokenIn: WETH_POLYGON.address,
      tokenOut: USDC_POLYGON.address,
      amountIn: SWAP_LEG.amountIn,
      status: "planned",
    });
  });

  it("records the executed leg, which is the whole point of binding it", async () => {
    const rail = mountRail({ operation: OPERATION });
    rail.current.openJournal(plan());
    await runRail(rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} }) ?? []);

    expect(storedJournals()[0]?.legs[0]).toMatchObject({
      status: "settled",
      nonceBefore: 7,
      txHash: mocks.sent[0],
    });
  });

  it("holds the §3.4 ordering: the hash is durable BEFORE the receipt is awaited", async () => {
    const rail = mountRail({ operation: OPERATION });
    rail.current.openJournal(plan());
    await runRail(rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} }) ?? []);

    // The probe fires inside `eth_getTransactionReceipt`, i.e. the instant the rail starts waiting.
    // A hash written after that await is a hash a closed tab loses, and for a bridge that is a
    // second deposit of the same money.
    expect(mocks.journalAtReceipt).toHaveLength(1);
    expect(mocks.journalAtReceipt[0]?.legs[0]).toMatchObject({
      status: "broadcast",
      txHash: mocks.sent[0],
    });
  });

  it("retires the journal when the route completes, so nothing reads as in flight", async () => {
    const rail = mountRail({ operation: OPERATION });
    rail.current.openJournal(plan());
    await runRail(rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {} }) ?? []);
    rail.current.closeJournal();

    expect(storedJournals()).toEqual([]);
  });

  it("mints nothing for a host that never said what the operation is", () => {
    const rail = mountRail();
    rail.current.openJournal(plan());

    expect(storedJournals()).toEqual([]);
  });
});

/**
 * POO-1136 [R7] — "one purchase per step, ever."
 *
 * A Paybis `requestId` is a purchase INTENT. The window that matters is paid-but-not-landed: the card
 * is charged, the tab dies before the balance delta appears, the user reopens the operation and the
 * plan is re-derived. Minting a second id there opens a second purchase while the first one's funds
 * are still moving. The journal (PP-CORE-LIB-067) exists for exactly this, and this hook is the mint
 * site it was written for, so the assertions below are about REUSE, not about which functions ran.
 */
describe("useProvisioningRail — the on-ramp requestId is resumed, not re-minted [R7]", () => {
  const ORDER = { currencyCode: "USDC-BASE", fiatAmount: "120.00", fiatCurrency: "USD" };

  it("reuses a journaled in-flight requestId instead of minting a second purchase", async () => {
    // The record a killed tab left behind: an intent whose funds may still be landing.
    recordOnRampRequest({ requestId: "req-in-flight", wallet: OWNER });
    const rail = mountRail({ operation: OPERATION });

    const result = await rail.current.mintOnRampRequest(ORDER);

    // The SAME purchase, resumed. A fresh id here is the double charge, whatever the server does.
    expect(result.requestId).toBe("req-in-flight");
    expect(result.wallet).toBe(OWNER);
    expect(mocks.createOnRampRequest).not.toHaveBeenCalled();
    // And no wallet prompt: re-signing to re-derive an id we already hold buys the user nothing.
    expect(mocks.signed).toEqual([]);
    // The record is untouched, so a further resume finds the same intent.
    expect(findResumableOnRampRequest(OWNER)?.requestId).toBe("req-in-flight");
  });

  // @rule POO-1375: the widget must OPEN on the amount we sized. Paybis pre-fills from `quoteId` and
  // pre-selects from `paymentMethod`; neither was sent, so the checkout opened on 0.00 EUR and the
  // user retyped a figure that is deliberately grossed up for fees. A hand-typed round number lands
  // short. Both are STARTING POINTS: the widget still lets the user change them.
  it("mints with a fresh quoteId and payment method so the widget opens pre-filled", async () => {
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER);

    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.quoteId).toBe("quote-abc");
    expect(body.paymentMethod).toBe("poolparty-credit-card");
    // Quoted on the ORDER's own fiat amount, the field documented as "Fiat amount to pre-fill".
    const quoted = mocks.getOnRampQuote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(quoted.amount).toBe(Number(ORDER.fiatAmount));
    expect(quoted.currencyCodeTo).toBe(ORDER.currencyCode);
  });

  // @rule POO-1375: RECEIVED-fixed for USDC-BASE, so the widget opens on what must LAND. Spend-fixed
  // pins the fiat and lets the provider decide the output, so the delivered amount moves with every
  // fee difference (another method, another currency) and the operation underfunds.
  // @rule POO-1512 [R6]: the R6 decision point is `currencyOverride = receivedFixed ? undefined :
  // order.fiatCurrency`. On the received-fixed leg the METHODS call must omit `currencyCodeFrom`
  // (the server resolves the buyer's own currency), and the QUOTE is then pinned to whatever the
  // methods call resolved, never to `order.fiatCurrency`: one resolution per flow, so a cache expiry
  // between the two calls cannot list methods in EUR and quote in USD.
  it("quotes received-fixed for USDC-BASE so the landed amount is what the op needs", async () => {
    // A NON-USD resolution, so the assertions can tell "threaded from the methods call" apart from
    // "pinned to order.fiatCurrency" (which is USD). Inverting the R6 ternary sends USD to BOTH.
    mocks.getOnRampPaymentMethods.mockResolvedValueOnce({
      ok: true,
      currencyCodeFrom: "EUR",
      methods: [
        {
          paymentMethod: "poolparty-credit-card",
          displayName: "Card",
          minUsd: 10,
          minCurrencyCode: "EUR",
        },
      ],
    });
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER);

    const methodsInput = mocks.getOnRampPaymentMethods.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(methodsInput.currencyCodeFrom).toBeUndefined();
    const quoted = mocks.getOnRampQuote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(quoted.direction).toBe("receive");
    expect(quoted.currencyCodeTo).toBe("USDC-BASE");
    expect(quoted.currencyCodeFrom).toBe("EUR");
  });

  /**
   * @rule POO-1573 [R1] — the live report, at the line that produced it.
   *
   * A gas-first order is the EMPTY wallet, which is the canonical fiat on-ramp buyer, and it was the
   * one leg still pinning `order.fiatCurrency` ("USD") on both calls. So a European was quoted in
   * dollars and offered the US method set (the list is fetched by `currencyFrom`), which is exactly
   * the defect POO-1512 shipped to fix and which survived on this path.
   *
   * It is fixed by making the leg received-fixed like the USDC one: the ETH TARGET is pinned, the
   * fiat is left to the server to resolve, and no USD figure is re-denominated ([R2]) because what
   * crosses is a crypto amount.
   */
  it("[POO-1573 R1] quotes a gas-first ETH-BASE order received-fixed in the buyer's currency", async () => {
    mocks.getOnRampPaymentMethods.mockResolvedValueOnce({
      ok: true,
      currencyCodeFrom: "EUR",
      methods: [
        {
          paymentMethod: "poolparty-credit-card",
          displayName: "Card",
          minUsd: 10,
          minCurrencyCode: "EUR",
        },
      ],
    });
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest({
      ...ORDER,
      currencyCode: "ETH-BASE",
      ethTarget: { gasFloorEth: "0.001", fundingUsd: "120.00" },
    });

    // The recipe is solved server-side (the price read lives inside the `"use server"` boundary).
    expect(mocks.getOnRampEthTarget).toHaveBeenCalledWith({
      gasFloorEth: "0.001",
      fundingUsd: "120.00",
    });
    // The methods list is fetched for the BUYER's currency, which is what puts SEPA in front of them.
    const methodsInput = mocks.getOnRampPaymentMethods.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(methodsInput.currencyCodeFrom).toBeUndefined();
    /**
     * ...and for THIS leg's crypto side, which is the other half of the pair (PR #875 cross-lane
     * review, X3). A Paybis method list is per-PAIR, not per-currency (`schemas.ts`: "the list is
     * per-pair, not per-identity", and an unsupported pair 404s), so `ETH-BASE` and `USDC-BASE` may
     * not offer the same set for the same fiat. `order.currencyCode` is therefore the render-time
     * name of the pair this leg WILL be charged on — it does not depend on the mint-time price read,
     * only the fiat half does — and it is what a caption naming payment methods has to check against
     * the pair its own list was fetched for (POO-1575 [R8], which today compares the fiat alone).
     */
    expect(methodsInput.currencyCodeTo).toBe("ETH-BASE");
    const quoted = mocks.getOnRampQuote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(quoted.direction).toBe("receive");
    expect(quoted.currencyCodeTo).toBe("ETH-BASE");
    expect(quoted.currencyCodeFrom).toBe("EUR");
    // [R2] the CRYPTO figure, never the USD one: 120 dollars must not cross as 120 euros.
    expect(quoted.amount).toBe(0.049);
  });

  /**
   * @rule POO-1573 [R5] at rules v2: an unpriceable ETH leg REFUSES the purchase.
   *
   * Rules v1 fell back to the shipped spend-fixed USD leg here, "precision, never the purchase". On
   * this screen that is not a loss of precision. Spend-fixed re-pins `currencyCodeFrom` to the order's
   * "USD", which re-fetches the method list in dollars, so the SEPA identifier the buyer just chose on
   * `/deposit` (POO-1513, live) is not in the list, `pickDefaultPaymentMethod` falls back to a card,
   * and the widget opens on a card in dollars. That is the live report this cluster exists to close,
   * verbatim, reinstated on the screen that had just offered the buyer their own method.
   *
   * So the mint aborts BEFORE anything opens: no methods call, no quote, no request id, and therefore
   * no widget. The host returns the buyer to review with a reason (`DepositScreen.realOnRamp.test.tsx`).
   * Opening the widget with NO prefill is not the alternative either: POO-1375 showed a checkout that
   * starts at 0.00 makes buyers hand-type a round number, losing the gross-up and underfunding the op.
   */
  it("[POO-1573 R5] refuses the purchase when ETH cannot be priced", async () => {
    mocks.getOnRampEthTarget.mockResolvedValueOnce({
      ok: false,
      code: "ONRAMP_ETH_PRICE_UNAVAILABLE",
      message: "no price",
      correlationId: "corr-eth",
    });
    const rail = mountRail({ operation: OPERATION });

    await expect(
      rail.current.mintOnRampRequest({
        ...ORDER,
        currencyCode: "ETH-BASE",
        ethTarget: { gasFloorEth: "0.001", fundingUsd: "120.00" },
      }),
    ).rejects.toMatchObject({ cause: { code: ONRAMP_ETH_UNPRICED_CODE } });

    // Nothing downstream ran: the widget cannot open on a purchase that was never created.
    expect(mocks.getOnRampPaymentMethods).not.toHaveBeenCalled();
    expect(mocks.getOnRampQuote).not.toHaveBeenCalled();
    expect(mocks.createOnRampRequest).not.toHaveBeenCalled();
    // The token is STABLE and load-bearing: a Sentry alert rule points at this exact string.
    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.eth_target_unavailable",
      expect.any(Error),
      expect.objectContaining({
        code: "ONRAMP_ETH_PRICE_UNAVAILABLE",
        correlationId: "corr-eth",
      }),
    );
  });

  /**
   * @rule POO-1573 [R5] v2 (PR #875 review, F3 posture): an `ok` answer carrying an unusable figure
   * refuses on the same code and reports on the same token.
   *
   * `toEthAmount` refuses a zero target, so this is contract drift rather than a reachable value
   * today; the point is that no path back to the USD leg is left behind, since a silent fallback is
   * exactly how the defect survived a release.
   */
  it("[POO-1573 R5] refuses an ETH target that resolved to an unusable figure", async () => {
    mocks.getOnRampEthTarget.mockResolvedValueOnce({ ok: true, ethAmount: "0" });
    const rail = mountRail({ operation: OPERATION });

    await expect(
      rail.current.mintOnRampRequest({
        ...ORDER,
        currencyCode: "ETH-BASE",
        ethTarget: { gasFloorEth: "0.001", fundingUsd: "120.00" },
      }),
    ).rejects.toMatchObject({ cause: { code: ONRAMP_ETH_UNPRICED_CODE } });

    expect(mocks.getOnRampQuote).not.toHaveBeenCalled();
    expect(mocks.createOnRampRequest).not.toHaveBeenCalled();
    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.eth_target_unavailable",
      expect.any(Error),
      expect.objectContaining({ code: "ONRAMP_ETH_AMOUNT_UNUSABLE", ethAmount: "0" }),
    );
  });

  /**
   * @rule POO-1573 [R5] v2, SCOPE: the refusal is the ETH leg's and nobody else's.
   *
   * A `USDC-BASE` order is already received-fixed against its own `fiatAmount` and carries no recipe,
   * so a dead price read must not reach it and must not stop it. Pinned because the refusal above is
   * the only place in this flow that can now stop a purchase before it starts, and a leak of it into
   * the ordinary USDC path would block every deposit the moment `/prices` had a bad minute.
   */
  it("[POO-1573 R5] leaves a USDC-BASE order untouched when the ETH price read is dead", async () => {
    mocks.getOnRampEthTarget.mockResolvedValue({
      ok: false,
      code: "ONRAMP_ETH_PRICE_UNAVAILABLE",
      message: "no price",
    });
    const rail = mountRail({ operation: OPERATION });

    const result = await rail.current.mintOnRampRequest(ORDER);

    expect(result.requestId).toBeTruthy();
    expect(mocks.getOnRampEthTarget).not.toHaveBeenCalled();
    const quoted = mocks.getOnRampQuote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(quoted.direction).toBe("receive");
    expect(mocks.reportClientError).not.toHaveBeenCalledWith(
      "onramp.eth_target_unavailable",
      expect.anything(),
      expect.anything(),
    );
  });

  /**
   * @rule POO-1573 [R5]: an order with no recipe at all (a plan built before this shipped, a mock
   * fixture) is the same degrade, and must not reach the price read to find that out.
   */
  it("[POO-1573 R5] keeps the spend-fixed leg for an ETH order carrying no recipe", async () => {
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest({ ...ORDER, currencyCode: "ETH-BASE" });

    expect(mocks.getOnRampEthTarget).not.toHaveBeenCalled();
    const quoted = mocks.getOnRampQuote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(quoted.direction).toBeUndefined();
    expect(quoted.currencyCodeFrom).toBe("USD");
  });

  /**
   * @rule POO-1573 [R5] — the DEPLOY-ORDER dependency, made observable (PR #875 review, F3).
   *
   * A refused quote was the one degrade on this path with no report at all: `if (!quote.ok) return
   * { paymentMethod }`. That matters now in a way it did not before, because this change carries a
   * hard deploy-order dependency on pool-party-api POO-1588 (`33abc64`): the receive-direction floor
   * used to be the flat fiat `0.01`, and a received-fixed ETH order is `usdAmount / ethUsd`, so an
   * un-deployed API 400s EVERY gas-first quote across the whole band from our $10 floor to
   * `0.01 x ethUsd` (~$25 at $2,500/ETH).
   *
   * The consequence is not a visible failure: the widget opens with no pre-filled amount, the buyer
   * hand-types a round number, the POO-1375 gross-up is lost and the operation underfunds. Ship this
   * frontend first and the symptom is silent underfunding, with nothing in Sentry naming the cause.
   */
  it("[POO-1573 R5] reports a refused quote instead of degrading the prefill silently", async () => {
    mocks.getOnRampPaymentMethods.mockResolvedValueOnce({
      ok: true,
      currencyCodeFrom: "EUR",
      methods: [
        {
          paymentMethod: "poolparty-credit-card",
          displayName: "Card",
          minUsd: 10,
          minCurrencyCode: "EUR",
        },
      ],
    });
    // The shape an API without POO-1588 answers a received-fixed ETH quote with.
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: false,
      code: "VALIDATION_FAILED",
      message: "amount must not be less than 0.01",
      correlationId: "corr-1588",
    });
    const rail = mountRail({ operation: OPERATION });

    const result = await rail.current.mintOnRampRequest({
      ...ORDER,
      currencyCode: "ETH-BASE",
      ethTarget: { gasFloorEth: "0.001", fundingUsd: "120.00" },
    });

    // [R5] the purchase still opens, exactly as every other prefill failure does.
    expect(result.requestId).toBeTruthy();
    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.quoteId).toBeUndefined();
    expect(body.paymentMethod).toBe("poolparty-credit-card");
    // ...and it is LOUD, with the four facts that separate "the API is behind" from "Paybis said no".
    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.quote_unavailable",
      expect.any(Error),
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        correlationId: "corr-1588",
        currencyCodeTo: "ETH-BASE",
        currencyCodeFrom: "EUR",
        requestedAmount: 0.049,
        direction: "receive",
      }),
    );
  });

  // @rule POO-1375: prefill is a convenience, NEVER a gate. Refusing to sell someone crypto because
  // a cosmetic lookup failed would be a worse bug than the one this fixes.
  it("still mints when the prefill lookup fails", async () => {
    mocks.getOnRampPaymentMethods.mockResolvedValueOnce({ ok: false, code: "X", message: "down" });
    const rail = mountRail({ operation: OPERATION });

    const result = await rail.current.mintOnRampRequest(ORDER);

    expect(result.requestId).toBeTruthy();
    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.quoteId).toBeUndefined();
    expect(body.currencyCode).toBe(ORDER.currencyCode);
  });

  /**
   * @rule POO-1413 R1 — the production 500, reproduced.
   *
   * Paybis returned a quote it priced NOTHING for, we passed its `quoteId` to the mint anyway, and
   * Paybis answered 422 "There are no available payment/payout methods in Quote" on
   * `property_path: quoteId`. The user saw "Internal server error", twice (trace
   * `8f2a7d4f0759431681fd797970d7eabf`, 2026-08-07).
   */
  it("[POO-1413 R1] sends NO quoteId when the quote priced nothing for our method", async () => {
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: true,
      quote: {
        quoteId: "quote-with-no-methods",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "source",
        paymentMethods: [],
      },
    });
    const rail = mountRail({ operation: OPERATION });

    const result = await rail.current.mintOnRampRequest(ORDER);

    // [R4] the purchase still opens: a lost prefill is worse UX, a 500 is a dead end.
    expect(result.requestId).toBeTruthy();
    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.quoteId).toBeUndefined();
    // The method still rides, so the widget at least opens on the right one.
    expect(body.paymentMethod).toBe("poolparty-credit-card");
  });

  /**
   * @rule POO-1666 R9 — the shape one step to POO-1413's LEFT, from a real production failure.
   *
   * POO-1413 guards an EMPTY `paymentMethods`. Paybis has a third answer: it returns the method
   * PRICED and simultaneously names it in `paymentMethodErrors`, so the array is non-empty and still
   * unusable. Captured on 2026-08-17 (trace `726e00a1...`): a 10-USDC quote priced
   * `pool-party-credit-card` at EUR 10.53 AND errored it with "You have to buy or sell at least
   * 10.003001 USDC per order". We sent that `quoteId` and Paybis answered 422 "There are no available
   * payment/payout methods in Quote". The buyer saw "Purchase not completed".
   *
   * The control from the same capture: the 11-USDC quote carried NO `paymentMethodErrors` and minted
   * 201. So the discriminator exists BEFORE the mint, and the row builder had been reading it since
   * POO-1599 while this path did not.
   */
  it("[POO-1666 R9] sends NO quoteId when the only priced method is also in paymentMethodErrors", async () => {
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: true,
      quote: {
        quoteId: "609a542a-9329-4f59-91e6-3dabb3f2203b",
        currencyCodeFrom: "EUR",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "target",
        // Non-empty, with a real charge: every emptiness check passes.
        paymentMethods: [
          {
            id: "poolparty-credit-card",
            chargeUsd: 10.53,
            chargeAmount: "10.53",
            chargeCurrencyCode: "EUR",
          },
        ],
        paymentMethodErrors: [
          {
            paymentMethod: "poolparty-credit-card",
            message: "You have to buy or sell at least 10.003001 USDC per order",
          },
        ],
      },
    });
    const rail = mountRail({ operation: OPERATION });

    const result = await rail.current.mintOnRampRequest(ORDER);

    // The purchase still opens ([R4]); what must NOT travel is the doomed quote.
    expect(result.requestId).toBeTruthy();
    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.quoteId).toBeUndefined();
    expect(body.paymentMethod).toBe("poolparty-credit-card");
  });

  // The control, same capture: no errors on the quote, so the quoteId DOES travel and Paybis minted.
  it("[POO-1666 R9] still sends the quoteId when the provider raised no error", async () => {
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: true,
      quote: {
        quoteId: "38995e92-a332-48c0-a46c-3da6e7ae1478",
        currencyCodeFrom: "EUR",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "target",
        paymentMethods: [
          {
            id: "poolparty-credit-card",
            chargeUsd: 11.39,
            chargeAmount: "11.39",
            chargeCurrencyCode: "EUR",
          },
        ],
        paymentMethodErrors: [],
      },
    });
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER);

    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.quoteId).toBe("38995e92-a332-48c0-a46c-3da6e7ae1478");
  });

  /**
   * @rule POO-1413 R3 — the subtler shape: the quote priced a DIFFERENT method than the one we asked
   * for. Rafael's call (2026-08-07) is to FOLLOW THE QUOTE, because dropping it would open the widget
   * with an empty amount and lose POO-1375's fee gross-up, and a user who hand-types the round number
   * lands short and underfunds the operation. Opening on a method they can change beats that.
   */
  it("[POO-1413 R3] follows the quote's method when Paybis priced a DIFFERENT one", async () => {
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: true,
      quote: {
        quoteId: "quote-for-somebody-else",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "source",
        paymentMethods: [
          {
            id: "poolparty-trustly",
            name: "Trustly",
            chargeUsd: 122.4,
            chargeAmount: "122.40",
            chargeCurrencyCode: "USD",
            receiveAmount: "120.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    });
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER);

    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    // The quote RIDES, which is the whole point: the amount stays pre-filled and grossed up.
    expect(body.quoteId).toBe("quote-for-somebody-else");
    // ...on the method Paybis actually priced, not the one we asked for. Sending our method WITH
    // their quoteId is the one combination that reproduces the original 422.
    expect(body.paymentMethod).toBe("poolparty-trustly");
  });

  // @rule POO-1413 R2 — a substitution is still an upstream signal worth showing Paybis.
  // @rule POO-1512: the report carries the QUOTE'S echoed `currencyCodeFrom`, never the order's
  // constant "USD": on a received-fixed leg the request omitted the fiat and the server resolved it,
  // so reporting a currency that was never sent has on-call replaying in USD, watching it price
  // fine, and closing the incident unreproducible.
  it("[POO-1413 R2] reports the substitution rather than swapping silently", async () => {
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: true,
      quote: {
        quoteId: "quote-for-somebody-else",
        // NON-USD on purpose: distinguishable from `order.fiatCurrency`, so the assertion below
        // fails if the report ever reads the order again.
        currencyCodeFrom: "EUR",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "source",
        paymentMethods: [
          {
            id: "poolparty-trustly",
            name: "Trustly",
            chargeUsd: 122.4,
            chargeAmount: "122.40",
            chargeCurrencyCode: "EUR",
            receiveAmount: "120.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    });
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER);

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.quote_method_substituted",
      expect.any(Error),
      expect.objectContaining({
        paymentMethod: "poolparty-credit-card",
        substitutedTo: "poolparty-trustly",
        methodCount: 1,
        currencyCodeFrom: "EUR",
      }),
    );
  });

  /**
   * @rule POO-1374 — after a substitution the minimum that applies is the SUBSTITUTE's, not the one
   * we originally chose. Comparing the substitute's charge against our original floor would report a
   * false breach (or hide a real one) on exactly the path already going wrong.
   */
  it("[POO-1374] checks the minimum of the method it actually opens on", async () => {
    mocks.getOnRampPaymentMethods.mockResolvedValueOnce({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [
        {
          paymentMethod: "poolparty-credit-card",
          displayName: "Card",
          minUsd: 10,
          minCurrencyCode: "USD",
        },
        {
          paymentMethod: "poolparty-trustly",
          displayName: "Trustly",
          minUsd: 200,
          minCurrencyCode: "USD",
        },
      ],
    });
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: true,
      quote: {
        quoteId: "quote-sub",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "source",
        paymentMethods: [
          {
            id: "poolparty-trustly",
            name: "Trustly",
            // Clears the card's $10 floor, breaches Trustly's $200 one.
            chargeUsd: 122.4,
            chargeAmount: "122.40",
            chargeCurrencyCode: "USD",
            receiveAmount: "120.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    });
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER);

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.below_method_minimum",
      expect.any(Error),
      expect.objectContaining({ paymentMethod: "poolparty-trustly", minUsd: 200 }),
    );
  });

  // @rule POO-1413 R2 — "the provider offered this method seconds ago and then priced nothing for
  // it" is a real upstream signal. It was silent until the mint failed.
  it("[POO-1413 R2] reports the unpriced quote rather than degrading in silence", async () => {
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: true,
      quote: {
        quoteId: "quote-with-no-methods",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "source",
        paymentMethods: [],
      },
    });
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER);

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.quote_unpriced",
      expect.any(Error),
      expect.objectContaining({
        paymentMethod: "poolparty-credit-card",
        methodCount: 0,
        // `requestedAmount` + `direction`, never a bare `amount`: on a received-fixed order the
        // figure is CRYPTO, and reading it beside `currencyCodeFrom` as fiat misdiagnoses the report.
        requestedAmount: expect.any(Number),
        direction: expect.stringMatching(/^(spend|receive)$/),
      }),
    );
  });

  /**
   * @rule POO-1374 — the method's own fiat minimum.
   *
   * This branch has had NO test since POO-1374 shipped, because the fixture it would have run
   * against carried `paymentMethods: []`, so the `find` never returned an entry and the condition was
   * unreachable. Fixing the fixture for POO-1413 is what makes it testable, so it is covered here
   * rather than left as a second silent gap beside the one this PR exists to close.
   */
  it("[POO-1374] reports a charge below the payment method's own minimum", async () => {
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: true,
      quote: {
        quoteId: "quote-tiny",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "source",
        paymentMethods: [
          {
            id: "poolparty-credit-card",
            name: "Credit/Debit Card",
            // Under the fixture's `minUsd: 10`.
            chargeUsd: 4.2,
            chargeAmount: "4.20",
            chargeCurrencyCode: "USD",
            receiveAmount: "4.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    });
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER);

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.below_method_minimum",
      expect.any(Error),
      expect.objectContaining({ chargeUsd: 4.2, minUsd: 10 }),
    );
    // Below the minimum is a WARNING, not a veto: the quote is priced, so the prefill still rides and
    // Paybis makes the final call at checkout.
    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.quoteId).toBe("quote-tiny");
  });

  it("[POO-1374] stays silent when the charge clears the minimum", async () => {
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER);

    expect(mocks.reportClientError).not.toHaveBeenCalledWith(
      "onramp.below_method_minimum",
      expect.anything(),
      expect.anything(),
    );
  });

  /**
   * @rule POO-1578 S3: the buyer's chosen method reaches BOTH calls, not just one of them.
   *
   * Asserting the mint alone would pass on a build that quoted the CARD and then sent Trustly, which
   * is the POO-1413 shape in reverse: a `quoteId` priced for one method riding to Paybis under
   * another is what produced the 422 "There are no available payment/payout methods in Quote". So the
   * quote's `paymentMethod`, the mint's `paymentMethod` and the `quoteId` are all pinned together.
   *
   * Untested until now: `resolveWidgetPrefill`'s `selectedPaymentMethod` parameter could be dropped,
   * `mintOnRampRequest` could stop destructuring `paymentMethod` out of its options, and nothing in
   * the suite would notice.
   */
  it("[POO-1578 S3] quotes and mints on the method the buyer chose", async () => {
    mocks.getOnRampPaymentMethods.mockResolvedValueOnce({
      ok: true,
      currencyCodeFrom: "USD",
      methods: [
        {
          paymentMethod: "poolparty-credit-card",
          displayName: "Card",
          minUsd: 10,
          minCurrencyCode: "USD",
        },
        {
          paymentMethod: "poolparty-trustly",
          displayName: "Trustly",
          minUsd: 30,
          minCurrencyCode: "USD",
        },
      ],
    });
    mocks.getOnRampQuote.mockResolvedValueOnce({
      ok: true,
      quote: {
        quoteId: "quote-trustly",
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
        requestedAmountType: "source",
        paymentMethods: [
          {
            id: "poolparty-trustly",
            name: "Trustly",
            // Clears Trustly's own $30 floor, so this case does not also trip the minimum report.
            chargeUsd: 125.51,
            chargeAmount: "125.51",
            chargeCurrencyCode: "USD",
            receiveAmount: "120.000000",
            receiveCurrencyCode: "USDC-BASE",
          },
        ],
      },
    });
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER, { paymentMethod: "poolparty-trustly" });

    // The choice PRICES: a quote for the card would be the wrong number and the wrong quoteId.
    const quoted = mocks.getOnRampQuote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(quoted.paymentMethod).toBe("poolparty-trustly");
    // ...and OPENS, carrying the quote that was priced for it.
    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.paymentMethod).toBe("poolparty-trustly");
    expect(body.quoteId).toBe("quote-trustly");
    // A choice that WAS on offer is not a substitution, so nothing is reported.
    expect(mocks.reportClientError).not.toHaveBeenCalledWith(
      "onramp.selection_unavailable",
      expect.anything(),
      expect.anything(),
    );
  });

  /**
   * @rule POO-1618 [R2] / POO-1621 defect 1: the flow's currency reaches the MINT.
   *
   * `resolveWidgetPrefill` resolved its own currency from scratch on a received-fixed order, so the
   * screen could print one currency while the card was charged in another - the class `CR-CORE-023`
   * is open on. There is no later place to fix it: `POST /v3/request` has no fiat field and the
   * widget's only option is `openInEmbed({ requestId })`, so the currency reaches checkout ONLY
   * through the `quoteId` and must be settled here.
   *
   * Both hops, for the same reason the method is pinned on both: a list fetched in one currency and
   * a quote priced in another is exactly the straddle POO-1512 exists to prevent.
   */
  it("[POO-1618 R2] lists and quotes in the currency the caller settled", async () => {
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(ORDER, { currencyCodeFrom: "BRL" });

    const listed = mocks.getOnRampPaymentMethods.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(listed.currencyCodeFrom).toBe("BRL");
    const quoted = mocks.getOnRampQuote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(quoted.currencyCodeFrom).toBe("BRL");
  });

  /**
   * @rule POO-1618 [R5]: the SPEND-fixed leg ignores it.
   *
   * That leg's `amount` IS `order.fiatAmount`, a USD-denominated figure built from USD gas floors
   * and `ethUsd`, and there is no FX source in this app (POO-333). Charging BRL 208 where 208 was
   * computed as dollars is not a currency change, it is a different purchase. So the order's own
   * `fiatCurrency` still wins there, exactly as it did before a buyer could choose anything.
   */
  it("[POO-1618 R5] ignores the chosen currency on the degraded spend-fixed leg", async () => {
    const rail = mountRail({ operation: OPERATION });

    await rail.current.mintOnRampRequest(
      { ...ORDER, currencyCode: "ETH-BASE" },
      { currencyCodeFrom: "BRL" },
    );

    const listed = mocks.getOnRampPaymentMethods.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(listed.currencyCodeFrom).toBe("USD");
    const quoted = mocks.getOnRampQuote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(quoted.currencyCodeFrom).toBe("USD");
  });

  /**
   * @rule POO-1578 S4: an OFF-LIST selection falls back, and the raw caller string never rides.
   *
   * The list is fetched per resolved currency (POO-1512), so a profile write or a cache expiry
   * between the picker's fetch and the mint's can legitimately retire the method the buyer picked.
   * Passing their string through anyway would send Paybis a method it did not offer for this pair.
   *
   * Inverting the `find(...) ?? pickDefaultPaymentMethod(...)` precedence is the mutation this pins:
   * with the fallback first, the chosen method never wins and this test still passes, which is why
   * the S3 case above pins the other direction.
   *
   * @rule POO-1578: and the drop is REPORTED. Both neighbouring divergences in
   * `resolveWidgetPrefill` already report, because a silent substitution on a money path is invisible
   * everywhere else; a dropped user CHOICE is the same class one step earlier.
   */
  it("[POO-1578 S4] falls back to the default when the chosen method is not on offer, and says so", async () => {
    const rail = mountRail({ operation: OPERATION });

    // Pix is not in the default fixture's list (card only), i.e. the pair does not offer it.
    await rail.current.mintOnRampRequest(ORDER, { paymentMethod: "poolparty-pix" });

    const quoted = mocks.getOnRampQuote.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(quoted.paymentMethod).toBe("poolparty-credit-card");
    // THE assertion: the caller's raw string never reaches Paybis.
    const body = mocks.createOnRampRequest.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.paymentMethod).toBe("poolparty-credit-card");
    expect(body.paymentMethod).not.toBe("poolparty-pix");

    expect(mocks.reportClientError).toHaveBeenCalledWith(
      "onramp.selection_unavailable",
      expect.any(Error),
      expect.objectContaining({
        selectedPaymentMethod: "poolparty-pix",
        fellBackTo: "poolparty-credit-card",
        // The flow's ONE resolution (POO-1512): the currency whose list the choice missed against.
        currencyCodeFrom: "USD",
        currencyCodeTo: "USDC-BASE",
      }),
    );
  });

  it("mints fresh when the journaled record is already terminal", async () => {
    recordOnRampRequest({ requestId: "req-done", wallet: OWNER });
    // Settled: the purchase landed, so there is nothing in flight to resume and the NEXT buy is a
    // genuinely new purchase. Resuming here would open the widget on a spent intent.
    markOnRampRequest("req-done", "settled");
    const rail = mountRail({ operation: OPERATION });

    const result = await rail.current.mintOnRampRequest(ORDER);

    expect(result.requestId).toBe("req-minted");
    expect(mocks.createOnRampRequest).toHaveBeenCalledTimes(1);
    expect(mocks.signed).toHaveLength(1);
  });

  it("mints fresh when nothing was ever journaled", async () => {
    const rail = mountRail({ operation: OPERATION });

    const result = await rail.current.mintOnRampRequest(ORDER);

    expect(result.requestId).toBe("req-minted");
    expect(mocks.createOnRampRequest).toHaveBeenCalledTimes(1);
  });
});

describe("useProvisioningRail — the shared price-move buffer [R43] rules v2", () => {
  it("consumes the buffer before signing a materially worse price", async () => {
    // 10% worse than the 3,000,000,000 the plan was approved at, i.e. far past the 100 bps gate.
    mocks.quotedOut = "2700000000";
    const consumeBuffer = vi.fn(() => true);
    const rail = mountRail({ operation: OPERATION });

    await runRail(
      rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {}, consumeBuffer }) ?? [],
    );

    expect(consumeBuffer).toHaveBeenCalledTimes(1);
    expect(consumeBuffer).toHaveBeenCalledWith(1000);
    // Absorbed within the buffer, so the leg went through: nobody was asked.
    expect(mocks.sent).toHaveLength(1);
  });

  it("sends nothing once the buffer is exceeded", async () => {
    mocks.quotedOut = "2700000000";
    const rail = mountRail({ operation: OPERATION });

    await expect(
      runRail(
        rail.current.buildSteps?.(plan(), {
          onLegBroadcast: () => {},
          consumeBuffer: () => false,
        }) ?? [],
      ),
    ).rejects.toMatchObject({ cause: { code: PROVISIONING_BUFFER_EXCEEDED_CODE } });
    expect(mocks.sent).toEqual([]);
  });

  it("never consumes the buffer when the price did not move against the user", async () => {
    const consumeBuffer = vi.fn(() => true);
    const rail = mountRail({ operation: OPERATION });

    await runRail(
      rail.current.buildSteps?.(plan(), { onLegBroadcast: () => {}, consumeBuffer }) ?? [],
    );

    // Acting on every basis point spends the run's buffer on noise.
    expect(consumeBuffer).not.toHaveBeenCalled();
    expect(mocks.sent).toHaveLength(1);
  });
});
