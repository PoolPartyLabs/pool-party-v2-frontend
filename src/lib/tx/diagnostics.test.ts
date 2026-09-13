/**
 * @id PP-CORE-LIB-012
 * @name tx diagnostics — tests
 * Behavior (POO-279 R1/R2): browser/OS detection prefers userAgentData with a UA-string
 * fallback; the copy payload carries message + code + diagnostics + timestamp.
 * POO-461 R1/R2/R4: classifyTxError maps backend codes, message patterns and provider codes to a
 * TxErrorKind (unknown when nothing matches); toTxError attaches the kind to every TxError.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseApiErrorBody } from "@/lib/api/errors";
import {
  buildErrorReport,
  classifyTxError,
  collectUserAgentInfo,
  languageLabel,
  toTxError,
} from "./diagnostics";
import { TransactionError } from "./sendTransaction";

afterEach(() => {
  vi.unstubAllGlobals();
});

// POO-461 R2 — precedence: (a) stable backend code, (b) message patterns (mirroring the
// pool-party-api checkIsSlippageError prose + contract-selector prose), (c) provider codes.
describe("classifyTxError", () => {
  it("classifies the backend slippage prose (checkIsSlippageError output)", () => {
    expect(
      classifyTxError(
        new Error(
          "Slippage error: The transaction may not be executed due to slippage. Please try again.",
        ),
      ),
    ).toBe("slippage");
  });

  it("classifies raw Uniswap slippage reverts", () => {
    expect(classifyTxError(new Error("execution reverted: Too little received"))).toBe("slippage");
    expect(classifyTxError(new Error("Price slippage check"))).toBe("slippage");
    expect(
      classifyTxError(
        new Error(
          "execution reverted: slippage tolerance exceeded - minimum output amount not met",
        ),
      ),
    ).toBe("slippage");
  });

  it("classifies a -32603 provider error with the reason nested in the cause/data", () => {
    const provider = Object.assign(new Error("Internal JSON-RPC error."), {
      code: -32603,
      data: { message: "execution reverted: Too little received" },
    });
    expect(classifyTxError(provider)).toBe("slippage");
    // Wrapped as a TransactionError cause (the sendBuiltTransaction path).
    expect(classifyTxError(new TransactionError("Transaction failed", provider))).toBe("slippage");
  });

  it("classifies a 4001 user rejection by provider code and by message", () => {
    expect(classifyTxError(Object.assign(new Error("nope"), { code: 4001 }))).toBe("userRejected");
    expect(classifyTxError(new Error("User rejected the request."))).toBe("userRejected");
  });

  it("classifies the deadline-expired selector prose", () => {
    expect(classifyTxError(new Error("Transaction deadline has expired. Please try again."))).toBe(
      "deadlineExpired",
    );
    expect(classifyTxError(new Error("execution reverted: Transaction too old"))).toBe(
      "deadlineExpired",
    );
  });

  it("classifies the insufficient-funds prose", () => {
    expect(
      classifyTxError(
        new Error(
          "Insufficient funds: The total cost of executing this transaction exceeds the balance of the account.",
        ),
      ),
    ).toBe("insufficientFunds");
  });

  it("classifies unauthorized operations", () => {
    expect(classifyTxError(new Error("Unauthorized access. You do not have permission."))).toBe(
      "unauthorized",
    );
  });

  // PP-INTEGRATION-POINT consumer: stable machine codes from the build endpoints (POO-461 R5).
  it("prefers a stable backend code over the message", () => {
    expect(
      classifyTxError(
        Object.assign(new Error("some unrelated prose"), { code: "SLIPPAGE_EXCEEDED" }),
      ),
    ).toBe("slippage");
    expect(
      classifyTxError(Object.assign(new Error("whatever"), { code: "DEADLINE_EXPIRED" })),
    ).toBe("deadlineExpired");
  });

  // @rule R? (POO-1141) — the provisioning planner's own shortfall code. Its message
  // ("The selected funding sources cover X of the Y required.") carries no "insufficient funds"
  // prose, so without the stable-code mapping it fell through to `unknown` and the panel showed the
  // generic "something went wrong" body instead of the actionable insufficient-funds copy.
  it("classifies PROVISIONING_INSUFFICIENT_FUNDS by its stable code", () => {
    expect(
      classifyTxError(
        Object.assign(
          new Error("The selected funding sources cover 40000000 of the 100000000 required."),
          { code: "PROVISIONING_INSUFFICIENT_FUNDS" },
        ),
      ),
    ).toBe("insufficientFunds");
  });

  // @rule R4 — unknown stays unknown (generic view).
  it("returns unknown for unmapped garbage", () => {
    expect(classifyTxError(new Error("something exploded"))).toBe("unknown");
    expect(classifyTxError("not even an error")).toBe("unknown");
    expect(classifyTxError(null)).toBe("unknown");
  });
});

// POO-886 [R3]: fixtures built from REAL AllExceptionsFilter output bodies, run through the
// real apiFetch error parsing (parseApiErrorBody) and rethrown the way the operation hooks do
// (TransactionError(message, { code }), so the code lands on `cause.code`). Locks that
// classification works against real-mode backend errors, old and new filter shape alike.
describe("classifyTxError on real AllExceptionsFilter shapes (POO-886 R3)", () => {
  /** Mirror of the real-mode pipeline: filter body -> ApiError fields -> hook rethrow. */
  function txErrorFromFilterBody(status: number, body: unknown): TransactionError {
    const { code, message } = parseApiErrorBody(status, body);
    return new TransactionError(message, { code });
  }

  it("classifies a slippage revert surfaced by the old filter shape (plain-Error path)", () => {
    const error = txErrorFromFilterBody(500, {
      statusCode: 500,
      timestamp: "2026-07-14T00:00:00.000Z",
      path: "/api/v1/portfolio/add-liquidity",
      response:
        "Slippage error: The transaction may not be executed due to slippage. Please try again.",
    });
    expect(classifyTxError(error)).toBe("slippage");
  });

  it("classifies a slippage revert surfaced by the new filter shape (top-level code/message)", () => {
    const error = txErrorFromFilterBody(500, {
      statusCode: 500,
      timestamp: "2026-07-14T00:00:00.000Z",
      path: "/api/v1/portfolio/add-liquidity",
      response:
        "Slippage error: The transaction may not be executed due to slippage. Please try again.",
      code: "INTERNAL_SERVER_ERROR",
      message:
        "Slippage error: The transaction may not be executed due to slippage. Please try again.",
    });
    expect(classifyTxError(error)).toBe("slippage");
  });

  it("keeps a throttle response out of the slippage class (no auto-retry storm on 429)", () => {
    const error = txErrorFromFilterBody(429, {
      statusCode: 429,
      timestamp: "2026-07-14T00:00:00.000Z",
      path: "/api/v1/portfolio/add-liquidity",
      response: "ThrottlerException: Too Many Requests",
    });
    // POO-1763 [R9]: a throttle is `transient` now (it used to be `unknown`). The point of this test
    // survives unchanged: it is NOT slippage, so the slippage auto-retry never fires on it, and the
    // transient retry is a single bounded attempt, never a storm.
    expect(classifyTxError(error)).toBe("transient");
  });

  it("keeps a validation error generic (nested Nest message array)", () => {
    const error = txErrorFromFilterBody(400, {
      statusCode: 400,
      timestamp: "2026-07-14T00:00:00.000Z",
      path: "/api/v1/portfolio/add-liquidity",
      response: {
        statusCode: 400,
        message: ["amount must be positive", "tokenId must be a number string"],
        error: "Bad Request",
      },
    });
    expect(classifyTxError(error)).toBe("unknown");
  });
});

