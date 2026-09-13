/**
 * @id PP-CORE-HOK-035 (POO-1803, POO-1926, POO-1923, POO-1928), spec
 * @name usePrivyOnRamp, spec
 * @implements-rules-version v4 (POO-1928 rules v1) · v3 (POO-1923 rules v1) · v2 (POO-1926 rules
 *   v1) · v1 (POO-1803 rules v1)
 * @epic POO-1793 (Privy on-ramp migration)
 *
 * The adapter's own suite, and the ONLY suite in the repo that mocks `@privy-io/react-auth` for the
 * on-ramp: component suites mock OUR adapter instead. The mock is a full module replacement with its
 * moving parts in `vi.hoisted()`, the pattern `src/app/providers.test.tsx:22` established.
 *
 * Three of the four rules have a failure mode that looks like success, which is why each is pinned
 * with an inverted guard rather than a happy path:
 *
 *   [R1] omitting `defaultAsset` does not throw. Privy silently falls back to a `navigator.language`
 *        rule, which POO-1512 [R5] forbids, and the buyer sees a plausible wrong currency.
 *   [R3] a deferred `addFunds` does not throw either. The popup is blocked by the browser and the
 *        buyer sees nothing at all.
 *   [R4] a mis-classified error does not throw. It renders "cancelled" over a charged card.
 */
import { addBreadcrumb } from "@sentry/nextjs";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOnRampIntentsForTests,
  findOpenOnRampIntent,
  ONRAMP_INTENT_OPEN_WINDOW_MS,
  readOnRampIntents,
} from "./onRampIntent";
import {
  ONRAMP_OUTCOME_EVENT,
  PROVIDER_TIMEOUT_MARGIN_MS,
  PROVIDER_TIMEOUT_MS,
  PROVIDER_TIMEOUT_REASON,
  type PrivyOnRampInput,
  usePrivyOnRamp,
} from "./usePrivyOnRamp";

const BASE = "eip155:8453";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WALLET = "0x1111111111111111111111111111111111111111";

/**
 * The SDK's moving parts. `addFunds` is a spy so the suite can assert WHEN it was called, not only
 * that it was, and `phaseAtCall` is what proves the intent was minted BEFORE the call ([R3]).
 */
const privy = vi.hoisted(() => ({
  addFunds: vi.fn(),
  phaseAtCall: null as string | null,
}));

vi.mock("@privy-io/react-auth", () => ({
  useAddFunds: () => ({ addFunds: privy.addFunds }),
}));

vi.mock("@sentry/nextjs", () => ({ addBreadcrumb: vi.fn() }));

/**
 * POO-1926: the first-party ingest. Mocked at the module so the suite asserts the PAYLOAD rather
 * than the transport, which `reportClientError`'s own spec already owns.
 */
const ingest = vi.hoisted(() => ({ ship: vi.fn() }));
vi.mock("@/lib/observability/reportClientError", () => ({
  shipClientErrorReport: ingest.ship,
  currentPath: () => "/en/deposit",
}));

function input(overrides: Partial<PrivyOnRampInput> = {}): PrivyOnRampInput {
  return {
    destination: { chain: BASE, asset: USDC_BASE },
    address: WALLET,
    requested: { amount: 100, currency: "USD" },
    prefill: { amount: 105, currency: "USD" },
    fiat: { defaultAsset: "usd", assets: ["usd", "eur"] },
    environment: "sandbox",
    // The observation window's zero mark, read by the host before the modal opened. Base units as a
    // string: 12 USDC, not float-safe past ~9e15 and not printable as a number below 1e-6.
    baseline: { raw: "12000000", decimals: 6 },
    ...overrides,
  };
}

/** The hook under test, mounted. */
function mount() {
  return renderHook(() => usePrivyOnRamp()).result;
}

/** The rows this adapter pushed, read where GTM would read them (POO-1813 [R3]). */
function rows(event: string): Record<string, unknown>[] {
  return ((window.dataLayer ?? []) as Record<string, unknown>[]).filter(
    (entry) => entry.event === event,
  );
}

