/**
 * @id PP-MGR-CMP-097 (POO-2291)
 * @name SolanaManagePresenter tests
 * @implements-rules-version v1
 * @analytics-events none, injected presenter behavior tests
 */
import { useReducer } from "react";
import { expect, it, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  userEvent,
  within,
} from "../../../../../tests/utils/renderWithProviders";
import { SolanaManagePresenter, type SolanaManagePresenterProps } from "./SolanaManagePresenter";
import {
  createSolanaManageState,
  type SolanaManageCurrent,
  type SolanaManageIdentity,
  type SolanaManageState,
  solanaManageReducer,
} from "./solanaManageModel";
import type { SolanaRangeContext } from "./solanaRangeModel";
import { USDC_MINT, WSOL_MINT } from "./solanaSchemas";

function present<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing test fixture");
  return value;
}
const now = "2026-10-08T10:00:00Z";
const source = {
  kind: "fixture" as const,
  fixtureId: "manage-test-only",
  sourceAsOf: "2026-10-08T09:59:00Z",
  slot: null,
};
const wsol = {
  kind: "spl" as const,
  network: "solana" as const,
  cluster: "mainnet-beta" as const,
  mint: WSOL_MINT,
  decimals: 9,
  symbol: "WSOL",
  unit: "base-units" as const,
};
const usdc = { ...wsol, mint: USDC_MINT, decimals: 6, symbol: "USDC" };
const identity: SolanaManageIdentity = {
  protocol: "orca",
  cluster: "mainnet-beta",
  program: "11111111111111111111111111111111",
  venue: WSOL_MINT,
  positionId: USDC_MINT,
  assets: [wsol, usdc],
};
const config = {
  allocation: "30",
  pair: "SOL / USDC" as const,
  range: { tickLower: -128, tickUpper: 128, displayInverted: false },
};
function initial(protocol: SolanaManagePresenterProps["protocol"] = "orca") {
  return createSolanaManageState([
    { localId: "a", protocol, config },
    { localId: "b", protocol, config },
  ]);
}
function current(): SolanaManageCurrent {
  return {
    status: "available",
    snapshot: {
      identity,
      snapshotId: "current-a",
      config,
      source,
      freshness: "fresh",
      values: {
        principal: [{ token: wsol, raw: "9007199254740993" }],
        interest: null,
        fees: [{ token: usdc, raw: "0" }],
        rewards: null,
      },
    },
  };
}
function ready() {
  return solanaManageReducer(initial(), { type: "reconcile", localId: "a", current: current() });
}
function edited(s = initial()) {
  return solanaManageReducer(s, { type: "edit", localId: "a", patch: { allocation: "40" } });
}
function chosen(s = ready()) {
  return solanaManageReducer(edited(s), { type: "choose", localId: "a", mode: "move" });
}
function after() {
  const s = chosen();
  return solanaManageReducer(s, {
    type: "preview",
    localId: "a",
    now,
    read: {
      status: "available",
      preview: {
        localId: "a",
        identity,
        baseSnapshotId: "current-a",
        draftRevision: present(s.instances.a).draft.revision,
        mode: "move",
        previewId: "after-a",
        validUntil: "2026-10-08T10:05:00Z",
        snapshot: {
          ...present(current().snapshot),
          snapshotId: "after-a",
          config: present(s.instances.a).draft.config,
          values: {
            principal: [{ token: wsol, raw: "1" }],
            interest: null,
            fees: null,
            rewards: null,
          },
        },
      },
    },
  });
}
function context(): SolanaRangeContext {
  return {
    protocol: "orca",
    cluster: "mainnet-beta",
    program: identity.program,
    pool: identity.venue,
    tokenA: { ...wsol, tokenProgram: identity.program, extensions: { status: "unknown" } },
    tokenB: { ...usdc, tokenProgram: identity.program, extensions: { status: "unknown" } },
    status: "available",
    source,
    tickSpacing: 64,
    tickCurrent: 0,
    sqrtPriceX64: "18446744073709551616",
    position: {
      positionId: identity.positionId,
      pool: identity.venue,
      rawLiquidity: "10",
      tickLower: -128,
      tickUpper: 128,
    },
    fee: { kind: "fixed", baseFeeRate: "3000", effectiveFeeRate: null },
    tokenBadge: { status: "unknown" },
  };
}
function props(state = initial()): SolanaManagePresenterProps {
  return { localId: "a", protocol: "orca", state, now, rangeContext: null, onAction: vi.fn() };
}
function Controlled({ state = initial() }: { state?: SolanaManageState }) {
  const [value, dispatch] = useReducer(solanaManageReducer, state);
  return <SolanaManagePresenter {...props(value)} onAction={dispatch} />;
}
// @rule R3/R8: local edits never manufacture Current or After.
it("keeps absent Current and After independent from the editable local draft", async () => {
  renderWithProviders(<Controlled />);
  expect(screen.getByRole("heading", { name: "Manage block" })).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Current" })).getAllByText("Not available").length,
  ).toBeGreaterThan(0);
  expect(
    within(screen.getByRole("region", { name: "After" })).getAllByText("Not available").length,
  ).toBeGreaterThan(0);
  const input = screen.getByRole("textbox", { name: "Allocation (%)" });
  await userEvent.clear(input);
  await userEvent.type(input, "40");
  expect(input).toHaveValue("40");
  expect(screen.getByRole("button", { name: /Move range/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Create new position/ })).toBeVisible();
});
// @rule R8: immediate and future intent remain exclusive and Review is inline.
it("preserves the draft across inline review and Back, with confirmation always unavailable", async () => {
  renderWithProviders(<Controlled state={edited()} />);
  await userEvent.click(screen.getByRole("button", { name: /Move range/ }));
  expect(screen.queryByRole("button", { name: /Create new position/ })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "Confirm & move range" })).toBeDisabled();
  expect(screen.getByText("Transaction details are unavailable.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Review move range" })).toHaveFocus();
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveAttribute("readonly");
  await userEvent.click(screen.getByRole("button", { name: "Back to settings" }));
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("40");
  await userEvent.click(screen.getByRole("button", { name: "Back to actions" }));
  expect(screen.getByRole("button", { name: /Create new position/ })).toBeVisible();
});
// @rule R8: future policy is a local intention, never a Current balance write.
it("reviews future settings without exposing Move or applying a balance", async () => {
  const action = vi.fn();
  const s = solanaManageReducer(edited(), { type: "choose", localId: "a", mode: "future" });
  renderWithProviders(<SolanaManagePresenter {...props(s)} onAction={action} />);
  expect(screen.queryByRole("button", { name: /Move range/ })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Review new deposits" }));
  expect(screen.getByRole("button", { name: "Confirm new deposits" })).toBeDisabled();
  expect(action).not.toHaveBeenCalled();
});
// @rule R2/R3/R8: exact quantities and zero remain separate; After requires its own preview.
it("renders exact independent Current and After snapshots with provenance", () => {
  renderWithProviders(<SolanaManagePresenter {...props(after())} />);
  const currentPane = within(screen.getByRole("region", { name: "Current" }));
  expect(currentPane.getByText("9007199.254740993 WSOL")).toBeVisible();
  expect(currentPane.getByText("0 USDC")).toBeVisible();
  expect(currentPane.getByText("Illustrative fixture")).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "After" })).getByText("0.000000001 WSOL"),
  ).toBeVisible();
  expect(screen.queryByText(/Total balance/)).toBeNull();
});
// @rule R3/R8: null clock and expiration hide After rather than renewing its validity.
it.each([null, "2026-10-08T10:05:00Z"])("withholds After when host clock is %s", (clock) => {
  renderWithProviders(<SolanaManagePresenter {...props(after())} now={clock} />);
  expect(
    within(screen.getByRole("region", { name: "After" })).queryByText("0.000000001 WSOL"),
  ).toBeNull();
});
// @rule R8: selection and canonical reconciliation do not erase the local draft.
it("keeps instance drafts independent and shows a canonical snapshot conflict", () => {
  const s = edited(ready());
  const view = renderWithProviders(<SolanaManagePresenter {...props(s)} />);
  view.rerender(<SolanaManagePresenter {...props(s)} localId="b" />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("30");
  const changed = current();
  present(changed.snapshot).snapshotId = "current-b";
  const conflicted = solanaManageReducer(s, { type: "reconcile", localId: "a", current: changed });
  view.rerender(<SolanaManagePresenter {...props(conflicted)} />);
  expect(screen.getByRole("textbox", { name: "Allocation (%)" })).toHaveValue("40");
  expect(screen.getByText("Current changed. Your draft is preserved.")).toBeVisible();
});
// @rule R2/R5: range uses injected protocol math, with no seed or incompatible origin.
it("uses the existing range presenter only with positive LP allocation and matching context", () => {
  const view = renderWithProviders(
    <SolanaManagePresenter {...props(ready())} rangeContext={context()} />,
  );
  expect(screen.getByRole("textbox", { name: "Min price" })).toBeVisible();
  view.rerender(
    <SolanaManagePresenter {...props(ready())} rangeContext={{ ...context(), pool: USDC_MINT }} />,
  );
  expect(screen.queryByRole("textbox", { name: "Min price" })).toBeNull();
  const zero = solanaManageReducer(ready(), {
    type: "edit",
    localId: "a",
    patch: { allocation: "0" },
  });
  view.rerender(<SolanaManagePresenter {...props(zero)} rangeContext={context()} />);
  expect(screen.queryByRole("textbox", { name: "Min price" })).toBeNull();
});
// @rule R2/R3/R8: a range context must agree with Current canonical ticks, never just the draft.
it.each([
  "different",
  "missing",
] as const)("withholds a range context when Current ticks are %s", (mismatch) => {
  const read = current();
  if (mismatch === "missing") present(read.snapshot).config = { ...config, range: null };
  const state = solanaManageReducer(initial(), { type: "reconcile", localId: "a", current: read });
  const original = context();
  const position = present(original.position);
  const rangeContext =
    mismatch === "different"
      ? { ...original, position: { ...position, tickLower: -64 } }
      : original;
  renderWithProviders(<SolanaManagePresenter {...props(state)} rangeContext={rangeContext} />);
  expect(screen.queryByRole("textbox", { name: "Min price" })).toBeNull();
});
// @rule R2/R8: changing draft ticks/orientation cannot change the Current/context comparison.
it("keeps a matching Current range available when draft ticks and orientation differ", () => {
  const state = solanaManageReducer(ready(), {
    type: "edit",
    localId: "a",
    patch: { range: { tickLower: -64, tickUpper: 192, displayInverted: true } },
  });
  renderWithProviders(<SolanaManagePresenter {...props(state)} rangeContext={context()} />);
  expect(screen.getByRole("textbox", { name: "Min price" })).toBeVisible();
});
// @rule R4/R6/R7: non-LP protocols never inherit range or LP collection.
it.each(["kamino", "holding", "jupiter"] as const)("does not give %s LP controls", (protocol) => {
  renderWithProviders(
    <SolanaManagePresenter
      {...props(initial(protocol))}
      protocol={protocol}
      rangeContext={context()}
    />,
  );
  expect(screen.queryByRole("textbox", { name: "Min price" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Collect/ })).toBeNull();
  if (protocol === "kamino")
    expect(screen.getByRole("region", { name: "Account risk" })).toHaveTextContent(
      "Verified account risk is not available.",
    );
});
// @rule R4/R8: allocation changes in lending are not presented as LP range operations.
it("mounts Kamino supplied, market and full-account risk reads before local settings", () => {
  renderWithProviders(<SolanaManagePresenter {...props(initial("kamino"))} protocol="kamino" />);
  const supply = screen.getByRole("region", { name: "Supply USDC" });
  const fields = within(supply);
  for (const label of [
    "Market",
    "Reserve",
    "Position",
    "Obligation",
    "Supplied",
    "Principal",
    "Interest",
    "Rewards",
    "Supply APY",
    "Available to withdraw",
  ]) {
    expect(fields.getByText(label, { exact: true })).toBeVisible();
  }
  expect(fields.getByRole("region", { name: "Account risk" })).toHaveTextContent(
    "Verified account risk is not available.",
  );
  expect(fields.queryByText("No debt")).toBeNull();
  expect(fields.queryByRole("combobox")).toBeNull();
  expect(fields.queryByRole("button")).toBeNull();
  expect(fields.getAllByText("Not available").length).toBeGreaterThan(0);
  const panel = screen.getByRole("region", { name: "Manage block" }).textContent ?? "";
  expect(panel.indexOf("Supplied")).toBeLessThan(panel.indexOf("Supply APY"));
  expect(panel.indexOf("Supply APY")).toBeLessThan(panel.indexOf("Available to withdraw"));
  expect(panel.indexOf("Available to withdraw")).toBeLessThan(panel.indexOf("Health factor"));
  expect(panel.indexOf("Health factor")).toBeLessThan(panel.indexOf("Allocation (%)"));
});

// @rule R4/R8: allocation changes in lending are not presented as LP range operations.
it("reviews a Kamino allocation with Apply now labels and keeps confirmation unavailable", async () => {
  const s = solanaManageReducer(edited(initial("kamino")), {
    type: "choose",
    localId: "a",
    mode: "move",
  });
  renderWithProviders(<SolanaManagePresenter {...props(s)} protocol="kamino" />);
  expect(screen.getByText("Apply now")).toBeVisible();
  expect(screen.queryByText("Move range")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }));
  expect(screen.getByRole("button", { name: "Confirm changes" })).toBeDisabled();
});
// @rule R8: journal ownership survives selection and discard, with no resend action.
it("shows the independent journal without retransmission controls", async () => {
  const s = solanaManageReducer(edited(ready()), {
    type: "journal",
    entry: {
      operationId: "op-a",
      localId: "a",
      identity,
      intentRevision: 2,
      status: "partial",
      signature: null,
      checkpoints: [{ id: "close", status: "confirmed", signature: "opaque-signature" }],
    },
  });
  renderWithProviders(<Controlled state={s} />);
  expect(screen.getByText("Partial")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByText("opaque-signature")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Retry|Resend|Execute/ })).toBeNull();
});
// @rule R8: unregistered/mismatched instances do not borrow another draft.
it("renders unavailable for unknown identity without controls", () => {
  renderWithProviders(<SolanaManagePresenter {...props()} localId="missing" />);
  expect(screen.getByText("Not available")).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
});
// @rule R8: host aggregate/capability guards apply before mode and inline review transitions.
it("reports a blocked intent when the host disallows choosing or reviewing", async () => {
  const blocked = vi.fn();
  const action = vi.fn();
  const view = renderWithProviders(
    <SolanaManagePresenter
      {...props(edited())}
      actionAllowed={false}
      onBlocked={blocked}
      onAction={action}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /Move range/ }));
  expect(blocked).toHaveBeenCalledTimes(1);
  expect(action).not.toHaveBeenCalled();
  view.rerender(
    <SolanaManagePresenter {...props(chosen())} actionAllowed={false} onBlocked={blocked} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Review move range" }));
  expect(blocked).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("button", { name: "Confirm & move range" })).toBeNull();
});
