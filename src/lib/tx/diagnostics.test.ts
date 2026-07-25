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
    expect(classifyTxError(error)).toBe("unknown");
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
  // @rule R2 — full payload: message + code + diagnostics + timestamp
  it("builds the full copy payload", () => {
    const report = buildErrorReport(
      { code: "-32603", message: "execution reverted" },
      {
        browser: "Chrome 146",
        os: "macOS 26.5",
        wallet: "Privy · Embedded",
        language: "English (en-US)",
      },
      new Date("2026-06-11T12:00:00Z"),
    );
    expect(report).toContain("Message: execution reverted");
    expect(report).toContain("Code: -32603");
    expect(report).toContain("Browser: Chrome 146");
    expect(report).toContain("Wallet: Privy · Embedded");
    expect(report).toContain("OS: macOS 26.5");
    expect(report).toContain("Language: English (en-US)");
    expect(report).toContain("Timestamp: 2026-06-11T12:00:00.000Z");
  });
});
