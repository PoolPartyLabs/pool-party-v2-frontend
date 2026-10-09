/**
 * @id PP-MGR-CMP-101
 * @name Shared local configuration panel regression tests
 * @implements-rules-version v1 (POO-2301)
 * @analytics-events none, assertions over panel outcomes.
 */

import type { UserEvent } from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
} from "../../../../../tests/utils/renderWithProviders";
import { useBlockCopy } from "../build/blocks/blockCopy";
import { AuxiliaryBlockPanel } from "../build/panel/AuxiliaryBlockPanel";
import { PanelHarness } from "../build/panel/panelTestKit";
import type { UsePanelDraftResult } from "../build/panel/usePanelDraft";
import type { BuildPlan, ManualSwapConfig } from "../build/plan/buildPlan";
import { addToken, tokenKey, withNetworks, withProtocols } from "../mandateDraft";
import { LOCAL_PANEL_BODIES } from "./SolanaBuilderPanelBodies";
import {
  buildSolanaBuilderCatalog,
  createSolanaBuilderDraft,
  SOLANA_LOCAL_CONFIGS,
} from "./solanaBuilderRuntime";

const catalog = buildSolanaBuilderCatalog();
const networks = withNetworks(createSolanaBuilderDraft("now", "local"), ["solana"], catalog);
const wsol = catalog.tokensFor(["solana"], networks.protocols)[0];
const holdingConfig = SOLANA_LOCAL_CONFIGS.solanaHolding;
if (!wsol || !holdingConfig) throw new Error("local fixture missing");
const selected = addToken(networks, wsol, catalog);
if ("blocked" in selected) throw new Error("fixture token refused");
const draft = withProtocols(selected, ["orca", "jupiter"]);
const plan: BuildPlan = {
  version: 1,
  hub: { chains: [] },
  spokes: [
    {
      network: "solana",
      sharePct: 20,
      chains: [
        {
          id: "c",
          sharePct: 20,
          steps: [
            { id: "swap", family: "flow", kind: "swap", auto: true },
            {
              id: "lp",
              family: "position",
              kind: "solanaOrcaPool",
              config: SOLANA_LOCAL_CONFIGS.solanaOrcaPool ?? null,
            },
            { id: "fees", family: "flow", kind: "collectFees", auto: false },
          ],
        },
      ],
    },
  ],
};

/** Exercise the same V2 listbox used by the EVM panels. */
async function chooseLocalOption(user: UserEvent, field: "Token" | "Pair", option: string) {
  await user.click(screen.getByRole("button", { name: field }));
  await user.click(screen.getByRole("option", { name: option }));
}

// @rule R4: both Jupiter fields use the mint's exact identity in the shared select.
it.each([
  "Token in",
  "Token out",
] as const)("keeps case-distinct Jupiter %s options separate for checked row and keyboard choice", async (field) => {
  const variant = {
    ...wsol,
    address: wsol.address.toLowerCase(),
    symbol: "Case variant",
    locked: false,
  };
  const exactKey = tokenKey(wsol);
  const variantKey = tokenKey(variant);
  const stable = draft.tokens.find((token) => token.network === "solana" && token.locked);
  if (!stable) throw new Error("local stable missing");
  const config: ManualSwapConfig = {
    tokenInKey: field === "Token in" ? variantKey : tokenKey(stable),
    tokenOutKey: field === "Token out" ? variantKey : tokenKey(stable),
    slippagePct: 2,
  };
  const values = { config, sharePct: null };
  const panel = {
    applied: values,
    draft: values,
    dirty: false,
    leaveBlocked: false,
    leaveAttempt: 0,
    refusal: null,
    setConfig: vi.fn(),
    setShare: vi.fn(),
    apply: vi.fn(() => true),
    discard: vi.fn(),
    use: vi.fn(() => true),
    reset: vi.fn(),
  } satisfies UsePanelDraftResult;
  function Jupiter() {
    const copy = useBlockCopy();
    return (
      <AuxiliaryBlockPanel
        target={{ blockId: "jupiter", kind: "swap", network: "solana", applied: values }}
        panel={panel}
        ctx={{
          plan,
          draft: { ...draft, tokens: [...draft.tokens, variant] },
          catalog,
          violations: [],
          copy,
        }}
        onEditMandate={vi.fn()}
        onRemoveRequest={vi.fn()}
      />
    );
  }
  const user = userEvent.setup();
  renderWithProviders(<Jupiter />);
  const button = screen.getByRole("button", { name: field });
  expect(button).toHaveTextContent("Case variant");
  expect(button.querySelector("img")).toHaveAttribute(
    "src",
    "/protocols/solana-preview/solana.svg",
  );
  button.focus();
  await user.keyboard("{ArrowDown}");
  const original = screen.getByRole("option", { name: "WSOL" });
  const selected = screen.getByRole("option", { name: "Case variant" });
  expect(original).toHaveAttribute("aria-selected", "false");
  expect(selected).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("listbox")).toHaveAttribute("aria-activedescendant", selected.id);
  await user.keyboard("{Home}{Enter}");
  expect(panel.setConfig).toHaveBeenCalledWith({
    ...config,
    [field === "Token in" ? "tokenInKey" : "tokenOutKey"]: exactKey,
  });
  expect(panel.apply).not.toHaveBeenCalled();
});

