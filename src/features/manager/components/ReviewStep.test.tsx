/**
 * @id PP-MGR-SCR-002
 * @name ReviewStep.test
 * Behavior: the strategy identity (name / logo / description) is edited HERE; launch is gated on a
 * valid performance fee AND a non-empty name; launching runs the automatic verification and shows
 * the live state; Save as draft shows the draft state; an out-of-range performance fee blocks
 * launch; stepping back hands the identity edits up so the wizard persists them.
 */
import { describe, expect, it, vi } from "vitest";
import { managerService } from "@/lib/services";
import { managerFeePolicy } from "@/mocks/data/manager";
import { uniswapPools } from "@/mocks/data/pools";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../tests/utils/renderWithProviders";
import { deriveMandate } from "../lib/deriveMandate";
import type { MandateResult } from "./MandateStep";
import { ReviewStep } from "./ReviewStep";

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// The mock create now fires the post-write refresh, whose server actions (revalidate*) need a
// request scope; stub it so these UI tests don't emit unhandled rejections. Its wiring is covered
// by ReviewStepRefresh.test.tsx.
vi.mock("@/lib/tx/usePostWriteRefresh", () => ({ usePostWriteRefresh: () => vi.fn() }));

const pool = uniswapPools[0];

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

describe("ReviewStep", () => {
  it("shows the disabled %/$ unit toggle (coming soon) on entry/exit and an info tooltip on each fee (POO-336)", () => {
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    // The %/$ unit toggle is display-only (coming soon) — only on the two locked entry/exit fees.
    expect(screen.getAllByTestId("fee-unit-toggle")).toHaveLength(2);
    // Each fee carries an info tooltip; the explanation doubles as the (i) trigger's accessible name.
    expect(
      screen.getByRole("button", {
        name: "A one-time fee charged on each deposit into the strategy.",
      }),
    ).toBeInTheDocument();
  });

  // @rule POO-547 R1/R2: create-pool's custom slippage no longer caps at 5%; a >5% value (e.g.
  // 12.5%) is accepted and surfaces the High-slippage warning, and Launch strategy stays enabled.
  it("[POO-547 R1/R2] accepts a >5% custom slippage in the gear and warns without blocking launch", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    // POO-550: the create-pool gear now lives in the Launch modal, so open the launch confirm first.
    await user.click(screen.getByRole("button", { name: "Launch strategy" }));
    await user.click(screen.getByRole("button", { name: "Transaction settings" }));
    const custom = await screen.findByLabelText("Custom");
    await user.clear(custom);
    await user.type(custom, "12.5");
    expect(custom).toHaveValue("12.5");
    expect(screen.getByText("High slippage")).toBeInTheDocument();
    // Close the gear; warn-only means the launch confirm stays enabled (not aria-disabled).
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getAllByRole("button", { name: "Launch strategy" }).at(-1)).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("launches (identity edited here) and shows the live state", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );

    const launch = screen.getByRole("button", { name: "Launch strategy" });
    expect(launch).not.toHaveAttribute("aria-disabled");
    // The identity editor is seeded from the lifted selection (POO-278 [R5]).
    expect(screen.getByLabelText("Strategy name")).toHaveValue("My Stable Yield");
    expect(
      screen.getByDisplayValue("Earns steady stablecoin yield from blue-chip pools."),
    ).toBeInTheDocument();
    await user.click(launch);

    // Launch confirms first (PP-MGR-MOD-002): summary rows, then the modal's confirm button.
    expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
    // The pair renders in the form preview too — the modal adds one more occurrence.
    expect(screen.getAllByText(`${pool?.token0}/${pool?.token1}`).length).toBeGreaterThanOrEqual(2);
    const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
    if (!confirm) throw new Error("expected the modal confirm button");
    await user.click(confirm);

    // Launching opens the multistep wallet-signing modal (not a generic spinner).
    expect(await screen.findByText("Continue in your wallet")).toBeInTheDocument();
    expect(screen.getByText("Creating your strategy…")).toBeInTheDocument();

    // POO-599: after the build settles, the flow pauses on the built-figures Review (the re-quote
    // countdown is unique to it). Approving there sends and settles live.
    expect(
      await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Launch strategy" }));

    // It settles to the live state once the send resolves and the mock create persists.
    expect(
      await screen.findByText("Your strategy is live", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  // @rule POO-599 R5: backing out of the built-figures Review abandons the launch — the mock persist
  // only fires on the send's success, so no phantom strategy is created.
  it("[POO-599] backing out of the Review abandons the launch and creates no strategy", async () => {
    const spy = vi.spyOn(managerService, "createStrategy");
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Launch strategy" }));
    const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
    if (!confirm) throw new Error("expected the modal confirm button");
    await user.click(confirm);
    // Reach the Review, then back out before approving.
    expect(
      await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    // Back on the form (its Launch CTA is shown again) and NO strategy was created.
    expect(await screen.findByRole("button", { name: "Launch strategy" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("saves a draft from the same form", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: "Save as draft" }));

    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
  });

  it("flags an out-of-range performance fee and blocks launch", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );

    const perf = screen.getByLabelText("Performance fee (%)");
    await user.clear(perf);
    await user.type(perf, "99");
    expect(screen.getByText("Performance fee must be between 10% and 90%.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch strategy" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // The V1 floor is 10%: a single-digit fee below it is also rejected.
    await user.clear(perf);
    await user.type(perf, "8");
    expect(screen.getByText("Performance fee must be between 10% and 90%.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch strategy" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("gates launch on a name and hands identity edits back through onBack", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={onBack} />,
    );

    // No name → no launch / save (the name now lives on this step).
    const nameInput = screen.getByLabelText("Strategy name");
    await user.clear(nameInput);
    expect(screen.getByRole("button", { name: "Launch strategy" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Save as draft" })).toBeDisabled();

    // Edit the identity, step back to Build → the wizard receives the merged selection.
    await user.type(nameInput, "Renamed Strategy");
    await user.click(screen.getByRole("button", { name: "Build" }));
    expect(onBack).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Renamed Strategy", poolId: pool?.id }),
    );
  });

  it("echoes the range in the manager's chosen (inverted) orientation, not the canonical pair", () => {
    const base = makeMandate();
    const mandate: MandateResult = {
      ...base,
      // Canonical bounds (token1/token0) stay 0.99–1.01; the manager built them in the flipped
      // orientation, so Review must echo the reciprocal pair with its label.
      selection: { ...base.selection, displayInverted: true },
    };
    renderWithProviders(
      <ReviewStep mandate={mandate} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
    );

    // Range row reads the reciprocal pair (token1/token0 = USDC/ETH) — proving the orientation flipped.
    expect(screen.getByText(/0\.99\d* – 1\.01\d* USDC\/ETH/)).toBeInTheDocument();
    // The raw canonical range string is no longer what the range row shows.
    expect(screen.queryByText("0.99 – 1.01")).not.toBeInTheDocument();
    // The pool identity row stays canonical (ETH/USDC), independent of the display orientation.
    expect(screen.getAllByText(`${pool?.token0}/${pool?.token1}`).length).toBeGreaterThanOrEqual(1);
  });

  // POO-495 (rules v1): Access + Fee tier rows on the on-page Summary card and the launch confirm
  // modal. Labels reuse "Access"/"Fee tier"; value reuses "Public". "Public" also renders in the
  // standalone Access card at the bottom of the page, so every assertion is scoped with within().
  describe("access + fee tier rows (POO-495)", () => {
    if (!pool) throw new Error("expected at least one mock pool");
    const feeTierLabel = `${(pool.feeBps / 100).toFixed(2)}%`;

    /** The on-page Summary card: the <dl> holding the summary rows. */
    function summaryCard(): HTMLElement {
      // "Summary" heading → its card container → the definition list of rows.
      const card = screen.getByText("Summary").closest("div");
      if (!card) throw new Error("expected the Summary card container");
      return card;
    }

    it("shows Fee tier and Access rows on the Summary card (R1, R2)", () => {
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      const card = within(summaryCard());
      // Fee tier row: value formatted exactly as the modal does — (feeBps / 100).toFixed(2) + "%".
      expect(card.getByText("Fee tier")).toBeInTheDocument();
      expect(card.getByText(feeTierLabel)).toBeInTheDocument();
      // Access row: label "Access", value "Public" (scoped so the standalone Access card doesn't count).
      expect(card.getByText("Access")).toBeInTheDocument();
      expect(card.getByText("Public")).toBeInTheDocument();
    });

    it("orders the Summary card rows Pool, Network, Protocol, Fee tier, Range, Category, Risk, Access (R3)", () => {
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      const labels = within(summaryCard())
        .getAllByRole("term")
        .map((dt) => dt.textContent);
      expect(labels).toEqual([
        "Pool",
        "Network",
        "Protocol",
        "Fee tier",
        "Range",
        "Category",
        "Risk",
        "Access",
      ]);
    });

    it("shows the Access row after Risk and before Performance fee in the launch confirm modal (R2, R3)", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
      const dialog = within(screen.getByRole("dialog"));
      // The Access row renders with value "Public" inside the modal.
      expect(dialog.getByText("Access")).toBeInTheDocument();
      expect(dialog.getByText("Public")).toBeInTheDocument();
      // The modal's detail labels run ... Risk, Access, Performance fee, in that order. (POO-524
      // appends receipt rows AFTER the details, so this asserts relative order, not the tail.)
      const labels = dialog.getAllByRole("term").map((dt) => dt.textContent);
      const risk = labels.indexOf("Risk");
      const access = labels.indexOf("Access");
      const perf = labels.indexOf("Performance fee");
      expect(risk).toBeGreaterThanOrEqual(0);
      expect(access).toBe(risk + 1);
      expect(perf).toBe(access + 1);
    });

    it("keeps the Fee tier value identical on the card and in the modal (R1)", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      // Card fee tier.
      expect(within(summaryCard()).getByText(feeTierLabel)).toBeInTheDocument();
      // Modal fee tier — same string, from the shared feeTierLabel const.
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
      expect(within(screen.getByRole("dialog")).getByText(feeTierLabel)).toBeInTheDocument();
    });

    it("sends the same access value it displays: createStrategy receives access public (R4, R7)", async () => {
      const spy = vi.spyOn(managerService, "createStrategy");
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      // Launch + confirm through the modal.
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
      const confirm = screen.getAllByRole("button", { name: "Launch strategy" }).at(-1);
      if (!confirm) throw new Error("expected the modal confirm button");
      await user.click(confirm);
      // POO-599: approve on the built-figures Review to send; the mock create persists on success.
      expect(
        await screen.findByText(/Refreshes in/, undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      expect(
        await screen.findByText("Your strategy is live", undefined, { timeout: 3000 }),
      ).toBeInTheDocument();
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ access: "public" }));
      spy.mockRestore();
    });
  });

  describe("launch confirm Fee row (POO-524)", () => {
    // @rule POO-524 R1 — the launch confirm gains ONE consolidated Fee row (network gas) built via
    // buildFeeRow. Mock mode uses the PP-MOCK gas constant (mirrors CollectModal's NETWORK_FEE_USD),
    // formatted as USD; there are no seed rows in mock mode (no seed step exists, no fabricated data).
    it("shows the consolidated Fee row with the mocked gas in the launch confirm (R1)", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      await user.click(screen.getByRole("button", { name: "Launch strategy" }));
      expect(await screen.findByText("Launch strategy?")).toBeInTheDocument();
      const dialog = within(screen.getByRole("dialog"));
      expect(dialog.getByText("Fee")).toBeInTheDocument();
      expect(dialog.getByText("$0.30")).toBeInTheDocument();
      // Mock mode has no seed step, so no seed rows render (no fabricated amounts).
      expect(dialog.queryByText("Seed liquidity")).not.toBeInTheDocument();
    });
  });

  // POO-586: image upload limit (10 MB, PNG/JPG only) on the strategy-logo pick handler.
  describe("[POO-586] logo upload limit", () => {
    /** A File whose reported size is `bytes` without allocating that much (jsdom reads File.size). */
    function fileOfSize(bytes: number, type: string, name = "x"): File {
      const file = new File(["x"], name, { type });
      Object.defineProperty(file, "size", { value: bytes, configurable: true });
      return file;
    }

    /** The hidden logo file input (labelled "Add logo" while no logo is set). */
    function logoInput(): HTMLInputElement {
      return screen.getByLabelText("Add logo", { selector: "input" }) as HTMLInputElement;
    }

    // @rule POO-586 R1: the logo input advertises PNG/JPG only via the accept attribute.
    it("sets accept=image/png,image/jpeg on the logo input", () => {
      renderWithProviders(
        <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
      );
      expect(logoInput()).toHaveAttribute("accept", "image/png,image/jpeg");
    });

    // @rule POO-586 R2/R3: a >10 MB file does not open the crop, shows the error, and resets the input.
    it("rejects an oversized file: no crop, shows the error, resets the input", () => {
      const createObjectURL = vi.fn(() => "blob:mock");
      const realCreate = URL.createObjectURL;
      URL.createObjectURL = createObjectURL;
      try {
        renderWithProviders(
          <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
        );
        const input = logoInput();
        fireEvent.change(input, {
          target: { files: [fileOfSize(11 * 1024 * 1024, "image/png", "big.png")] },
        });
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(screen.queryByTestId("crop-viewport")).not.toBeInTheDocument();
        expect(screen.getByText("Use a PNG or JPG under 10 MB.")).toBeInTheDocument();
        expect(input.value).toBe("");
      } finally {
        URL.createObjectURL = realCreate;
      }
    });

    // @rule POO-586 R1/R3: a wrong-type file (GIF) does not open the crop and shows the error.
    it("rejects a wrong-type file: no crop, shows the error", () => {
      const createObjectURL = vi.fn(() => "blob:mock");
      const realCreate = URL.createObjectURL;
      URL.createObjectURL = createObjectURL;
      try {
        renderWithProviders(
          <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
        );
        fireEvent.change(logoInput(), {
          target: { files: [fileOfSize(1024, "image/gif", "a.gif")] },
        });
        expect(createObjectURL).not.toHaveBeenCalled();
        expect(screen.queryByTestId("crop-viewport")).not.toBeInTheDocument();
        expect(screen.getByText("Use a PNG or JPG under 10 MB.")).toBeInTheDocument();
      } finally {
        URL.createObjectURL = realCreate;
      }
    });

    // @rule POO-586 R1/R2: a valid PNG under the limit opens the crop (no error).
    it("accepts a valid PNG: opens the crop, no error", () => {
      const realCreate = URL.createObjectURL;
      URL.createObjectURL = () => "blob:mock";
      try {
        renderWithProviders(
          <ReviewStep mandate={makeMandate()} feePolicy={managerFeePolicy} onBack={vi.fn()} />,
        );
        fireEvent.change(logoInput(), {
          target: { files: [fileOfSize(2 * 1024 * 1024, "image/png", "ok.png")] },
        });
        expect(screen.getByTestId("crop-viewport")).toBeInTheDocument();
        expect(screen.queryByText("Use a PNG or JPG under 10 MB.")).not.toBeInTheDocument();
      } finally {
        URL.createObjectURL = realCreate;
      }
    });
  });
});
