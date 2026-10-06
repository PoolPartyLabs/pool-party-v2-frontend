import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x1111111111111111111111111111111111111111" as string | undefined,
  signed: true,
  load: vi.fn(),
  track: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ address: mocks.address }) }));
vi.mock("@/lib/auth/useSiweSession", () => ({
  useSiweSession: () => ({ isSignedIn: mocks.signed }),
}));
vi.mock("@/lib/services", () => ({ isMockMode: false }));
vi.mock("@/lib/analytics/useAnalytics", () => ({ useAnalytics: () => ({ track: mocks.track }) }));
vi.mock("@/lib/media/useUploadMedia", () => ({ useUploadMedia: () => vi.fn() }));
vi.mock("../../actions", () => ({ getManagerProfileAction: mocks.load }));
vi.mock("../../components/ManagerProfileTabView", () => ({
  ManagerProfileTabView: ({ profile }: { profile: { name: string } }) => <div>{profile.name}</div>,
}));

import { OverviewProfile } from "./OverviewProfile";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.address = "0x1111111111111111111111111111111111111111";
  mocks.signed = true;
});
describe("Overview profile identity", () => {
  // POO-2245 R9
  it("reuses the existing editor for the verified owner profile", async () => {
    mocks.load.mockResolvedValue({ name: "Owner profile", address: mocks.address });
    render(<OverviewProfile />);
    expect(await screen.findByText("Owner profile")).toBeInTheDocument();
  });
  it("does not read a profile without a signed-in session", () => {
    mocks.signed = false;
    render(<OverviewProfile />);
    expect(screen.getByText("session")).toBeInTheDocument();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("discards a late response when the wallet changes", async () => {
    let resolve!: (value: unknown) => void;
    mocks.load.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const old = mocks.address;
    const { rerender } = render(<OverviewProfile />);
    mocks.address = "0x2222222222222222222222222222222222222222";
    mocks.load.mockResolvedValueOnce({ name: "Second owner", address: mocks.address });
    rerender(<OverviewProfile />);
    expect(await screen.findByText("Second owner")).toBeInTheDocument();
    await act(async () => resolve({ name: "Old owner", address: old }));
    expect(screen.queryByText("Old owner")).not.toBeInTheDocument();
  });
  it("rejects a profile returned for a different session", async () => {
    mocks.load.mockResolvedValue({
      name: "Other owner",
      address: "0x2222222222222222222222222222222222222222",
    });
    render(<OverviewProfile />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("notAvailable"));
    expect(screen.queryByText("Other owner")).not.toBeInTheDocument();
  });
});