describe("toTxError kind (POO-461 R1)", () => {
  it("attaches the classification to the structured error", () => {
    const txError = toTxError(
      new Error("execution reverted: Too little received"),
      "INVEST_FAILED",
    );
    expect(txError.kind).toBe("slippage");
    expect(txError.code).toBe("INVEST_FAILED");
  });

  it("keeps unknown failures generic", () => {
    const txError = toTxError(new Error("boom"), "INVEST_FAILED");
    expect(txError.kind).toBe("unknown");
  });

  // POO-1037: a bridge leg that broadcast and has not arrived yet is the one failure that already
  // put a transaction on a chain. The hash has to survive the mapping or the user is told their
  // money is moving with no way to check.
  it("carries a broadcast hash the thrower attached to the cause", () => {
    const txError = toTxError(
      new Error("Bridged funds have not arrived on chain 42161 after 600s", {
        cause: { code: "PROVISIONING_BRIDGE_PENDING", txHash: "0xfeed" },
      }),
      "PROVISIONING_FAILED",
    );
    expect(txError).toMatchObject({ code: "PROVISIONING_BRIDGE_PENDING", txHash: "0xfeed" });
    // Not a transaction failure, so it must stay uncatalogued and keep the generic classification.
    expect(txError.kind).toBe("unknown");
  });

  it("leaves txHash absent for every failure that never reached a chain", () => {
    expect(toTxError(new Error("boom"), "INVEST_FAILED").txHash).toBeUndefined();
  });

  // POO-1044 [R3]: a chain with no native coin cannot originate a transaction, so the planner
  // refuses to produce a route at all. It has to classify, or the one failure the user can actually
  // act on ("you need a little ETH on Arbitrum") renders as "something went wrong".
  it("classifies a blocked funding chain, carrying the chain the operation needs gas on", () => {
    const txError = toTxError(
      new Error("Chain 42161 cannot pay for its own transactions.", {
        cause: { code: "PROVISIONING_GAS_BLOCKED", targetChainId: 42161 },
      }),
      "PROVISIONING_FAILED",
    );
    expect(txError).toMatchObject({
      code: "PROVISIONING_GAS_BLOCKED",
      kind: "gasBlocked",
      targetChainId: 42161,
    });
  });

  // POO-1251 [R1]: the correlation id rides on the cause exactly like the code and the target chain,
  // because a thrown Server Action error is masked in production and only the cause survives.
  it("carries the correlation id the rethrow attached to the cause", () => {
    const txError = toTxError(
      new Error("Slippage error", {
        cause: {
          code: "SLIPPAGE_EXCEEDED",
          correlationId: "80a8cbb7d98b4bc9ba2f7c6c5e78c17d",
        },
      }),
      "INVEST_FAILED",
    );
    expect(txError.correlationId).toBe("80a8cbb7d98b4bc9ba2f7c6c5e78c17d");
    expect(txError.kind).toBe("slippage");
  });

  // Absent, never an empty string: the dialog's `?? browserTraceId()` fallback has to fire, and a
  // blank reference row would read as a broken one.
  it("leaves the correlation id absent for a failure that never reached the API", () => {
    expect(toTxError(new Error("user rejected"), "INVEST_FAILED").correlationId).toBeUndefined();
    expect(
      toTxError(new Error("boom", { cause: { code: "X", correlationId: "" } }), "INVEST_FAILED")
        .correlationId,
    ).toBeUndefined();
  });
});

