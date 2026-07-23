/**
 * @id PP-STR-MOD-009
 * @name ShareYieldModal — tests
 * Behavior: opens on the 30d default, re-binds the card on period change, copies the referral
 * link, opens share intents and exports the PNG. Privacy rule R1 is asserted on the rendered card.
 * POO-906: the card shows the SHORTENED link while copy / intents / native share carry the FULL
 * url ([R1][R2]); a file-capable Web Share API attaches the PNG ([R4]); export failures surface
 * as visible feedback + analytics, never a silent no-op ([R5]).
 */
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PositionEarnings } from "@/lib/schemas";
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { ShareYieldModal, shareIntentUrl } from "./ShareYieldModal";

vi.mock("../lib/yieldReceiptPng", () => ({
  exportYieldReceiptPng: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
}));

const earnings: PositionEarnings = { "24h": -4.12, "7d": 9.83, "30d": 86.52 };

/** A real pool-scoped referral link (host + 42-char strategy address + ref code), POO-906 [R1]. */
const LONG_LINK =
  "v2.dev.pool-party.xyz/strategies/0x357d1E34aBcD9915ef33CAdd8888ffFF00001111?ref=Surfista";
const LONG_LINK_DISPLAY = "v2.dev.pool-party.xyz/strategies/0x357d...?ref=Surfista";

function renderModal(overrides: Partial<Parameters<typeof ShareYieldModal>[0]> = {}) {
  return renderWithProviders(
    <ShareYieldModal
      open
      onOpenChange={vi.fn()}
      strategyId="s1"
      strategyName="Stable Yield"
      riskLabel="Conservative"
      earnings={earnings}
      referralLink="app.pool-party.xyz?ref=maria2026"
      {...overrides}
    />,
  );
}

