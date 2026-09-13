/**
 * @id PP-STR-MOD-008
 * @name TransactionErrorActions — tests
 * Behavior (v2, POO-279): the error-details box shows the raw message + Code/Browser/Wallet/OS/
 * Language rows; Copy error writes the FULL payload; Try again retries; Discord opens support.
 *
 * v3 (POO-1251): the box also shows a de-emphasised Reference row sourced from the backend's
 * correlation id and falling back to the browser's Sentry trace id [R1]; the copy payload leads with
 * it and carries no raw address or bare key [R2]/[R3]; the Discord button copies the FULL report
 * before opening the invite, because a Discord channel URL cannot pre-fill message text [R4].
 *
 * POO-1786 rules v1 [R1] [R2] [R3] (site S8): the copy label survives Chrome page translation, so
 * the `Copy` to `Check` icon swap beside it no longer throws the POO-1762 `NotFoundError`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatchBoundary, translateLikeChrome } from "../../../../tests/utils/chromeTranslate";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
} from "../../../../tests/utils/renderWithProviders";
import { TransactionErrorActions } from "./TransactionErrorActions";

const browserTraceId = vi.fn<() => string | undefined>(() => undefined);
const sentryRelease = vi.fn<() => string | undefined>(() => undefined);
vi.mock("@/lib/observability/sentry/clientContext", () => ({
  browserTraceId: () => browserTraceId(),
  sentryRelease: () => sentryRelease(),
}));

const error = { code: "-32603", message: "execution reverted: out of ticks" };

/** The live dev trace from POO-1251: the value support pastes into Sentry as `trace:<id>`. */
const CORRELATION_ID = "80a8cbb7d98b4bc9ba2f7c6c5e78c17d";

/**
 * POO-1403: the server-minted Paybis purchase id, from the 2026-08-06 production report whose
 * escalation dead-ended because no report carried it (Paybis invoice `PB26086511232TX9`).
 */
const PAYBIS_REQUEST_ID = "19fd7802-cdb0-80b6-b36e-76befd2ee33f";

beforeEach(() => {
  browserTraceId.mockReturnValue(undefined);
  sentryRelease.mockReturnValue(undefined);
});