beforeEach(() => {
  localStorage.clear();
  window.dataLayer = [];
  privy.addFunds.mockReset();
  vi.mocked(addBreadcrumb).mockClear();
  privy.phaseAtCall = null;
  privy.addFunds.mockResolvedValue({ method: "fiat", status: "confirmed" });
  // POO-1926: without this the ingest mock accumulates across the whole file and
  // `toHaveBeenCalledWith` passes on an EARLIER test's call, which made two of the three new
  // report call sites deletable with the suite still green. Same reset as `paybisCapture.test.ts:75`.
  ingest.ship.mockReset();
});
afterEach(() => {
  // POO-1923: unconditional, so a fake clock can never leak into the rest of the file. The timeout
  // tests carry their own `finally` too; this makes that belt-and-braces rather than the only thing
  // standing between a fake clock and every test after it.
  vi.useRealTimers();
  clearOnRampIntentsForTests();
  localStorage.clear();
});

describe("usePrivyOnRamp, the call it makes (POO-1803)", () => {
  // @rule R1
  it("[R1] always passes defaultAsset, on every call", async () => {
    const { current } = mount();
    await current.openCheckout(input());

    expect(privy.addFunds).toHaveBeenCalledTimes(1);
    const opts = privy.addFunds.mock.calls[0]?.[0];
    expect(opts.fiat.source.defaultAsset).toBe("usd");
  });

  // @rule R1 -- the inverted guard. Omitting it is SILENT at the SDK, so the adapter must refuse.
  it("[R1] refuses to open at all when defaultAsset is missing", async () => {
    const { current } = mount();
    const broken = { ...input(), fiat: { assets: ["usd"] } } as unknown as PrivyOnRampInput;

    const outcome = await current.openCheckout(broken);

    expect(privy.addFunds).not.toHaveBeenCalled();
    expect(outcome.moved).toBe("no");
    expect(outcome.reason).toBe("missing_default_asset");
  });

  // @rule R1 -- presence is not enough. The rail sells 49 codes and refuses the rest with a vendor
  // error on the buyer's screen, over a decision we were in a position to make ourselves.
  it("[R1] refuses to open when defaultAsset is not a currency the rail sells", async () => {
    const { current } = mount();

    const outcome = await current.openCheckout(
      input({ fiat: { defaultAsset: "xyz", assets: ["xyz"] } }),
    );

    expect(privy.addFunds).not.toHaveBeenCalled();
    expect(outcome.moved).toBe("no");
    expect(outcome.reason).toBe("unsupported_fiat_asset");
    expect(readOnRampIntents()).toEqual([]);
  });

  // @rule R2 -- forwarded EXACTLY. The probed-green set is POO-1805's to compute, never this hook's.
  it("[R2] forwards source.assets verbatim and computes nothing", async () => {
    const { current } = mount();
    await current.openCheckout(
      input({ fiat: { defaultAsset: "brl", assets: ["brl", "usd", "eur"] } }),
    );

    const opts = privy.addFunds.mock.calls[0]?.[0];
    expect(opts.fiat.source.assets).toEqual(["brl", "usd", "eur"]);
    expect(opts.fiat.source.defaultAsset).toBe("brl");
  });

  it("passes the destination through in the rail's vocabulary, with the wallet address", async () => {
    const { current } = mount();
    await current.openCheckout(input());

    const opts = privy.addFunds.mock.calls[0]?.[0];
    expect(opts.destination).toEqual({ address: WALLET, chain: BASE, asset: USDC_BASE });
  });

  // The prefill is what the CALLER decided to pass, buffer included. The adapter never computes it,
  // but it does ROUND it: `defaultAmount` lands verbatim in the modal's amount field and in the
  // quotes body, and a buyer reading `43.785000000000004` is reading a number nobody chose.
  it("passes the prefill amount as a money string rounded to cents", async () => {
    const { current } = mount();
    await current.openCheckout(input({ prefill: { amount: 43.785000000000004, currency: "USD" } }));

    const opts = privy.addFunds.mock.calls[0]?.[0];
    expect(opts.fiat.defaultAmount).toBe("43.79");
  });

  // `defaultAmount` carries no currency of its own: the rail reads it in `source.defaultAsset`. A
  // figure sized in one currency and spent in another is a wrong charge that looks like a prefill,
  // so when the two disagree the amount is dropped and the buyer types their own.
  it("omits defaultAmount when the prefill currency is not the default asset", async () => {
    const { current } = mount();
    await current.openCheckout(
      input({
        prefill: { amount: 105, currency: "USD" },
        fiat: { defaultAsset: "eur", assets: ["eur", "usd"] },
      }),
    );

    const opts = privy.addFunds.mock.calls[0]?.[0];
    expect(opts.fiat).not.toHaveProperty("defaultAmount");
    // Dropped from the CALL, never from the record: the difference stays measurable (POO-1811).
    expect(readOnRampIntents()[0]?.prefill).toEqual({ amount: 105, currency: "USD" });
  });

  it("passes the environment through and never a crypto config", async () => {
    const { current } = mount();
    await current.openCheckout(input());

    const opts = privy.addFunds.mock.calls[0]?.[0];
    expect(opts.fiat.environment).toBe("sandbox");
    expect(opts).not.toHaveProperty("crypto");
  });
});