/**
 * POO-1763 [R9]: a failure the chain or the RPC will not repeat is `transient`, so the user reads
 * "try again in a moment" instead of "something went wrong", and a caller that cannot move funds may
 * retry once on its own ([R10]). Precedence is the whole point of half of these: a nested revert,
 * slippage or funds message keeps its own kind even when the outer envelope reads as transient.
 */
describe("classifyTxError transient (POO-1763 [R9])", () => {
  it.each([
    "SYSTEM_TIMEOUT",
    "SYSTEM_NETWORK_ERROR",
    "SYSTEM_RATE_LIMITED",
  ])("classifies the API's %s by its stable code", (code) => {
    expect(classifyTxError(new TransactionError("the build failed", { code }))).toBe("transient");
  });

  it.each([
    "The wallet did not answer the permit signature request",
    "request timeout",
    "Failed to fetch",
    "NetworkError when attempting to fetch resource.",
    "network error",
    "429 Too Many Requests",
    "rate limit exceeded",
    "Internal JSON-RPC error.",
    "socket hang up",
  ])("classifies the pre-broadcast failure %j by message", (message) => {
    expect(classifyTxError(new Error(message))).toBe("transient");
  });

  it("classifies our own TimeoutError by name, whatever its message", () => {
    const error = Object.assign(new Error("Operation timed out"), { name: "TimeoutError" });
    expect(classifyTxError(error)).toBe("transient");
  });

  // POO-1763 [R9]: the receipt-confirmation timeout is broadcast-but-unconfirmed. It carries a stable
  // code, resolved before any message pattern, so it is `confirmationTimeout` (its own honest copy)
  // and never `transient` ("nothing moved, retry"), which would be a false claim on a live money path.
  it("classifies the broadcast-but-unconfirmed receipt timeout as confirmationTimeout", () => {
    const error = new TransactionError("Transaction confirmation timed out", {
      code: "TX_CONFIRMATION_UNKNOWN",
      txHash: "0xabc",
    });
    expect(classifyTxError(error)).toBe("confirmationTimeout");
    expect(toTxError(error, "INVEST_FAILED")).toMatchObject({
      code: "TX_CONFIRMATION_UNKNOWN",
      kind: "confirmationTimeout",
      txHash: "0xabc",
    });
  });

  // POO-1763 [R9]: the post-broadcast mempool strings mean a tx with that nonce is already in flight
  // or mined. They are deliberately NOT transient — falling to `unknown` (their pre-POO-1763 kind) so
  // nothing tells the user "nothing moved" or arms an unconditional retry that would double-send.
  it.each([
    "nonce too low",
    "replacement transaction underpriced",
    "already known",
  ])("leaves the post-broadcast mempool message %j unclassified, never transient", (message) => {
    expect(classifyTxError(new Error(message))).toBe("unknown");
  });

  it("classifies a -32603 whose nested reason is itself transient", () => {
    expect(
      classifyTxError(
        new Error("Internal JSON-RPC error.", {
          cause: { code: -32603, data: { message: "request timed out" } },
        }),
      ),
    ).toBe("transient");
  });

  it("keeps a nested revert out of the transient class", () => {
    expect(
      classifyTxError(
        new Error("Internal JSON-RPC error.", {
          cause: { code: -32603, data: { message: "execution reverted: STF" } },
        }),
      ),
    ).toBe("reverted");
  });

  it("keeps nested slippage and funds reasons in their own classes", () => {
    expect(
      classifyTxError(
        new Error("Internal JSON-RPC error.", {
          cause: { code: -32603, data: { message: "Too little received" } },
        }),
      ),
    ).toBe("slippage");
    expect(
      classifyTxError(
        new Error("Internal JSON-RPC error.", {
          cause: { code: -32603, data: { message: "insufficient funds for gas * price + value" } },
        }),
      ),
    ).toBe("insufficientFunds");
  });

  it("keeps a user rejection that mentions a timeout in the rejection class", () => {
    expect(classifyTxError(new Error("User rejected the request (timeout dialog)"))).toBe(
      "userRejected",
    );
  });

  it("does not classify a bare -32603 with an unrelated reason as transient", () => {
    expect(
      classifyTxError(
        new Error("something else entirely", {
          cause: { code: -32603, data: { message: "denied by policy" } },
        }),
      ),
    ).toBe("unknown");
  });

  it("carries the kind onto the structured error", () => {
    expect(
      toTxError(new TransactionError("upstream", { code: "SYSTEM_TIMEOUT" }), "X"),
    ).toMatchObject({ code: "SYSTEM_TIMEOUT", kind: "transient" });
  });
});

