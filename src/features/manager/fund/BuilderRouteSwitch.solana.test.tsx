/**
 * @id PP-MGR-SCR-002
 * @name BuilderRouteSwitch Solana preview integration tests
 * @implements-rules-version v2 (POO-2281)
 * @analytics-events none, asserts the user-facing emitters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractFamilyToggle } from "@/components/layout/ContractFamilyToggle";
import { __resetSolanaPreviewForTests } from "@/lib/experiments/solanaPreviewStore";
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

const local = vi.hoisted(() => ({ dirty: false, previewDirty: false, address: "account-a" }));
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ address: local.address, isAuthenticated: true, session: null }),
}));
vi.mock("./FundStrategyBuilderScreen", async () => {
  const { useUnsavedChanges } = await import("@/lib/hooks/unsavedChanges");
  return {
    FundStrategyBuilderScreen: () => {
      useUnsavedChanges(local.dirty);
      return <p>EVM builder</p>;
    },
  };
});
vi.mock("./solana-preview/SolanaStrategyPreviewScreen", async () => {
  const { useUnsavedChanges } = await import("@/lib/hooks/unsavedChanges");
  return {
    SolanaStrategyPreviewScreen: ({ onExit }: { onExit: () => void }) => {
      useUnsavedChanges(local.previewDirty);
      return (
        <>
          <p>Solana editor</p>
          <button type="button" onClick={onExit}>
            Exit preview
          </button>
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

async function selectAndReveal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "V2" }));
  await user.tripleClick(screen.getByRole("button", { name: "V2" }));
}

beforeEach(() => {
  local.dirty = false;
  local.previewDirty = false;
  local.address = "account-a";
  window.localStorage.clear();
  window.dataLayer = [];
  __resetSolanaPreviewForTests();
  __resetContractFamilyStoreForTests();
  __resetDevOverridesForTests();
  vi.stubEnv("NEXT_PUBLIC_FEATURE_FUND_CONTRACTS", "on");
});
afterEach(() => {
  cleanup();
  act(() => __resetSolanaPreviewForTests());
  __resetContractFamilyStoreForTests();
  __resetDevOverridesForTests();
  vi.unstubAllEnvs();
});

describe("local preview activation through sibling toggle and builder", () => {
  // @rule R1/R3: selecting V2 normally doesn't count toward the gesture.
  it("keeps normal V2, then reveals only after three selected presses without a new family write", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    await user.click(screen.getByRole("button", { name: "V2" }));
    await user.dblClick(screen.getByRole("button", { name: "V2" }));
    expect(screen.getByText("EVM builder")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "V2" }));
    expect(screen.getByText("Solana editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "V2 Solana" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem("pp.contractFamily")).toBe('"v2"');
    expect(window.dataLayer?.filter((row) => row.event === "contract_family_toggled")).toHaveLength(
      1,
    );
    expect(window.dataLayer?.filter((row) => row.event === "solana_preview_entered")).toHaveLength(
      1,
    );
  });

  // @rule R1: public list/detail toggles have no registered preview host.
  it("never reveals the preview from a standalone toggle", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContractFamilyToggle />);
    await selectAndReveal(user);
    expect(screen.queryByRole("button", { name: "V2 Solana" })).toBeNull();
  });

  // @rule R4: existing EVM dirty work survives Stay and mode entry requires Leave.
  it("uses the existing unsaved guard on entry", async () => {
    const user = userEvent.setup();
    local.dirty = true;
    renderWithProviders(<Host />);
    await selectAndReveal(user);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByText("Solana editor")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("EVM builder")).toBeInTheDocument();
    await user.tripleClick(screen.getByRole("button", { name: "V2" }));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByText("Solana editor")).toBeInTheDocument();
  });

  // @rule R4: pending activation is invalid after a different account or route host.
  it("does not activate from a late Leave after account change", async () => {
    const user = userEvent.setup();
    local.dirty = true;
    const view = renderWithProviders(<Host />);
    await selectAndReveal(user);
    local.address = "account-b";
    view.rerender(<Host />);
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByText("EVM builder")).toBeInTheDocument();
    expect(screen.queryByText("Solana editor")).toBeNull();
  });

  // @rule R4: an explicit accessible exit returns to V2, guarding local work.
  it("guards exit from the label and screen and returns to the EVM builder", async () => {
    const user = userEvent.setup();
    local.previewDirty = true;
    renderWithProviders(<Host />);
    await selectAndReveal(user);
    await user.click(screen.getByRole("button", { name: "V2 Solana" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("Solana editor")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Exit preview" }));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByText("EVM builder")).toBeInTheDocument();
    expect(window.localStorage.getItem("pp.contractFamily")).toBe('"v2"');
  });

  // @rule R4: route disposal clears preview, not the persisted EVM preference.
  it("resets on route disposal and restores V2 normally on remount", async () => {
    const user = userEvent.setup();
    const first = renderWithProviders(<Host />);
    await selectAndReveal(user);
    first.unmount();
    renderWithProviders(<Host />);
    expect(screen.getByText("EVM builder")).toBeInTheDocument();
    expect(screen.queryByText("Solana editor")).toBeNull();
  });
});