describe("usePrivyOnRamp, synchronous open (POO-1803 [R3])", () => {
  // @rule R3 -- MoonPay, Coinbase and Meld open a popup. A call deferred past the click handler's
  // synchronous window is blocked by the browser, and nothing on screen says so.
  it("[R3] calls addFunds before anything is awaited", () => {
    const { current } = mount();

    const promise = current.openCheckout(input());

    // No `await` has run yet: this assertion is in the same synchronous turn as the call.
    expect(privy.addFunds).toHaveBeenCalledTimes(1);
    return promise;
  });

  // @rule R3 -- and the intent is minted BEFORE the call, so a popup that opens always has a record.
  it("[R3] mints the intent before calling, then moves it to `opened`", async () => {
    privy.addFunds.mockImplementation(() => {
      privy.phaseAtCall = readOnRampIntents()[0]?.phase ?? null;
      return Promise.resolve({ method: "fiat", status: "confirmed" });
    });
    const { current } = mount();

    await current.openCheckout(input());

    expect(privy.phaseAtCall).toBe("created");
  });
});

describe("usePrivyOnRamp, the outcome it returns (POO-1803 [R4])", () => {
  // @rule R4
  it("[R4] reports a provider claim as `confirmed` and records the phase", async () => {
    const { current } = mount();

    const outcome = await current.openCheckout(input());

    expect(outcome.moved).toBe("confirmed");
    expect(outcome.providerStatus).toBe("confirmed");
    expect(outcome.attemptId).toBeTruthy();
    const [record] = readOnRampIntents();
    expect(record?.phase).toBe("confirmed");
    // Settlement is POO-1804's, from the delta. The adapter must not resolve one.
    expect(record?.outcome).toBeNull();
    expect(record?.delivered).toBeNull();
  });

  // @rule R4
  it("[R4] reports an inconclusive exit as `maybe` and leaves the intent OPEN", async () => {
    privy.addFunds.mockRejectedValue(new Error("User exited flow"));
    const { current } = mount();

    const outcome = await current.openCheckout(input());

    expect(outcome.moved).toBe("maybe");
    expect(outcome.reason).toBe("user_exited");
    const [record] = readOnRampIntents();
    expect(record?.phase).toBe("exited");
    // NOT terminal: the observation window owns it from here (ADR-0006).
    expect(record?.outcome).toBeNull();
  });

  // @rule R4
  it("[R4] reports a pre-flight refusal as a hard `no`, which IS terminal", async () => {
    privy.addFunds.mockRejectedValue(new Error("User must be authenticated to add funds"));
    const { current } = mount();

    const outcome = await current.openCheckout(input());

    expect(outcome.moved).toBe("no");
    expect(outcome.reason).toBe("not_authenticated");
    const [record] = readOnRampIntents();
    expect(record?.phase).toBe("failed");
    expect(record?.outcome).toBe("failed");
  });

  // @rule R4 -- the fail-safe reaches the intent record too.
  it("[R4] an unknown rejection leaves the intent open, not failed", async () => {
    privy.addFunds.mockRejectedValue(new Error("Checkout failed after maximum retry attempts"));
    const { current } = mount();

    const outcome = await current.openCheckout(input());

    expect(outcome.moved).toBe("maybe");
    expect(readOnRampIntents()[0]?.phase).toBe("exited");
  });

  it("carries the raw error through for the caller's diagnostics", async () => {
    const error = new Error("User exited flow");
    privy.addFunds.mockRejectedValue(error);
    const { current } = mount();

    expect((await current.openCheckout(input())).error).toBe(error);
  });

  // The adapter never throws: every path resolves to a classified outcome, because a throw would
  // land in a host click handler that has no way to classify it.
  it("never rejects, whatever the SDK does", async () => {
    privy.addFunds.mockRejectedValue(new Error("User exited flow"));
    const { current } = mount();

    await expect(current.openCheckout(input())).resolves.toBeDefined();
  });
});

