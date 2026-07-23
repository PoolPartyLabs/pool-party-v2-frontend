/**
 * @id PP-MGR-SCR-002 (POO-701)
 * @name ReviewStep logo-upload.test
 * @implements-rules-version v1
 *
 * POO-701 rules v1 — the strategy-creation logo persists via a manager-scoped PRE-ID media mint
 * (Option (b)). On crop-apply the cropped blob is uploaded through the injected `onUploadLogo`
 * (`useUploadMedia("logo")`, no strategyId) and the returned trusted https URL is staged into `logoUrl`
 * so it rides into the single create POST.
 *   - [R1] a successful upload stages the https URL (swaps the local `data:` preview);
 *   - [R1] a failed upload surfaces an inline error and keeps the local preview (never silently dropped);
 *   - [R2] Launch is blocked while the logo is uploading;
 *   - [R3] mock mode (no `onUploadLogo`) keeps the crop as a session-local preview — no upload, no error.
 * The crop modal is the real `ImageCropModal`; jsdom cannot rasterize the canvas, so Apply ships the
 * source through `onApply` → the upload path (mirrors PersonalInfoScreen.test).
 */
import { describe, expect, it, vi } from "vitest";
import { managerFeePolicy } from "@/mocks/data/manager";
import { uniswapPools } from "@/mocks/data/pools";
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../../tests/utils/renderWithProviders";
import { deriveMandate } from "../lib/deriveMandate";
import type { MandateResult } from "./MandateStep";
import { ReviewStep } from "./ReviewStep";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The mock create fires the post-write refresh (server actions need a request scope); stub it so these
// UI tests don't emit unhandled rejections (its wiring is covered by ReviewStepRefresh.test.tsx).
vi.mock("@/lib/tx/usePostWriteRefresh", () => ({ usePostWriteRefresh: () => vi.fn() }));

const pool = uniswapPools[0];

/** A mock-mode mandate with a valid (>= 10 char) name, so Launch is gated only by the logo state. */
function makeMandate(): MandateResult {
  if (!pool) throw new Error("expected at least one mock pool");
  return {
    selection: {
      name: "My Stable Yield",
      description: "Earns steady stablecoin yield from blue-chip pools.",
      logoUrl: null,
      network: pool.network,
      query: "",
      poolId: pool.id,
      full: false,
      activePreset: 10,
      minPrice: "0.99",
      maxPrice: "1.01",
    },
    pool,
    derived: deriveMandate(pool, 10),
    rangeWidthPct: 10,
  };
}

/** Stub URL.createObjectURL (so the picked-file → crop path runs) + fetch (data URL → Blob in jsdom). */
function withImageStubs(run: () => Promise<void> | void): () => Promise<void> {
  return async () => {
    const realCreate = URL.createObjectURL;
    const realFetch = global.fetch;
    URL.createObjectURL = () => "blob:mock";
    global.fetch = vi.fn(async () => ({
      blob: async () => new Blob(["x"], { type: "image/png" }),
    })) as unknown as typeof fetch;
    try {
      await run();
    } finally {
      URL.createObjectURL = realCreate;
      global.fetch = realFetch;
    }
  };
}

/** Pick a logo file then Apply the crop (ships the source through onApply → handleCropApply). */
function pickAndApplyLogo() {
  fireEvent.change(screen.getByLabelText("Add logo", { selector: "input" }), {
    target: { files: [new File(["x"], "logo.png", { type: "image/png" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
}

describe("ReviewStep logo upload (POO-701)", () => {
  // @rule R1 — a successful upload stages the trusted https URL as the logo (swaps the local preview).
  it(
    "[R1] uploads the cropped logo and stages its https URL",
    withImageStubs(async () => {
      const publicUrl = "https://cdn.pool-party.xyz/managers/0xw/strategy-logos/abc.png?v=2";
      const onUploadLogo = vi.fn(async () => publicUrl);
      renderWithProviders(
        <ReviewStep
          mandate={makeMandate()}
          feePolicy={managerFeePolicy}
          onBack={vi.fn()}
          onUploadLogo={onUploadLogo}
        />,
      );

      pickAndApplyLogo();

      await waitFor(() => expect(onUploadLogo).toHaveBeenCalledTimes(1));
      // The uploaded CDN URL becomes the rendered logo once staged.
      await waitFor(() => expect(document.querySelector(`img[src="${publicUrl}"]`)).not.toBeNull());
      // No error surfaced.
      expect(screen.queryByText("Couldn't upload the image. Try again.")).toBeNull();
    }),
  );

  // @rule R1 — a failed upload surfaces the inline error and does NOT stage a URL (the logo is not
  // silently dropped): the local crop preview is kept and the launch is not sent with a lost logo.
  it(
    "[R1] surfaces an inline error and keeps the local preview when the upload fails",
    withImageStubs(async () => {
      const onUploadLogo = vi.fn(async () => {
        throw new Error("503 MEDIA_NOT_CONFIGURED");
      });
      renderWithProviders(
        <ReviewStep
          mandate={makeMandate()}
          feePolicy={managerFeePolicy}
          onBack={vi.fn()}
          onUploadLogo={onUploadLogo}
        />,
      );

      pickAndApplyLogo();

      // The inline upload-failed error is shown (reuses the manager profile-tab copy).
      expect(await screen.findByText("Couldn't upload the image. Try again.")).toBeInTheDocument();
      // The local crop preview is kept (the "Remove" control renders only when a logo is set), and NO
      // trusted https URL was staged (the upload threw).
      expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
      expect(document.querySelector('img[src^="https://"]')).toBeNull();
    }),
  );

  // @rule R2 — Launch is blocked while the logo is uploading, so the staged https URL is resolved first
  // (mirrors the manager Profile-tab mediaUploading gate).
  it(
    "[R2] blocks Launch while the logo is uploading",
    withImageStubs(async () => {
      // A never-resolving upload keeps `logoUploading` true.
      const onUploadLogo = vi.fn(() => new Promise<string>(() => {}));
      renderWithProviders(
        <ReviewStep
          mandate={makeMandate()}
          feePolicy={managerFeePolicy}
          onBack={vi.fn()}
          onUploadLogo={onUploadLogo}
        />,
      );

      // Before any upload, the Launch CTA is ready (valid name + perf, no seed gate in mock mode).
      expect(screen.getByRole("button", { name: "Launch strategy" })).not.toHaveAttribute(
        "aria-disabled",
      );

      pickAndApplyLogo();

      // While the upload is in flight, Launch is blocked.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Launch strategy" })).toHaveAttribute(
          "aria-disabled",
          "true",
        ),
      );
    }),
  );

  // @rule R3 — mock mode (no injected onUploadLogo) is unchanged: the crop is a session-local preview,
  // nothing is uploaded, no error surfaces, and Launch is not blocked by an upload.
  it(
    "[R3] keeps the crop as a local preview in mock mode (no upload, no error)",
    withImageStubs(async () => {
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );

      pickAndApplyLogo();

      // The crop is staged locally (the "Remove" control appears), with no upload error and no block.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument(),
      );
      expect(screen.queryByText("Couldn't upload the image. Try again.")).toBeNull();
      expect(screen.getByRole("button", { name: "Launch strategy" })).not.toHaveAttribute(
        "aria-disabled",
      );
    }),
  );
});