describe("ShareYieldModal", () => {
  beforeEach(() => {
    window.dataLayer = [];
  });

  // @rule R2 — default period is 30d
  it("opens on the 30d default with the earned amount and PERIOD row bound", () => {
    renderModal();
    expect(screen.getByText("Share performance")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "30D" })).toHaveAttribute("aria-pressed", "true");
    const card = screen.getByTestId("yield-receipt-card");
    expect(within(card).getByText("+$86.52")).toBeInTheDocument();
    expect(within(card).getByText("Last 30 days")).toBeInTheDocument();
  });

  // @rule R1 — only the earned amount; never a percent and never principal figures
  it("renders no percent sign and no principal figures on the card", () => {
    renderModal();
    const card = screen.getByTestId("yield-receipt-card");
    expect(within(card).queryByText(/%/)).not.toBeInTheDocument();
    const figures = within(card).getAllByText(/\$/);
    expect(figures).toHaveLength(1);
    expect(figures[0]).toHaveTextContent("+$86.52");
  });

  // @rule R2 — switching the period re-binds the amount and the PERIOD row
  // @rule R6 — a negative window renders the loss treatment (red amount)
  it("re-binds the card when the period changes and tracks the event", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "24H" }));
    const card = screen.getByTestId("yield-receipt-card");
    const amount = within(card).getByText("-$4.12");
    expect(amount).toHaveClass("text-destructive");
    expect(within(card).getByText("Last 24 hours")).toBeInTheDocument();
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({
        event: "strategy_share_period_changed",
        strategy_id: "s1",
        share_period: "24h",
      }),
    );
  });

  // @rule R3 — the single gold CTA copies the user's referral link
  it("copies the referral link and confirms briefly", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Copy referral link" }));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("https://app.pool-party.xyz?ref=maria2026");
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_share_link_copied", share_period: "30d" }),
    );
    vi.unstubAllGlobals();
  });

  it("opens the X intent with the referral link and tracks the target", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "X" }));
    });
    expect(open).toHaveBeenCalledTimes(1);
    const url = open.mock.calls[0]?.[0] as string;
    expect(url).toContain("x.com/intent/post");
    expect(url).toContain(encodeURIComponent("app.pool-party.xyz?ref=maria2026"));
    expect(window.dataLayer).toContainEqual(
      expect.objectContaining({ event: "strategy_share_target_clicked", share_target: "x" }),
    );
    open.mockRestore();
  });

  // @rule POO-906 R1/R2 — the card displays the shortened link; every share carries the FULL url
  it("[R1][R2] shows the shortened link on the card while the intent carries the full url", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderModal({ referralLink: LONG_LINK });
    const card = screen.getByTestId("yield-receipt-card");
    expect(within(card).getByText(LONG_LINK_DISPLAY)).toBeInTheDocument();
    expect(within(card).queryByText(LONG_LINK)).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "X" }));
    });
    const url = open.mock.calls[0]?.[0] as string;
    expect(url).toContain(encodeURIComponent(`https://${LONG_LINK}`));
    open.mockRestore();
  });

  // @rule POO-906 R2 — copy always carries the full untruncated url
  it("[R2] copies the FULL url even when the card displays the shortened link", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderModal({ referralLink: LONG_LINK });
    fireEvent.click(screen.getByRole("button", { name: "Copy referral link" }));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`https://${LONG_LINK}`);
    vi.unstubAllGlobals();
  });

  // @rule POO-906 R4 — file-capable Web Share: the PNG + message + FULL url ride the native sheet
  it("[R4] shares the PNG file with the message and full url when the platform supports files", async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    const canShare = vi.fn(() => true);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      renderModal({ referralLink: LONG_LINK });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "X" }));
      });
      expect(share).toHaveBeenCalledTimes(1);
      const payload = share.mock.calls[0]?.[0];
      if (!payload) throw new Error("share was not called with a payload");
      expect(payload.url).toBe(`https://${LONG_LINK}`);
      expect(payload.text).toContain("+$86.52");
      expect(payload.files).toHaveLength(1);
      expect(payload.files?.[0]?.name).toBe("pool-party-yield-receipt.png");
      expect(payload.files?.[0]?.type).toBe("image/png");
      expect(open).not.toHaveBeenCalled();
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({ event: "strategy_share_target_clicked", share_target: "x" }),
      );
    } finally {
      Reflect.deleteProperty(navigator, "share");
      Reflect.deleteProperty(navigator, "canShare");
      open.mockRestore();
    }
  });

  // @rule POO-906 R4 — a failed export degrades to a file-less native share, tracked, never dead
  it("[R4][R5] shares text + full url without the file and tracks the failure when the export throws", async () => {
    const { exportYieldReceiptPng } = await import("../lib/yieldReceiptPng");
    vi.mocked(exportYieldReceiptPng).mockRejectedValueOnce(new Error("no canvas"));
    const share = vi.fn(async (_data: ShareData) => undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    try {
      renderModal();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Telegram" }));
      });
      expect(share).toHaveBeenCalledTimes(1);
      const payload = share.mock.calls[0]?.[0];
      if (!payload) throw new Error("share was not called with a payload");
      expect(payload.files).toBeUndefined();
      expect(payload.url).toBe("https://app.pool-party.xyz?ref=maria2026");
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({
          event: "strategy_share_export_failed",
          share_target: "telegram",
        }),
      );
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({
          event: "strategy_share_target_clicked",
          share_target: "telegram",
        }),
      );
    } finally {
      Reflect.deleteProperty(navigator, "share");
      Reflect.deleteProperty(navigator, "canShare");
    }
  });

  // @rule POO-906 R4 — a dismissed native sheet is a user choice: no popup, no error, no failure
  it("[R4] stays silent when the user dismisses the native share sheet", async () => {
    const share = vi.fn(async () => {
      throw new DOMException("dismissed", "AbortError");
    });
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      renderModal();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "X" }));
      });
      expect(open).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(window.dataLayer).not.toContainEqual(
        expect.objectContaining({ event: "strategy_share_export_failed" }),
      );
      expect(window.dataLayer).not.toContainEqual(
        expect.objectContaining({ event: "strategy_share_target_clicked" }),
      );
    } finally {
      Reflect.deleteProperty(navigator, "share");
      Reflect.deleteProperty(navigator, "canShare");
      open.mockRestore();
    }
  });

  // @rule POO-906 R4 — a hard native-share failure falls back to the intent with the full link
  it("[R4] falls back to the text intent when the native share fails outright", async () => {
    const share = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      renderModal();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
      });
      expect(open).toHaveBeenCalledTimes(1);
      const url = open.mock.calls[0]?.[0] as string;
      expect(url).toContain("wa.me");
      expect(url).toContain(encodeURIComponent("app.pool-party.xyz?ref=maria2026"));
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({
          event: "strategy_share_target_clicked",
          share_target: "whatsapp",
        }),
      );
    } finally {
      Reflect.deleteProperty(navigator, "share");
      Reflect.deleteProperty(navigator, "canShare");
      open.mockRestore();
    }
  });

  // @rule POO-906 R5 — a failed Save export surfaces feedback + analytics, never a silent no-op
  it("[R5] surfaces a failed PNG export on Save with visible feedback and analytics", async () => {
    const { exportYieldReceiptPng } = await import("../lib/yieldReceiptPng");
    vi.mocked(exportYieldReceiptPng).mockRejectedValueOnce(new Error("no canvas"));
    const createObjectURL = vi.fn(() => "blob:receipt");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    try {
      renderModal();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Couldn't create the share image. Please try again.",
      );
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({
          event: "strategy_share_export_failed",
          share_target: "save",
          share_period: "30d",
        }),
      );
      expect(window.dataLayer).not.toContainEqual(
        expect.objectContaining({ event: "strategy_share_card_saved" }),
      );
    } finally {
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  // @rule R5 — Save exports the 1080x1080 PNG
  // @rule R2 — the export payload is bound to the SELECTED period, not the default
  it("exports the PNG on Save with the selected period's data and tracks the event", async () => {
    const { exportYieldReceiptPng } = await import("../lib/yieldReceiptPng");
    const exportMock = vi.mocked(exportYieldReceiptPng);
    exportMock.mockClear();
    // jsdom has no object-URL support; patch the methods without replacing the URL constructor
    // (jsdom internals depend on it).
    const createObjectURL = vi.fn(() => "blob:receipt");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    try {
      renderModal();
      fireEvent.click(screen.getByRole("button", { name: "7D" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(exportMock).toHaveBeenCalledTimes(1);
      expect(exportMock).toHaveBeenCalledWith(
        expect.objectContaining({
          amountText: "+$9.83",
          isGain: true,
          periodText: "Last 7 days",
          referralLink: "app.pool-party.xyz?ref=maria2026",
        }),
      );
      expect(window.dataLayer).toContainEqual(
        expect.objectContaining({
          event: "strategy_share_card_saved",
          share_target: "save",
          share_period: "7d",
        }),
      );
    } finally {
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    }
  });

  // @rule R2 — closing resets the transient state, so a reopen lands on the 30d default
  it("reopens on the 30d default after closing on another period", () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            reopen
          </button>
          <ShareYieldModal
            open={open}
            onOpenChange={setOpen}
            strategyId="s1"
            strategyName="Stable Yield"
            riskLabel="Conservative"
            earnings={earnings}
            referralLink="app.pool-party.xyz?ref=maria2026"
          />
        </>
      );
    }
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "24H" }));
    expect(screen.getByRole("button", { name: "24H" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    expect(screen.getByRole("button", { name: "30D" })).toHaveAttribute("aria-pressed", "true");
    const card = screen.getByTestId("yield-receipt-card");
    expect(within(card).getByText("+$86.52")).toBeInTheDocument();
  });
});

describe("shareIntentUrl", () => {
  it("builds the three external intents around the message and link", () => {
    expect(shareIntentUrl("x", "hello", "https://pp.xyz/r/a")).toContain("x.com/intent/post");
    expect(shareIntentUrl("telegram", "hello", "https://pp.xyz/r/a")).toContain("t.me/share/url");
    expect(shareIntentUrl("whatsapp", "hello", "https://pp.xyz/r/a")).toContain("wa.me");
  });
});