describe("usePrivyOnRamp, what it leaves in the incident timeline", () => {
  // The outcome never reaches Sentry on its own: the classified paths all RESOLVE, so an exit that
  // may have charged a card is invisible in an incident unless something records it.
  it("drops one breadcrumb carrying the classification, and no provider text", async () => {
    privy.addFunds.mockRejectedValue(new Error("User exited flow"));
    const { current } = mount();

    const outcome = await current.openCheckout(input());

    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
    const crumb = vi.mocked(addBreadcrumb).mock.calls[0]?.[0];
    expect(crumb).toMatchObject({
      category: "onramp",
      level: "info",
      data: { attemptId: outcome.attemptId, moved: "maybe", reason: "user_exited" },
    });
    // The rejection's own message is raw provider text. It reaches the caller as `error` and stops
    // there; a breadcrumb is attached to events we send, and vendor prose is not ours to forward.
    expect(JSON.stringify(crumb)).not.toContain("User exited flow");
  });

  it("drops no breadcrumb when it refuses to open, because nothing was classified", async () => {
    const { current } = mount();
    const broken = { ...input(), fiat: { assets: ["usd"] } } as unknown as PrivyOnRampInput;

    await current.openCheckout(broken);

    expect(addBreadcrumb).not.toHaveBeenCalled();
  });
});

describe("usePrivyOnRamp, what it deliberately does not do", () => {
  it("records the requested and prefill figures on the intent, and no delivered figure", async () => {
    const { current } = mount();
    await current.openCheckout(input());

    const [record] = readOnRampIntents();
    expect(record?.requested).toEqual({ amount: 100, currency: "USD" });
    expect(record?.prefill).toEqual({ amount: 105, currency: "USD" });
    expect(record?.delivered).toBeNull();
  });

  // The record is wallet-scoped: one browser profile holds several wallets, so an unscoped record
  // would offer wallet B a reconcile against wallet A's purchase. Checksum casing in, lowercase out.
  it("mints the intent against the receiving wallet, lowercased", async () => {
    const { current } = mount();
    await current.openCheckout(input({ address: "0xAbCdEf0000000000000000000000000000000001" }));

    expect(readOnRampIntents()[0]?.wallet).toBe("0xabcdef0000000000000000000000000000000001");
  });

  // The zero mark the observation window subtracts from, stored so a reload can resume from the
  // record alone. Base units and decimals, never a display figure.
  it("stores the pre-checkout balance as the baseline, in base units", async () => {
    const { current } = mount();
    await current.openCheckout(input({ baseline: { raw: "12345678", decimals: 6 } }));

    const [record] = readOnRampIntents();
    expect(record?.baselineRaw).toBe("12345678");
    expect(record?.decimals).toBe(6);
  });

  it("mints no intent when it refuses to open", async () => {
    const { current } = mount();
    const broken = { ...input(), fiat: { assets: ["usd"] } } as unknown as PrivyOnRampInput;

    const outcome = await current.openCheckout(broken);

    expect(readOnRampIntents()).toEqual([]);
    expect(outcome.attemptId).toBeNull();
  });
});

/**
 * POO-1813 [R3]: the three rows this adapter owns, asserted at the seam.
 *
 * They are read off `window.dataLayer` rather than off a mocked emitter, because what matters is
 * that GTM would really receive them: the first draft of this change wired the calls and no test
 * touched them at all, so an emitter that had been deleted, renamed or moved behind a rail check
 * would still have shipped green. `settled` is deliberately absent here and asserted on the two
 * hosts instead: this module never sees a balance.
 */