describe("collectUserAgentInfo", () => {
  it("prefers userAgentData brands and platform", () => {
    vi.stubGlobal("navigator", {
      userAgent: "",
      userAgentData: {
        brands: [
          { brand: "Not.A/Brand", version: "99" },
          { brand: "Chromium", version: "146" },
          { brand: "Google Chrome", version: "146" },
        ],
        platform: "macOS",
      },
    });
    expect(collectUserAgentInfo()).toEqual({ browser: "Google Chrome 146", os: "macOS" });
  });

  it("falls back to the UA string when userAgentData is missing", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    });
    expect(collectUserAgentInfo()).toEqual({ browser: "Chrome 146", os: "macOS 10.15" });
  });

  it("detects Safari on macOS from the UA string (Version/, not Chrome)", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    });
    expect(collectUserAgentInfo()).toEqual({ browser: "Safari 17", os: "macOS 10.15" });
  });

  it("detects Edge before Chrome (Edge UAs embed Chrome/)", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0",
    });
    expect(collectUserAgentInfo()).toEqual({ browser: "Edge 146", os: "Windows 10.0" });
  });

  it("detects Firefox on Windows from the UA string", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    });
    expect(collectUserAgentInfo()).toEqual({ browser: "Firefox 133", os: "Windows 10.0" });
  });

  it("returns Unknown for an empty environment", () => {
    vi.stubGlobal("navigator", { userAgent: "" });
    expect(collectUserAgentInfo()).toEqual({ browser: "Unknown", os: "Unknown" });
  });
});

describe("languageLabel", () => {
  it("labels the locale with its display name", () => {
    expect(languageLabel("en-US")).toBe("English (en-US)");
    expect(languageLabel("pt-BR")).toContain("(pt-BR)");
  });
});

