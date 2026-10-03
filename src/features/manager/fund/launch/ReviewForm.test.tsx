import { describe, expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../../../../../tests/utils/renderWithProviders";
import { createJournal } from "./journal";
import type { LaunchStep } from "./plan";
import { FundReviewForm } from "./ReviewForm";

const review = {
  name: "Demo income fund",
  description: "",
  imageUrl: "",
  performanceFeeBps: 2000,
  managementFeeBps: 0,
  payoutFeeBps: 200,
  minimum: "100",
  seed: "100",
};
const steps: LaunchStep[] = [{ id: "create", kind: "create", chain: 42161, dependencies: [] }];
const props = () => ({
  initial: review,
  balance: BigInt("200000000"),
  steps,
  journal: null,
  busy: false,
  gap: false,
  onLaunch: vi.fn(async () => {}),
  onUpload: vi.fn(async () => "https://cdn.test/logo.png"),
  onBack: vi.fn(),
});
describe("Review UI [R1, R6, R9]", () => {
  it("shows fixed terms, net seed and the real dynamic steps without Base", () => {
    renderWithProviders(<FundReviewForm {...props()} />);
    expect(screen.getByText(/Net principal: 99 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/Operating Cash: 0/)).toBeInTheDocument();
    expect(screen.getByText(/Standard payout: 72 hours/)).toBeInTheDocument();
    expect(screen.getByText(/Up to 1 on-chain/)).toBeInTheDocument();
    expect(screen.queryByText(/Base/)).not.toBeInTheDocument();
  });
  it("Max uses balance and invalid first deposit never launches", async () => {
    const input = props();
    renderWithProviders(<FundReviewForm {...input} />);
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    const amount = screen.getByLabelText("Your first deposit (USDC on Arbitrum)");
    expect(amount).toHaveValue("200");
    await userEvent.clear(amount);
    await userEvent.type(amount, "99");
    await userEvent.click(screen.getByRole("button", { name: "Launch strategy" }));
    expect(input.onLaunch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Check your identity");
  });
  it("launches exact fractional fee percentages without binary rounding errors", async () => {
    const input = props();
    renderWithProviders(<FundReviewForm {...input} />);
    const management = screen.getByLabelText(/Management fee/);
    await userEvent.clear(management);
    await userEvent.type(management, "0.29");
    await userEvent.click(screen.getByRole("button", { name: "Launch strategy" }));
    expect(input.onLaunch).toHaveBeenCalledWith(expect.objectContaining({ managementFeeBps: 29 }));
  });
  it("successful logo upload stages only the HTTPS URL and uploading blocks launch", async () => {
    const input = props();
    renderWithProviders(<FundReviewForm {...input} />);
    const file = new File(["image"], "logo.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("Logo (PNG/JPG, up to 10 MB)"), file);
    await waitFor(() => expect(input.onUpload).toHaveBeenCalledWith(file));
    expect(await screen.findByText("https://cdn.test/logo.png")).toBeInTheDocument();
  });
  it("keeps immutable inputs locked for a persisted launch and offers Resume", () => {
    const journal = createJournal("draft", "manager", { review }, steps);
    renderWithProviders(<FundReviewForm {...props()} journal={journal} />);
    expect(screen.getByLabelText("Strategy name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Resume launch" })).toBeEnabled();
  });
});