describe("usePrivyOnRamp, the three funnel rows it owns (POO-1813 [R3])", () => {
  // @rule R3
  it("[R3] reports started once the checkout has been asked to open", async () => {
    const { current } = mount();
    await current.openCheckout(input());

    expect(rows("funding_buy_started")).toHaveLength(1);
    expect(rows("funding_buy_started")[0]).toMatchObject({
      rail: "privy",
      // [R4]: what the card is CHARGED in, which is `fiat.defaultAsset` and not the USD figure the
      // prefill is sized in.
      fiat_currency: "USD",
    });
    // OUR intent id, so the row joins to the other three. Never a provider reference.
    expect(rows("funding_buy_started")[0]?.attempt_id).toBe(readOnRampIntents()[0]?.attemptId);
  });

  // @rule R3
  it("[R3] reports submitted with the classifier's verdict, never a completion", async () => {
    privy.addFunds.mockResolvedValue({ method: "fiat", status: "submitted" });
    const { current } = mount();
    await current.openCheckout(input());

    expect(rows("funding_buy_submitted")).toHaveLength(1);
    expect(rows("funding_buy_submitted")[0]).toMatchObject({ rail: "privy", moved: "confirmed" });
    // The provider's claim is not money: only a host's observed delta may settle.
    expect(rows("funding_buy_settled")).toEqual([]);
  });

  // @rule R3
  it("[R3] reports an inconclusive exit as submitted `maybe`, never as a failure", async () => {
    // ADR-0006: a charged card and an abandonment are the same rejection on the Stripe path, so
    // this row is where a real charge lands. Reporting it as `failed` would be the cancellation
    // over a charged card this epic exists to stop.
    privy.addFunds.mockRejectedValue(new Error("User exited flow"));
    const { current } = mount();
    await current.openCheckout(input());

    expect(rows("funding_buy_submitted")[0]).toMatchObject({ moved: "maybe" });
    expect(rows("funding_buy_failed")).toEqual([]);
  });

  // @rule R3
  it("[R3] reports failed on a hard no, with the MAPPED code beside the raw reason", async () => {
    privy.addFunds.mockRejectedValue(new Error("Unable to open payment window"));
    const { current } = mount();
    await current.openCheckout(input());

    expect(rows("funding_buy_failed")).toHaveLength(1);
    expect(rows("funding_buy_failed")[0]).toMatchObject({
      rail: "privy",
      reason: "popup_blocked",
      // Uppercase, or `sanitizeParams` drops it and the row reaches GA4 with a blank dimension.
      error_code: "ONRAMP_POPUP_BLOCKED",
    });
  });

  // @rule R3
  it("[R3] reports a refusal that opened nothing, with no attempt id to join on", async () => {
    const { current } = mount();
    const broken = { ...input(), fiat: { assets: ["usd"] } } as unknown as PrivyOnRampInput;

    await current.openCheckout(broken);

    expect(rows("funding_buy_started")).toEqual([]);
    expect(rows("funding_buy_failed")[0]).toMatchObject({
      reason: "missing_default_asset",
      error_code: "ONRAMP_MISSING_DEFAULT_ASSET",
    });
    expect(rows("funding_buy_failed")[0]).not.toHaveProperty("attempt_id");
  });

  // @rule R4
  it("[R4] reports the CHARGE currency, not the currency the prefill is sized in", async () => {
    // The two disagree on every non-USD purchase: the figure is a USD one this rail declines to
    // send, while the card is charged in the buyer's own money. Reporting the sizing currency would
    // put "USD" on a series of euro charges, which is POO-1512's defect wearing an analytics hat.
    const { current } = mount();
    await current.openCheckout(input({ fiat: { defaultAsset: "eur", assets: ["usd", "eur"] } }));

    expect(rows("funding_buy_started")[0]).toMatchObject({ fiat_currency: "EUR" });
  });
});

/**
 * POO-1923 [R2]. `await pending` had no bound, so a provider surface that never resolves left this
 * hook awaiting forever: no outcome, no intent update, no report, and a spinner the buyer cannot
 * escape. Observed for real on 2026-09-12, where MoonPay's page loaded indefinitely after an
 * abandoned attempt.
 *
 * The bound must classify as `maybe`, never `no`. A timeout means we DO NOT KNOW whether the card
 * was charged, and ADR-0006 forbids rendering an inconclusive exit as a cancellation, which is
 * POO-1923 [R5] as well as [R2].
 */
