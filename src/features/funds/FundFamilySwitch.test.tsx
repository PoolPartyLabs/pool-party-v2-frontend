import { describe, expect, it, vi } from "vitest";
import { renderWithProviders, screen } from "../../../tests/utils/renderWithProviders";

const mocks = vi.hoisted(() => ({ enabled: false, family: "v1", hydrated: true }));
vi.mock("@/lib/features/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ isEnabled: () => mocks.enabled }),
}));
vi.mock("@/lib/hooks/useContractFamily", () => ({ useContractFamily: () => mocks }));
vi.mock("./FundExplorer", () => ({ FundExplorer: () => <p>isolated-v2-funds</p> }));

import { FundFamilySwitch } from "./FundFamilySwitch";

describe("fund family route switch", () => {
  it("R1 flag off leaves the V1 element unchanged", () => {
    mocks.enabled = false;
    mocks.family = "v2";
    renderWithProviders(<FundFamilySwitch view="explore" v1={<p>v1-original</p>} />);
    expect(screen.getByText("v1-original")).toBeInTheDocument();
    expect(screen.queryByText("isolated-v2-funds")).not.toBeInTheDocument();
  });
  it("R1 existing V2 preference selects only fund content", () => {
    mocks.enabled = true;
    mocks.family = "v2";
    mocks.hydrated = true;
    renderWithProviders(<FundFamilySwitch view="holder" v1={<p>v1-original</p>} />);
    expect(screen.getByText("isolated-v2-funds")).toBeInTheDocument();
    expect(screen.queryByText("v1-original")).not.toBeInTheDocument();
  });
  it("R1 holds a translated loading state until the existing preference hydrates", () => {
    mocks.enabled = true;
    mocks.hydrated = false;
    renderWithProviders(<FundFamilySwitch view="manager" v1={<p>v1-original</p>} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });
});