describe("buildErrorReport", () => {
  const diagnostics = {
    browser: "Chrome 146",
    os: "macOS 26.5",
    wallet: "Privy · Embedded",
    language: "English (en-US)",
  };
  const timestamp = new Date("2026-06-11T12:00:00Z");

  // @rule R2 — full payload: message + code + diagnostics + timestamp
  it("builds the full copy payload", () => {
    const report = buildErrorReport(
      { code: "-32603", message: "execution reverted" },
      diagnostics,
      {
        timestamp,
      },
    );
    expect(report).toContain("Message: execution reverted");
    expect(report).toContain("Code: -32603");
    expect(report).toContain("Browser: Chrome 146");
    expect(report).toContain("Wallet: Privy · Embedded");
    expect(report).toContain("OS: macOS 26.5");
    expect(report).toContain("Language: English (en-US)");
    expect(report).toContain("Timestamp: 2026-06-11T12:00:00.000Z");
  });

  // @rule POO-1251 R2 — the reference LEADS, because it is the only line that finds anything: a
  // money-path failure is filed by the backend as an expected HttpException (so no Sentry Issue) and
  // is usually unsampled (so no spans). It lands in Sentry Logs, and the id is what locates it.
  it("puts the reference first and carries the code, release and ISO timestamp", () => {
    const report = buildErrorReport(
      { code: "SLIPPAGE_EXCEEDED", message: "Slippage error" },
      diagnostics,
      { reference: "80a8cbb7d98b4bc9ba2f7c6c5e78c17d", release: "v2.4.1", timestamp },
    );
    const lines = report.split("\n");
    expect(lines[0]).toBe("Pool Party error report");
    expect(lines[1]).toBe("Reference: 80a8cbb7d98b4bc9ba2f7c6c5e78c17d");
    expect(lines[2]).toBe("Code: SLIPPAGE_EXCEEDED");
    expect(report).toContain("Release: v2.4.1");
    expect(report).toContain("Timestamp: 2026-06-11T12:00:00.000Z");
  });

  // @rule POO-1251 R1 — never an empty or "undefined" line. An unresolvable reference or release
  // omits its row entirely, on the payload as on the dialog.
  it("omits the reference and release lines when neither resolved", () => {
    const report = buildErrorReport({ code: "TX_FAILED", message: "boom" }, diagnostics, {
      timestamp,
    });
    expect(report).not.toContain("Reference:");
    expect(report).not.toContain("Release:");
    expect(report).not.toContain("undefined");
  });

  // @rule POO-1403 R1 — an on-ramp failure carries BOTH ids, and the labels say whose is whose. Ours
  // ("Reference") finds our trace; Paybis has never heard of it, and the one identifier their support
  // can act on is the server-minted `requestId`. It sits next to ours so the pair reads as a pair.
  it("carries the Paybis requestId, labelled as the vendor's own id", () => {
    const report = buildErrorReport({ code: "ONRAMP_ERROR", message: "boom" }, diagnostics, {
      reference: "0627f0495ed8448da1b3760bbb7c88c9",
      paybisRequestId: "19fd7802-cdb0-80b6-b36e-76befd2ee33f",
      timestamp,
    });
    const lines = report.split("\n");
    expect(lines[1]).toBe("Reference: 0627f0495ed8448da1b3760bbb7c88c9");
    expect(lines[2]).toBe("Paybis ref: 19fd7802-cdb0-80b6-b36e-76befd2ee33f");
  });

  // @rule POO-1403 R1/R4 — absent for a failure that never minted one, and for every failure on the
  // generic transaction dialog: the line is omitted rather than written blank.
  it("omits the Paybis line entirely when there is no requestId", () => {
    const report = buildErrorReport({ code: "-32603", message: "boom" }, diagnostics, {
      reference: "0627f0495ed8448da1b3760bbb7c88c9",
      timestamp,
    });
    expect(report).not.toContain("Paybis");
    expect(report).not.toContain("undefined");
  });

  // @rule POO-1251 R3 — the clipboard is pasted into a private staff support ticket, so an address that
  // rode in on a provider message is masked exactly as every log line and Sentry event masks it.
  it("masks addresses that arrive inside the raw provider message", () => {
    const report = buildErrorReport(
      {
        code: "-32603",
        message: "insufficient funds for 0xfe4c1a2b3c4d5e6f708192a3b4c5d6e7f8091b408",
      },
      diagnostics,
      { timestamp },
    );
    expect(report).not.toContain("0xfe4c1a2b3c4d5e6f708192a3b4c5d6e7f8091b408");
    expect(report).toContain("0xfe4c…b408");
  });
});