describe("POO-1923 [R2]: the wait on the provider is bounded", () => {
  /**
   * Fake timers, because the bound is MINUTES by design (see `PROVIDER_TIMEOUT_MS`): it has to
   * outlast a real buyer entering a card and clearing 3DS. Advancing them is what lets the suite
   * assert a backstop that must never fire during a genuine purchase. The figure is not restated
   * here either, POO-1928 [R1] made it a derivation and this drives whatever it derives to.
   */
  async function openAndTimeOut() {
    privy.addFunds.mockReturnValueOnce(new Promise(() => {}));
    const { current } = mount();
    vi.useFakeTimers();
    try {
      const pending = current.openCheckout(input());
      await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS + 1);
      return await pending;
    } finally {
      vi.useRealTimers();
    }
  }

  // @rule R2 -- never silence. Before the bound this case did not resolve at all.
  it("[R2] resolves instead of hanging when the provider never settles", async () => {
    const outcome = await openAndTimeOut();

    expect(outcome).toBeDefined();
    expect(outcome.reason).toBe(PROVIDER_TIMEOUT_REASON);
  });

  /**
   * [R5] The money-critical half. `no` renders a refusal, and a refusal over a card that may have
   * been charged is the POO-1794 defect class.
   */
  it("[R5] classifies the timeout as maybe, never as a hard no", async () => {
    const outcome = await openAndTimeOut();

    expect(outcome.moved).toBe("maybe");
    expect(outcome.moved).not.toBe("no");
  });

  /**
   * [R5] `outcome === null` is what `findOpenOnRampIntent` reads, and `exited` is what
   * `phaseFor("maybe")` writes. Both are asserted, and the record's existence with them: a bare
   * `expect(intent?.outcome).not.toBe("failed")` passes when there is NO record at all, and also
   * passes for `cancelled` and `unverified`, which are terminal too.
   */
  it("[R5] leaves the intent record non-terminal, so the observation window still owns it", async () => {
    const outcome = await openAndTimeOut();

    const intent = readOnRampIntents().find((i) => i.attemptId === outcome.attemptId);
    expect(intent).toBeDefined();
    expect(intent?.outcome).toBeNull();
    expect(intent?.phase).toBe("exited");
  });

  /**
   * The assertion POO-1923 and POO-1926 each deferred to the other: the bound is this branch's, the
   * reporting was POO-1926's, and it is only writable where both exist. The report sits at the
   * classified-outcome point, AFTER the race, so a timeout flows through it with no extra work.
   *
   * `reason` is ours (`provider_timeout`), which is what makes an abandoned purchase distinguishable
   * from a delivered one in the log: POO-1926's two real-money lines separated on exactly this field.
   */
  it("[R2] reports the timeout to the ingest as maybe, with our own slug", async () => {
    const outcome = await openAndTimeOut();

    expect(ingest.ship).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ONRAMP_OUTCOME_EVENT,
        category: "maybe",
        reason: PROVIDER_TIMEOUT_REASON,
        reference: outcome.attemptId,
      }),
    );
  });

  // @rule R2 -- the bound must never fire on a provider that answers, which is the whole reason it
  // is minutes and not fifteen seconds.
  it("[R2] does not bound a provider that answers in time", async () => {
    privy.addFunds.mockResolvedValueOnce({ status: "confirmed" });
    const { current } = mount();

    const outcome = await current.openCheckout(input());

    expect(outcome.reason).toBe("provider_confirmed");
    expect(outcome.moved).toBe("confirmed");
  });

  /**
   * A timeout carries no `error`, which is precisely what distinguishes it from an exit: there is
   * no rejection to forward. Callers branch on `reason`, never on the presence of this.
   */
  it("[R2] carries no error field, unlike an exit", async () => {
    const outcome = await openAndTimeOut();

    expect(outcome).not.toHaveProperty("error");
  });
});

/**
 * POO-1928 [R3]/[R4]. The two bounds were written in different issues (POO-1923 for the wait,
 * POO-1802 for the store) and neither referenced the other, so both read `15 * 60 * 1000` while
 * `isStillOpen` bounds an open record with a STRICT `<` against the `createdAt` the intent is
 * stamped with immediately before `addFunds`. At exactly that instant the adapter minted
 * `provider_timeout` and `findOpenOnRampIntent` stopped returning the record in the same turn: the
 * verdict was written to a record no reader would hand back, and because a `maybe` leaves
 * `outcome: null` by design there was no age bound left that would ever reconcile it. The record
 * did not become wrong, it became permanent, which is what POO-1833's resume path would inherit.
 *
 * Both halves are here and neither replaces the other. The invariant is the one that fails if a
 * later issue edits either number in isolation, which is the actual regression being guarded; the
 * behavioural one is the only one that proves the two numbers meet on a real `localStorage` write.
 * An invariant over two constants passes happily while nothing ever writes a record.
 */
