/**
 * @id PP-MGR-SCR-002
 * @name BuilderRouteSwitch one builder integration tests
 * @implements-rules-version v3 (POO-2342 rules v1: one builder for V2, no Solana mode)
 * @analytics-events none, asserts the user-facing emitters.
 *
 * A click on V2 mounts one fund builder. There is no gesture, no second builder and no exit control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractFamilyToggle } from "@/components/layout/ContractFamilyToggle";
import { __resetDevOverridesForTests } from "@/lib/features/devOverrides";
import { UnsavedChangesProvider } from "@/lib/hooks/unsavedChanges";
import { __resetContractFamilyStoreForTests } from "@/lib/hooks/useContractFamily";
import {
  act,
  cleanup,
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../tests/utils/renderWithProviders";
import { BuilderRouteSwitch } from "./BuilderRouteSwitch";

const local = vi.hoisted(() => ({ address: "account-a" }));
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: local.address, isAuthenticated: true, session: null }),
}));
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./FundStrategyBuilderScreen", async () => {
  const { useState } = await import("react");
  return {
    FundStrategyBuilderScreen: (props: Record<string, unknown>) => {
      const [owner] = useState(() => {
        mounts.count += 1;
        return local.address;
      });
      return (
        <>
          <p>Fund builder</p>
          <p data-testid="owner">{owner}</p>
          <p data-testid="props">{Object.keys(props).sort().join(",")}</p>
        </>
      );
    },
  };
});

function Host() {
  return (
    <UnsavedChangesProvider>
      <ContractFamilyToggle />
      <BuilderRouteSwitch v1={<p>V1 builder</p>} />
    </UnsavedChangesProvider>
  );
}

beforeEach(() => {
  local.address = "account-a";
  mounts.count = 0;
  window.localStorage.clear();
  window.dataLayer = [];
  __resetContractFamilyStoreForTests();
  __resetDevOverridesForTests();
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FUND_CONTRACTS", "on");
});
afterEach(() => {
  cleanup();
  __resetContractFamilyStoreForTests();
  __resetDevOverridesForTests();
  vi.unstubAllEnvs();
});

describe("one builder for V2 (POO-2342)", () => {
  // @rule R1: one click on V2 opens the builder. No gesture and no flag stand in between.
  it("[R1] shows the fund builder after one click on V2", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    await user.click(screen.getByRole("button", { name: "V2" }));
    expect(screen.getByText("Fund builder")).toBeInTheDocument();
    expect(window.localStorage.getItem("pp.contractFamily")).toBe('"v2"');
  });

  // @rule R2: the label is always "V2", also after more presses. There is no Solana label or exit.
  it("[R2] keeps the V2 label after repeated presses and shows no exit control", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    await user.click(screen.getByRole("button", { name: "V2" }));
    await user.tripleClick(screen.getByRole("button", { name: "V2" }));
    expect(screen.getByRole("button", { name: "V2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "V2 Solana" })).toBeNull();
    expect(screen.queryByRole("button", { name: /exit/i })).toBeNull();
    expect(screen.getAllByText("Fund builder")).toHaveLength(1);
    expect(window.dataLayer?.some((row) => String(row.event).startsWith("solana_preview_"))).toBe(
      false,
    );
  });

  // @rule R3: one screen serves V2 and it takes the checkpoint only, with no runtime prop.
  it("[R3] mounts one builder that takes no runtime prop", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    await user.click(screen.getByRole("button", { name: "V2" }));
    expect(mounts.count).toBe(1);
    expect(screen.getByTestId("props")).toHaveTextContent("standardCheckpoint");
    expect(screen.getByTestId("props")).not.toHaveTextContent("runtime");
  });

  // @rule R3: an account change starts a new builder session, so no draft leaks to the next account.
  it("[R3] resets the builder owner when the authenticated account changes", async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<Host />);
    await user.click(screen.getByRole("button", { name: "V2" }));
    expect(screen.getByTestId("owner")).toHaveTextContent("account-a");
    local.address = "account-b";
    act(() => view.rerender(<Host />));
    expect(screen.getByTestId("owner")).toHaveTextContent("account-b");
  });
});
