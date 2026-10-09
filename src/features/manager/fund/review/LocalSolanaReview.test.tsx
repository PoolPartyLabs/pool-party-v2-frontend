/**
 * @id PP-MGR-CMP-102
 * @name Local shared Review regression test
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, local Review assertions.
 */
import { beforeEach, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { createSolanaBuilderDraft } from "../solana-preview/solanaBuilderRuntime";
import { LocalSolanaReview } from "./LocalSolanaReview";

const mocks = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: mocks.track }) }));
beforeEach(() => vi.clearAllMocks());

function mount(update = vi.fn()) {
  return renderWithProviders(
    <LocalSolanaReview
      draft={{ ...createSolanaBuilderDraft("now", "local"), name: "Solana intention" }}
      update={update}
      onBackToBuild={() => {}}
      onEditMandate={() => {}}
    />,
  );
}

// @rule R5/R8: shared Review stays editable, upload/quote/launch are unavailable capabilities.
it("shows the same Review cards without a file picker or zero-signature execution promise", async () => {
  const write = vi.spyOn(Storage.prototype, "setItem");
  const update = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(
    <LocalSolanaReview
      draft={{ ...createSolanaBuilderDraft("now", "local"), name: "Solana intention" }}
      update={update}
      onBackToBuild={() => {}}
      onEditMandate={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Add logo" })).toHaveAttribute("aria-disabled", "true");
  expect(screen.queryByText(/Up to 0 signatures/i)).toBeNull();
  expect(screen.queryByText(/Not available%/)).toBeNull();
  await user.type(screen.getByLabelText("Strategy name"), " edited");
  expect(update).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Launch strategy" }));
  expect(write).not.toHaveBeenCalled();
  write.mockRestore();
});

// @rule R5/R6/R8: local editable intentions do not claim EVM economics or launch capabilities.
it("keeps the shared cards and numerical intentions without unavailable financial or signing promises", () => {
  mount();
  for (const claim of [
    /before signing/i,
    /USDC on Arbitrum/i,
    /Shares start at 1 USDC/i,
    /waiting 72 hours/i,
    /after launch/i,
    /Fixed at launch/i,
    /can only go down/i,
    /Anyone can discover and invest/i,
    /paid when the strategy closes/i,
    /Wait for your USDC balance to load/i,
    /What every investor accepts when depositing/i,
    /10% to 90% of the income/i,
    /Execution and bridge settlement determine/i,
  ])
    expect(screen.queryAllByText(claim)).toHaveLength(0);
  expect(screen.queryByText("Public")).toBeNull();
  for (const title of [
    "Strategy identity",
    "Your fees",
    "Transaction fees",
    "Investor terms",
    "Your first deposit",
    "Investor preview",
    "Mandate summary",
    "Applied Build",
    "Launch steps",
  ])
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  for (const [name, value] of [
    ["Performance fee", "20"],
    ["Management fee", "0"],
    ["Instant withdrawal fee", "2"],
    ["Minimum first deposit", "100"],
    ["First deposit amount", "100"],
  ])
    expect(screen.getByRole("textbox", { name })).toHaveValue(value);
  expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
  expect(screen.queryByText("Estimate before signing")).toBeNull();
});

// @rule R6/R8: missing capabilities remain observable blocked intents, with no side effects.
it.each([
  "Add logo",
  "Max",
  "Launch strategy",
])("tracks an unavailable %s intent without file reads, draft updates or storage writes", async (name) => {
  const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
  const write = vi.spyOn(Storage.prototype, "setItem");
  const update = vi.fn();
  const user = userEvent.setup();
  const { container } = mount(update);
  const button = screen.getByRole("button", { name });
  expect(button).toHaveAttribute("aria-disabled", "true");
  expect(button).not.toBeDisabled();
  expect(container.querySelector('input[type="file"]')).toBeNull();
  await user.click(button);
  expect(mocks.track.mock.calls.filter(([event]) => event === "solana_preview_blocked")).toEqual([
    ["solana_preview_blocked"],
  ]);
  expect(update).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  read.mockRestore();
  write.mockRestore();
});
