/**
 * @id PP-MGR-CMP-097 (POO-2291)
 * @name SolanaManagePresenter stories
 * @implements-rules-version v1
 * @analytics-events none, isolated harness-only state and snapshot fixtures
 */
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useReducer } from "react";
import { fn } from "storybook/test";
import { withManagerMessages } from "../build/canvas/canvasStorySupport";
import { SolanaManagePresenter, type SolanaManagePresenterProps } from "./SolanaManagePresenter";
import {
  createSolanaManageState,
  type SolanaManageCurrent,
  type SolanaManageProtocol,
  solanaManageReducer,
} from "./solanaManageModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

/** Harness state only. No runtime import of these illustrative snapshots. */
function localState(protocol: SolanaManageProtocol = "orca") {
  return createSolanaManageState([
    { localId: "story-a", protocol, config: { allocation: "30", pair: "SOL / USDC", range: null } },
  ]);
}
const token = {
  kind: "spl" as const,
  network: "solana" as const,
  cluster: "mainnet-beta" as const,
  mint: WSOL_MINT,
  decimals: 9,
  symbol: "WSOL",
  unit: "base-units" as const,
};
const fixture: SolanaManageCurrent = {
  status: "available",
  snapshot: {
    identity: {
      protocol: "orca",
      cluster: "mainnet-beta",
      program: "11111111111111111111111111111111",
      venue: WSOL_MINT,
      positionId: USDC_MINT,
      assets: [token],
    },
    snapshotId: "illustrative-current",
    config: { allocation: "30", pair: "SOL / USDC", range: null },
    source: {
      kind: "fixture",
      fixtureId: "manage-read-only-example",
      sourceAsOf: "2026-10-08T09:59:00Z",
      slot: null,
    },
    freshness: "fresh",
    values: {
      principal: [{ token, raw: "9007199254740993" }],
      interest: null,
      fees: null,
      rewards: null,
    },
  },
};
const injected = solanaManageReducer(localState(), {
  type: "reconcile",
  localId: "story-a",
  current: fixture,
});
const edited = solanaManageReducer(injected, {
  type: "edit",
  localId: "story-a",
  patch: { allocation: "40" },
});
function Controlled(args: SolanaManagePresenterProps) {
  const [state, dispatch] = useReducer(solanaManageReducer, args.state);
  return <SolanaManagePresenter {...args} state={state} onAction={dispatch} />;
}
const meta = {
  title: "Manager/Solana Preview/Local Manage",
  component: SolanaManagePresenter,
  decorators: [withManagerMessages],
  args: {
    localId: "story-a",
    protocol: "orca",
    state: localState(),
    now: null,
    rangeContext: null,
    onAction: fn(),
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof SolanaManagePresenter>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CurrentUnavailable: Story = { render: Controlled };
export const IndependentCurrentFixture: Story = { args: { state: injected }, render: Controlled };
export const EditedChoiceFixture: Story = { args: { state: edited }, render: Controlled };
export const MoveFixture: Story = {
  args: {
    state: solanaManageReducer(edited, { type: "choose", localId: "story-a", mode: "move" }),
  },
  render: Controlled,
};
export const FutureFixture: Story = {
  args: {
    state: solanaManageReducer(edited, { type: "choose", localId: "story-a", mode: "future" }),
  },
  render: Controlled,
};
export const KaminoUnavailable: Story = {
  args: { protocol: "kamino", state: localState("kamino") },
  render: Controlled,
};
export const StaleCurrentFixture: Story = {
  args: {
    state: solanaManageReducer(injected, {
      type: "reconcile",
      localId: "story-a",
      current: {
        ...fixture,
        status: "stale",
        snapshot: fixture.snapshot ? { ...fixture.snapshot, freshness: "stale" } : null,
      },
    }),
  },
  render: Controlled,
};
export const NarrowUnavailable: Story = {
  decorators: [
    (Story) => (
      <div className="w-[320px] max-w-full">
        <Story />
      </div>
    ),
  ],
  render: Controlled,
};