describe("POO-1928: the provider timeout lands inside the intent open window", () => {
  // @rule R3 -- asserted on the constants themselves, because what this guards is an EDIT and not a
  // runtime path: a future issue retuning either window in isolation reopens the race silently.
  it("[R3] bounds the provider wait strictly inside the openness window", () => {
    expect(PROVIDER_TIMEOUT_MS).toBeLessThan(ONRAMP_INTENT_OPEN_WINDOW_MS);
  });

  // @rule R1 / R5 -- derived, never restated, and read here through the named export R5 keeps. The
  // literal that happens to be smaller still fails here rather than passing [R3] and drifting on.
  it("[R1] derives the bound from the window, and the difference is the named margin", () => {
    expect(ONRAMP_INTENT_OPEN_WINDOW_MS - PROVIDER_TIMEOUT_MS).toBe(PROVIDER_TIMEOUT_MARGIN_MS);
  });

  /**
   * @rule R2 -- a one-millisecond margin satisfies [R3]'s arithmetic and buys nothing. The gap has
   * to survive the timer firing LATE, which in this flow is the normal case rather than the tail:
   * the provider's surface holds focus for the whole wait, so our tab is hidden, and a hidden silent
   * tab has its already-scheduled timers clamped to one wake per minute. Fake timers cannot model
   * throttling, so the floor is asserted on the constant instead of demonstrated in [R4].
   */
  it("[R2] leaves a margin measured in tens of seconds, not milliseconds", () => {
    expect(PROVIDER_TIMEOUT_MARGIN_MS).toBeGreaterThanOrEqual(60_000);
  });

  /**
   * @rule R4 -- the behavioural half, and the only one that proves the verdict reaches a record the
   * resumption reader will still return.
   *
   * `at` is read under the FAKE clock deliberately, and this test is worthless without that. The
   * shared `openAndTimeOut` restores the real timers in its `finally`, and a
   * `findOpenOnRampIntent(WALLET)` call after that compares the record against the REAL `Date.now()`.
   * `vi.useFakeTimers()` seeds the fake clock FROM the real one, so `createdAt` is stamped at the
   * install instant and only the fake clock ever advances: back on the real clock `now - createdAt`
   * is ~0, every record is trivially open, and the assertion passes with the defect fully in place.
   * So the drive is inlined and the read happens at the instant the adapter finished writing.
   */
  it("[R4] writes the timeout verdict to a record findOpenOnRampIntent still returns", async () => {
    privy.addFunds.mockReturnValueOnce(new Promise(() => {}));
    const { current } = mount();
    vi.useFakeTimers();
    try {
      const pending = current.openCheckout(input());
      await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS + 1);
      const outcome = await pending;
      // The instant the verdict landed, which is the instant a reader on this turn would see.
      const at = Date.now();

      expect(outcome.reason).toBe(PROVIDER_TIMEOUT_REASON);
      const open = findOpenOnRampIntent(WALLET, at);
      expect(open).not.toBeNull();
      expect(open?.attemptId).toBe(outcome.attemptId);
      // `exited` is the verdict's mark ON the record (`phaseFor("maybe")`) and `outcome: null` is
      // what keeps the observation window's claim on it. Both asserted positively and after the
      // record's existence: a bare `not.toBe("failed")` passes when there is no record at all.
      expect(open?.phase).toBe("exited");
      expect(open?.outcome).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * POO-1926. A Sentry breadcrumb only ships attached to a LATER event, so before this an attempt
 * that failed cleanly, or succeeded, left no durable trace anywhere. On the one path that charges a
 * card that is not an acceptable answer to an incident.
 *
 * Every assertion here depends on the `ingest.ship.mockReset()` in `beforeEach`: without it
 * `toHaveBeenCalledWith` matches a call an EARLIER test in this file made, and two of the three
 * report call sites could be deleted with this describe still green.
 */
describe("POO-1926: every classified outcome reaches the first-party ingest", () => {
  // @rule R1 -- a success has no `Error` to reduce, so no error rail would ever have recorded it.
  it("[R1] reports a provider-claimed purchase, which no error rail would have recorded", async () => {
    privy.addFunds.mockResolvedValueOnce({ status: "confirmed" });
    const { current } = mount();

    await current.openCheckout(input());

    expect(ingest.ship).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ONRAMP_OUTCOME_EVENT,
        // `moved` is the classifier's own vocabulary, not a boolean: `no`, `maybe` or `confirmed`
        // (`submitted` is a `ProviderStatus`, a different axis). Asserting the literal keeps this
        // test honest about what ships.
        category: "confirmed",
        reason: "provider_confirmed",
        asset: "USD",
        surface: "sandbox",
      }),
    );
  });

  // @rule R1 -- exactly ONE line per attempt, which is what makes a count in the log meaningful.
  it("[R1] reports exactly once for one attempt", async () => {
    privy.addFunds.mockResolvedValueOnce({ status: "confirmed" });
    const { current } = mount();

    await current.openCheckout(input());

    expect(ingest.ship).toHaveBeenCalledTimes(1);
  });

  // @rule R2 -- the attempt id is the join, and it is ours: `att-<base36 time>-<random>`, never
  // derived from a wallet or an email.
  it("[R2] carries the attempt id, so a log line joins to the intent record", async () => {
    privy.addFunds.mockResolvedValueOnce({ status: "confirmed" });
    const { current } = mount();

    const outcome = await current.openCheckout(input());

    const payload = ingest.ship.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.reference).toBe(outcome.attemptId);
    expect(payload.reference).toBeTruthy();
  });

  /**
   * [R2] the whole surface, not a sample. `objectContaining` passes with arbitrary EXTRA keys, so
   * without this a later field carrying an amount or a wallet address would ship green against
   * every other assertion in this describe.
   */
  it("[R2] sends these fields and no others, so no amount or address can be added by accident", async () => {
    privy.addFunds.mockResolvedValueOnce({ status: "confirmed" });
    const { current } = mount();

    await current.openCheckout(input());

    const payload = ingest.ship.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "asset",
      "category",
      "event",
      "path",
      "reason",
      "reference",
      "surface",
    ]);
  });

  /**
   * [R4] The distinction that decides the remedy: a sandbox failure and a production failure are
   * indistinguishable in a log line without it.
   */
  it("[R4] names the vendor environment that was addressed", async () => {
    privy.addFunds.mockResolvedValueOnce({ status: "confirmed" });
    const { current } = mount();

    await current.openCheckout(input({ environment: "production" }));

    expect(ingest.ship).toHaveBeenCalledWith(expect.objectContaining({ surface: "production" }));
  });

  // @rule R1 -- the refusal branches are two, and each is pinned by its own slug: asserting only
  // `category: "no"` matched four earlier tests in this file and left both call sites deletable.
  it("[R1] reports the refusal of a currency the rail does not sell, before anything was minted", async () => {
    const { current } = mount();

    await current.openCheckout(input({ fiat: { defaultAsset: "xyz", assets: ["xyz"] } }));

    expect(ingest.ship).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ONRAMP_OUTCOME_EVENT,
        category: "no",
        reason: "unsupported_fiat_asset",
      }),
    );
  });

  // @rule R1 -- the other refusal branch, which no other assertion in the file reaches.
  it("[R1] reports the refusal of a missing defaultAsset, before anything was minted", async () => {
    const { current } = mount();
    const broken = { ...input(), fiat: { assets: ["usd"] } } as unknown as PrivyOnRampInput;

    await current.openCheckout(broken);

    expect(ingest.ship).toHaveBeenCalledWith(
      expect.objectContaining({
        event: ONRAMP_OUTCOME_EVENT,
        category: "no",
        reason: "missing_default_asset",
      }),
    );
  });

  /**
   * [R3] The provider's own rejection text is raw vendor prose and may carry anything. Only our own
   * classification leaves the browser. This is also the `maybe` path: an unrecognized rejection
   * fail-safes to `maybe`, the class ADR-0006 exists for, so it is pinned here rather than nowhere.
   */
  it("[R3] never forwards the provider's rejection message", async () => {
    privy.addFunds.mockRejectedValueOnce(new Error("card 4242 declined for user@example.com"));
    const { current } = mount();

    await current.openCheckout(input());

    const sent = JSON.stringify(ingest.ship.mock.calls.at(-1)?.[0]);
    expect(sent).not.toContain("4242");
    expect(sent).not.toContain("user@example.com");
    expect(ingest.ship.mock.calls.at(-1)?.[0]).toMatchObject({
      category: "maybe",
      reason: "unknown_error",
    });
  });
});