it("refuses Holding WSOL outside the mandate while preserving the applied plan and pending panel", async () => {
  const onEvent = vi.fn();
  const user = userEvent.setup();
  const stableDraft = withProtocols(networks, []);
  const stablePlan: BuildPlan = {
    version: 1,
    hub: { chains: [] },
    spokes: [
      {
        network: "solana",
        sharePct: 20,
        chains: [
          {
            id: "c",
            sharePct: 20,
            steps: [
              {
                id: "holding",
                family: "position",
                kind: "solanaHolding",
                config: holdingConfig,
              },
            ],
          },
        ],
      },
    ],
  };
  renderWithProviders(
    <PanelHarness
      draft={stableDraft}
      plan={stablePlan}
      catalog={catalog}
      selectedId="holding"
      bodies={LOCAL_PANEL_BODIES}
      onEvent={onEvent}
    >
      {({ plan: current }) => <output data-testid="current-plan">{JSON.stringify(current)}</output>}
    </PanelHarness>,
  );
  const before = screen.getByTestId("current-plan").textContent;
  await chooseLocalOption(user, "Token", "WSOL");
  await user.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(screen.getByTestId("current-plan").textContent).toBe(before);
  expect(screen.getByRole("button", { name: "Token" })).toHaveTextContent("WSOL");
  expect(screen.getByRole("button", { name: "Apply changes" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
  expect(onEvent).toHaveBeenCalledWith({ type: "blocked", reason: "not_in_mandate" });
  expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "applied" }));
  await user.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.getByRole("button", { name: "Token" })).toHaveTextContent("USDC");
});

it("refuses an LP orientation Apply after Jupiter leaves, without reporting success", async () => {
  const onEvent = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(
    <PanelHarness
      draft={withProtocols(draft, ["orca"])}
      plan={plan}
      catalog={catalog}
      selectedId="lp"
      bodies={LOCAL_PANEL_BODIES}
      onEvent={onEvent}
    >
      {({ plan: current }) => <output data-testid="current-plan">{JSON.stringify(current)}</output>}
    </PanelHarness>,
  );
  const before = screen.getByTestId("current-plan").textContent;
  await chooseLocalOption(user, "Pair", "USDC / SOL");
  await user.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(screen.getByTestId("current-plan").textContent).toBe(before);
  expect(screen.getByRole("button", { name: "Pair" })).toHaveTextContent("USDC / SOL");
  expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
  expect(onEvent).toHaveBeenCalledWith({ type: "blocked", reason: "not_in_mandate" });
  expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "applied" }));
});

// @rule R5/R6/R7: traditional Fields stage changes, Discard restores and Apply owns the change.
it("uses the shared panel for local LP Apply and Discard without a fabricated pool or range", async () => {
  const onEvent = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(
    <PanelHarness
      draft={draft}
      plan={plan}
      catalog={catalog}
      selectedId="lp"
      bodies={LOCAL_PANEL_BODIES}
      onEvent={onEvent}
    >
      {({ plan: current }) => {
        const block = current.spokes[0]?.chains[0]?.steps.find(
          (step) => step.family === "position",
        );
        return <output data-testid="pair">{JSON.stringify(block?.config ?? null)}</output>;
      }}
    </PanelHarness>,
  );
  expect(screen.getByRole("button", { name: "Apply changes" })).toBeDisabled();
  const pair = screen.getByRole("button", { name: "Pair" });
  expect(pair).toHaveAttribute("aria-haspopup", "listbox");
  expect(pair.querySelectorAll("img")).toHaveLength(2);
  expect(pair.querySelector("img")).toHaveAttribute("src", "/protocols/solana-preview/solana.svg");
  expect(screen.queryByRole("combobox")).toBeNull();
  pair.focus();
  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  expect(screen.getByTestId("pair")).toHaveTextContent("SOL / USDC");
  await user.click(screen.getByRole("button", { name: "Discard" }));
  expect(screen.getByRole("button", { name: "Pair" })).toHaveTextContent("SOL / USDC");
  await chooseLocalOption(user, "Pair", "USDC / SOL");
  await user.click(screen.getByRole("button", { name: "Apply changes" }));
  expect(screen.getByTestId("pair")).toHaveTextContent("USDC / SOL");
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "applied" }));
  expect(screen.queryByText("Supply APY")).toBeNull();
  expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
});

// @rule R2/R5: EVM bodies do not mount their live read providers in the local runtime.
it("keeps an EVM card in the shared local panel with an unavailable source", () => {
  const local: BuildPlan = {
    version: 1,
    hub: {
      chains: [
        {
          id: "evm",
          sharePct: 0,
          steps: [{ id: "supply", family: "position", kind: "aaveSupply", config: null }],
        },
      ],
    },
    spokes: [],
  };
  renderWithProviders(
    <PanelHarness
      draft={{ ...draft, protocols: [...draft.protocols, "aave-v3"] }}
      plan={local}
      catalog={catalog}
      selectedId="supply"
      bodies={LOCAL_PANEL_BODIES}
    />,
  );
  expect(screen.getAllByText("Not available").length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
});

// @rule POO-2301 R5 / POO-2187 P13: zero allocation defers range, positive allocation needs verified context.
it("defers the local LP range until a positive draft allocation", async () => {
  const zeroPlan: BuildPlan = {
    ...plan,
    spokes: plan.spokes.map((spoke) => ({
      ...spoke,
      sharePct: 0,
      chains: spoke.chains.map((chain) => ({ ...chain, sharePct: 0 })),
    })),
  };
  renderWithProviders(
    <PanelHarness
      draft={draft}
      plan={zeroPlan}
      catalog={catalog}
      selectedId="lp"
      bodies={LOCAL_PANEL_BODIES}
    />,
  );
  expect(document.querySelector("[data-solana-range]")).toBeNull();
  const allocation = screen.getByRole("slider");
  allocation.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(document.querySelector("[data-solana-range]")).toHaveAttribute(
    "data-solana-range",
    "unavailable",
  );
  expect(screen.queryByRole("textbox", { name: "Min price" })).toBeNull();
});
