/**
 * @id PP-MGR-CMP-073 (POO-2188)
 * @name ReviewCards.test
 * @implements-rules-version v1
 * @analytics-events none: presentational cards, parent emits.
 */

import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { previewSeed, rawUsdc } from "../launch/review";
import { ReviewFeesCard } from "./ReviewFeesCard";
import { ReviewFirstDepositCard } from "./ReviewFirstDepositCard";
import { ReviewIdentityCard } from "./ReviewIdentityCard";
import { ReviewTermsCard } from "./ReviewTermsCard";

vi.mock("@/components/ui/ImageCropModal", () => ({
  ImageCropModal: (props: { open: boolean; onApply: (value: string) => void }) =>
    props.open ? (
      <button type="button" onClick={() => props.onApply("data:image/png;base64,iVBORw0KGgo=")}>
        Apply crop
      </button>
    ) : null,
}));

describe("Review identity [R1] [R2] [R3] [R5]", () => {
  it("counts trimmed names and optional descriptions, retaining edits", async () => {
    const name = vi.fn();
    const description = vi.fn();
    renderWithProviders(
      <ReviewIdentityCard
        name="  1234567890  "
        description="hello"
        imageUrl=""
        onNameChange={name}
        onDescriptionChange={description}
        onUploadLogo={vi.fn()}
      />,
    );
    expect(screen.getByText("10 / 50")).toBeInTheDocument();
    expect(screen.getByText("5 / 280")).toBeInTheDocument();
    expect(screen.getByText(/stay editable after launch/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Strategy name"), { target: { value: "new strategy" } });
    expect(name).toHaveBeenCalledWith("new strategy");
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "new description" },
    });
    expect(description).toHaveBeenCalledWith("new description");
  });
  it("refuses an invalid pick before opening the crop", async () => {
    const upload = vi.fn();
    const { container } = renderWithProviders(
      <ReviewIdentityCard
        name="A valid strategy"
        description=""
        imageUrl=""
        onNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onUploadLogo={upload}
      />,
    );
    const input = container.querySelector('input[type="file"]');
    if (!input) throw new Error("Missing logo picker");
    fireEvent.change(input, {
      target: { files: [new File(["bad"], "logo.svg", { type: "image/svg+xml" })] },
    });
    expect(await screen.findByText("Choose a PNG or JPG image up to 10 MB.")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByText("Apply crop")).not.toBeInTheDocument();
  });
  it("uploads only an applied cropped PNG and reports failure", async () => {
    const upload = vi.fn().mockRejectedValue(new Error("failed"));
    const { container } = renderWithProviders(
      <ReviewIdentityCard
        name="A valid strategy"
        description=""
        imageUrl=""
        onNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onUploadLogo={upload}
      />,
    );
    const input = container.querySelector('input[type="file"]');
    if (!input) throw new Error("Missing logo picker");
    fireEvent.change(input, {
      target: { files: [new File(["ok"], "logo.png", { type: "image/png" })] },
    });
    await userEvent.click(await screen.findByText("Apply crop"));
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/png", name: "logo.png" }),
    );
    expect(await screen.findByText(/Logo upload failed/)).toBeInTheDocument();
  });
  it("announces uploading and renders the saved logo", () => {
    renderWithProviders(
      <ReviewIdentityCard
        name="A valid strategy"
        description=""
        imageUrl="https://example.com/logo.png"
        uploading
        onNameChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onUploadLogo={vi.fn()}
      />,
    );
    expect(screen.getByText("Logo is still uploading")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.com/logo.png");
    expect(screen.getByRole("button", { name: "Change" })).toBeDisabled();
  });
});
describe("Review fee cards [R4] [R5] [R6] [R8]", () => {
  it("commits only a bounded fee on blur and steps by one percent", async () => {
    const change = vi.fn();
    renderWithProviders(
      <ReviewFeesCard performanceFeeBps={2000} managementFeeBps={0} onFeePercentChange={change} />,
    );
    const field = screen.getByRole("textbox", { name: "Performance fee" });
    fireEvent.change(field, { target: { value: "95" } });
    expect(change).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(change).toHaveBeenCalledWith("performanceFeeBps", "90");
    await userEvent.click(screen.getByRole("button", { name: "Increase Management fee" }));
    expect(change).toHaveBeenCalledWith("managementFeeBps", "1");
    expect(screen.getByRole("button", { name: "Decrease Management fee" })).toBeDisabled();
  });
  it("uses the supplied protocol rate, marks fallback and keeps access Public", () => {
    renderWithProviders(
      <ReviewTermsCard
        minimum="100"
        payoutFeeBps={200}
        feeConfiguration={{ flowFeeBps: 40, flowSource: "fallback" }}
        onMinimumChange={vi.fn()}
        onFeePercentChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Pool Party charges 0.4%/)).toBeInTheDocument();
    expect(screen.getByText("Estimated protocol rate")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.queryByText(/Operating cash/)).not.toBeInTheDocument();
  });
  it("sanitizes minimum USDC and normalizes on blur", () => {
    const change = vi.fn();
    renderWithProviders(
      <ReviewTermsCard
        minimum="100"
        payoutFeeBps={200}
        feeConfiguration={{ flowFeeBps: 25, flowSource: "fund-detail" }}
        onMinimumChange={change}
        onFeePercentChange={vi.fn()}
      />,
    );
    const field = screen.getByRole("textbox", { name: "Minimum first deposit" });
    fireEvent.change(field, { target: { value: "0100,500 USDC" } });
    expect(change).toHaveBeenCalledWith("0100.500");
    fireEvent.blur(field);
    expect(change).toHaveBeenCalledWith("100.5");
    expect(screen.queryByText("Estimated protocol rate")).not.toBeInTheDocument();
  });
});
describe("Review first deposit [R7] [R8]", () => {
  it("shows estimates from the supplied preview and Max delegates", async () => {
    const max = vi.fn();
    renderWithProviders(
      <ReviewFirstDepositCard
        seed="100"
        minimum="100"
        balance={BigInt("2500000000")}
        preview={previewSeed(BigInt("100000000"), 40)}
        onSeedChange={vi.fn()}
        onMax={max}
      />,
    );
    expect(screen.getByText("99")).toBeInTheDocument();
    expect(screen.getByText("0.4 USDC")).toBeInTheDocument();
    expect(screen.getByText("99.4 USDC")).toBeInTheDocument();
    expect(screen.getByText("0.6 USDC")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(max).toHaveBeenCalledOnce();
    expect(screen.getByText("Estimate before signing")).toBeInTheDocument();
  });
  it.each([
    ["50", "100", BigInt("2500000000"), "Your first deposit must reach the minimum first deposit."],
    [
      "3000",
      "100",
      BigInt("2500000000"),
      "Your first deposit exceeds your available USDC balance.",
    ],
    [
      "1.001",
      "1",
      BigInt("2500000000"),
      "Increase the first deposit to receive at least one whole share after the protocol fee.",
    ],
    ["100", "100", null, "Wait for your USDC balance to load before launching."],
  ])("shows the specific seed failure for %s", (seed, minimum, balance, reason) => {
    renderWithProviders(
      <ReviewFirstDepositCard
        seed={seed}
        minimum={minimum}
        balance={balance}
        preview={previewSeed(rawUsdc(seed))}
        onSeedChange={vi.fn()}
        onMax={vi.fn()}
      />,
    );
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "First deposit amount" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
  it("keeps unread balances unavailable and prevents Max", () => {
    renderWithProviders(
      <ReviewFirstDepositCard
        seed="100"
        minimum="100"
        balance={null}
        preview={null}
        onSeedChange={vi.fn()}
        onMax={vi.fn()}
      />,
    );
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Max" })).toBeDisabled();
  });
});