describe("TransactionErrorActions", () => {
  it("calls onRetry when Try again is clicked", () => {
    const onRetry = vi.fn();
    renderWithProviders(<TransactionErrorActions onRetry={onRetry} error={error} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // @rule R1 — the box shows the raw message plus the environment rows
  it("renders the error-details box with the diagnostic rows", async () => {
    renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
    expect(screen.getByText("Error details")).toBeInTheDocument();
    expect(screen.getByText("execution reverted: out of ticks")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
    expect(screen.getByText("-32603")).toBeInTheDocument();
    for (const label of ["Browser", "Wallet", "OS", "Language"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Wallet resolves async from the account service mock (embedded).
    expect(await screen.findByText("Privy · Embedded")).toBeInTheDocument();
    // The active app language (test locale is en).
    expect(screen.getByText("English (en)")).toBeInTheDocument();
  });

  // @rule R2 — Copy error copies the full payload (message + code + diagnostics + timestamp)
  it("copies the full error report when the clipboard is available", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      const payload = writeText.mock.calls[0]?.[0] as string;
      expect(payload).toContain("Message: execution reverted: out of ticks");
      expect(payload).toContain("Code: -32603");
      expect(payload).toContain("Browser:");
      expect(payload).toContain("Language:");
      expect(payload).toContain("Timestamp:");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Copy must confirm only on a REAL copy: a rejected write (unfocused document / permission)
  // or an absent Clipboard API keeps the idle label, never a false "Copied".
  it("keeps the idle label when the clipboard write rejects", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    try {
      renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Copy error" })).toBeInTheDocument();
      expect(screen.queryByText("Copied")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // @rule R3 — Discord stays as the sanctioned second action
  it("opens the Discord invite", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
    fireEvent.click(screen.getByRole("button", { name: "Get help on Discord" }));
    expect(open).toHaveBeenCalledWith(
      "https://discord.com/invite/2Tcn6jqGRu",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  // @rule POO-1786 R1 R2 (S8): the icon swap lands beside an element React owns, so the confirmation
  // renders instead of the route error boundary once translation has rewritten the label.
  it("[POO-1786 R1 R2] confirms the copy after Chrome translated the label, without throwing", async () => {
    // React logs the boundary-caught error; that log IS the failure under test, not noise to fix.
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    try {
      const caught: Error[] = [];
      renderWithProviders(
        <CatchBoundary onError={(error) => caught.push(error)}>
          <TransactionErrorActions onRetry={vi.fn()} error={error} />
        </CatchBoundary>,
      );
      const button = screen.getByRole("button", { name: "Copy error" });
      translateLikeChrome(button);
      // The replay must have rewritten a node, or the case passes vacuously.
      expect(button.querySelector("font")).not.toBeNull();

      await act(async () => {
        fireEvent.click(button);
      });

      expect(caught.map((error) => error.name)).toEqual([]);
      expect(button.querySelector("svg.lucide-check")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Copied" })).toBe(button);
    } finally {
      errorLog.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  // @rule POO-1786 R3 (S8): invisible. The label span carries nothing of its own, so it is one flex
  // item where the anonymous one was, and the accessible name is still the label.
  it("[POO-1786 R3] wraps the label in a bare span and keeps the accessible name", () => {
    renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
    const button = screen.getByRole("button", { name: "Copy error" });
    const label = button.querySelector("svg + span");
    expect(label).not.toBeNull();
    expect(label?.attributes).toHaveLength(0);
    expect(label?.textContent).toBe("Copy error");
  });

  it("falls back to the legacy reference when no structured error is provided", () => {
    renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} />);
    expect(screen.getByText("PP-TX-ERR")).toBeInTheDocument();
  });

  // POO-839 R5 — the raw provider message (hex calldata / viem URLs are unbroken tokens far
  // wider than a phone) wraps instead of painting outside the dialog; diagnostics cells shrink.
  it("wraps the raw provider message and lets the diagnostics values shrink", () => {
    const longError = { code: "-32603", message: `0x${"a".repeat(180)}` };
    renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={longError} />);
    expect(screen.getByText(longError.message)).toHaveClass("break-words");
    // The Code diagnostics value cell can shrink below its content width.
    expect(screen.getByText("-32603")).toHaveClass("min-w-0");
  });

  describe("the support reference (POO-1251)", () => {
    // @rule R1 — the backend's correlation id is the first source, and it renders de-emphasised:
    // a support handle, not information for the user.
    it("shows the correlation id, de-emphasised", () => {
      renderWithProviders(
        <TransactionErrorActions
          onRetry={vi.fn()}
          error={{ ...error, correlationId: CORRELATION_ID }}
        />,
      );
      expect(screen.getByText("Reference")).toBeInTheDocument();
      const value = screen.getByText(CORRELATION_ID);
      expect(value).toHaveClass("text-muted-foreground");
      expect(value).toHaveClass("break-all");
    });

    // @rule R1 — a purely client-side failure never reached the API and has no correlation id, but
    // the browser Sentry event exists, so its trace id is the handle instead.
    it("falls back to the browser trace id when the failure never reached the API", () => {
      browserTraceId.mockReturnValue("0af7651916cd43dd8448eb211c80319c");
      renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
      expect(screen.getByText("0af7651916cd43dd8448eb211c80319c")).toBeInTheDocument();
    });

    // @rule R1 — with nothing resolvable the row is absent. It must never render empty, and must
    // never render the string "undefined".
    it("renders no reference row when neither source resolved", () => {
      renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
      expect(screen.queryByText("Reference")).toBeNull();
      expect(screen.queryByText("undefined")).toBeNull();
    });

    /**
     * @rule POO-1403 R1 — an ON-RAMP failure is the one class where a THIRD PARTY holds the answer,
     * and the `Reference` above is ours: Paybis has never heard of it. Their `requestId` rides the
     * same box and the same payload, labelled so a human can tell whose id is whose.
     */
    it("[POO-1403 R1] shows the Paybis ref beside ours and copies both", async () => {
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      try {
        renderWithProviders(
          <TransactionErrorActions
            onRetry={vi.fn()}
            error={{ ...error, code: "ONRAMP_ERROR", correlationId: CORRELATION_ID }}
            paybisRequestId={PAYBIS_REQUEST_ID}
          />,
        );
        expect(screen.getByText("Paybis ref")).toBeInTheDocument();
        const value = screen.getByText(PAYBIS_REQUEST_ID);
        expect(value).toHaveClass("select-all");
        expect(value).toHaveClass("text-xs");

        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
        });
        const payload = writeText.mock.calls[0]?.[0] as string;
        expect(payload.split("\n")[1]).toBe(`Reference: ${CORRELATION_ID}`);
        expect(payload.split("\n")[2]).toBe(`Paybis ref: ${PAYBIS_REQUEST_ID}`);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    /**
     * @rule POO-1403 R4 — this block renders on eleven surfaces and ten of them have no `requestId`
     * at all. Opt-in by VALUE: pass nothing and there is no row, no line and no "undefined".
     */
    it("[POO-1403 R4] grows no Paybis row on the generic transaction dialog", async () => {
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      try {
        renderWithProviders(
          <TransactionErrorActions
            onRetry={vi.fn()}
            error={{ ...error, correlationId: CORRELATION_ID }}
          />,
        );
        expect(screen.queryByText("Paybis ref")).toBeNull();

        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
        });
        const payload = writeText.mock.calls[0]?.[0] as string;
        expect(payload).not.toContain("Paybis");
        expect(payload).not.toContain("undefined");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    // @rule R2 — the reference LEADS the copy payload, with the code, the release and an ISO
    // timestamp. It is the one value that finds the trace, so it is the one that cannot be buried.
    it("leads the copied payload with the reference, plus code, release and timestamp", async () => {
      sentryRelease.mockReturnValue("v2.4.1");
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      try {
        renderWithProviders(
          <TransactionErrorActions
            onRetry={vi.fn()}
            error={{
              code: "SLIPPAGE_EXCEEDED",
              message: "Slippage error: the transaction may not be executed due to slippage.",
              correlationId: CORRELATION_ID,
            }}
          />,
        );
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
        });
        const payload = writeText.mock.calls[0]?.[0] as string;
        expect(payload.split("\n")[1]).toBe(`Reference: ${CORRELATION_ID}`);
        expect(payload).toContain("Code: SLIPPAGE_EXCEEDED");
        expect(payload).toContain("Release: v2.4.1");
        expect(payload).toMatch(/Timestamp: \d{4}-\d{2}-\d{2}T[\d:.]+Z/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    /**
     * @rule R2/R3 — the clipboard is pasted into a private staff support ticket, and the payload is masked
     * on the way out. Asserted on the VALUES that would actually leak, never on field NAMES: an
     * earlier version of this test asserted the payload did not contain the strings `"amount"`,
     * `"positionId"` and `"slippagePct"`, which are keys that were never in a prose message in the
     * first place. It read as proof and was none: it passed with full base-unit figures present.
     *
     * The mask is `redactSecrets`, the SAME rule the Sentry scrubber applies, so the more exposed of
     * the two sinks no longer gets the weaker one. It covers `0x…` runs and bare 40+ hex runs, both
     * exercised below.
     */
    it("masks a prefixed address on the copied message", async () => {
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      try {
        renderWithProviders(
          <TransactionErrorActions
            onRetry={vi.fn()}
            error={{
              code: "SLIPPAGE_EXCEEDED",
              message: "Slippage error from 0xfe4c1a2b3c4d5e6f708192a3b4c5d6e7f8091b408",
              correlationId: CORRELATION_ID,
            }}
          />,
        );
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
        });
        const payload = writeText.mock.calls[0]?.[0] as string;
        expect(payload).not.toContain("0xfe4c1a2b3c4d5e6f708192a3b4c5d6e7f8091b408");
        expect(payload).toContain("0xfe4c…b408");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    /**
     * The gap `redactAddresses` alone left open: an address (or a raw key) that lost its `0x` on the
     * way into a message. It was masked on its way into Sentry, our own access-controlled
     * infrastructure, and left intact on its way into a support ticket. `redactSecrets` closes it.
     */
    it("masks an UNPREFIXED long hex run too", async () => {
      const bareKey = "fe4c1a2b3c4d5e6f708192a3b4c5d6e7f8091b408e7d6c5b4a3928170f6e5d4c3";
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      try {
        renderWithProviders(
          <TransactionErrorActions
            onRetry={vi.fn()}
            error={{ code: "TX_FAILED", message: `signer ${bareKey} rejected` }}
          />,
        );
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
        });
        const payload = writeText.mock.calls[0]?.[0] as string;
        expect(payload).not.toContain(bareKey);
        expect(payload).toContain("fe4c…d4c3");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    /**
     * PP-DEBT(SEV:LOW) — the KNOWN, deliberately unclosed gap, recorded as a test so it is a decision
     * rather than an oversight. A backend message can carry operational figures in PROSE:
     * `PROVISIONING_INSUFFICIENT_FUNDS` reads "the selected funding sources cover 412000 of the
     * 500000 required" (`buildPlan.ts`), and those base units survive to the clipboard.
     *
     * Not a POO-1251 regression: that message was already rendered on screen and already copied by
     * "Copy error" before this issue existed. Closing it means deciding WHICH prose figures are
     * diagnostic and which are operational, which is a product call, not a mask change.
     */
    it("still copies a figure carried in the message prose (known gap)", async () => {
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      try {
        renderWithProviders(
          <TransactionErrorActions
            onRetry={vi.fn()}
            error={{
              code: "PROVISIONING_INSUFFICIENT_FUNDS",
              message: "The selected funding sources cover 412000 of the 500000 required.",
            }}
          />,
        );
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
        });
        const payload = writeText.mock.calls[0]?.[0] as string;
        expect(payload).toContain("cover 412000 of the 500000 required");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    /**
     * @rule R4 — a Discord channel URL cannot pre-fill message text; that is a platform limitation.
     * So the button copies (confirmed through the SAME "Copied" affordance the copy button uses) and
     * then opens the invite, and the user pastes it into their first message.
     *
     * It copies the FULL report, not the bare reference. The natural sequence is "Copy error" and
     * then "Get help on Discord" to go paste it, so a Discord click that wrote only the reference
     * OVERWROTE the payload the user had just copied. The reference leads the report, so the button
     * still hands over exactly what it existed to hand over.
     */
    it("copies the full report and then opens Discord", async () => {
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      try {
        renderWithProviders(
          <TransactionErrorActions
            onRetry={vi.fn()}
            error={{ ...error, correlationId: CORRELATION_ID }}
          />,
        );
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Get help on Discord" }));
        });
        const payload = writeText.mock.calls[0]?.[0] as string;
        expect(payload.split("\n")[1]).toBe(`Reference: ${CORRELATION_ID}`);
        expect(payload).toContain("Code: -32603");
        expect(payload).toContain("Message: execution reverted: out of ticks");
        expect(open).toHaveBeenCalledWith(
          "https://discord.com/invite/2Tcn6jqGRu",
          "_blank",
          "noopener,noreferrer",
        );
        // The visible affordance on the copy button, matched by ROLE: the same word is also in the
        // sr-only live region below, so a bare text query is ambiguous by design.
        expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
      } finally {
        open.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    // With no reference the report is still worth handing over (code, message, environment), and
    // Discord must still open.
    it("still copies the report and opens Discord when there is no reference", async () => {
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const open = vi.spyOn(window, "open").mockImplementation(() => null);
      try {
        renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Get help on Discord" }));
        });
        const payload = writeText.mock.calls[0]?.[0] as string;
        expect(payload).not.toContain("Reference:");
        expect(payload).toContain("Code: -32603");
        expect(open).toHaveBeenCalledTimes(1);
      } finally {
        open.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    /**
     * PP-A11Y — the reference is the one value a user may have to read and hand-select by eye, since
     * `copyToClipboard`'s catch exists for the insecure context where the Clipboard API is absent.
     * So it is `text-xs` like every other value in the list (muted tone is the de-emphasis, not a
     * 10px size) and `select-all`, which makes it one click to select.
     */
    it("renders the reference at the same size as every other value, and selectable", () => {
      renderWithProviders(
        <TransactionErrorActions
          onRetry={vi.fn()}
          error={{ ...error, correlationId: CORRELATION_ID }}
        />,
      );
      const value = screen.getByText(CORRELATION_ID);
      expect(value).toHaveClass("text-xs");
      expect(value).toHaveClass("select-all");
      // Same size as the Code row's value, which is what "de-emphasised" must not have meant.
      expect(screen.getByText("-32603")).toHaveClass("text-xs");
    });

    /**
     * PP-A11Y — "Copied" is a label swap on the button, which a screen reader reads only if focus
     * happens to return to it. Without a live region both copy paths confirmed silently.
     */
    it("announces the copy to assistive technology", async () => {
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      try {
        renderWithProviders(<TransactionErrorActions onRetry={vi.fn()} error={error} />);
        const live = screen.getByRole("status");
        expect(live).toHaveAttribute("aria-live", "polite");
        expect(live).toBeEmptyDOMElement();

        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Copy error" }));
        });
        expect(screen.getByRole("status")).toHaveTextContent("Copied");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
